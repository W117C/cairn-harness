// 实验 → 候选（Cairn Evolve · P3）：只有分析为 passed 的实验才能生成候选档案。
//
// 评分口径要诚实：在线实验的治疗臂成功率进 validation；没有离线 holdout 就是 null，
// 不拿 validation 冒充 holdout。P4 再补 gym/bench 的 holdout 评分。

import { newCandidate, type CandidateRecord, type CandidateScores } from "../../agent/evolve/candidates";
import { applyPlaybookEvents, type PlaybookOp } from "../../agent/evolve/playbook";
import { analyzeExperimentById } from "./experiment-store";
import { appendPlaybookEvents, loadPlaybook } from "./playbook-store";
import { candidatePathFor, createCandidate, loadCandidate } from "./candidate-store";

export interface ExperimentCandidateResult {
  candidate: CandidateRecord;
  path: string;
  created: boolean;
  analysis: Awaited<ReturnType<typeof analyzeExperimentById>>["analysis"];
}

export async function createCandidateFromExperiment(
  workspace: string,
  experimentId: string,
  options: { now?: number } = {},
): Promise<ExperimentCandidateResult> {
  const result = await analyzeExperimentById(workspace, experimentId);
  if (result.analysis.status !== "passed") {
    throw new Error("实验未通过（" + result.analysis.status + "/" + result.analysis.decision + "）：" + result.analysis.reason);
  }
  const entryId = result.record.candidateRef;
  const playbook = await loadPlaybook(workspace);
  const entry = playbook.entries.find((item) => item.id === entryId);
  if (entry === undefined) throw new Error("实验候选不在 playbook 上：" + entryId);
  if (entry.status === "retired" || entry.status === "deprecated") {
    throw new Error("实验候选已退役/废弃：" + entryId);
  }
  const now = options.now ?? Date.now();
  const treatment = result.analysis.nTreatment;
  const validation: CandidateScores = {
    success: treatment > 0 ? result.analysis.successTreatment / treatment : null,
    costUsd: result.analysis.cost.treatmentUsd,
    latencyMs: null,
    safety: "unknown",
  };
  // 因果置信度回填：对照组实验的 riskDiff/CI 是 candidate → active 的唯一升级依据。
  // 只写进 playbook 条目（读侧 ranking 与激活门都吃这一格）；候选档案另存 validation。
  const causal = {
    trials: result.analysis.nControl + result.analysis.nTreatment,
    riskDiff: result.analysis.riskDiff,
    ci95: result.analysis.ci95,
  };
  const currentCausal = entry.confidence.causal;
  const causalAlready = currentCausal.trials === causal.trials
    && currentCausal.riskDiff === causal.riskDiff
    && JSON.stringify(currentCausal.ci95) === JSON.stringify(causal.ci95);
  if (!causalAlready) {
    const patch: PlaybookOp = {
      v: 1,
      op: "patch",
      ts: now,
      id: entryId,
      fields: { confidence: { ...entry.confidence, causal } },
      evidence: result.samples.filter((sample) => sample.arm === "treatment").map((sample) => sample.episodeId),
      reason: "experiment " + experimentId + " passed（riskDiff " + String(causal.riskDiff) + "）",
    };
    // 追加前先过同一 fold：append 本身不判语义，坏 patch 会静默躺在账上。
    const refusal = applyPlaybookEvents([...playbook.events, patch])
      .refusals.find((item) => item.index === playbook.events.length);
    if (refusal !== undefined) throw new Error("实验置信度写不进 playbook：" + refusal.reason);
    await appendPlaybookEvents(workspace, [patch]);
  }
  const candidate = newCandidate({
    workspace,
    operator: "experiment",
    target: { kind: "experience", id: entryId },
    body: entry.body,
    evidence: result.samples
      .filter((sample) => sample.arm === "treatment")
      .map((sample) => sample.episodeId),
    status: "passed",
    eval: { validation, costUsd: result.analysis.cost.treatmentUsd },
    metaproductivity: { trials: 1, accepted: 1, yieldPerKToken: null },
    now,
  });
  const existing = await loadCandidate(workspace, candidate.id);
  if (existing !== null) {
    return { candidate: existing, path: candidatePathFor(workspace, existing.id), created: false, analysis: result.analysis };
  }
  const path = await createCandidate(workspace, candidate);
  return { candidate, path, created: true, analysis: result.analysis };
}
