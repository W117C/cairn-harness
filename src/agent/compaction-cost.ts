// 压缩重写代价的摊销策略（compaction amortization）。
//
// 依据是同目录那格量出来的两个读数（`outputs/prefix-churn-2026-09-23/00-实测发现.md` §5）：
// 一次阈值摘要替换后，**只有 161 / 5,486 字符仍可走缓存命中**——即「压缩一次 ≈ 整段前缀重写一次」。
// 关键结构是：缓存断点的位置 = **第一个被摘除/替换的消息**，与这次摘掉多少内容**无关**。
// 所以既然横竖要在前面断一次，就该在这一次里**多压一点**，把接下来几次的重写省掉——
// 「一次付账，拿满折扣」（pay once, take the whole discount）。
//
// 反向的代价必须说清楚：tail 是模型的**工作集**，压得越狠越容易忘掉最近的细节。
// 本模块只量缓存代价，**没有量行为质量**——所以缺省关（`enabled` 由调用方给），且永远留 `floorTokens` 底。
// 质量代价要等靶场能跑长会话时再量（见 `02` 的留尾）。
//
// 叶子模块：只 `import type`。判据在 `amortizedCompactionConfig` 这一只纯函数里，门与生产共用。
import { lcpChars } from "./prefix-churn";
import type { CompactionConfig } from "./compaction";

/** 上一轮的可缓存头部**存活到多少比例以下**就算「这次压缩很贵」。
 *  实测的合成样本里存活比例是 0.029——留了一倍余量仍判「贵」。 */
export const COMPACT_COST_HEAD_SURVIVAL_HIGH = 0.15;

/** 判「贵」之后，tail 预算乘这个系数（= 这次多压一点）。 */
export const COMPACT_TAIL_AMORTIZE_FACTOR = 0.5;

/** tail 预算的下限（token）：再往下压就是在伤最近的工作集，不划算。 */
export const COMPACT_TAIL_FLOOR_TOKENS = 1_500;

export interface HeadSurvivalReading {
  /** 相邻两轮请求里，上一轮头部仍然可缓存的比例（0–1）。 */
  share: number;
  stableChars: number;
  prevChars: number;
}

/** 用相邻两轮**真正发出去**的装配量头部存活比例（复用 `prefix-churn` 那只 LCP，不抄第二份）。
 *  `prevLayer` / `curLayer` 都取自 `serializeLayer(messages)`——与门里同一口径。 */
export function measureHeadSurvival(prevLayer: string, curLayer: string): HeadSurvivalReading {
  const stableChars = lcpChars(prevLayer, curLayer);
  return {
    share: prevLayer.length === 0 ? 1 : stableChars / prevLayer.length,
    stableChars,
    prevChars: prevLayer.length,
  };
}

export function isExpensiveRewrite(reading: HeadSurvivalReading | null): boolean {
  return reading !== null && reading.share <= COMPACT_COST_HEAD_SURVIVAL_HIGH;
}

/** 摊销后的 tail 预算（token）：把原预算乘系数，但不低于下限、不高于原值。 */
export function amortizedTailBudget(tailBudget: number, factor = COMPACT_TAIL_AMORTIZE_FACTOR, floor = COMPACT_TAIL_FLOOR_TOKENS): number {
  const scaled = Math.floor(tailBudget * factor);
  return Math.max(Math.min(scaled, tailBudget), Math.min(floor, tailBudget));
}

/** 策略本体（唯一实现点）。
 *  返回 `undefined` ⇒ 调用方原样用旧配置（**逐字节零回归**，缺省关就走这支）；
 *  返回一份 `Partial<CompactionConfig>` ⇒ 这次压缩的 tail 预算收紧（多压一点）。
 *  `overflow` 触发**永不摊销**：那是已经装不下了，少压一点只会立刻再撞一次硬闸。 */
export function amortizedCompactionConfig(opts: {
  enabled: boolean;
  headSurvival: HeadSurvivalReading | null;
  config: CompactionConfig;
  trigger?: "auto" | "manual" | "overflow";
  factor?: number;
  floorTokens?: number;
}): Partial<CompactionConfig> | undefined {
  if (!opts.enabled) return undefined;
  if (opts.trigger === "overflow") return undefined;
  if (!isExpensiveRewrite(opts.headSurvival)) return undefined;
  const c = opts.config;
  // tail 预算实际是 clamp(available × tailRatio, tailMinTokens, tailMaxTokens)（见 compaction.ts 那行），
  // 所以三个旋钮要一起收，否则只改 tailRatio 会被 tailMaxTokens 顶回去、等于没改。
  const available = Math.max(1, c.inputLimit - c.maxOutputReserve);
  const current = Math.min(Math.max(available * c.tailRatio, c.tailMinTokens), c.tailMaxTokens);
  const next = amortizedTailBudget(current, opts.factor, opts.floorTokens);
  if (next >= current) return undefined; // 已在底 ⇒ 不动（保持逐字零回归的语义，不返回「等效但不同」的对象）
  return {
    tailRatio: next / available,
    tailMaxTokens: next,
  };
}
