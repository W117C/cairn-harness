// 已停目标的「隐藏」持久化（2026-10-18）：此前只在内存，重启后已停芯片会重新出现。
// 按「工作区 + 会话 id」记账（at 只是该会话事件流里的下标，跨会话不可比；同 id 跨工作区
// 也是两场会话）。旧版本按裸 id 存的记录只在工作区未知时回退读取；工作区已知时不再让
// 一条隐藏记录跨根误伤另一场会话。坏数据当没有；只收数字。
import { sessionKeyOf } from "./state/session-identity";

const KEY = "cairn.goal.dismissed.v1";

export function dismissedFrom(raw: string | null): Map<string, number> {
  const out = new Map<string, number>();
  if (raw === null) return out;
  try {
    const obj: unknown = JSON.parse(raw);
    if (obj === null || typeof obj !== "object") return out;
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (typeof v === "number" && Number.isInteger(v)) out.set(k, v);
    }
  } catch { /* 坏数据当没有 */ }
  return out;
}

export function readDismissedGoals(): Map<string, number> {
  if (typeof window === "undefined") return new Map();
  try {
    return dismissedFrom(window.localStorage.getItem(KEY));
  } catch {
    return new Map();
  }
}

export function writeDismissedGoals(m: Map<string, number>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(m)));
  } catch { /* 存不下则本会话内生效 */ }
}

/** 目标隐藏记录的持久化键：有可信工作区用引用键，否则保留旧裸 id 形态。 */
export function dismissedGoalKey(workspace: string | null | undefined, sessionId: string): string {
  return sessionKeyOf(workspace, sessionId) ?? sessionId;
}

/** 读一条隐藏记录：已知工作区只认限定键，绝不拿另一棵根的裸 id 记录顶替。 */
export function dismissedGoalAt(
  goals: ReadonlyMap<string, number>,
  workspace: string | null | undefined,
  sessionId: string | null | undefined,
): number | undefined {
  if (sessionId === null || sessionId === undefined || sessionId === "") return undefined;
  const key = sessionKeyOf(workspace, sessionId);
  return goals.get(key ?? sessionId);
}
