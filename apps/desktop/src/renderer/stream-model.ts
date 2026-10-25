import type { StreamRow } from "./projections";

/** 目录/摘要行的单行摘要：空白折叠为单空格，超长截断加省略号（不编造内容）。 */
export function truncateSummary(text: string, max = 42): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : flat.slice(0, max) + "…";
}

/** 对话目录数据：从流行里取用户轮（round + 首句摘要），顺序即轮序。 */
export function turnSummaries(rows: readonly StreamRow[]): Array<{ round: number; text: string }> {
  return rows
    .filter((r): r is Extract<StreamRow, { kind: "user" }> => r.kind === "user")
    .map((r) => ({ round: r.round, text: truncateSummary(r.text) }));
}

export { foldAllButLast } from "./fold-rounds";

/** 该轮可否折叠：运行中的最后一轮不可（折叠 = 把正在流的内容藏起来，禁止）。 */
export function canFoldRound(round: number, lastRound: number | null, streaming: boolean): boolean {
  return !(streaming && round === lastRound);
}
