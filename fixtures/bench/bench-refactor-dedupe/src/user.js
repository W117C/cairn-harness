// 待办：这份是各自实现的，和 order.js 漂了（这份忘了 trim）
export function normalizeUserEmail(raw) {
  if (typeof raw !== "string") return null;
  const s = raw.toLowerCase();
  return s.includes("@") ? s : null
}
