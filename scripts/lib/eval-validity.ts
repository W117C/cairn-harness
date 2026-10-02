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

/** 判一趟跑算不算数。`fails` 传判卷给出的失败原因列表。 */
export function runValidity(run: RunFace, fails: readonly string[]): Validity {
  if (run.requests <= 0) {
    return { valid: false, why: "未起步（0 次模型请求：provider 报错 / 限流 / 鉴权失败）" };
  }
  for (const f of fails) {
    if (f.includes("runLoop 抛错") && PROVIDER_ERROR.test(f)) {
      return { valid: false, why: "中途被打断（provider 侧错误）：" + f.slice(0, 120) };
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
