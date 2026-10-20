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

/** 把一条草稿从 `fromId` 搬到 `toId`（**纯函数**：桶原文进、桶原文出；判卷不用 DOM）。
 *
 *  用途（2026-10-20 独立评审追出，LOW-MEDIUM）：「回到原会话」会删掉那条「第 1 轮编辑建的空分支」，
 *  而用户**还没发出去的编辑稿**存在那条分支的草稿键下 ⇒ 删会话不删草稿 ⇒ 稿子变成**孤儿**
 *  （那条会话没了，谁也读不到它）⇒ 用户以为自己写的字还在，其实没了。
 *  修法：删之前把稿子**搬到用户要回去的那条会话**上（不是丢掉，也不是留在孤儿键里）。
 *
 *  为什么是「搬」而不是「不删那条会话」：那条分支的使命就是"第 1 轮编辑的临时副本"，
 *  0 字节 + 没有发言 ⇒ 留着只是侧栏一行垃圾；而稿子该跟着用户走。
 */
export function moveDraftInBucket(raw: string | null, fromId: string, toId: string): string | null {
  if (raw === null) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null; // 坏数据当没有（不猜、不造）
  }
  if (obj === null || typeof obj !== "object") return null;
  const bucket = obj as Record<string, unknown>;
  const from = bucket[fromId];
  if (typeof from !== "string" || from.trim() === "") return null;
  const next: Record<string, unknown> = { ...bucket };
  next[toId] = from;
  delete next[fromId];
  return JSON.stringify(next);
}

/** 真搬（读-改-写 localStorage；存不下/坏数据 = 静默不动，用户那点字不能被我们弄丢）。 */
export function moveDraftBetweenSessions(fromId: string, toId: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = window.localStorage.getItem(DRAFTS_KEY);
    const next = moveDraftInBucket(raw, fromId, toId);
    if (next === null) return false;
    window.localStorage.setItem(DRAFTS_KEY, next);
    return true;
  } catch {
    return false;
  }
}
