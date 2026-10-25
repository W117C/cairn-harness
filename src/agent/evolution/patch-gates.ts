// 补丁门（闭环 v2 · 批次 A3）：补丁进 system prompt 前的**确定性验证**。
//
// 缺口：旧实现里 strategyPatches 产什么发什么——规则层自洽（补丁由信号派生，字段必与读数一致），
// 但反思位（批次 A2）加进来之后，note 是 LLM 写的，补丁列表多了一个来源。本模块把「一条补丁
// 凭什么上场」写成显式判据，两个来源过同一道门：
//  1. **字段与读数一致**（证据门）：verify-escalate 的 cause 必须在本轮失败账上；goal-reconfirm
//     的 driftCount 必须等于本轮漂移真读数；cost-throttle 必须真可测且真超线（走具名判据
//     costThrottleMeasurable，不抄第四份）。规则补丁恒过（它就是从这些读数派生的）；
//     反思/接续补丁过不了 ⇒ 拒——「问题已经不在了还开方」比「少一句提示」坏。
//  2. **同轮去重**：同一 key 只发一条（先到先得——fresh 优先于 carry-over 的次序由 index.ts
//     的拼接顺序保证，这里只兜底显式拒重）。
//  3. **有界**：条数 ≤ MAX_PATCHES_PER_RUN（超了拒尾部——不是静默截断，拒因出声）。
//
// gym 回放位（可插拔）：`replay` 注入时每条获准补丁再过一道外部验证（gym 的 scripted/probe 档
// 回放「带这条补丁会不会降分」），不过 ⇒ 该条拒。缺省不注入 = 零行为——回放执行面属于 gym 侧，
// 本模块不 spawn、不抄命令面（gate-runner 同款纪律：编排归 src，执行面归调用方注入）。

import type { EvolutionSignals } from "./signal";
import { COST_PER_BOUNDARY_LIMIT, MAX_PATCHES_PER_RUN, costThrottleMeasurable, type StrategyPatch } from "./strategy-patch";
import { patchKeyOf } from "./patch-effect";
import type { LedgerKeyStats } from "./ledger";

export interface PatchGateCtx {
  signals: EvolutionSignals;
  /** 账本统计（可缺——首启无账时去重只看本轮内）。 */
  stats?: Record<string, LedgerKeyStats>;
}

export interface PatchReplay {
  /** 外部回放验证面（gym 档）；返回 ok=false ⇒ 该条补丁拒。 */
  replay?: (patch: StrategyPatch) => Promise<{ ok: boolean; detail: string }>;
}

export interface GateResult {
  admitted: StrategyPatch[];
  refused: Array<{ key: string; reason: string }>;
}

/** 一条补丁与本轮读数的一致性（纯函数）。三条 kind 各一条判据，全部走信号派生时的同一格。
 *
 *  判据的方向是「**拦矛盾**，放缺席」：patch-effect 已把「读数说没问题」的旧补丁判 resolved 淘汰、
 *  把「读数说又犯了」的判 recurred 接续——能走到门前的旧补丁只剩「读数缺席」（inconclusive：
 *  本轮没跑 verify / 漂移不可测 / 成本不可测）这一类，它们的接续是跨轮闭环的语义（不可测不等于
 *  已消解），**不许被门当矛盾拒掉**。门拦的是「读数在场且与补丁前提相抵」：
 *  · verify-escalate：本轮跑了 verify 且该 cause 零失败 ⇒ 矛盾（没犯这个病不开这个方）；
 *  · goal-reconfirm：漂移可测且条数与补丁记的不一致 ⇒ 矛盾（fresh 恒一致；不一致的旧补丁
 *    在 carryOver 处已被 fresh 顶掉，走到这里的可测情形必一致——这条判据守住的是不变量）；
 *  · cost-throttle：可测且未超线 ⇒ 矛盾（回落的账不该再挂节流方子）。 */
function consistentWithSignals(patch: StrategyPatch, s: EvolutionSignals): string | null {
  switch (patch.kind) {
    case "verify-escalate":
      if (s.verifyOutcome === "none") return null;
      return (s.verifyFailuresByCause[patch.cause] ?? 0) > 0
        ? null
        : "本轮跑了 verify 且 cause=" + patch.cause + " 零失败——没犯这个病不开这个方";
    case "goal-reconfirm":
      if (patch.driftCount <= 0) return "driftCount ≤ 0 的 goal-reconfirm 不该存在（fresh 由 drift>0 派生）";
      if (s.goalDriftMeasurable === true && s.goalDriftCount !== patch.driftCount) {
        return "driftCount=" + String(patch.driftCount) + " 与本轮漂移真读数 " + String(s.goalDriftCount) + " 不一致";
      }
      return null;
    case "cost-throttle":
      if (!costThrottleMeasurable(s)) return null;
      return s.tokensPerBoundary > COST_PER_BOUNDARY_LIMIT
        ? null
        : "成本已回落到 " + String(COST_PER_BOUNDARY_LIMIT) + " 以内——回落的账不该再挂节流方子";
  }
}

/** 同步门（纯函数）：证据一致性 + 同轮去重 + 有界。 */
export function gatePatchesSync(patches: readonly StrategyPatch[], ctx: PatchGateCtx): GateResult {
  const refused: Array<{ key: string; reason: string }> = [];
  const admitted: StrategyPatch[] = [];
  const seen = new Set<string>();
  for (const p of patches) {
    const key = patchKeyOf(p);
    if (seen.has(key)) {
      refused.push({ key, reason: "同轮重复 key——同一条账只发一条" });
      continue;
    }
    const inconsistent = consistentWithSignals(p, ctx.signals);
    if (inconsistent !== null) {
      refused.push({ key, reason: inconsistent });
      continue;
    }
    if (admitted.length >= MAX_PATCHES_PER_RUN) {
      refused.push({ key, reason: "超过单跑上限 " + String(MAX_PATCHES_PER_RUN) + " 条——拒尾部，不静默截断" });
      continue;
    }
    seen.add(key);
    admitted.push(p);
  }
  return { admitted, refused };
}

/** 全门（含可插拔回放）：同步门过了的逐条过 replay；任一条 replay 拒 ⇒ 该条出局。
 *  replay 本身抛错 ⇒ 按「不可判」拒那条（fail-closed：回放面坏了不让补丁溜过去）。 */
export async function gatePatches(
  patches: readonly StrategyPatch[],
  ctx: PatchGateCtx,
  replay?: PatchReplay,
): Promise<GateResult> {
  const sync = gatePatchesSync(patches, ctx);
  if (replay?.replay === undefined || sync.admitted.length === 0) return sync;
  const admitted: StrategyPatch[] = [];
  const refused = [...sync.refused];
  for (const p of sync.admitted) {
    let verdict: { ok: boolean; detail: string };
    try {
      verdict = await replay.replay(p);
    } catch (err) {
      verdict = { ok: false, detail: "回放面抛错（按不可判拒）: " + (err instanceof Error ? err.message : String(err)) };
    }
    if (verdict.ok) admitted.push(p);
    else refused.push({ key: patchKeyOf(p), reason: "回放未过：" + verdict.detail });
  }
  return { admitted, refused };
}
