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

import { wilsonInterval } from "./eval-arms";

/** 一趟跑里我们关心的最小面（从 `Reading` 与判卷的 `fails` 里取，不复制整个结构）。 */
export interface RunFace {
  requests: number;
  /** 这一趟的「模型那一侧」从哪来（第 422 页的合成面）。缺省按真会话处理。 */
  providerFace?: "真会话" | "剧本";
}

/** provider / 传输层错误的白名单。**只认这些**——模型自己干坏事的失败不许走这条。
 *
 *  `停滞超时` 是 2026-10-13 补的（`src/net.ts` 的 stallGuard 抛的原话：
 *  `停滞超时：60000ms 内无任何数据（对端挂起或网络黑洞）`）。当日实测：
 *  `cn:hy3` × B1 那一趟模型**诊断对了、方案也被批准了**，写盘之前连接静默 60 秒被看门狗掐断；
 *  而这张表不认它 ⇒ 那一趟被算成「模型没做到」进了分母，既算数又不重拨。
 *  与 429 同一族：这一跑是被**外面**切断的，不是被度量的行为。
 *  ⚠️ 反向那半照旧：工具层的超时（run_shell 墙钟）走 `tool_result`、不进 `fails` 的这一支；
 *  模型自己造的坏输出（`无法解析的 tool_call`）不含传输层字样 ⇒ 仍算数。 */
const PROVIDER_ERROR = /HTTP (?:429|5\d\d)\b|请求失败|rate limit|fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|socket hang up|停滞超时/iu;

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
  /* 「0 次请求」有两种成因，这里必须分开：**真会话**那一侧它是限流/鉴权/报错（不许记成"模型没做到"，
   *  于是剔出分母）；**剧本**那一侧它是构造如此——按构造就没有网络请求。把后者也判成"未起步"，
   *  等于宣布离线合成面永远出不了数（第一次端到端跑通就是这么被拦下的，2026-10-08）。
   *  「被打断」那一判两边都照拦：剧本读不出来会留在 fails 里，不放行。 */
  if (run.requests <= 0 && run.providerFace !== "剧本") {
    return { valid: false, why: WHY_NOT_STARTED };
  }
  const interrupt = providerInterruptOf(fails);
  if (interrupt !== null) {
    return { valid: false, why: WHY_INTERRUPTED_PREFIX + interrupt.slice(0, 120) };
  }
  return { valid: true };
}

/** 收束闸**真的补了几拍**：只数带 `auto:true` 的 `verify_result`（生产者＝`src/agent/loop.ts` 的 `verifyBeat`，
 *  它把 auto 摊进事件那一句是唯一的落点）。
 *
 *  为什么要有计数而不是布尔：布尔把「1 拍」与「2 拍（第一拍代码红 ⇒ 模型真改过盘之后重验）」压成同一个 `true`，
 *  而**返修那一环正是能力 5 要量的东西**——盘上 49 趟读数的 `verified` 直方图里，2 次以上只有 2 趟，
 *  全靠模型自调；闸补的拍数从来没有可数的出口（本仓「算出来没出口」那一族，规则 245 同形）。
 *  口径交给这里一处：跑器那边的布尔位从这里派生，不另写一遍 `some(...)`（同一谓词两份副本宽度不同＝第十三族）。 */
export function autoVerifyBeats(rows: readonly { auto?: boolean }[]): number {
  return rows.reduce((n, r) => n + (r.auto === true ? 1 : 0), 0);
}

/** 一枚验证拍的**归属**（由调用方算好交进来：生产端的事实是「auto 拍没有配对的 tool_call」，
 *  所以拿 `verify_result.callId` 去 join 模型 `tool_call.id`，再叠上哨兵 callId 与事件里那枚 `auto` 键）。
 *  `unknown` 是一等公民：归属读不出时必须出声，不许由 `model` 或 `harness` 代替——
 *  否则「闸替模型补了一拍」会被记成「模型自己返修过」，那正是能力 5 的分子最容易长歪的地方。 */
export interface VerifyBeatFace { ok: boolean; by: "model" | "harness" | "unknown" }

/** 返修这一格的终态，**六态分开印**（两两合一都会把「没有尺」读成「没问题」）：
 *   - `noVerify`：这趟一次都没验 ⇒ 没有尺，不是"没返修"；
 *   - `greenFirst`：从头绿到底（一次就过）⇒ 这一格对它没有话可说；
 *   - `notRecovered`：红过，之后再没有绿；
 *   - `harnessOnly`：红过、绿了，但那些绿**全部**是闸补的 ⇒ 记给 harness，不记给模型；
 *   - `modelRecovery`：红过、之后有一枚模型自己发的绿 ⇒ 能力 5 要的分子；
 *   - `attributionUnknown`：红过、之后有绿，但那些绿的归属读不出。 */
export type VerifyRecovery =
  | "noVerify" | "greenFirst" | "notRecovered" | "harnessOnly" | "modelRecovery" | "attributionUnknown";

/** 由一枚 `verify_result` 事件算出它的归属。**跑器与留档扫描都吃这一支**——
 *  同一谓词抄两份、宽度不同是本仓反复点名的那一族（第十三族）。
 *  `harnessCallId` 由调用方把生产端那枚导出的哨兵传进来：这里不 import `src/agent/loop`，
 *  为的是这一支保持纯函数（不拉进整个跑器），也让"有没有跟着生产端改名"变成**消费者**的一件事。 */
export function verifyBeatFace(
  v: { ok: boolean; auto?: boolean; callId: string },
  modelVerifyCallIds: ReadonlySet<string>,
  harnessCallId: string,
): VerifyBeatFace {
  return {
    ok: v.ok,
    by: v.auto === true || v.callId === harnessCallId ? "harness"
      : modelVerifyCallIds.has(v.callId) ? "model" : "unknown",
  };
}

/** 只看**第一枚红拍之后**的绿拍：红之前的绿拍与返修无关（那枚绿不能证明模型改过任何东西）。 */
export function verifyRecovery(beats: readonly VerifyBeatFace[]): VerifyRecovery {
  if (beats.length === 0) return "noVerify";
  const firstRed = beats.findIndex((b) => !b.ok);
  if (firstRed < 0) return "greenFirst";
  const greens = beats.slice(firstRed + 1).filter((b) => b.ok);
  if (greens.length === 0) return "notRecovered";
  if (greens.some((b) => b.by === "model")) return "modelRecovery";
  if (greens.every((b) => b.by === "harness")) return "harnessOnly";
  return "attributionUnknown";
}

/** 读数行/失败原因用的措辞：一态一句，且**每句都点名下一步该看哪一格**。 */
export const VERIFY_RECOVERY_WHY: Record<VerifyRecovery, string> = {
  noVerify: "没跑过 verify（没有尺）",
  greenFirst: "一次就绿（没有返修可谈）",
  notRecovered: "红过之后再没绿过",
  harnessOnly: "红过、绿了，但那几拍全是闸补的（不记给模型）",
  modelRecovery: "红过、模型自己再验且绿",
  attributionUnknown: "红过、之后有绿，但归属读不出（callId 既不在模型 tool_call 里、也没有 auto 键）",
};

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

/** 一条任务在「任务级」汇总里要的那张脸（`r` 只需要 `RunFace` 那两格）。 */
export interface TaskFace {
  taskId: string;
  r: RunFace;
  g: { ok: boolean; fails: string[] };
}

/** 没跑满的任务（缺遍或有无效 rep）——**单列出来，不藏**。 */
export interface PartialTask {
  taskId: string;
  /** 这条任务应当跑几遍。 */
  expected: number;
  /** 算数（进了观测）的遍数。 */
  valid: number;
  /** 达标（进了分子）的遍数。 */
  passed: number;
  /** 不可知的遍数（无效 rep 或缺遍）。 */
  unknown: number;
  /** 对 pass@k 的结局已知吗（false ⇒ 这条不进 pass@k 的分母）。 */
  atKKnown: boolean;
  /** 对 pass^k 的结局已知吗（false ⇒ 这条不进 pass^k 的分母）。 */
  kKnown: boolean;
}

export interface TaskRollup {
  /** pass@k 的分母：结局已定的任务数。 */
  passAtKTotal: number;
  /** pass@k 的分子：至少一遍达标的任务数。 */
  passAtK: number;
  /** pass@k 的 95% 区间（Wilson；任务是独立单位）。 */
  passAtKCi: { lower: number; upper: number } | null;
  /** pass^k 的分母：结局已定的任务数。 */
  passKTotal: number;
  /** pass^k 的分子：每一遍都达标的任务数。 */
  passK: number;
  /** pass^k 的 95% 区间。 */
  passKCi: { lower: number; upper: number } | null;
  /** 没跑满的任务——单列（结局不可知的那一面不进分母）。 */
  partial: PartialTask[];
  /** 两个分母都空 ⇒ true（不许印 0/0 当读数）。 */
  refuse: boolean;
}

/**
 * 任务级的一层汇总：**独立单位是「任务」，不是「趟次」**。
 *
 * 为什么（2026-10-22 补的）：`--reps N` 把同一条任务跑 N 遍，而**同一条任务的 N 遍不独立**
 * （同一份任务难度、同一族种子、同一模型）⇒ 把 N×M 趟当成 M 个独立二项样本去算区间，
 * **区间会偏窄**（自相关把方差压小），于是「12 任务 × 3 rep」被读成比它实际更可靠的样子。
 * 而「这条配置在**没见过的任务**上还灵不灵」问的正是**任务** ⇒ 独立单位取任务。
 *
 * 两个读数一起印（τ-bench 那对指标）：
 *   · pass@k＝这条任务的 k 遍里**至少一遍**达标；
 *   · pass^k＝这条任务的 k 遍里**全部**达标（＝稳不抖）。
 * 只看 pass@k 会把「1/3 蒙对」与「3/3 全对」当成同一件事；只看 pass^k 又分不清「抖」与「不行」。
 *
 * **两个指标的分母各自算，因为「不可知」对它们的含义相反**（这一格最容易抄错）：
 *   · pass@k：见着**一遍**达标就是定局（至少一遍中了 ⇒ 与别的遍无关）；
 *     一遍都没见着、而还有不知道的遍 ⇒ 不可知 ⇒ 不进分母。
 *   · pass^k：见着**一遍**不达标就是定局（这一条已经不算 pass^k 了）；
 *     没见着不达标、而还有不知道的遍 ⇒ 不可知 ⇒ 不进分母。
 * ⇒ 一条「2 遍败 + 1 遍无效」的任务：pass@k 不可知（那一遍可能赢），
 *   但 pass^k **已经确定是败** ⇒ 它要**留在 pass^k 的分母里当败**。
 * 若把「没跑满」的任务从两个分母里一并剔掉，就等于**把一次已知的败藏起来** ⇒ 比率被抬高，
 *   那是**不安全**的方向（本仓「把红跑藏起来」那一族）。所以只有真不可知的才剔。
 *
 * 区间用的是 Wilson 闭式（与 `eval-arms` 的 `wilsonInterval` 同一份，**不重抄第二份**：
 * 同一谓词两份副本宽度不同＝本仓第十三族）。
 */
export function taskRollup(rows: readonly TaskFace[], repsPerTask: number): TaskRollup {
  const empty: TaskRollup = {
    passAtKTotal: 0, passAtK: 0, passAtKCi: null,
    passKTotal: 0, passK: 0, passKCi: null,
    partial: [], refuse: true,
  };
  if (repsPerTask < 1) return empty;
  const byTask = new Map<string, { valid: number; passed: number; failed: number }>();
  for (const x of rows) {
    let e = byTask.get(x.taskId);
    if (e === undefined) { e = { valid: 0, passed: 0, failed: 0 }; byTask.set(x.taskId, e); }
    const v = runValidity(x.r, x.g.fails);
    if (!v.valid) continue;
    e.valid += 1;
    if (x.g.ok) e.passed += 1; else e.failed += 1;
  }
  const partial: PartialTask[] = [];
  let passAtK = 0;
  let passAtKTotal = 0;
  let passK = 0;
  let passKTotal = 0;
  for (const [taskId, e] of byTask) {
    const unknown = Math.max(0, repsPerTask - e.valid);
    const atKKnown = e.passed >= 1 || unknown === 0;
    const kKnown = e.failed >= 1 || unknown === 0;
    if (unknown > 0) {
      partial.push({ taskId, expected: repsPerTask, valid: e.valid, passed: e.passed, unknown, atKKnown, kKnown });
    }
    if (atKKnown) { passAtKTotal += 1; if (e.passed >= 1) passAtK += 1; }
    if (kKnown) { passKTotal += 1; if (e.failed === 0) passK += 1; }
  }
  return {
    passAtKTotal, passAtK,
    passAtKCi: passAtKTotal > 0 ? wilsonInterval(passAtK, passAtKTotal) : null,
    passKTotal, passK,
    passKCi: passKTotal > 0 ? wilsonInterval(passK, passKTotal) : null,
    partial,
    refuse: passAtKTotal === 0 && passKTotal === 0,
  };
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
