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

/** 判一趟跑算不算数。`fails` 传判卷给出的失败原因列表。 */
export function runValidity(run: RunFace, fails: readonly string[]): Validity {
  if (run.requests <= 0) {
    return { valid: false, why: WHY_NOT_STARTED };
  }
  for (const f of fails) {
    if (f.includes("runLoop 抛错") && PROVIDER_ERROR.test(f)) {
      return { valid: false, why: WHY_INTERRUPTED_PREFIX + f.slice(0, 120) };
    }
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
