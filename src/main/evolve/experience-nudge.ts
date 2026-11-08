// run 中途的经验提醒（Cairn Evolve · 快环）：verify 当轮变红时，把 active 的 on-signal 经验
// 追加到失败回执尾部——只在模型正要处理这条红时出现，不等到下一场会话。
//
// 边界：
//  · 只读；不改 playbook、不写 assignment、不调模型；
//  · 只读 active；观测账只影响排序（与起点注入同一份口径）；
//  · 有界：至多 2 条 / 700 字符；调用方负责去重（excludeIds）与脱敏；
//  · 读不动 ⇒ 空提醒（调用方还会再兜一层 catch）——verify 红不能被经验读取拖死。

import { classifyTask, observationalStatsOf, taskTokens } from "../../agent/evolve/episode";
import {
  applyObservationalStats,
  renderSignalNote,
  retrieveExperiences,
  type ExperienceEntry,
  type RetrievalContext,
} from "../../agent/evolve/playbook";
import { loadEpisodesWithUserFeedback } from "./episode-store";
import { isEvolveFrozen } from "./governance";
import { loadPlaybook } from "./playbook-store";

export const NUDGE_MAX_ENTRIES = 2;
export const NUDGE_MAX_CHARS = 700;

export interface ExperienceNudgeInput {
  taskContent: string;
  toolNames?: readonly string[];
  paths?: readonly string[];
  /** 本场已注入（起点 note / 上一次提醒）的经验 id：同一句不重复说。 */
  excludeIds?: readonly string[];
  maxEntries?: number;
  maxChars?: number;
  now?: number;
}

export interface ExperienceNudge {
  note: string;
  ids: string[];
}

export interface ExperienceNudgeRunnerInput {
  taskContent: string;
  toolNames?: readonly string[];
  paths?: readonly string[];
  maxEntries?: number;
  maxChars?: number;
  now?: number;
}

export interface ExperienceNudgeRunner {
  nudge(signals: readonly string[], excludeIds?: readonly string[]): Promise<ExperienceNudge>;
  /** 实际读盘次数（测试/观测用）：同一 runner 最多 1 次。 */
  loads(): number;
}

/** run 内单例：playbook + Episode 观测账**懒加载一次**，之后每次失败只做检索。
 *  边界：同一 run 中途从外部改账（激活/退役）不会反映到这条提醒——一场会话的提醒面
 *  以首次失败时读到的账为准；下一次 run 自然重读。 */
export function createExperienceNudgeRunner(
  workspace: string,
  base: ExperienceNudgeRunnerInput,
): ExperienceNudgeRunner {
  let cached: ExperienceEntry[] | null = null;
  let loading: Promise<ExperienceEntry[]> | null = null;
  let loadCount = 0;

  const load = (): Promise<ExperienceEntry[]> => {
    if (cached !== null) return Promise.resolve(cached);
    if (loading !== null) return loading;
    loadCount += 1;
    loading = (async () => {
      try {
        const playbook = await loadPlaybook(workspace);
        if (playbook.entries.length === 0) return [];
        try {
          const loaded = await loadEpisodesWithUserFeedback(workspace);
          return applyObservationalStats(playbook.entries, observationalStatsOf(loaded.episodes));
        } catch (err) {
          console.warn("[evolve] verify 提醒：观测账读不了（按原置信度）: "
            + (err instanceof Error ? err.message : String(err)));
          return [...playbook.entries];
        }
      } catch (err) {
        console.warn("[evolve] verify 提醒：playbook 读不了（本场不提醒）: "
          + (err instanceof Error ? err.message : String(err)));
        return [];
      }
    })().then((entries) => {
      cached = entries;
      return entries;
    });
    return loading;
  };

  return {
    loads: () => loadCount,
    async nudge(signals, excludeIds = []) {
      if (signals.length === 0) return { note: "", ids: [] };
      // STOP 冻结 = 不注入：起点注记已挡，中途快环也必须同一道门。每次调用现判——
      // 冻结可能发生在 run 中途；只判首次读账会让已缓存的 runner 继续漏经验。
      if (await isEvolveFrozen(workspace)) return { note: "", ids: [] };
      const entries = await load();
      if (entries.length === 0) return { note: "", ids: [] };
      const exclude = new Set(excludeIds);
      const context: RetrievalContext = {
        workspace,
        taskClass: classifyTask(base.taskContent),
        tokens: taskTokens(base.taskContent),
        signals: [...signals].sort(),
        toolNames: [...(base.toolNames ?? [])],
        paths: [...(base.paths ?? [])],
        now: base.now ?? Date.now(),
      };
      const result = retrieveExperiences(entries.filter((entry) => !exclude.has(entry.id)), context, {
        includeStatuses: ["active"],
        maxEntries: Math.min(base.maxEntries ?? NUDGE_MAX_ENTRIES, NUDGE_MAX_ENTRIES),
        maxChars: Math.min(base.maxChars ?? NUDGE_MAX_CHARS, NUDGE_MAX_CHARS),
      });
      if (result.selected.length === 0) return { note: "", ids: [] };
      return {
        note: renderSignalNote(result.selected, signals),
        ids: result.selected.map((entry) => entry.id),
      };
    },
  };
}

/** 失败信号 → 经验提醒（一次性调用；run 内多次调用请用 runner 复用读盘）。 */
export async function experienceSignalNudge(
  workspace: string,
  signals: readonly string[],
  input: ExperienceNudgeInput,
): Promise<ExperienceNudge> {
  return createExperienceNudgeRunner(workspace, input).nudge(signals, input.excludeIds ?? []);
}
