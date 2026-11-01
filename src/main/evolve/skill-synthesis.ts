// 技能候选落库（Cairn Evolve · P4）：读 Episode → skillCandidates → 追加 playbook add。
// 只写 candidate；同 id 幂等跳过。没有成功 Episode 或不足最小样本 ⇒ 零写入。

import { skillCandidates, type SkillSynthesisOptions } from "../../agent/evolve/skills";
import { validateExperience, type PlaybookOp } from "../../agent/evolve/playbook";
import { loadEpisodes } from "./episode-store";
import { appendPlaybookEvents, loadPlaybook, playbookPathFor } from "./playbook-store";
import { isEvolveFrozen, loadEvolveBudget } from "./governance";

export interface SeedSkillResult {
  path: string;
  proposed: number;
  added: number;
  skippedExisting: number;
  skippedInvalid: number;
  /** STOP 冻结时 true；本函数不写任何东西。 */
  frozen?: boolean;
  /** playbook 已达预算上限时 true；本函数不写任何东西。 */
  budgetBlocked?: boolean;
}

export async function seedSkillCandidates(
  workspace: string,
  options: Omit<SkillSynthesisOptions, "now"> & { now?: number } = {},
): Promise<SeedSkillResult> {
  const now = options.now ?? Date.now();
  const path = playbookPathFor(workspace);
  if (await isEvolveFrozen(workspace)) {
    return { path, proposed: 0, added: 0, skippedExisting: 0, skippedInvalid: 0, frozen: true };
  }
  const budget = (await loadEvolveBudget(workspace)).budget;
  const playbook = await loadPlaybook(workspace);
  if (playbook.entries.length >= budget.maxPlaybookEntries) {
    return { path, proposed: 0, added: 0, skippedExisting: 0, skippedInvalid: 0, budgetBlocked: true };
  }
  const loaded = await loadEpisodes(workspace);
  const candidates = skillCandidates(loaded.episodes, {
    now,
    ...(options.minEpisodes === undefined ? {} : { minEpisodes: options.minEpisodes }),
    ...(options.maxSteps === undefined ? {} : { maxSteps: options.maxSteps }),
  });
  const existing = new Set(playbook.entries.map((entry) => entry.id));
  const ops: PlaybookOp[] = [];
  let skippedExisting = 0;
  let skippedInvalid = 0;
  for (const candidate of candidates) {
    if (existing.has(candidate.entry.id)) {
      skippedExisting += 1;
      continue;
    }
    const issues = validateExperience(candidate.entry);
    if (issues.length > 0) {
      skippedInvalid += 1;
      continue;
    }
    ops.push({
      v: 1,
      op: "add",
      ts: now,
      entry: candidate.entry,
      evidence: candidate.entry.evidence.episodes,
      reason: "skill synthesis: " + candidate.sequence.join(">"),
    });
    existing.add(candidate.entry.id);
  }
  if (ops.length > 0) await appendPlaybookEvents(workspace, ops);
  return {
    path,
    proposed: candidates.length,
    added: ops.length,
    skippedExisting,
    skippedInvalid,
  };
}
