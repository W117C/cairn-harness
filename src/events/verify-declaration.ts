// 会话声明的「当前任务」窗口：只认用户/宿主写进 session_meta / session_meta_update 的判据。
//
// 这个纯函数住在 events 层：事件形状、轮界与回退边界都属协议面；agent/context.ts 与
// events/session-view.ts 两处读者共用它，不各写一份「上一轮用户消息在哪」的判定。
import { isNumericCompaction, type AgentEvent, type VerifyDeclaration } from "./types";

/** 日志里的声明字段是不是可投影的纯数据（不执行、不读盘）。
 *  校验失败的声明按「没有有效判据」处理，绝不静默拿仓库配置顶替。
 *  超时上下限与 `src/agent/verify.ts` 的 MIN/MAX_VERIFY_TIMEOUT_MS 同值；事件层保持零依赖。 */
export function isVerifyDeclaration(raw: unknown): raw is VerifyDeclaration {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return false;
  const r = raw as { commands?: unknown; timeoutMs?: unknown; note?: unknown };
  if (!Array.isArray(r.commands) || r.commands.length === 0) return false;
  if (r.commands.some((c) => typeof c !== "string" || c.trim() === "")) return false;
  if (r.note !== undefined && typeof r.note !== "string") return false;
  if (r.timeoutMs !== undefined &&
      (typeof r.timeoutMs !== "number" || !Number.isInteger(r.timeoutMs) ||
       r.timeoutMs < 1_000 || r.timeoutMs > 900_000)) return false;
  return true;
}

export interface EffectiveVerifyDeclaration {
  declaration: VerifyDeclaration;
  origin: "session_meta" | "session_meta_update";
  /** 声明在传入数组里的 1-based 行号（只作审计，不写回日志）。 */
  eventId: number;
  /** 契约该注入在哪条用户消息之后（1-based）；0 = 日志里还没有用户消息，放上下文开头。 */
  anchorEventId: number;
}

const NO_EXCLUDED: ReadonlySet<number> = new Set<number>();

function hasWorkerId(event: AgentEvent): boolean {
  return "agent_id" in event && typeof event.agent_id === "string" && event.agent_id.length > 0;
}

function isContinuation(event: AgentEvent): boolean {
  if (event.type !== "user_message") return false;
  const kind = event.origin?.kind;
  return kind === "goal" || kind === "steering";
}

function previousUser(events: readonly AgentEvent[], before: number, excluded: ReadonlySet<number>): number {
  for (let i = before - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.type === "user_message" && !hasWorkerId(e) && !excluded.has(i + 1)) return i;
  }
  return -1;
}

/** 上一件**真正由人发起**的任务：goal 续跑/轮中插话不另算一轮。 */
function previousTaskUser(events: readonly AgentEvent[], before: number, excluded: ReadonlySet<number>): number {
  for (let i = before - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.type === "user_message" && !hasWorkerId(e) && !excluded.has(i + 1) && !isContinuation(e)) return i;
  }
  return -1;
}

/** 压缩摘除的 1-based 行号（与 `agent/context.ts#excludedIds` 同口径，但不反向依赖 agent 层）。
 *  M3c：worker 子流压缩（agent_id 在场）不参与——它的 id 是 worker 内存态事件序，
 *  对主表照搬会错摘主事件（同 context.ts 头注释）。测试用它钉这条同口径契约。
 *  `offset` 用于把每个来源文件里的物理行号折进一份合成事件表。 */
export function declarationExcludedIds(events: readonly AgentEvent[], offset = 0): Set<number> {
  const out = new Set<number>();
  events.forEach((e, i) => {
    if (e.type === "compaction" && isNumericCompaction(e) && !hasWorkerId(e)) {
      for (const id of e.compressed_event_ids) out.add(offset + id);
    }
  });
  return out;
}

/** 当前任务窗口里最后一条合法声明；坏声明 fail-closed（不投影，也不退回更早一条）。
 *
 *  窗口定义：从「本任务第一条用户消息」之前那条用户消息之后开始，到有效边界为止。
 *  `goal` 自动续跑与 `steering` 轮中插话属于同一任务，不重置窗口；
 *  真正的新用户消息会把旧任务的声明留在窗口之外，避免 `--verify` 跨轮泄漏。
 *  若在任务开始之后又遇到一条非续跑的用户消息，立即停止（防御性 fail-closed）。
 *  一条用户消息都没有时，声明仍生效并锚在上下文开头（宿主可以先写判据再写任务）。
 */
export function findEffectiveVerifyDeclaration(
  events: readonly AgentEvent[],
  boundary = events.length,
  excluded: ReadonlySet<number> = NO_EXCLUDED,
): EffectiveVerifyDeclaration | null {
  const limit = Math.min(events.length, boundary);
  const lastUserIdx = previousUser(events, limit, excluded);
  if (lastUserIdx < 0) return scan(events, 0, limit, -1, excluded);

  // 轮中插话 / goal 续跑往前回溯到真正开启这件任务的那条用户消息。
  let taskStartIdx = lastUserIdx;
  for (;;) {
    if (!isContinuation(events[taskStartIdx]!)) break;
    const prev = previousUser(events, taskStartIdx, excluded);
    if (prev < 0) break; // 日志左边界之外没有更早的用户消息
    taskStartIdx = prev;
  }
  const windowStart = previousTaskUser(events, taskStartIdx, excluded) + 1;
  return scan(events, windowStart, limit, taskStartIdx, excluded);
}

function scan(
  events: readonly AgentEvent[],
  from: number,
  limit: number,
  taskStartIdx: number,
  excluded: ReadonlySet<number>,
): EffectiveVerifyDeclaration | null {
  let found: EffectiveVerifyDeclaration | null = null;
  for (let index = from; index < limit; index++) {
    const event = events[index]!;
    const eventId = index + 1;
    if (taskStartIdx >= 0 && index > taskStartIdx &&
        event.type === "user_message" && !hasWorkerId(event) && !isContinuation(event)) break;
    if (excluded.has(eventId) || hasWorkerId(event)) continue;
    if (event.type !== "session_meta" && event.type !== "session_meta_update") continue;
    const raw = (event as { verify?: unknown }).verify;
    if (raw === undefined) continue;
    const declaration = isVerifyDeclaration(raw) ? { ...raw } : null;
    found = declaration === null
      ? null
      : { declaration, origin: event.type, eventId, anchorEventId: taskStartIdx + 1 };
  }
  return found;
}
