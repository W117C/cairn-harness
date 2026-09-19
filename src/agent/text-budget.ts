/** 进上下文的文本按 token 预算收窄——一份实现，多处复用。
 *  此前同一条政策有三份各写各的：skill 正文（plugins/skills.ts）、worker 报告（worker-report.ts）、
 *  地图渲染（map/render.ts），三家的 marker 是否计入预算、超限时留头还是留尾都不一样。
 *  口径与 compaction 一致（chars/4，向上取整），零 tokenizer 依赖。 */

export function estimateTextTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** 头部保留（关键约定写在前面），marker 与 suffix **一律计入预算**——
 *  否则「≤ 预算」这句承诺会被提示自己撑破（run_shell 的 NOTICE_RESERVE 同族坑）。
 *  未超限时逐字不变（零回归）。 */
export function clampToTokenBudget(text: string, tokenBudget: number, label: string, suffix = ""): string {
  if (estimateTextTokens(text) <= tokenBudget) return text;
  const marker = "\n[" + label + "超 " + String(tokenBudget) + " token，已截断]";
  const chars = Math.max(0, tokenBudget * 4 - marker.length - suffix.length);
  return text.slice(0, chars) + marker + suffix;
}
