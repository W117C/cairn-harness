// P0-c：工具选对率 / 漏拦率的靶场读数（纯函数，离线可测，2026-10-04）。
//
// **这份模块解决的是 `tool-choice.ts` 开头自陈的那个缺口**：
//   「事件流里没有『本该调哪个』的信息……真选对率要 W5a 靶场」。
// 补法：让 case **声明**该调 / 不该调哪些工具（`GymExpect.expectTools` / `forbidTools`，
// 两者都是**可选**的，所以一条冻结 case 都不用改），再从事件流里数实际调了什么。
//
// ## 三条纪律，每条都对应本仓点过名的失败形状
//
// ① **分母为 0 一律 null，不是 0**（与 `tool-choice.ts` 同款：未证 ≠ 通过）。
//    没声明 `expectTools` 的 case 贡献 `hitDeclared=false`，合并时**不进分母**，
//    绝不按「没声明 = 全对」算——那会让选对率永远漂亮。
//
// ② **只存原始计数，比率留到合并后再算**（与 `tool-choice.ts` 同一手法）：
//    把 per-case 的比率相加会得到「平均的平均」，那种数字看着精确其实什么都没说。
//
// ③ **单 case 只有 0/1，没有率**。一条 case 的读数是「命中了吗」「有没有漏拦」；
//    「选对率」这种量必须**跨 case** 才有意义，而跨 case 只有在 **case 的面不一样大**时
//    才携带信息（同一批任务、同一个模型、只换工具面）。本模块因此额外提供
//    `toolChoiceAblation()`：按面分组对齐后才允许出 A/B 差值——
//    **面不同就不许比**，直接返回 null 并说明原因。
//
// ## 现在能不能出读数（2026-10-04 实测）
//
// 机制可以建、可以离线测（本文件 + 测试都不联网）。但**有意义的读数今天出不来**：
// `GymModelKind` 有 `scripted | real | probe` 三档 —— `scripted` 的工具选择是脚本写死的，
// 量出来的是「脚本有没有照脚本调」（构造上同义反复）；`real`/`probe` 需要 API key，
// 而**本机没有任何 API key**（`env | grep KEY` 为空）。所以：
// **P0-c 的状态是「尺子造好了，样本还没有」**，不许拿 scripted 档的数字充数。
import type { AgentEvent } from "../../events";
import type { GymExpect } from "./case";

/** 一条 case 跑的原始计数（不含比率——比率在 `mergeToolChoice` 里算）。 */
export interface CaseToolChoice {
  caseId: string;
  /** 事件流里实际调过的工具，去重后按字典序（同一件调 20 次与调 1 次在这里等价——
   *  「选没选对」问的是选型，不是频次；频次另由 `tool-choice.ts` 的投影管）。 */
  toolsCalled: string[];
  /** 命中了 `expectTools` 里的哪几件；空数组 = 没命中（**当 `expectDeclared=false` 时它无意义**）。 */
  hits: string[];
  /** case 是否声明过该调什么。没声明 ⇒ `hits` 不进任何分母。 */
  expectDeclared: boolean;
  /** 撞上了 `forbidTools` 里的哪几件（去重）。 */
  violations: string[];
  forbidDeclared: boolean;
  /** 实际工具调用总次数（含重复）——漏拦率的分母。 */
  callCount: number;
}

/** 从事件流抽工具调用。本仓的事件词表是 `tool_call`（**不是**官方 App 的 `tool/call`）。 */
export function toolsCalledIn(events: readonly AgentEvent[]): { names: string[]; count: number } {
  const seen = new Set<string>();
  let count = 0;
  for (const e of events) {
    if (e.type !== "tool_call") continue;
    count++;
    if (typeof e.name === "string" && e.name !== "") seen.add(e.name);
  }
  return { names: [...seen].sort(), count };
}

/** 单 case 读数。纯函数，不读盘。 */
export function caseToolChoice(caseId: string, events: readonly AgentEvent[], expect: GymExpect): CaseToolChoice {
  const { names, count } = toolsCalledIn(events);
  const expectDeclared = Array.isArray(expect.expectTools) && expect.expectTools.length > 0;
  const forbidDeclared = Array.isArray(expect.forbidTools) && expect.forbidTools.length > 0;
  const called = new Set(names);
  return {
    caseId,
    toolsCalled: names,
    hits: expectDeclared ? expect.expectTools!.filter((t) => called.has(t)).sort() : [],
    expectDeclared,
    violations: forbidDeclared ? expect.forbidTools!.filter((t) => called.has(t)).sort() : [],
    forbidDeclared,
    callCount: count,
  };
}

/** 跨 case 合并后的比率。**分母为 0 一律 null。** */
export interface MergedToolChoice {
  /** 声明了「该调什么」的 case 数（选对率的分母）。 */
  nDeclared: number;
  /** 命中的 case 数。 */
  nHit: number;
  /** 选对率；`nDeclared === 0` 时 null（不是 0，也不是 1）。 */
  hitRate: number | null;
  /** 声明了「不该调什么」的 case 数（case 级分母）。 */
  nForbidDeclared: number;
  /** 至少漏拦一次的 case 数。 */
  nViolating: number;
  /** **漏拦率 = 至少漏拦一次的 case 数 ÷ 声明了禁令的 case 数**（case 级）。
   *  ⚠️ 2026-10-04 改口径。原先这里是**调用次数比**（被禁调用数 ÷ 总调用数），实测发现它
   *  **量错了东西**：只禁一件工具、它每轮只调一次时，这个比值 = 1 ÷ 总调用数，
   *  于是「每次都违规」和「偶尔违规」会给出几乎一样的数——实测 8 次跑全是违规，
   *  比值却在 0.083–0.167 之间晃（晃的是分母）。**比率把分母的波动当成了信号的波动。**
   *  case 级是「这次跑到底违没违规」的直接读数；调用级另留一格 `callLevelViolationRate`
   *  给需要看密度的场合，两者必须分开读。 */
  violationRate: number | null;
  /** 被禁工具的**调用次数**（去重后按工具计；同一工具调多次只算一次）。 */
  forbiddenCalls: number;
  totalCalls: number;
  /** 调用级漏拦率（被禁工具件数 ÷ 总调用数）。分母 0 时 null。**与 `violationRate` 分开读。** */
  callLevelViolationRate: number | null;
}

export function mergeToolChoice(rows: readonly CaseToolChoice[]): MergedToolChoice {
  const declared = rows.filter((r) => r.expectDeclared);
  const forbid = rows.filter((r) => r.forbidDeclared);
  const totalCalls = forbid.reduce((a, r) => a + r.callCount, 0);
  const forbiddenCalls = forbid.reduce((a, r) => a + r.violations.length, 0);
  return {
    nDeclared: declared.length,
    nHit: declared.filter((r) => r.hits.length > 0).length,
    hitRate: declared.length === 0 ? null : declared.filter((r) => r.hits.length > 0).length / declared.length,
    nForbidDeclared: forbid.length,
    nViolating: forbid.filter((r) => r.violations.length > 0).length,
    violationRate: forbid.length === 0 ? null : forbid.filter((r) => r.violations.length > 0).length / forbid.length,
    forbiddenCalls,
    totalCalls,
    callLevelViolationRate: totalCalls === 0 ? null : forbiddenCalls / totalCalls,
  };
}

/**
 * A/B 差值：**只有两组的 case 集完全对齐（同一批 caseId）时才允许出**。
 * 不对齐返回 `{ ok: false, why }` 而不是硬算——拿 case A 组跟 case B 组比，
 * 差值里混着「任务不同」与「面不同」两件事，读数不可归因。
 */
export interface ToolChoiceAblation {
  ok: boolean;
  why?: string;
  /** 每组的合并读数（对齐时才有）。 */
  baseline?: MergedToolChoice;
  ablated?: MergedToolChoice;
  /** 差值 = ablated − baseline；任一分母为 0 时 null。 */
  hitRateDelta?: number | null;
  violationRateDelta?: number | null;
  /** token 差：两臂各跑一次的 `tokens` 之差（pruned − full）。任一侧缺该数时 null。
   *  **这是本仓唯一在 n=2 下就有信号的量**：轮数与 token 数是连续量，波动比 0/1 小得多；
   *  而正确率本身在实测里就会 0↔1 跳（见 §P1-b 实测·第二轮）。所以「更便宜」这类结论
   *  **只能**建立在 token 差上，不能建立在选对率/漏拦率上。 */
  tokensDelta?: number | null;
}

export function toolChoiceAblation(
  baseline: readonly CaseToolChoice[],
  ablated: readonly CaseToolChoice[],
): ToolChoiceAblation {
  const b = new Set(baseline.map((r) => r.caseId));
  const a = new Set(ablated.map((r) => r.caseId));
  const onlyB = [...b].filter((x) => !a.has(x));
  const onlyA = [...a].filter((x) => !b.has(x));
  if (onlyB.length > 0 || onlyA.length > 0) {
    return {
      ok: false,
      why: "case 集不对齐，只在 baseline 有：" + (onlyB.join("、") || "无")
        + "；只在 ablated 有：" + (onlyA.join("、") || "无")
        + "。不齐就没有可归因的差值（差值里混着「任务不同」与「面不同」）。",
    };
  }
  const mb = mergeToolChoice(baseline);
  const ma = mergeToolChoice(ablated);
  const delta = (x: number | null, y: number | null): number | null =>
    x === null || y === null ? null : y - x;
  return {
    ok: true,
    baseline: mb, ablated: ma,
    hitRateDelta: delta(mb.hitRate, ma.hitRate),
    violationRateDelta: delta(mb.violationRate, ma.violationRate),
  };
}