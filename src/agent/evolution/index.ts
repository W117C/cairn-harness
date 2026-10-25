// 自进化编排：会话收束时从事件流抽信号 → 翻成策略补丁 → 落盘；
// 下一轮装配时读回补丁并渲染成 system prompt 里的紧凑提示。
// 唯一有 IO 的层（signal / strategy-patch 是纯函数，store 只管文件）。
//
// 跨轮闭环（2026-10-16 补齐）：每轮落盘前先读上一轮记录，用本轮读数评一遍旧补丁
// （patch-effect）——"已消解"的不再挂着，"复发"的接回下一轮并升级处置；同时把本轮读数
// 推出的路由/上下文建议（advice）一起落盘。评估失败退化成"没有旧记录"的旧行为，不阻塞落盘。
//
// 闭环 v2（2026-10-25，三批加强）：
//  · **账本**（ledger.ts）：emit/observe 进追加式 evolution-ledger.jsonl，投影出每条 key 的
//    复发连击——第 N 次复发自动升级措辞（escalateNote）。evolution.json 仍是装配面读料（逐字兼容）。
//  · **反思位**（reflect.ts）：有补丁要发时请注入的 ReflectFn（读真实轨迹的 provider）改写
//    note；产出无证据即拒、规则 note 兜底（fail-open 到既有行为）。
//  · **补丁门**（patch-gates.ts）：两个来源（规则/反思）过同一道确定性验证——字段与读数一致、
//    同轮去重、有界；可选 gym 回放注入。
// 三段的失败语义一致：任何一段红都不阻塞落盘，退化成对应段的缺省行为。

import type { AgentEvent } from "../../events";
import { evolutionAdvice, hasAdvice, renderAdvice, type EvolutionAdvice } from "./advice";
import {
  carryOverPatches,
  evaluatePatchEffects,
  patchKeyOf,
  renderEffects,
  type PatchEffect,
} from "./patch-effect";
import { extractSignals } from "./signal";
import { strategyPatches, renderPatches, MAX_PATCHES_PER_RUN, type StrategyPatch } from "./strategy-patch";
import { loadEvolution, persistEvolution } from "./store";
import {
  appendLedger,
  escalateNote,
  ledgerEventsFor,
  loadLedger,
  projectLedger,
  type LedgerKeyStats,
} from "./ledger";
import { applyReflection, parseReflectProposals, reflectInstruction, type ReflectFn } from "./reflect";
import { gatePatches } from "./patch-gates";

export { extractSignals, type EvolutionSignals } from "./signal";
export { strategyPatches, renderPatches, type StrategyPatch, MAX_PATCHES_PER_RUN, COST_PER_BOUNDARY_LIMIT } from "./strategy-patch";
export {
  evaluatePatchEffects,
  carryOverPatches,
  renderEffects,
  patchKeyOf,
  type PatchEffect,
  type PatchEffectStatus,
  type PatchDisposition,
} from "./patch-effect";
export { evolutionAdvice, renderAdvice, hasAdvice, COMPRESS_EARLY_RATIO, type EvolutionAdvice } from "./advice";
export { loadEvolution, persistEvolution, evolutionPathFor, type EvolutionRecord, type EvolutionExtras } from "./store";
export {
  appendLedger,
  escalateNote,
  evolutionLedgerPathFor,
  ledgerEventsFor,
  loadLedger,
  medianOf,
  projectLedger,
  RECURRENCE_ESCALATE_MIN_STREAK,
  type LedgerEvent,
  type LedgerKeyStats,
  type LedgerProjection,
  type LoadedLedger,
} from "./ledger";
export {
  applyReflection,
  parseReflectProposals,
  reflectInstruction,
  NOTE_MAX_CHARS,
  type ReflectFn,
  type ReflectInput,
  type ReflectOutcome,
  type ReflectProposal,
} from "./reflect";
export { gatePatches, gatePatchesSync, type PatchGateCtx, type PatchReplay, type GateResult } from "./patch-gates";

export interface EvolutionRunResult {
  signals: ReturnType<typeof extractSignals>;
  patches: StrategyPatch[];
  /** 上一轮补丁在本轮读数下的效果评估（本轮存进去、下一轮装配时可见）。 */
  effects: PatchEffect[];
  /** 本轮读数推出的路由/上下文建议（空建议 = 全 null）。 */
  advice: EvolutionAdvice;
  persistedTo: string | null;
  /** 补丁门的拒单（出声面：拒了什么、为什么——不静默截断）。 */
  gateRefusals: Array<{ key: string; reason: string }>;
  /** 反思位的拒因（同上：反思说了但没采纳的，点名）。 */
  reflectRefusals: string[];
}

/** 每工作区一条读-评估-写串行链：同一 workspace 两场 run 同时收束时，
 *  旧实现各自读旧记录再整文件覆盖，后写者丢掉前者的补丁/效果/建议。 */
const evolutionChains = new Map<string, Promise<unknown>>();

function withEvolutionLock<T>(workspace: string, fn: () => Promise<T>): Promise<T> {
  const prev = evolutionChains.get(workspace) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  evolutionChains.set(workspace, next.catch(() => undefined));
  return next;
}

export interface RunEvolutionOptions {
  /** 反思位（批次 A2）：读真实轨迹改写补丁措辞。缺省不注入 = 纯规则（既有行为）。 */
  reflect?: ReflectFn;
  /** gym 回放位（批次 A3）：补丁门的外部验证面。缺省不注入。 */
  replay?: import("./patch-gates").PatchReplay;
}

/** 会话收束时跑一次：抽信号、评旧账、生补丁、过门、落盘。失败不许影响主流程。
 *  落盘两份：evolution.json（装配面读料，逐字兼容）+ evolution-ledger.jsonl（跨轮统计账）。 */
export async function runEvolution(
  events: readonly AgentEvent[],
  workspace: string,
  fromSession?: string,
  opts?: RunEvolutionOptions,
): Promise<EvolutionRunResult> {
  return await withEvolutionLock(workspace, () => runEvolutionLocked(events, workspace, fromSession, opts));
}

async function runEvolutionLocked(
  events: readonly AgentEvent[],
  workspace: string,
  fromSession: string | undefined,
  opts: RunEvolutionOptions | undefined,
): Promise<EvolutionRunResult> {
  const signals = extractSignals(events);
  // 读上一轮（读不动 = 没有旧账，不编造）；评估与生成都是纯函数。
  const previous = await loadEvolution(workspace);
  const effects = evaluatePatchEffects(previous?.patches ?? [], signals);
  const fresh = strategyPatches(signals);
  const carried = carryOverPatches(effects, fresh);
  // 账本投影：复发连击给 escalateNote 用（坏行只丢那一条，出声不阻塞）。
  const ledger = await loadLedger(workspace);
  if (ledger.badLines > 0) {
    console.warn("[evolution] 账本有 " + String(ledger.badLines) + " 行认不出，已只丢那几行（不整账作废）");
  }
  const projection = projectLedger(ledger.events);

  let candidates: StrategyPatch[] = [...fresh, ...carried];
  let reflectRefusals: string[] = [];
  // 反思位：只在有补丁要发、且本轮真有可反思的失败面时请一次——反思是增益，不是每场会话的固定开销。
  if (opts?.reflect !== undefined && candidates.length > 0
    && (Object.keys(signals.verifyFailuresByCause).length > 0 || signals.goalDriftCount > 0)) {
    try {
      const raw = await opts.reflect({ instruction: reflectInstruction(candidates, effects, signals), patches: candidates, effects });
      const outcome = parseReflectProposals(raw, events);
      reflectRefusals = outcome.refusals;
      candidates = applyReflection(candidates, outcome.proposals);
    } catch (err) {
      reflectRefusals = ["反思面抛错，按规则 note 继续（不影响落盘）: " + (err instanceof Error ? err.message : String(err))];
    }
  }

  // 复发升级：账本连击过线的 key，note 前加「（第 N 次复发）」。
  candidates = candidates.map((p) => escalatePatchNote(p, projection.stats));

  // 补丁门：证据一致性 / 同轮去重 / 有界（+ 可选回放）。拒单出声。
  const gated = await gatePatches(candidates, { signals, stats: projection.stats }, opts?.replay);
  for (const refusal of gated.refused) {
    console.warn("[evolution] 补丁门拒收 " + refusal.key + "：" + refusal.reason);
  }
  for (const refusal of reflectRefusals) {
    console.warn("[evolution] 反思产出被拒：" + refusal);
  }
  const patches = gated.admitted;

  const advice = evolutionAdvice(signals);
  let persistedTo: string | null = null;
  try {
    persistedTo = await persistEvolution(workspace, patches, fromSession, { effects, advice });
    // 账本追加（同一把锁内；失败只出声——evolution.json 已落，账本缺这一段只是统计变薄）。
    await appendLedger(workspace, ledgerEventsFor(Date.now(), fromSession, signals, patches, effects));
  } catch (err) {
    persistedTo = null;
    console.warn("[evolution] 落盘失败（不影响主流程）: " + (err instanceof Error ? err.message : String(err)));
  }
  return { signals, patches, effects, advice, persistedTo, gateRefusals: gated.refused, reflectRefusals };
}

function escalatePatchNote(p: StrategyPatch, stats: Record<string, LedgerKeyStats>): StrategyPatch {
  // 定位键只从 patchKeyOf 取（账本写侧同一个函数）——在这里再拼一遍 "kind:cause" 就是
  // 同一事实源的第二份抄法，两处漂了连击就对不上账。
  return { ...p, note: escalateNote(p.note, stats[patchKeyOf(p)]) };
}

/** 下一轮装配时读回上轮记录，渲染成给模型看的紧凑提示（空串 = 零行为）。
 *  三段各带「（记于 rec.ts）」时刻戳：记录可能是几天前写的，没有锚就会被读成"刚发生的"。 */
export async function evolutionPromptNote(workspace: string): Promise<string> {
  const rec = await loadEvolution(workspace);
  if (rec === null) return "";
  const advice = rec.advice ?? { preferredTier: null, contextAction: null, reasons: [] };
  const adviceText = hasAdvice(advice) ? renderAdvice(advice, rec.ts) : "";
  return renderPatches(rec.patches, rec.ts) + renderEffects(rec.effects ?? [], rec.ts) + adviceText;
}

/** 装配缝的结构化偏置（批次 A4 的读料口）：路由降档与提前压缩两个决策从「提示词文本」
 *  升格为「程序可读字段」。读不动 / 无建议 ⇒ 全 null（零偏置，既有行为）。
 *  与 evolutionPromptNote 读**同一份**记录——渲染面与决策面不各读各的。 */
export async function evolutionRoutingBias(
  workspace: string,
): Promise<{ preferredTier: EvolutionAdvice["preferredTier"]; contextAction: EvolutionAdvice["contextAction"] }> {
  const rec = await loadEvolution(workspace);
  if (rec === null) return { preferredTier: null, contextAction: null };
  const advice = rec.advice;
  if (advice === undefined) return { preferredTier: null, contextAction: null };
  return { preferredTier: advice.preferredTier, contextAction: advice.contextAction };
}
