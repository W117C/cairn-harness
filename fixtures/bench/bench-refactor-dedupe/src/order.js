// 待办：这份也漂了（这份忘了 toLowerCase）
export function normalizeOrderEmail(raw) {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  return s.includes("@") ? s : null
}
