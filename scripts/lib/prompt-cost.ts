/** 生产系统提示的**固定开销**算法（纯函数，供 `tests/prompt-cost.test.ts` 消费）。
 *  不 import `agent-runner`（那是别人的在飞文件，且会把整个 runner 拖进判卷进程）——
 *  提示文本由调用方灌进来，这里只算"每请求固定付多少、在一个会话里占输入多少"。
 *
 * 为什么值得单独一层（能力 9「成本可观测」/ 目标「消耗 token 最少」）：
 *  第 89 页那组 A/B 说明"长提示没换来准确率"，但它的**幅度**受同配置抖动 3.34× 限制、要等复跑；
 *  而固定开销这部分**不需要花真钱**——它是 `提示长度 × 请求数` 的算术，
 *  在既有 usage 事件上直接可测。把这两件事分开，能立刻用的结论就不会被"还得再跑几轮"拖住。
 */

/** 一次请求里，系统提示那份固定输入。`factor` = 每 token 多少字符（仓里 `calibrateFactor` 的产物）。 */
export function fixedInputTokens(promptChars: number, requests: number, factor: number): number {
  if (requests <= 0 || factor <= 0) return 0;
  return Math.ceil(promptChars / factor) * requests;
}

/** 固定开销占**实测输入**的比例。`measuredInputTokens <= 0` ⇒ null（不许把"没数据"读成 0%）。 */
export function fixedShare(fixedTokens: number, measuredInputTokens: number): number | null {
  if (measuredInputTokens <= 0) return null;
  return Math.min(1, fixedTokens / measuredInputTokens);
}

/** 中位数（配度量的习惯：比值一律带上下界 + 中位，不报单一均值）。空数组 ⇒ null。 */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

export interface PromptCostRow {
  file: string;
  /** 请求数 = 该流里 usage 事件的条数（一条 usage = 一次真实请求的回报）。 */
  requests: number;
  fixedTokens: number;
  measuredInputTokens: number;
  share: number | null;
  /** `share` 为 null 的原因要说出来（规则 82：缺字段说"未记"，不许读成全量或 0）。 */
  note: string;
}

/** 逐文件算一行。**只有 usage 事件的流才进表**（问答流没请求 ⇒ 无从摊）。 */
export function promptCostRows(
  perFile: readonly { file: string; requests: number; measuredInputTokens: number }[],
  opts: { promptChars: number; factor: number },
): PromptCostRow[] {
  const out: PromptCostRow[] = [];
  for (const f of perFile) {
    if (f.requests <= 0) continue;
    const fixedTokens = fixedInputTokens(opts.promptChars, f.requests, opts.factor);
    const share = fixedShare(fixedTokens, f.measuredInputTokens);
    out.push({
      file: f.file,
      requests: f.requests,
      fixedTokens,
      measuredInputTokens: f.measuredInputTokens,
      share,
      note: share === null ? "该流没有可读的 inputTokens（usage 缺报）⇒ 占比未记，不算 0" : "",
    });
  }
  return out;
}

/** 汇总：条数、中位占比、最大占比、合计固定 token / 合计实测输入。 */
export function summarizePromptCost(rows: readonly PromptCostRow[]): {
  streams: number; medianShare: number | null; maxShare: number | null; fixedTotal: number; inputTotal: number;
} {
  const shares = rows.map((r) => r.share).filter((s): s is number => s !== null);
  const fixedTotal = rows.reduce((n, r) => n + r.fixedTokens, 0);
  const inputTotal = rows.reduce((n, r) => n + r.measuredInputTokens, 0);
  return {
    streams: rows.length,
    medianShare: median(shares),
    maxShare: shares.length === 0 ? null : Math.max(...shares),
    fixedTotal,
    inputTotal,
  };
}
