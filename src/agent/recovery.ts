// M3c 崩溃恢复（agent-plan §4.4.9）：重启重开会话 → 扫描无终态事件的 worker →
// failed(reason=interrupted) + 恢复卡（重派 = 按原 spawn 参数再 spawn，全新 agent_id；V1 无热恢复）。
// 纯投影层：扫描是纯函数（事件 → 无终态 worker 清单）；落流与重派由调用方（会话重开 / card_action）执行。
import type { AgentEvent, AgentSpawnedEvent } from "../events";

/** 重派参数（原 spawn 参数；depends_on 不随重派——崩溃后依赖链已断，重派环为独立 spawn）。 */
export interface RespawnArgs {
  mode: "read" | "write";
  task: string;
  resources?: string[];
  max_turns?: number;
  tier?: AgentSpawnedEvent["permission_mode"];
  model?: string;
}

export interface InterruptedWorker {
  agentId: string;
  /** agent_spawned 事件本体（重派参数的来源）。 */
  spawned: AgentSpawnedEvent;
}

const TERMINAL_STATUSES = new Set(["done", "failed", "cancelled"]);

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
  };
}
