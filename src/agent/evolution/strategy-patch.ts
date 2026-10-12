// 自进化的策略补丁层：把信号变成「下一轮该怎么改」的可审计指令。
// 纯函数：signals ⇒ patches。每条补丁都带证据（cause / eventCount），
// 不编造、不猜——同 lessons 的「无出处不写」纪律。

import type { EvolutionSignals } from "./signal";

export type StrategyPatch =
  | { kind: "verify-escalate"; cause: string; times: number; note: string }
  | { kind: "goal-reconfirm"; driftCount: number; note: string }
  | { kind: "cost-throttle"; tokensPerBoundary: number | null; note: string };

export const MAX_PATCHES_PER_RUN = 3;

/** 把信号翻译成策略补丁。纯函数，有界（单跑最多 MAX_PATCHES_PER_RUN 条）。 */
export function strategyPatches(s: EvolutionSignals): StrategyPatch[] {
  const out: StrategyPatch[] = [];

  // 1) 同一 cause 连败 ≥3 ⇒ 升级：这条错不是代码问题，别再让模型照它改。
  if (s.repeatedVerifyCause !== null) {
    const times = s.verifyFailuresByCause[s.repeatedVerifyCause] ?? 0;
    out.push({
      kind: "verify-escalate",
      cause: s.repeatedVerifyCause,
      times,
      note: `同一 verify 失败 cause="${s.repeatedVerifyCause}" 连续 ${String(times)} 次——这多半是环境/工具链问题，不是代码可改；下一轮先排查环境，别照红改本来正确的代码。`,
    });
  }

  // 2) 目标漂移 >0 ⇒ 下一轮先复述目标再动手。
  if (s.goalDriftCount > 0) {
    out.push({
      kind: "goal-reconfirm",
      driftCount: s.goalDriftCount,
      note: `本跑目标漂移 ${String(s.goalDriftCount)} 处——下一轮开工前先复述当前目标与「不做什么」，对齐了再动手。`,
    });
  }

  // 3) 成本÷前进可测且偏高，或最后边界后还在烧 ⇒ 提前压缩 + 降档路由。
  if (s.costMeasurable && s.tokensPerBoundary !== null && s.tokensPerBoundary > 40_000) {
    out.push({
      kind: "cost-throttle",
      tokensPerBoundary: s.tokensPerBoundary,
      note: `每次 verified 前进平均花 ${String(s.tokensPerBoundary)} token——下一轮提前压缩上下文、路由优先走便宜档。`,
    });
  } else if (!s.costMeasurable && s.spendAfterLastBoundary > 0) {
    out.push({
      kind: "cost-throttle",
      tokensPerBoundary: null,
      note: `最后一次 verified 边界后仍花 ${String(s.spendAfterLastBoundary)} token 且无新前进——下一轮该停就停，别在死跑上继续烧。`,
    });
  }

  return out.slice(0, MAX_PATCHES_PER_RUN);
}

/** 把补丁渲染成一段给模型看的紧凑提示（进 system prompt，不另起事件类型）。 */
export function renderPatches(patches: readonly StrategyPatch[]): string {
  if (patches.length === 0) return "";
  const lines = patches.map((p) => `- ${p.note}`);
  return `\n\n[evolution] 上一轮的经验（仅供参考，不强制）：\n${lines.join("\n")}`;
}
