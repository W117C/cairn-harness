// 上下文摘录（第二十四遍「Tab 想下一条」·业主裁 A②）：Tab 触发单发模型时的会话原料。
// 只取**已成终稿**的用户/助手行（live 行还在流，半截话不喂）；最近 8 条、每条截 400 字、
// 总量封顶 2000 字（超则从最早整条丢起）——摘录是确定性纯函数（suggest.test 判卷），
// 内容生成归模型（src/main/suggest-next），这里一个字的建议都不编。
import type { StreamRow } from "./projections";

export const SUGGEST_CONTEXT_MESSAGES = 8;
export const SUGGEST_CONTEXT_PER_MESSAGE = 400;
export const SUGGEST_CONTEXT_TOTAL = 2000;

/** 摘录只关心的行型（收窄用）：用户行 + 已成终稿的助手行。 */
type SuggestRow = Extract<StreamRow, { kind: "user" } | { kind: "assistant" }>;

/** 拼「用户：…／助手：…」摘录；没有可用的行 ⇒ null（调用方给「先聊两句」提示，不硬编）。 */
export function buildSuggestContext(rows: readonly StreamRow[]): string | null {
  const picked = rows
    .filter((r): r is SuggestRow => r.kind === "user" || (r.kind === "assistant" && r.live !== true))
    .filter((r) => r.text.trim() !== "")
    .slice(-SUGGEST_CONTEXT_MESSAGES);
  if (picked.length === 0) return null;
  const lines = picked.map((r) => {
    const t = r.text.trim();
    const cut = t.length > SUGGEST_CONTEXT_PER_MESSAGE ? `${t.slice(0, SUGGEST_CONTEXT_PER_MESSAGE)}…` : t;
    return `${r.kind === "user" ? "用户：" : "助手："}${cut}`;
  });
  while (lines.length > 1 && lines.join("\n").length > SUGGEST_CONTEXT_TOTAL) lines.shift();
  return lines.join("\n");
}
