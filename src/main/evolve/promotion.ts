// 候选 → SEMA staging（Cairn Evolve · P3）：只提交 content-pack 提案，不安装、不激活。
//
// 晋升不是“把候选直接塞进提示词”：它必须变成 SEMA 的 content-pack 提案，过门、由人批准、
// 装进 installed、再经 canary。本文件只做第一步（submitProposal），并把回执写回候选档案。
// 没有 modules/ ⇒ 拒绝且不产生任何副作用（零行为）。

import type { CandidateRecord } from "../../agent/evolve/candidates";
import { triggerLabel, type ExperienceEntry } from "../../agent/evolve/playbook";
import { openEvolutionRegistry } from "../evolution/activation-host";
import { EvolutionPlane, ProposalRefusedError } from "../evolution/evolution-plane";
import { loadPlaybook } from "./playbook-store";
import { loadCandidate, saveCandidate } from "./candidate-store";
import { isEvolveFrozen } from "./governance";

export const PROMOTION_GATES: readonly string[] = ["prompt-surface-check", "prefix-churn-check"];
export const PROMOTION_ACTOR = "evolve-promote-v1";

export type PromotionOutcome =
  | {
    outcome: "submitted";
    candidate: CandidateRecord;
    bundleId: string;
    version: string;
    stagingDir: string;
  }
  | { outcome: "refused"; candidate: CandidateRecord; reason: string }
  | { outcome: "already-promoted"; candidate: CandidateRecord; reason: string };

function renderPackBody(candidate: CandidateRecord, entry: ExperienceEntry): string {
  const evidence = candidate.evidence.length > 0
    ? candidate.evidence.slice(0, 20).map((id) => "- " + id).join("\n")
    : "- （无 Episode 证据；本候选来自实验快照）";
  return [
    entry.body,
    "",
    "---",
    "触发：" + triggerLabel(entry),
    "范围：" + entry.scope.workspace + (entry.scope.taskClass === undefined ? "" : " · " + entry.scope.taskClass),
    "证据：",
    evidence,
    "来源：候选 " + candidate.id + "（实验晋升）",
  ].join("\n");
}

/**
 * 将 passed 候选提交为 content-pack staging。只提交，不安装。
 * 候选正文必须与 playbook 目标一致；目标已退役/改动 ⇒ 拒绝并让调用方重新生成候选。
 */
export async function promoteCandidateToSema(
  workspace: string,
  candidateId: string,
): Promise<PromotionOutcome> {
  const candidate = await loadCandidate(workspace, candidateId);
  if (candidate === null) throw new Error("候选不存在或坏档：" + candidateId);
  if (await isEvolveFrozen(workspace)) {
    return { outcome: "refused", candidate, reason: "STOP 冻结中：不晋升、不写 staging" };
  }
  if (candidate.status === "promoted" && candidate.promotion !== undefined) {
    return { outcome: "already-promoted", candidate, reason: "已晋升到 " + candidate.promotion.bundleId + "@" + candidate.promotion.version };
  }
  if (candidate.status !== "passed") {
    return { outcome: "refused", candidate, reason: "只有 passed 候选可晋升（当前 " + candidate.status + "）" };
  }
  const holdout = candidate.eval.holdout;
  if (holdout === null || holdout.success === null || holdout.success <= 0 || holdout.safety !== "pass") {
    return {
      outcome: "refused",
      candidate,
      reason: "没有可用的离线 holdout 评分（需要 success>0 且 safety=pass；先跑 evolve-eval）",
    };
  }
  const playbook = await loadPlaybook(workspace);
  const entry = playbook.entries.find((item) => item.id === candidate.target.id);
  if (entry === undefined) {
    return { outcome: "refused", candidate, reason: "候选目标不在 playbook 上：" + candidate.target.id };
  }
  if (entry.status === "retired" || entry.status === "deprecated") {
    return { outcome: "refused", candidate, reason: "候选目标已退役/废弃：" + entry.id };
  }
  if (entry.body !== candidate.body) {
    return { outcome: "refused", candidate, reason: "候选正文与 playbook 目标不一致（目标已改动，请重新生成候选）" };
  }

  const opened = await openEvolutionRegistry(workspace, PROMOTION_GATES);
  if (opened.kind === "absent") {
    return { outcome: "refused", candidate, reason: "工作区没有 modules/（SEMA 未启用）" };
  }
  if (opened.kind === "broken") {
    return { outcome: "refused", candidate, reason: "registry 账本读不动：" + opened.detail };
  }

  const bundleId = "content-pack.evolve-" + candidate.id.slice("cand_".length);
  const version = "0.1.0";
  const manifest = {
    id: bundleId,
    version,
    kind: "content-pack",
    entry: "prompt.md",
    deps: [],
    permissions: [],
    gates: [...PROMOTION_GATES],
    title: "Evolve 候选 " + candidate.id,
    description: "由实验/候选档案晋升；证据 " + String(candidate.evidence.length) + " 条。",
  };
  const files = { "prompt.md": renderPackBody(candidate, entry) };
  const plane = new EvolutionPlane({
    registry: opened.registry,
    actor: PROMOTION_ACTOR,
    requiredGatesByKind: {},
  });
  try {
    const receipt = await plane.submitProposal({ manifest, files });
    const promoted: CandidateRecord = {
      ...candidate,
      status: "promoted",
      updatedAt: Date.now(),
      promotion: {
        bundleId: receipt.id,
        version: receipt.version,
        stagingDir: receipt.stagingDir,
        ts: Date.now(),
      },
    };
    await saveCandidate(workspace, promoted);
    return {
      outcome: "submitted",
      candidate: promoted,
      bundleId: receipt.id,
      version: receipt.version,
      stagingDir: receipt.stagingDir,
    };
  } catch (err) {
    const reason = err instanceof ProposalRefusedError
      ? err.message
      : err instanceof Error ? err.message : String(err);
    return { outcome: "refused", candidate, reason };
  }
}
