// 置顶会话的手工顺序（2026-10-31，R3）：参考库 DraggableSessionList 的 pinnedOrder。
// 只排「置顶段」；时间桶仍按时间，跨工作区用 `workspace\0id` 作键（id 可跨项目撞名）。
// 持久化走 localStorage（单窗渲染层偏好），不改会话 metadata / IPC——顺序是视图偏好，不是会话事实。
export const PINNED_ORDER_KEY = "cairn.sidebar.pinnedOrder";

export type DropPosition = "before" | "after";

export interface OrderableSession {
  id: string;
  workspace: string;
  pinned?: boolean;
  archived?: boolean;
}

export function orderKeyOf(s: { id: string; workspace: string }): string {
  return `${s.workspace}\u0000${s.id}`;
}

export function parsePinnedOrder(raw: string | null): string[] {
  if (raw === null || raw === "") return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.filter((value): value is string => typeof value === "string" && value !== ""))];
  } catch {
    return [];
  }
}

/** 置顶段按手工顺序排；不在顺序表里的置顶项保持原相对序、排在其后；非置顶项原样。 */
export function applyPinnedOrder<T extends OrderableSession>(list: readonly T[], order: readonly string[]): T[] {
  if (order.length === 0) return [...list];
  const rank = new Map(order.map((key, index) => [key, index]));
  return [...list].sort((a, b) => {
    if (a.pinned !== true || b.pinned !== true) return 0;
    const ra = rank.get(orderKeyOf(a));
    const rb = rank.get(orderKeyOf(b));
    if (ra === undefined && rb === undefined) return 0;
    if (ra === undefined) return 1;
    if (rb === undefined) return -1;
    return ra - rb;
  });
}

/** 把 dragKey 移到 targetKey 的前/后；两者缺表时先补进表尾，再移动。 */
export function moveInOrder(
  order: readonly string[],
  dragKey: string,
  targetKey: string,
  position: DropPosition,
): string[] {
  if (dragKey === targetKey) return [...order];
  const base = [...order];
  for (const key of [dragKey, targetKey]) {
    if (!base.includes(key)) base.push(key);
  }
  const next = base.filter((key) => key !== dragKey);
  const at = next.indexOf(targetKey);
  if (at === -1) return [...next, dragKey];
  next.splice(position === "before" ? at : at + 1, 0, dragKey);
  return next;
}
