// 自进化编排：会话收束时从事件流抽信号 → 翻成策略补丁 → 落盘；
// 下一轮装配时读回补丁并渲染成 system prompt 里的紧凑提示。
// 唯一有 IO 的层（signal / strategy-patch 是纯函数，store 只管文件）。

import type { AgentEvent } from "../../events";
import { extractSignals } from "./signal";
import { strategyPatches, renderPatches, type StrategyPatch } from "./strategy-patch";
import { loadEvolution, persistEvolution } from "./store";

export { extractSignals, type EvolutionSignals } from "./signal";
export { strategyPatches, renderPatches, type StrategyPatch, MAX_PATCHES_PER_RUN } from "./strategy-patch";
export { loadEvolution, persistEvolution, evolutionPathFor, type EvolutionRecord } from "./store";

export interface EvolutionRunResult {
  signals: ReturnType<typeof extractSignals>;
  patches: StrategyPatch[];
  persistedTo: string | null;
}

/** 会话收束时跑一次：抽信号、生补丁、落盘。失败不许影响主流程。 */
export async function runEvolution(
  events: readonly AgentEvent[],
  workspace: string,
  fromSession?: string,
): Promise<EvolutionRunResult> {
  const signals = extractSignals(events);
  const patches = strategyPatches(signals);
  let persistedTo: string | null = null;
  try {
    persistedTo = await persistEvolution(workspace, patches, fromSession);
  } catch {
    persistedTo = null;
  }
  return { signals, patches, persistedTo };
}

/** 下一轮装配时读回上轮补丁，渲染成给模型看的紧凑提示（空串 = 零行为）。 */
export async function evolutionPromptNote(workspace: string): Promise<string> {
  const rec = await loadEvolution(workspace);
  if (rec === null || rec.patches.length === 0) return "";
  return renderPatches(rec.patches);
}
