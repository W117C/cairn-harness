// 裁剪的分批策略：把「每次省一点」换成「攒够一次剪」，因为**重写前缀的次数**才是隐藏成本。
//
// 为什么值得单独立一层（这条不是省 token 的调参）：本仓今天能在自己 instruments 上量到——
// `prefix-churn-check` PC6 实测「老工具结果每越出保护区一次，就作废 ~40,299 字符的已发前缀」，
// 而 `prune` 的触发是**逐条**的：一轮多一条候选就多一次整段重写。
// 反面参照是压缩：一次生产尺度压缩实测只剩 161 / 509,802 字符可缓存（`long-horizon-probe` §2.2），
// 也就是说「断一次前缀」很贵，但**断第二次不比第一次便宜多少** ⇒ 该断的时候多干点活。
//
// 与 `compaction-cost.ts` 的关系是同一条原理的两个方向：
// 压缩是「已经要断了就一次多压一点」（收 tail），裁剪是「还没到断的时机就先别断」（攒批）。
//
// 缺省关（`enabled` 由调用方给）：关掉时 `apply` 恒真 ⇒ 与今天逐字同行为，零回归。
// 唯一不许攒的情形：**头寸已经紧**。宁可多断一次前缀，也不能因为攒着不剪去撞最终硬闸——
// 那是把「省缓存」做成「会话直接失败」。

/** 攒够多少节省 token 才值得断一次前缀。取 `PRUNE_MINIMUM_TOKENS`（20,000）的 2 倍：
 *  单次最小裁剪量刚好过闸就剪，等于把重写次数做到上限。 */
export const PRUNE_BATCH_MIN_SAVED_TOKENS = 40_000;

/** 估算输入占到「可用预算」的这个比例以内都不算紧张（可以继续攒）；超过就照旧剪。
 *  0.85 = 留 15% 余量，覆盖一轮之间可能长出来的东西与估算误差。 */
export const PRUNE_BATCH_PRESSURE_RATIO = 0.85;

export interface PruneBatchDecision {
  apply: boolean;
  /** 为什么不剪（或为什么照剪）——一句话，测试与门都读它，别只读布尔。 */
  why: string;
  savedTokens: number;
  threshold: number;
}

export function shouldApplyPrune(opts: {
  enabled: boolean;
  /** **增量**：本轮新越界那几条能省的 token（不是累计可省）。
   *  拿累计值判会把策略判成恒真——候选集每轮都含上一轮那几条，"已经攒够"就再也不会推迟。
   *  这个坑是本格的 A/B 先跑成「两支逐字同值」之后才定位到的。 */
  savedTokens: number;
  /** 本轮装配的估算 token（与压缩触发同一把尺：`estimateContextTokens`）。 */
  estimatedTokens: number;
  /** 可用输入预算 = inputLimit − maxOutputReserve。 */
  availableTokens: number;
  minSavedTokens?: number;
  pressureRatio?: number;
}): PruneBatchDecision {
  const minSaved = opts.minSavedTokens ?? PRUNE_BATCH_MIN_SAVED_TOKENS;
  const pressure = opts.pressureRatio ?? PRUNE_BATCH_PRESSURE_RATIO;
  if (!opts.enabled) {
    return { apply: true, why: "未启用分批：照旧逐轮裁剪（零回归支）", savedTokens: opts.savedTokens, threshold: minSaved };
  }
  // 算不出头寸（available ≤ 1）就当紧：宁可多断一次前缀，也不要在预算未知时推迟裁剪。
  const available = Math.max(1, opts.availableTokens);
  if (opts.availableTokens <= 1) {
    return { apply: true, why: "可用预算算不出来（" + String(opts.availableTokens) + "）：不推迟", savedTokens: opts.savedTokens, threshold: minSaved };
  }
  if (opts.estimatedTokens >= available * pressure) {
    return {
      apply: true,
      why: "头寸已紧（估算 " + String(opts.estimatedTokens) + " ≥ 可用 " + String(Math.round(available * pressure)) +
        "）：照剪——绝不因攒批去撞最终硬闸",
      savedTokens: opts.savedTokens,
      threshold: minSaved,
    };
  }
  if (opts.savedTokens >= minSaved) {
    return {
      apply: true,
      why: "攒够了（可省 " + String(opts.savedTokens) + " ≥ 门槛 " + String(minSaved) + "）：一次剪掉，断一次前缀",
      savedTokens: opts.savedTokens,
      threshold: minSaved,
    };
  }
  return {
    apply: false,
    why: "先不断前缀（可省 " + String(opts.savedTokens) + " < 门槛 " + String(minSaved) +
      "，且头寸不紧：估算 " + String(opts.estimatedTokens) + " / 可用 " + String(available) + "）",
    savedTokens: opts.savedTokens,
    threshold: minSaved,
  };
}

/** 增量：本轮新越界、且**还没反映在已发出的请求里**的那几条能省多少 token。
 *  没有这个函数就会拿累计值判 —— 累计值每轮都含上一轮那几条，等于「永远已经攒够」，
 *  分批在实测里退化成分批前的同一条链（本格的 A/B 第一次就是这么跑成「两支逐字同值」的）。 */
export function freshSavings(savedByIdTokens: ReadonlyMap<number, number>, alreadySent: ReadonlySet<number>): number {
  let n = 0;
  for (const [id, v] of savedByIdTokens) if (!alreadySent.has(id)) n += v;
  return n;
}
