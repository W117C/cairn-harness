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

/** 固定面占**实测输入**的比例。`measuredInputTokens <= 0` ⇒ null（不许把"没数据"读成 0%）。
 *
 *  2026-09-29 改掉的一条：这里原先 `Math.min(1, …)` 封顶。封顶的理由写在用例里
 *  （「算出 >1 说明口径错了，宁可夹住也不报 130%」），但它把一个**系统性失效**夹成了一片 100%：
 *  固定面进分子之后，本仓 19 条可摊流里 **18 条估出来比整条流的实测输入还大**（中位 148%、最大 197%）
 *  ——估计大于事实＝物理不可能 ⇒ 错的是系数（池化的 `calibrateFactor` 由中文散文标定 ≈2，
 *  而面里 94% 是英文 JSON 规格 ≈4）。夹住之后那一列看起来"正常"，而一片相同的 100% 恰恰是
 *  规则 242 说的"常数的签名"。所以现在**原样返回**，超 1 由行上的 note 说破。 */
export function fixedShare(fixedTokens: number, measuredInputTokens: number): number | null {
  if (measuredInputTokens <= 0) return null;
  return fixedTokens / measuredInputTokens;
}

/** 中位数（配度量的习惯：比值一律带上下界 + 中位，不报单一均值）。空数组 ⇒ null。 */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

/** 系数自检：给定每请求固定面的字符数，返回能让**所有**流的「估计固定 ≤ 实测输入」成立的最小系数。
 *
 *  为什么要有这一位（第 185 页）：占比 >1 在物理上不可能（固定面只是输入的一部分），
 *  所以只要有一条流超了，就说明**换算系数**用错了，而不是数据错了。与其再猜一个系数，
 *  不如让数据自己说话：`share_i(f) = 面/f × 请求数 ÷ 实测输入` ⇒ `share_i ≤ 1` 等价于
 *  `f ≥ 面 × 请求数 ÷ 实测输入`，取全部流的最紧那条就是这一面的**字符/token 下界**（本仓现读：面 10,801 字符 ⇒ 下界 3.9，
 *  而 `calibrateFactor` 由中文散文标定 = 2.0 —— 差一倍多，因为面里九成以上是英文 JSON 规格）。
 *  没有可用流（请求数 0 或实测输入缺报）⇒ null（不许假装有结论）。
 *  报的是**至少**：`fixedInputTokens` 向上取整，所以按这条下界摊，最紧那一行仍可能刚好越过 1；
 *  真实可用系数只会更大，不会更小——把"至少"写成"就是它"会把一个下界当成精确阈值。 */
export function minAdmissibleFactor(
  faceChars: number,
  rows: readonly { requests: number; measuredInputTokens: number }[],
): number | null {
  if (faceChars <= 0) return null;
  let lo: number | null = null;
  for (const r of rows) {
    if (r.requests <= 0 || r.measuredInputTokens <= 0) continue;
    const need = (faceChars * r.requests) / r.measuredInputTokens;
    if (lo === null || need > lo) lo = need;
  }
  return lo;
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
      note:
        share === null
          ? "该流没有可读的 inputTokens（usage 缺报）⇒ 占比未记，不算 0"
          : share > 1
            ? "估计固定 > 该流实测输入 ⇒ 这一行的系数不成立（面里九成以上是英文规格，而系数由中文散文标定），只能当上界"
            : "",
    });
  }
  return out;
}

/** 汇总：条数、中位占比、最大占比、合计固定 token / 合计实测输入、**超过 100% 的条数**。
 *  `overshoot` 是这条尺的自检：占比 >1 在物理上不可能（固定面是输入的一部分），
 *  所以它一出现就说明系数或档归属错了——以前靠封顶把它藏起来，现在单独计一笔。 */
export function summarizePromptCost(rows: readonly PromptCostRow[]): {
  streams: number; medianShare: number | null; maxShare: number | null; fixedTotal: number; inputTotal: number; overshoot: number;
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
    overshoot: shares.filter((s) => s > 1).length,
  };
}

// ---- 每请求固定**面**（第 185 页，待办 #22）----
// 这条尺的标签一直是「每请求固定输入」，而分子只有系统提示 ⇒ 标签比取料面大。
// 真上 wire 的固定部分还包含**逐请求重发的工具规格**：本仓现读 default 档提示 670 字符、
// 序列化规格 10,131 字符（**15.1 倍**，系统提示只占固定面的 6.2% ⇒ 旧读数少记 93.8%）。
// 规格由调用方灌进来（本层刻意不 import `agent-runner`/`session-provider`，同文件头注那条纪律）。

export interface ModeFaceInput {
  mode: string;
  /** 该档每请求重发的系统提示字符数（`systemPromptFor(mode).length`）。 */
  promptChars: number;
  /** 该档的工具规格对象本身（序列化后才是真上 wire 的那一份）。 */
  specs: readonly unknown[];
}

export interface ModeFixedFace {
  mode: string;
  promptChars: number;
  /** `JSON.stringify(specs)` 的长度——不是描述文字的长度：属性名、类型、required 全都算钱。 */
  toolSpecChars: number;
  /** 每请求固定面 = 两者之和（分子的口径就写在这里，别在调用方再拼一次）。 */
  totalChars: number;
  tools: number;
}

export function fixedFaceOfMode(input: ModeFaceInput): ModeFixedFace {
  const toolSpecChars = JSON.stringify(input.specs).length;
  return {
    mode: input.mode,
    promptChars: input.promptChars,
    toolSpecChars,
    totalChars: input.promptChars + toolSpecChars,
    tools: input.specs.length,
  };
}

/** 逐档各数各的：read-only 只发 8 把工具，default/guided/auto 发 20 把 ⇒ 面本来就不同，
 *  并成一个数就是把最贵那档的成本安到最便宜的档上。 */
export function fixedFacesOfModes(inputs: readonly ModeFaceInput[]): ModeFixedFace[] {
  return inputs.map((i) => fixedFaceOfMode(i));
}

/** 旧口径（只数系统提示）在新面里的占比 ⇒ 一句"这条尺从前少看了多少"。`total<=0` ⇒ null（没尺）。 */
export function promptShareOfFixedFace(face: ModeFixedFace): number | null {
  if (face.totalChars <= 0) return null;
  return face.promptChars / face.totalChars;
}
