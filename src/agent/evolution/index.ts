// 自进化编排：会话收束时从事件流抽信号 → 翻成策略补丁 → 落盘；
// 下一轮装配时读回补丁并渲染成 system prompt 里的紧凑提示。
// 唯一有 IO 的层（signal / strategy-patch 是纯函数，store 只管文件）。
//
// 跨轮闭环（2026-10-16 补齐）：每轮落盘前先读上一轮记录，用本轮读数评一遍旧补丁
// （patch-effect）——"已消解"的不再挂着，"复发"的接回下一轮并升级处置；同时把本轮读数
// 推出的路由/上下文建议（advice）一起落盘。评估失败退化成"没有旧记录"的旧行为，不阻塞落盘。

import type { AgentEvent } from "../../events";
import { evolutionAdvice, hasAdvice, renderAdvice, type EvolutionAdvice } from "./advice";
import {
  carryOverPatches,
  evaluatePatchEffects,
  renderEffects,
  type PatchEffect,
} from "./patch-effect";
import { extractSignals } from "./signal";
import { strategyPatches, renderPatches, MAX_PATCHES_PER_RUN, type StrategyPatch } from "./strategy-patch";
import { loadEvolution, persistEvolution } from "./store";

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
export { evolutionAdvice, renderAdvice, hasAdvice, type EvolutionAdvice } from "./advice";
export { loadEvolution, persistEvolution, evolutionPathFor, type EvolutionRecord, type EvolutionExtras } from "./store";

export interface EvolutionRunResult {
  signals: ReturnType<typeof extractSignals>;
  patches: StrategyPatch[];
  /** 上一轮补丁在本轮读数下的效果评估（本轮存进去、下一轮装配时可见）。 */
  effects: PatchEffect[];
  /** 本轮读数推出的路由/上下文建议（空建议 = 全 null）。 */
  advice: EvolutionAdvice;
  persistedTo: string | null;
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

/** 会话收束时跑一次：抽信号、评旧账、生补丁、落盘。失败不许影响主流程。 */
export async function runEvolution(
  events: readonly AgentEvent[],
  workspace: string,
  fromSession?: string,
): Promise<EvolutionRunResult> {
  return await withEvolutionLock(workspace, () => runEvolutionLocked(events, workspace, fromSession));
}

async function runEvolutionLocked(
  events: readonly AgentEvent[],
  workspace: string,
  fromSession?: string,
): Promise<EvolutionRunResult> {
  const signals = extractSignals(events);
  // 读上一轮（读不动 = 没有旧账，不编造）；评估与生成都是纯函数。
  const previous = await loadEvolution(workspace);
  const effects = evaluatePatchEffects(previous?.patches ?? [], signals);
  const fresh = strategyPatches(signals);
  const patches = [...fresh, ...carryOverPatches(effects, fresh)].slice(0, MAX_PATCHES_PER_RUN);
  const advice = evolutionAdvice(signals);
  let persistedTo: string | null = null;
  try {
    persistedTo = await persistEvolution(workspace, patches, fromSession, { effects, advice });
  } catch (err) {
    persistedTo = null;
    console.warn("[evolution] 落盘失败（不影响主流程）: " + (err instanceof Error ? err.message : String(err)));
  }
  return { signals, patches, effects, advice, persistedTo };
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
