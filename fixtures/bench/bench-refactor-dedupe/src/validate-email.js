// 统一口径：trim + toLowerCase，含 @ 才合法。不合法返回 null。
export function normalizeEmail(raw) {
  if (typeof raw !== "string") return null;
  const s = raw.trim().toLowerCase();
  return s.includes("@") ? s : null
}
