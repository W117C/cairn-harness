// M3c 崩溃恢复（agent-plan §4.4.9）：重启重开会话 → 扫描无终态事件的 worker →
// failed(reason=interrupted) + 恢复卡（重派 = 按原 spawn 参数再 spawn，全新 agent_id；V1 无热恢复）。
// 纯投影层：扫描是纯函数（事件 → 无终态 worker 清单）；落流与重派由调用方（会话重开 / card_action）执行。
import { AGENT_PERMISSION_MODES } from "../events";
import type { AgentEvent, AgentSpawnedEvent } from "../events";

/** 重派参数（原 spawn 参数；depends_on 不随重派——崩溃后依赖链已断，重派环为独立 spawn）。 */
export interface RespawnArgs {
  mode: "read" | "write";
  task: string;
  resources?: string[];
  max_turns?: number;
  tier?: AgentSpawnedEvent["permission_mode"];
  model?: string;
  /** 原角色名（缺席 = 当初没带角色面）。重派必须带它：角色决定工具剔除面与提示词面，
   *  丢了就等于**换了一张角色面重跑**，而用户看到的只是「按原参数重派」。 */
  role?: string;
}

export interface InterruptedWorker {
  agentId: string;
  /** agent_spawned 事件本体（重派参数的来源）。 */
  spawned: AgentSpawnedEvent;
}

const TERMINAL_STATUSES = new Set(["done", "failed", "cancelled"]);

/** 崩溃恢复「重派」时该用哪个父档位——**只采信这条会话历史上真用过的档**，两条来源都没有才交回兜底值。
 *
 *  为什么不能直接读 `settings.mode`：那个键的语义是「**新对话**开始时使用的权限档」（设置页原话）。
 *  拿它当一条*已存在*会话的父档 ⇒ 用户全局默认是 auto 时，一条崩溃过的 read-only 会话重派回来就顶着
 *  auto 的帽子，于是 worker 档位那两道闸（`clampTier` 的上限、read-only 父不得派 write）一起被换松一档
 *  （§11.7.6 单调继承：worker ≤ 父）。方向单向变宽 ⇒ 这是权限问题，不是读数问题。
 *
 *  来源优先级（都取**最后一条**，即用户最近一次的选择）：
 *  ① 主会话自己的 `tool_result.gate.mode` —— 每次权限判定都留痕，evaluate 一侧必带；
 *     worker 子流的 tool_result 也落在同一条主流 JSONL 上（M3a），所以**必须按 `agent_id` 排除**：
 *     那是裁过之后的子档，当父档用两向都可能错。
 *  ② 最近一次 `agent_spawned.permission_mode` —— 同样 ≤ 父 ⇒ 宁可更严，不会更宽。
 *  ③ 都没有 ⇒ 返回调用方给的兜底（并如实：这一格没有会话级证据）。 */
export function recoveryParentMode(
  events: readonly AgentEvent[],
  fallback: AgentSpawnedEvent["permission_mode"],
): AgentSpawnedEvent["permission_mode"] {
  const known = new Set<string>(AGENT_PERMISSION_MODES);
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type !== "tool_result" || e.agent_id !== undefined) continue;
    const mode = e.gate?.mode as AgentSpawnedEvent["permission_mode"] | undefined;
    if (mode !== undefined && known.has(mode)) return mode;
  }
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type === "agent_spawned" && known.has(e.permission_mode)) return e.permission_mode;
  }
  return fallback;
}

/** 无终态 worker 扫描（纯函数）：有 agent_spawned、其后无任何终态 agent_status 的 agent。
 *  幂等：一旦补发 failed(interrupted)，重扫即见终态，不再重复标记。 */
export function interruptedWorkers(events: readonly AgentEvent[]): InterruptedWorker[] {
  const spawned = new Map<string, AgentSpawnedEvent>();
  const dead = new Set<string>();
  for (const e of events) {
    if (e.type === "agent_spawned") spawned.set(e.agent_id, e);
    else if (e.type === "agent_status" && TERMINAL_STATUSES.has(e.status)) dead.add(e.agent_id);
  }
  const out: InterruptedWorker[] = [];
  for (const [agentId, spawnedEvent] of spawned) {
    if (!dead.has(agentId)) out.push({ agentId, spawned: spawnedEvent });
  }
  return out.sort((a, b) => a.spawned.parent_event_id - b.spawned.parent_event_id);
}

/** agent_spawned → 重派 SpawnArgs（纯函数；恢复的「重派」= 全新 agent_id 重新 spawn，§4.4.9）。 */
export function respawnArgsFrom(spawned: AgentSpawnedEvent): RespawnArgs {
  return {
    mode: spawned.mode === "write" ? "write" : "read",
    task: spawned.task,
    ...(spawned.resources !== undefined && spawned.resources.length > 0 ? { resources: spawned.resources } : {}),
    ...(spawned.max_turns !== undefined ? { max_turns: spawned.max_turns } : {}),
    ...(spawned.permission_mode !== undefined ? { tier: spawned.permission_mode } : {}),
    ...(spawned.model !== undefined ? { model: spawned.model } : {}),
    ...(spawned.role !== undefined ? { role: spawned.role } : {}),
  };
}
