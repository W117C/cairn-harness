// 一趟跑"算不算数"——**未起步 / 被 provider 打断的趟次不许进分母**。
//
// 为什么要有这一层（2026-10-02 实测）：按计划书原命令跑 12 条 × 3 rep（36 趟），
// 32 趟死在 OpenRouter 免费档日配额（probe 原文：`X-RateLimit-Limit: 1000 / Remaining: 0 /
// limit_source=openrouter_free_tier_daily`，`requests=0 / tok=0`），而汇总结算照样印
// **`合计 2/36 达标`** ⇒ 那个 `2/36` 报的是**限流器**，不是 agent。
//
// 同族纪律本脚本已经有了：任务集解析报错时"**拒绝出数（分母不完整时任何分数都是假的）**"。
// 本模块只是把**同一条纪律**应用到"跑不成"这一种不完整上——两者是同一件事的两种形状。
//
// 边界（这条比上面更要紧）：**只把"环境打断"判无效，绝不把"模型自己失败"判无效**。
// 否则修完就成了"把红跑藏起来"——本仓点过名的形状。所以只有白名单里的
// provider/传输层错误才算无效；"改了判卷面""verify 未通过"这类**模型行为**的失败照旧计入分母。

/** 一趟跑里我们关心的最小面（从 `Reading` 与判卷的 `fails` 里取，不复制整个结构）。 */
export interface RunFace {
  requests: number;
}

/** provider / 传输层错误的白名单。**只认这些**——模型自己干坏事的失败不许走这条。 */
const PROVIDER_ERROR = /HTTP (?:429|5\d\d)\b|请求失败|rate limit|fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|socket hang up/iu;

export type Validity = { valid: true } | { valid: false; why: string };

/** 两条"无效"措辞提成常量：**判卷引用它们，不许把原话抄进测试**。
 *  为什么（2026-10-02 被 `tests/prose-needle-scan.test.ts` 当场抓住）：我在判卷里抄了
 *  `未起步` 三个字 ⇒ 同一段话出现在**两处**（生产 + 测试）⇒ 顶包候选从 10 涨到 11，
 *  越过那条"只准下调"的水位。那把尺的治法原文就是「**改成派生断言**」——
 *  措辞只留一个源头、判卷引用常量 ⇒ 改一处仍然会响。 */
export const WHY_NOT_STARTED = "未起步（0 次模型请求：provider 报错 / 限流 / 鉴权失败）";
export const WHY_INTERRUPTED_PREFIX = "中途被打断（provider 侧错误）：";

/** 找出那条 provider 侧打断的**原文**；没有 ⇒ null。
 *  「这一趟算不算数」（下面 runValidity）与「要不要再拨一次」（`eval-retry.retryVerdict`）
 *  都从这里取判断 ⇒ 一条白名单只有一份。抄两份迟早漂成两把尺（本仓同族第十几次）。 */
export function providerInterruptOf(fails: readonly string[]): string | null {
  for (const f of fails) {
    if (f.includes("runLoop 抛错") && PROVIDER_ERROR.test(f)) return f;
  }
  return null;
}

/** 判一趟跑算不算数。`fails` 传判卷给出的失败原因列表。 */
export function runValidity(run: RunFace, fails: readonly string[]): Validity {
  if (run.requests <= 0) {
    return { valid: false, why: WHY_NOT_STARTED };
  }
  const interrupt = providerInterruptOf(fails);
  if (interrupt !== null) {
    return { valid: false, why: WHY_INTERRUPTED_PREFIX + interrupt.slice(0, 120) };
  }
  return { valid: true };
}

/** 汇总口径：分母只数**算数**的趟次；一趟都不算数时**拒绝出数**（不许印 0/0 或 0/N）。 */
export function tally(
  rows: readonly { r: RunFace; g: { ok: boolean; fails: string[] } }[],
): { pass: number; total: number; invalid: number; refuse: boolean; invalidWhy: string[] } {
  let pass = 0;
  let total = 0;
  const invalidWhy: string[] = [];
  for (const x of rows) {
    const v = runValidity(x.r, x.g.fails);
    if (!v.valid) { invalidWhy.push(`${x.r.requests} 请求：${v.why}`); continue; }
    total += 1;
    if (x.g.ok) pass += 1;
  }
  return { pass, total, invalid: invalidWhy.length, refuse: total === 0, invalidWhy };
}

/** 钱的那一面：`cny` 由调用方从 `Reading` 里取来（这里不复制结构）。 */
export interface CostRow { r: { requests: number; cny: number }; g: { ok: boolean; fails: readonly string[] } }

/**
 * **分子与分母必须同面**（本仓 `cost-per-progress` 的老纪律，这里是它的镜像）。
 * `tally` 已经只数算数的趟次，而汇总那行从前用**全量** `cny` 除以算数的达标数 ⇒
 * 被剔掉的趟次花的钱仍留在分子里。2026-10-02 那次 36 趟实测就是活的：
 * 合计 ¥0.2774，其中 1 趟起步后被 429 打断、独自占 **¥0.0789 = 28%**，
 * 而它已经不在分母里了 ⇒ 「每达标任务」印成 ¥0.1387 而真值是 ¥0.0993 ⇒ **比值被高估 39.7%**。
 * （28% 是白花占全量实付：0.0789/0.2774。两个数分母不同，别混用——10-02 复算逐笔见 c438529。）
 * ⚠️ 上面那些 ¥ 是**按缺省价 0.8/2.8 算出来的名义值**，而那 36 趟拨的是 OpenRouter 免费档
 *   （`limit_source=openrouter_free_tier_daily`，见 outputs/bench-reps3-2026-10-02/README.md）⇒
 *   「实付」两个字当时是不成立的。39.7% 这个**比值**不受影响（分子分母同乘一个常数）。
 *   这条正是下面 `priceFace` 存在的原因：价目没绑定所拨模型时，钱只能报「不可知」。
 * 被打断的趟次花的钱是真钱，所以**单列、不藏**；只是不许混进那个比值。
 */
export function costSplit(rows: readonly CostRow[]): { paidAll: number; validSpend: number; wastedSpend: number; wastedRuns: number } {
  let paidAll = 0;
  let validSpend = 0;
  let wastedSpend = 0;
  let wastedRuns = 0;
  for (const x of rows) {
    const cny = Number.isFinite(x.r.cny) ? x.r.cny : 0;
    paidAll += cny;
    if (runValidity(x.r, x.g.fails).valid) validSpend += cny;
    else {
      wastedSpend += cny;
      wastedRuns += 1;
    }
  }
  return { paidAll, validSpend, wastedSpend, wastedRuns };
}

export type PriceFace =
  | { known: true; inPerM: number; outPerM: number; caveat: string }
  | { known: false; why: string };

/**
 * 钱这把尺**有没有资格存在**。只认操作者当场给全的两个价（每百万 token）。
 *
 * 为什么不许留缺省（2026-10-02 现读）：`loop-eval` 从前写的是
 * 「env 没给就吃 0.8 / 2.8」，而那两位是某个中转端点对**它自己那一档**的目录价；
 * 同一句里拨的却是 OpenRouter 免费档（token 照记、钱应为 0）⇒
 * 印出来的「实付≈¥0.2774」是**用别人的价给自己的模型定价**，没人看得出。
 * 与 09-23 那条「价表键=档位 id，模型名必须经 priceForModel 反查」同族，第三次命中。
 *
 * 三态里没有「半把尺」那一档：只给 in 不给 out（或反之）也算不可知——
 * 单边价算出来的比值看着像数，实际是噪声。
 */
export function priceFace(rawIn: string | undefined, rawOut: string | undefined): PriceFace {
  const missing: string[] = [];
  if (!rawIn) missing.push("EVAL_PRICE_IN");
  if (!rawOut) missing.push("EVAL_PRICE_OUT");
  if (missing.length > 0) {
    return { known: false, why: "没给 " + missing.join(" / ") + " ⇒ 钱按「不可知」处理（不再静默吃缺省价）" };
  }
  const inPerM = Number(rawIn);
  const outPerM = Number(rawOut);
  if (!Number.isFinite(inPerM) || !Number.isFinite(outPerM) || inPerM < 0 || outPerM < 0) {
    return { known: false, why: "给的价不是非负有限数（in=「" + String(rawIn) + "」 out=「" + String(rawOut) + "」）" };
  }
  return {
    known: true,
    inPerM,
    outPerM,
    caveat: "手给价：跑器不核对它与所拨档位是否同源——那一半拿 readings 里的 model 去对",
  };
}

/** 「这一格量不出来」的唯一措辞（判卷引用它，不许把原话抄进测试——同 WHY_NOT_STARTED 那条纪律）。 */
export const PRICE_UNKNOWN = "价不可知";

/** 钱的读数写法：不可知**不许**退化成 `¥0.0000`（那正是 2026-10-02 登记的那条「0 而不是不可知」）。 */
export function moneyText(v: number): string {
  return Number.isFinite(v) ? `¥${v.toFixed(4)}` : PRICE_UNKNOWN;
}
