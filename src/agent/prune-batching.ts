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
  /** 本轮前缀**已被压缩打断**（`session-provider.ts` 在压缩成功后的那次重组装前置位，取用即清零）。
   *  头既然已经断了，这一刀就是免费的——攒批省的是"断前缀的次数"，已经在断的那一轮没有可省的。
   *  不许退化成"每轮都剪"：`computePrune` 自己的 `minimumTokens`（20,000）仍然挡着，
   *  顺手剪的仍是"够一刀"的量；而"取用即清零"由 PC9 那条集合相等判据钉住（见 `freeRideCoincidence`）。 */
  freeRide?: boolean;
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
  // 免费车优先于攒批：压缩已经把头打断，再攒就是白多断一次。
  if (opts.freeRide === true) {
    return {
      apply: true,
      why: "前缀本轮已被压缩打断 ⇒ 顺手剪（可省 " + String(opts.savedTokens) + "，不再攒到 " + String(minSaved) + "）",
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

/** 一次驱动里某一轮的可判读痕迹（门把真 provider 跑出来的三个计数器交回来）。 */
export interface FreeRideRound {
  /** 决策时刻有多少条已经越出保护区可剪（**剪完仍是空的** ⇒ 这条判据无分辨力，门自身红）。 */
  prunableAtDecision: number;
  /** 本轮事件流里多出的 `compaction` 事件数（harness 自己留的痕迹，不是从措辞推的）。 */
  compactions: number;
  /** 本轮落进 `prune-attachments/` 的文件数 = 裁剪真被采纳的证据。 */
  attachments: number;
}

/** 免费车的判据：**把攒批门槛抬到不可能达到的量之后，裁剪只该发生在压缩打断过前缀的那些轮上**。
 *  两侧都要判，缺一侧就是摆设——
 *  · 只判「压了就有剪」：针脚可以「无条件每轮都剪」，量出来的落盘轮数照样等于压缩轮数；
 *  · 只判「没压就别剪」：针脚把压缩后的那刀删掉，剩下全推迟，照样过。
 *  ⇒ 判的是**两个集合相等**：落盘轮集合 == 压缩轮集合，且推迟轮确实有可剪的量（不是无事可做）。
 *  为什么这么判而不是 A/B 差值：这条支路的收益只有在压缩与裁剪同场时才存在，而生产缺省窗口下
 *  两者根本不共存（实测 12k 窗口配 20k 结果 ⇒ 每轮 overflow 压、裁剪永远攒不到）——
 *  换句话说 PC8 那条链上根本没有免费车，得另配一条链才量得到，量出来的是 coincidence 而不是次数差。 */
export function freeRideCoincidence(rounds: readonly FreeRideRound[]): { ok: boolean; detail: string } {
  // 轮次下标必须从**原数组**取：先 filter 再 map 会把下标重编号成 0,1,2…，两个集合就永远"相等"了
  // （判据自己变成恒真式——本仓体检抓过的那一族）。
  const indices = (keep: (r: FreeRideRound) => boolean) =>
    rounds.map((r, i) => [r, i] as const).filter(([r]) => keep(r)).map(([, i]) => i);
  const landed = indices((r) => r.attachments > 0);
  const compacted = indices((r) => r.compactions > 0);
  // 「有可剪的量却没剪」= 推迟真的发生过（而不是那条链本来就没活干）。
  const deferredWithWork = rounds.filter((r) => r.attachments === 0 && r.prunableAtDecision > 0).length;
  const same = landed.length === compacted.length && landed.every((i, n) => i === compacted[n]);
  const ok = compacted.length >= 1 && deferredWithWork >= 1 && same;
  return {
    ok,
    detail: `落盘轮=[${landed.join(",")}] 压缩轮=[${compacted.join(",")}] 有量却推迟的轮=${String(deferredWithWork)}` +
      (same ? "" : " ⇒ 两个集合不等：要么白断了一次头，要么有一个没人批的放行口") +
      (compacted.length === 0 ? "（这条链根本没压缩 ⇒ 量不到免费车，门自身红）" : "") +
      (deferredWithWork === 0 ? "（没有任何一轮「本可剪而没剪」⇒ 这条判据无分辨力）" : ""),
  };
}

/** 对照臂的判据：把门槛压到 1（"有活就剪"）之后，必须能看到**没压缩的那一轮也落盘**。
 *  为什么要它：主判据量的是「只有压缩轮落盘」，而这个读数可能只是因为别的轮根本没活可干——
 *  那样就不是策略在挑时机，而是链条自己空。判"策略有效"之前先证明"旋钮接得上"，
 *  顺带把 `minSavedTokens` 这个覆盖参数的接线也纳入观测（它只被这条对照臂用到）。 */
export function thresholdKnobIsWired(rounds: readonly FreeRideRound[]): { ok: boolean; detail: string } {
  const stray = rounds.filter((r) => r.attachments > 0 && r.compactions === 0).length;
  const withWork = rounds.filter((r) => r.prunableAtDecision > 0).length;
  return {
    ok: stray >= 1,
    detail: `门槛=1 时：没压缩却落盘的轮 ${String(stray)}、有可剪量的轮 ${String(withWork)}` +
      (stray === 0 ? "（门槛拨到多低都不会多出落盘 ⇒ 主判据的对照是空的）" : ""),
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
