// 技能合成（Cairn Evolve · P4）：从**成功且同签名**的 Episode 提炼可复用的工具序列。
//
// 这是 Voyager/AWM 的最小本仓版：不做模型生成、不做开放世界探索，只用确定性规则把
// “同一类任务里反复走通、且最后 verify 绿”的工具序列折成 strategy candidate。
// 产出一律 candidate：还要过 shadow、实验、SEMA，才可能常驻。
// 分组用精确签名（workspace + taskClass + 工具序列骨架），先验证形态；模糊聚类留后。

import type { EpisodeRecord } from "./episode";
import { newExperience, type ExperienceEntry } from "./playbook";

export interface SkillSynthesisOptions {
  minEpisodes?: number;
  maxSteps?: number;
  now: number;
}

export interface SkillCandidate {
  entry: ExperienceEntry;
  episodeIds: string[];
  sequence: string[];
}

const MAX_BODY_CHARS = 800;

function renderBody(episode: EpisodeRecord, sequence: readonly string[]): string {
  const tokens = episode.task.tokens.slice(0, 6);
  const lines = [
    "当任务类为 " + episode.task.class + (tokens.length > 0 ? " 且出现 " + tokens.join("、") : "")
      + " 时，按已验证的顺序执行：",
    sequence.map((step, index) => String(index + 1) + ". " + step).join("\n"),
    "每步核对输出；收尾前跑 verify，绿了再收尾。",
  ];
  return lines.join("\n").slice(0, MAX_BODY_CHARS);
}

/** 纯函数：成功 Episode 按精确工具序列分组，组内 ≥ minEpisodes 才产出候选。 */
export function skillCandidates(
  episodes: readonly EpisodeRecord[],
  options: SkillSynthesisOptions,
): SkillCandidate[] {
  const minEpisodes = Math.max(2, options.minEpisodes ?? 3);
  const maxSteps = Math.max(2, options.maxSteps ?? 12);
  const groups = new Map<string, EpisodeRecord[]>();

  for (const episode of episodes) {
    if (episode.outcome.final !== "success") continue;
    const sequence = episode.evidence.toolSequence ?? [];
    if (sequence.length < 2 || sequence.length > maxSteps) continue;
    const key = [episode.workspace, episode.task.class, sequence.join(">")].join("\0");
    const group = groups.get(key) ?? [];
    group.push(episode);
    groups.set(key, group);
  }

  const out: SkillCandidate[] = [];
  for (const group of groups.values()) {
    if (group.length < minEpisodes) continue;
    const first = group[0]!;
    const sequence = first.evidence.toolSequence;
    const tokens = first.task.tokens.slice(0, 6);
    const entry = newExperience({
      kind: "strategy",
      scope: { workspace: first.workspace, taskClass: first.task.class },
      trigger: { when: "on-task-class", ...(tokens.length > 0 ? { keywords: tokens } : {}) },
      body: renderBody(first, sequence),
      evidenceEpisodes: group.map((episode) => episode.id),
      generator: "rule",
      pipeline: "skill-synthesis-v1",
      now: options.now,
    });
    out.push({ entry, episodeIds: group.map((episode) => episode.id), sequence: [...sequence] });
  }

  return out.sort((a, b) => b.episodeIds.length - a.episodeIds.length
    || (a.entry.id < b.entry.id ? -1 : a.entry.id > b.entry.id ? 1 : 0));
}
