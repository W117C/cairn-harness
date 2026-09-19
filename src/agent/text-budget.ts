/** 进上下文的文本按 token 预算收窄——一份实现，多处复用。
 *  此前同一条政策有三份各写各的：skill 正文（plugins/skills.ts）、worker 报告（worker-report.ts）、
 *  地图渲染（map/render.ts），三家的 marker 是否计入预算、超限时留头还是留尾都不一样。
 *
 *  估算器按**字符类别**登记，不是一律 chars/4：CJK（含全角标点）一字≈1 token，
 *  拉丁≈4 字符一 token。一律 chars/4 会把中文段低估 3–4 倍——「≤ 2000 token」的角色块
 *  实际能到 6k+，而这种低估在纯英文测试里根本测不出来。 */

/** 宽字符（CJK 汉字/假名/注音/韩文/全角标点与字符）。用码位区间判定，避免正则表意不清。 */
function isWideAt(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0x303e) ||
    (code >= 0x3041 && code <= 0x33ff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0xa000 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe4f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x20000 && code <= 0x2fa1f)
  );
}

/** 该字符值多少 token：宽字符 1，其余 1/4。 */
function charWeight(ch: string): number {
  const code = ch.codePointAt(0) ?? 0;
  return isWideAt(code) ? 1 : 0.25;
}

function weightOf(text: string): number {
  let w = 0;
  for (const ch of text) w += charWeight(ch);
  return w;
}

/** token 估算（向上取整）。纯 ASCII 时与 compaction 的 chars/4 完全同值。 */
export function estimateTextTokens(text: string): number {
  return Math.ceil(weightOf(text));
}

/** 按权重从头部取到 allowed 为止（逐字符走，遇到超权重即停；代理对整体计一次）。 */
function cutToWeight(text: string, allowed: number): string {
  if (allowed <= 0) return "";
  let w = 0;
  let i = 0;
  for (const ch of text) {
    const cw = charWeight(ch);
    if (w + cw > allowed) break;
    w += cw;
    i += ch.length;
  }
  return text.slice(0, i);
}

/** 用调用方给的提示行收窄：措辞各有其职责（有的面要报「全文见何处」，有的门已在断言提示文案），
 *  但「按字符类别计量」与「提示行自己计入预算」是一份实现。未超限时逐字不变。 */
export function truncateToTokenBudget(text: string, tokenBudget: number, notice: string): string {
  if (estimateTextTokens(text) <= tokenBudget) return text;
  return cutToWeight(text, Math.max(0, tokenBudget - weightOf(notice))) + notice;
}

/** 头部保留（关键约定写在前面），marker 与 suffix **一律计入预算**——
 *  否则「≤ 预算」这句承诺会被提示自己撑破（run_shell 的 NOTICE_RESERVE 同族坑）。
 *  未超限时逐字不变（零回归）。 */
export function clampToTokenBudget(text: string, tokenBudget: number, label: string, suffix = ""): string {
  const marker = "\n[" + label + "超 " + String(tokenBudget) + " token，已截断]";
  return truncateToTokenBudget(text, tokenBudget, marker + suffix);
}
