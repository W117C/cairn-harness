// 离线评估记录（Cairn Evolve · P3 补齐）：跑离线配对 → 折成候选评分 → 存候选档案。
// 不自动晋升；promotion 会再查 holdout。已 promoted 的候选不接受复评。

import {
  evaluateOffline,
  type OfflineEvalResult,
} from "../../agent/evolve/offline-eval";
import { applyOfflineEvaluation } from "../../agent/evolve/offline-apply";
import type { CandidateRecord } from "../../agent/evolve/candidates";
import { loadCandidate, saveCandidate } from "./candidate-store";

export interface RecordOfflineEvalResult {
  candidate: CandidateRecord;
  result: OfflineEvalResult;
}

export async function recordOfflineEvaluation(
  workspace: string,
  candidateId: string,
  input: unknown,
  now: number = Date.now(),
): Promise<RecordOfflineEvalResult> {
  const candidate = await loadCandidate(workspace, candidateId);
  if (candidate === null) throw new Error("候选不存在或坏档：" + candidateId);
  if (candidate.status === "promoted") throw new Error("已晋升候选不再接受离线复评：" + candidateId);
  const result = evaluateOffline(input);
  const updated = applyOfflineEvaluation(candidate, result, now);
  await saveCandidate(workspace, updated);
  return { candidate: updated, result };
}
