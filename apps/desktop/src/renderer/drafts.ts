// 草稿落盘的单源（2026-10-18）：键、解析、读取都在这，Composer 写、App 读来给侧栏画“有草稿”标记。
// 只存非空文本；home 键（\u0000home）不入侧栏标记（首页没有会话行）。
export const DRAFTS_KEY = "cairn.composer.drafts.v1";
export const HOME_DRAFT_KEY = "\u0000home";

/** 从 localStorage 的原始字符串解析出“有非空草稿的会话 id”集合（纯函数，判卷用）。 */
export function draftIdsFrom(raw: string | null): Set<string> {
  const ids = new Set<string>();
  if (raw === null) return ids;
  try {
    const obj: unknown = JSON.parse(raw);
    if (obj === null || typeof obj !== "object") return ids;
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (k !== HOME_DRAFT_KEY && typeof v === "string" && v.trim() !== "") ids.add(k);
    }
  } catch { /* 坏数据当没有 */ }
  return ids;
}

export function readDraftIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    return draftIdsFrom(window.localStorage.getItem(DRAFTS_KEY));
  } catch {
    return new Set();
  }
}
