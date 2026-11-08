// 离线评估 → 候选档案（Cairn Evolve · P3 补齐）：纯映射，不读盘。
// passed/promote ⇒ status passed；failed ⇒ failed；unmeasurable ⇒ evaluating（不许晋升）。
// 已 promoted 的候选不再被复评降级（晋升是单向的；回滚走 SEMA/人工）。

import type { CandidateRecord, CandidateStatus } from "./candidates";
import type { OfflineEvalResult } from "./offline-eval";

export function applyOfflineEvaluation(
  candidate: CandidateRecord,
  result: OfflineEvalResult,
  now: number,
): CandidateRecord {
  if (candidate.status === "promoted") return candidate;
  const status: CandidateStatus = result.status === "passed" && result.decision === "promote"
    ? "passed"
    : result.status === "unmeasurable"
      ? "evaluating"
      : "failed";
  return {
    ...candidate,
    status,
    eval: {
      search: result.searchScores ?? candidate.eval.search,
      validation: result.validationScores ?? candidate.eval.validation,
      holdout: result.holdoutScores ?? candidate.eval.holdout,
      costUsd: result.holdoutScores?.costUsd ?? candidate.eval.costUsd,
    },
    updatedAt: now,
  };
}
