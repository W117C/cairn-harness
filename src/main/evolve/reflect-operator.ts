// reflect-delta 落库（Cairn Evolve · P3）：读 Episode 证据集 → 解析反思 → 新 candidate entry
// → 追加 playbook add + 候选档案。不改原条目；重复反思同一内容幂等。
//
// 只写 candidate/draft；晋升仍走离线 holdout + SEMA；STOP 冻结时不写。

import { parseReflectDelta } from "../../agent/evolve/operators";
import type { CandidateRecord } from "../../agent/evolve/candidates";
import type { ExperienceEntry } from "../../agent/evolve/playbook";
import { appendPlaybookEvents, loadPlaybook } from "./playbook-store";
import { loadEpisodes } from "./episode-store";
import { candidatePathFor, createCandidate, loadCandidate } from "./candidate-store";
import { isEvolveFrozen } from "./governance";

export interface ReflectRecordInput {
  workspace: string;
  targetId: string;
  reflection: unknown;
  now?: number;
  parentId?: string | null;
}

export interface ReflectRecordResult {
  outcome: "created" | "existing" | "refused" | "frozen";
  entry?: ExperienceEntry;
  candidate?: CandidateRecord;
  path?: string;
  refusals?: string[];
}

export async function recordReflectDelta(input: ReflectRecordInput): Promise<ReflectRecordResult> {
  if (await isEvolveFrozen(input.workspace)) {
    return { outcome: "frozen", refusals: ["STOP 冻结中：不写反思候选"] };
  }
  const playbook = await loadPlaybook(input.workspace);
  const target = playbook.entries.find((entry) => entry.id === input.targetId);
  if (target === undefined) {
    return { outcome: "refused", refusals: ["目标经验不在 playbook 上：" + input.targetId] };
  }
  const episodes = await loadEpisodes(input.workspace);
  const now = input.now ?? Date.now();
  const parsed = parseReflectDelta({
    workspace: input.workspace,
    entry: target,
    evidenceEpisodes: episodes.episodes.map((episode) => episode.id),
    reflection: input.reflection,
    now,
    ...(input.parentId === undefined ? {} : { parentId: input.parentId }),
  });
  if (!parsed.ok) return { outcome: "refused", refusals: parsed.refusals };

  const existing = await loadCandidate(input.workspace, parsed.candidate.id);
  if (existing !== null) {
    return {
      outcome: "existing",
      entry: parsed.entry,
      candidate: existing,
      path: candidatePathFor(input.workspace, existing.id),
    };
  }
  if (playbook.entries.some((entry) => entry.id === parsed.entry.id)) {
    return {
      outcome: "refused",
      entry: parsed.entry,
      candidate: parsed.candidate,
      refusals: ["候选条目 id 已存在但候选档案缺失——先查账，不重复写"],
    };
  }

  await appendPlaybookEvents(input.workspace, [{
    v: 1,
    op: "add",
    ts: now,
    entry: parsed.entry,
    evidence: parsed.entry.evidence.episodes,
    reason: "reflect-delta from " + target.id,
  }]);
  const path = await createCandidate(input.workspace, parsed.candidate);
  return { outcome: "created", entry: parsed.entry, candidate: parsed.candidate, path };
}
