// 已停目标的「隐藏」持久化（2026-10-18）：此前只在内存，重启后已停芯片会重新出现。
// 按会话 id 记账（at 只是该会话事件流里的下标，跨会话不可比）。坏数据当没有；只收数字。
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
