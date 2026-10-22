// 草稿落盘的单源（2026-10-18）：键、解析、读取都在这，Composer 写、App 读来给侧栏画“有草稿”标记。
// 只存非空文本；home 键（\u0000home）不入侧栏标记（首页没有会话行）。
import { sessionKeyOf } from "./state/session-identity";

export const DRAFTS_KEY = "cairn.composer.drafts.v1";
export const HOME_DRAFT_KEY = "\u0000home";

/** 草稿桶键：会话用「工作区+id」引用键（两个已登记工作区里同秒同 id 的会话不串稿）；
 *  首页用常量键；工作区未知退回裸 id（与 runKey 同口径，旧行为可用）。 */
export function draftKeyFor(workspace: string | null | undefined, sessionId: string | null): string {
  if (sessionId === null) return HOME_DRAFT_KEY;
  return sessionKeyOf(workspace, sessionId) ?? sessionId;
}

/** 草稿键里的会话 id：引用键与旧裸 id 都认；home ⇒ null。旧裸 id 桶的懒迁移用。 */
export function sessionIdOfDraftKey(key: string): string | null {
  if (key === HOME_DRAFT_KEY) return null;
  if (!key.startsWith("[")) return key;
  try {
    const parsed: unknown = JSON.parse(key);
    if (Array.isArray(parsed) && parsed.length === 2 && typeof parsed[1] === "string" && parsed[1] !== "") return parsed[1];
  } catch { /* 坏键当裸 id */ }
  return key;
}

/** 从 localStorage 的原始字符串解析出“有非空草稿的桶键”集合（纯函数，判卷用；键的形态见 draftKeyFor）。 */
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
