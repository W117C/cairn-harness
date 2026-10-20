// 跨轮闭环的第一半：**上一轮发出去的策略补丁，这一轮到底生效了没有**。
//
// 缺口（2026-10-16 复核）：runEvolution 每轮无条件覆盖 .agent/evolution.json——上一轮
// 说过什么、这一轮有没有消解，账上不留痕。后果两头都坏：已消解的那句会一轮一轮重发，
// 而真复发的那类问题只会当"新问题"再提一遍，与第一次提示读起来一模一样。
//
// 本模块只做判定（纯函数），不做重发取舍（取舍在 index.ts 编排）：
// 每条旧补丁拿一个三态结论 + 一个处置建议，证据是本轮 EvolutionSignals 的真实读数。
//
// 纪律（沿 signal.ts / cost-per-progress 三条）：
//  · **无读数不判消解**：本轮没跑 verify、成本算不出来 ⇒ "inconclusive"，
//    不许折成 resolved（把"没看见"读成"好了"是这一维唯一不能错的方向）；
//  · **不可测 ≠ 零**：observed 里保留"不可测"的字样与原因，不填 0；
//  · **判定必须点得出数**：observed 里带本轮的数字，与 strategy-patch 的 note 同一条纪律；
//  · **段落自报时刻**（2026-10-16）：这些句子是上一轮收尾时写的、下一轮开工时读的。正文里
//    不写「本轮」这类会随时间读歪的代词——一律「上次读数」，配 renderEffects 的「（记于 X）」戳。
import type { EvolutionSignals } from "./signal";
import { COST_PER_BOUNDARY_LIMIT, recordedAtStamp, renderVerifyPatchNote, type StrategyPatch } from "./strategy-patch";

export type PatchEffectStatus = "resolved" | "recurred" | "inconclusive";

/** 处置建议：resolved ⇒ drop（不再重复发）；recurred ⇒ keep / escalate；inconclusive ⇒ observe。 */
export type PatchDisposition = "drop" | "keep" | "escalate" | "observe";

export interface PatchEffect {
  kind: StrategyPatch["kind"];
  /** 定位键（verify-escalate 带 cause；其余就是 kind）：接续与账面去重都按它。 */
  key: string;
  status: PatchEffectStatus;
  disposition: PatchDisposition;
  /** 本轮读数（判定依据，点名数字/缺席原因）。 */
  observed: string;
  /** 被评估的那条旧补丁原文（接续重发与渲染都用它，不另抄一份）。 */
  patch: StrategyPatch;
}

/** 补丁的定位键。同一 kind 的不同 cause 是两笔独立账目。 */
export function patchKeyOf(patch: StrategyPatch): string {
  return patch.kind === "verify-escalate" ? patch.kind + ":" + patch.cause : patch.kind;
}

function verifyEscalateEffect(patch: Extract<StrategyPatch, { kind: "verify-escalate" }>, s: EvolutionSignals): PatchEffect {
  if (s.verifyOutcome === "none") {
    return {
      kind: patch.kind,
      key: patchKeyOf(patch),
      status: "inconclusive",
      disposition: "observe",
      observed: "上次读数没有 verify 拍，读数缺席——不可测不等于已消解",
      patch,
    };
  }
  if (s.verifyOutcome === "green") {
    return {
      kind: patch.kind,
      key: patchKeyOf(patch),
      status: "resolved",
      disposition: "drop",
      observed: "上次读数 verify 全绿，之前累计的失败不再代表当前阻塞",
      patch,
    };
  }
  const lastCause = s.lastVerifyFailureCause;
  if (lastCause === null) {
    return {
      kind: patch.kind,
      key: patchKeyOf(patch),
      status: "inconclusive",
      disposition: "observe",
      observed: "上次读数有 verify 红，但最后原因缺席——不能把历史失败当作当前复发",
      patch,
    };
  }
  if (lastCause !== undefined && lastCause !== patch.cause) {
    return {
      kind: patch.kind,
      key: patchKeyOf(patch),
      status: "resolved",
      disposition: "drop",
      observed: `上次读数最后一拍 cause=${String(lastCause)}，旧 cause=${patch.cause} 已不是当前阻塞`,
      patch,
    };
  }
  const times = s.verifyFailuresByCause[patch.cause] ?? 0;
  if (times > 0) {
    return {
      kind: patch.kind,
      key: patchKeyOf(patch),
      status: "recurred",
      // 复发且不比上轮轻 ⇒ 升级；有缓解但未消解 ⇒ 保持（下一轮仍看得见这条）。
      disposition: times >= patch.times ? "escalate" : "keep",
      observed: `上次读数：cause=${patch.cause} 又失败 ${String(times)} 次（补丁发出时 ${String(patch.times)} 次）`,
      patch,
    };
  }
  return {
    kind: patch.kind,
    key: patchKeyOf(patch),
    status: "inconclusive",
    disposition: "observe",
    observed: "上次读数有 verify 红，但没有该 cause 的失败证据——旧补丁不据此升级",
    patch,
  };
}

function goalReconfirmEffect(patch: Extract<StrategyPatch, { kind: "goal-reconfirm" }>, s: EvolutionSignals): PatchEffect {
  // **没测过 ≠ 漂移已消解**（2026-10-19 独立评审追出的 MEDIUM）：
  // 旧实现只看 `goalDriftCount > 0`，而那个 0 有两种成因——"测过了没有"与"根本没得测"
  // （这一跑只有工具调用、助手一句散文都没写 ⇒ 没有可读的目标漂移面）。
  // 后者被当成"消解" ⇒ 上一轮的 goal-reconfirm 补丁**被删掉**，审计轨迹还记着"已消解"——
  // 为一个**从没测过**的漂移记了一次消解。补丁是"治漂移"的方子，没测过就没有理由扔。
  // 同 `costMeasurable` 那一格（2026-10-16「不可测 ≠ 无前进」）：不可测 ⇒ inconclusive + 观察，
  // 不动补丁（verify 那一维早就是这个形状）。
  if (s.goalDriftMeasurable === false) {
    return {
      kind: patch.kind,
      key: patchKeyOf(patch),
      status: "inconclusive",
      disposition: "observe",
      observed: "这一跑没有可读的目标漂移面（助手没写散文）⇒ 不可测，不据此消解旧补丁",
      patch,
    };
  }
  if (s.goalDriftCount > 0) {
    return {
      kind: patch.kind,
      key: patchKeyOf(patch),
      status: "recurred",
      disposition: s.goalDriftCount > patch.driftCount ? "escalate" : "keep",
      observed: `上次读数目标漂移 ${String(s.goalDriftCount)} 处（补丁发出时 ${String(patch.driftCount)} 处）`,
      patch,
    };
  }
  return {
    kind: patch.kind,
    key: patchKeyOf(patch),
    status: "resolved",
    disposition: "drop",
    observed: "上次读数目标漂移 0 处",
    patch,
  };
}

function costThrottleEffect(patch: Extract<StrategyPatch, { kind: "cost-throttle" }>, s: EvolutionSignals): PatchEffect {
  const key = patchKeyOf(patch);
  if (s.costMeasurable && s.tokensPerBoundary !== null) {
    const now = s.tokensPerBoundary;
    if (now <= COST_PER_BOUNDARY_LIMIT) {
      return {
        kind: patch.kind, key, status: "resolved", disposition: "drop",
        observed: `上次读数每次 verified 前进 ${String(now)} token，已回落到 ${String(COST_PER_BOUNDARY_LIMIT)} 以内`,
        patch,
      };
    }
    // 已经可测、但仍高于偏高线：与上轮比"更贵还是更便宜"决定升级/保持。
    const worse = patch.tokensPerBoundary !== null && now > patch.tokensPerBoundary;
    return {
      kind: patch.kind, key, status: "recurred", disposition: worse ? "escalate" : "keep",
      observed: patch.tokensPerBoundary !== null
        ? `上次读数每次 verified 前进 ${String(now)} token（补丁发出时 ${String(patch.tokensPerBoundary)}），仍高于 ${String(COST_PER_BOUNDARY_LIMIT)}`
        : `死跑已停、转成可测，但每次 verified 前进 ${String(now)} token，仍高于 ${String(COST_PER_BOUNDARY_LIMIT)}`,
      patch,
    };
  }
  if (s.spendAfterLastBoundary > 0) {
    /* 不可测且边界后还在烧 ⇒ **不可判**，不是"死跑复发"（2026-10-16 与 advice /
     *  strategy-patch 同一口径）。从前这里 status=recurred + escalate：于是一条由不可测推出的
     *  旧补丁会一轮一轮自我确认、越升越硬。可测才谈得上消解或复发；不可测时唯一诚实的结论是
     *  "这轮没有读数"，处置是继续观察，不是加大药量。 */
    return {
      kind: patch.kind, key, status: "inconclusive", disposition: "observe",
      observed: `上次读数成本仍不可测，最后一次 verified 边界后烧了 ${String(s.spendAfterLastBoundary)} token`
        + "——读数缺席，不可测不等于无前进",
      patch,
    };
  }
  return {
    kind: patch.kind, key, status: "inconclusive", disposition: "observe",
    observed: "上次读数成本不可测且边界后开销为 0，读数缺席——不可测不等于已消解",
    patch,
  };
}

function effectFor(patch: StrategyPatch, s: EvolutionSignals): PatchEffect {
  switch (patch.kind) {
    case "verify-escalate":
      return verifyEscalateEffect(patch, s);
    case "goal-reconfirm":
      return goalReconfirmEffect(patch, s);
    case "cost-throttle":
      return costThrottleEffect(patch, s);
  }
}

/** 评估上一轮每条补丁在本轮读数下的效果。纯函数；旧补丁为空 ⇒ 空数组（零行为）。 */
export function evaluatePatchEffects(previous: readonly StrategyPatch[], s: EvolutionSignals): PatchEffect[] {
  return previous.map((patch) => effectFor(patch, s));
}

/** 本轮信号没再生成、但上一轮判定为"复发/不可判"的补丁，逐条接回——"保持"不能只留在账上。 */
export function carryOverPatches(effects: readonly PatchEffect[], fresh: readonly StrategyPatch[]): StrategyPatch[] {
  const have = new Set(fresh.map(patchKeyOf));
  const out: StrategyPatch[] = [];
  for (const e of effects) {
    if (e.status === "resolved") continue;
    if (have.has(e.key)) continue;
    out.push(e.patch.kind === "verify-escalate"
      ? { ...e.patch, note: renderVerifyPatchNote(e.patch.cause, e.patch.times) }
      : e.patch);
    have.add(e.key);
  }
  return out;
}

const STATUS_LABEL: Readonly<Record<PatchEffectStatus, string>> = {
  resolved: "已消解",
  recurred: "复发",
  inconclusive: "不可判",
};

const DISPOSITION_LABEL: Readonly<Record<PatchDisposition, string>> = {
  drop: "这一轮不再重复发",
  keep: "保持观察",
  escalate: "升级：这一轮先按它处理",
  observe: "读数缺席，继续观察",
};

const KIND_LABEL: Readonly<Record<StrategyPatch["kind"], string>> = {
  "verify-escalate": "verify 连败排查",
  "goal-reconfirm": "目标复述",
  "cost-throttle": "成本节流",
};

/** 把跨轮评估渲染成给模型看的紧凑提示（与 renderPatches 同一条组装面，缺省零行为）。
 *  recordedAt = 这份读数是什么时候记的（记录里的 ts）：带上就印「（记于 X）」戳。 */
export function renderEffects(effects: readonly PatchEffect[], recordedAt?: number): string {
  if (effects.length === 0) return "";
  const lines = effects.map((e) => `- [${STATUS_LABEL[e.status]}] ${KIND_LABEL[e.kind]}：${e.observed}（${DISPOSITION_LABEL[e.disposition]}）`);
  return "\n\n[evolution] 上一轮补丁的跨轮评估" + recordedAtStamp(recordedAt) + "：\n" + lines.join("\n");
}
