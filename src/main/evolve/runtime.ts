// 运行时注入（Cairn Evolve · P2）：装配缝读 active 经验 + running 实验，确定性分配，
// 写 assignment sidecar，返回一段可拼进 system prompt 的紧凑注记。
//
// 边界：
//  · 没有 active 经验、没有 running 实验 ⇒ 空串 + 不写 sidecar（零行为）；
//  · 实验候选必须不是 active（否则 control 也被污染）；候选已过期/不匹配 ⇒ 本场不入实验，不写 sidecar；
//  · assignment 写不进去 ⇒ 本场不注入（宁可不试，也不制造一条无法归因的 treatment）；
//  · 本层不调用模型、不判实验成败；它只负责“这一场属于哪一臂、看到什么”。

import {
  classifyTask,
  observationalStatsOf,
  taskTokens,
  type EpisodeAssignment,
  type EpisodeArm,
} from "../../agent/evolve/episode";
import {
  applyObservationalStats,
  matchesContext,
  renderPlaybookNote,
  retrievable,
  retrieveExperiences,
  type ExperienceEntry,
  type RetrievalContext,
} from "../../agent/evolve/playbook";
import { previousRunSignals } from "../../agent/evolve/shadow";
import type { EpisodeRecord } from "../../agent/evolve/episode";
import {
  aggregateExperimentSamplesBySession,
  assignArm,
  checkExperimentBudget,
  type ExperimentRecord,
} from "../../agent/evolve/experiment";
import {
  clearAssignment,
  POLICY_VERSION,
  writeAssignment,
  type AssignmentStamp,
} from "./assignment-store";
import { listExperiments, loadExperimentAnalysis } from "./experiment-store";
import { loadEpisodesWithUserFeedback } from "./episode-store";
import { isGlobalEvolveFrozen, loadGlobalPlaybook } from "./global-playbook-store";
import { loadPlaybook } from "./playbook-store";
import { isEvolveFrozen, loadEvolveBudget } from "./governance";

export const MAX_INJECTED = 6;
export const MAX_INJECTED_CHARS = 2_000;

export interface PrepareEvolutionInput {
  workspace: string;
  sessionId: string;
  taskContent: string;
  toolNames?: readonly string[];
  paths?: readonly string[];
  /** 装配方已知的信号（可选）。同一会话上一跑的信号由本层自己从 Episode 账读。 */
  signals?: readonly string[];
  now?: number;
}

export interface EvolutionInjection {
  note: string;
  assignment: EpisodeAssignment | null;
  experimentId: string | null;
  arm: EpisodeArm;
  /** 本场已注入的经验 id（含基线）：run 中途的 verify 提醒用它去重，避免同一句说两遍。 */
  injectedExperienceIds: string[];
  reason: string;
}

function entryChars(entry: ExperienceEntry): number {
  return entry.body.length + 80;
}

function selectWithinBudget(
  entries: readonly ExperienceEntry[],
  maxEntries: number,
  maxChars: number,
): ExperienceEntry[] {
  const selected: ExperienceEntry[] = [];
  let chars = 0;
  for (const entry of entries) {
    if (selected.length >= maxEntries) break;
    const cost = entryChars(entry);
    if (chars + cost > maxChars) continue;
    selected.push(entry);
    chars += cost;
  }
  return selected;
}

/** Episode 观测账读侧入口：读不动 ⇒ null（注入照旧，只是没有观测叠加与上跑信号），出声。 */
async function loadInjectionEpisodes(workspace: string): Promise<EpisodeRecord[] | null> {
  try {
    return (await loadEpisodesWithUserFeedback(workspace)).episodes;
  } catch (err) {
    console.warn("[evolve] Episode 账读不了（本轮按原始置信度、无上跑信号）: "
      + (err instanceof Error ? err.message : String(err)));
    return null;
  }
}

/** 基线注入也写归因 sidecar（arm=none / experimentId=null）：收束时 Episode 才说得出
 *  「这一场注入了哪几条」。写不进仍注入——基线没有实验完整性要保，观测账缺这一条只出声。 */
async function stampBaselineInjection(
  workspace: string,
  sessionId: string,
  selected: readonly ExperienceEntry[],
  note: string,
  now: number,
): Promise<void> {
  if (selected.length === 0 || sessionId.length === 0) return;
  const stamp: AssignmentStamp = {
    experimentId: null,
    arm: "none",
    propensity: null,
    policyVersion: POLICY_VERSION,
    injectedExperienceIds: selected.map((entry) => entry.id),
    injectedChars: note.length,
  };
  try {
    await writeAssignment(workspace, sessionId, stamp, now);
  } catch (err) {
    console.warn("[evolve] 基线注入归因写不进（本场仍注入，观测账缺这一条）: "
      + (err instanceof Error ? err.message : String(err)));
  }
}

/** 全局 active 经验（owner 显式晋升的跨 workspace 经验）：全局 STOP 时零注入。 */
async function loadGlobalActiveEntries(): Promise<ExperienceEntry[]> {
  try {
    if (await isGlobalEvolveFrozen()) return [];
    const global = await loadGlobalPlaybook();
    return global.entries.filter((entry) => entry.status === "active");
  } catch (err) {
    console.warn("[evolve] 全局 playbook 读不了（本轮只注局部经验）: "
      + (err instanceof Error ? err.message : String(err)));
    return [];
  }
}

/** 起点检索的共同料：预算 + 已叠加观测账的 active 候选 + Episode 账（可为 null）。
 *  主会话与 worker 起点注记共用这一份，避免两处各读一遍/各算一次。
 *  全局 active 经验按 id 去重后并入（同 id 的 workspace 条目优先）。 */
async function loadBaselineState(workspace: string): Promise<{
  budget: Awaited<ReturnType<typeof loadEvolveBudget>>["budget"];
  entries: ExperienceEntry[];
  episodes: EpisodeRecord[] | null;
}> {
  const budget = (await loadEvolveBudget(workspace)).budget;
  const playbook = await loadPlaybook(workspace);
  const globalEntries = await loadGlobalActiveEntries();
  const localIds = new Set(playbook.entries.map((entry) => entry.id));
  const rawEntries = [...playbook.entries, ...globalEntries.filter((entry) => !localIds.has(entry.id))];
  // 有经验才需要观测账：空账的检索本来是空，不白读 Episode。
  const episodes = rawEntries.length === 0 ? null : await loadInjectionEpisodes(workspace);
  const entries = episodes === null
    ? rawEntries
    : applyObservationalStats(rawEntries, observationalStatsOf(episodes));
  return { budget, entries, episodes };
}

/** worker 起点注记（只读）：没有会话/实验分配，只把 active 经验按任务面筛一遍。
 *  与主会话起点共用同一份账与排序；冻结时零注入。 */
export async function baselineEvolutionNote(input: {
  workspace: string;
  taskContent: string;
  toolNames?: readonly string[];
  paths?: readonly string[];
  now?: number;
}): Promise<string> {
  const now = input.now ?? Date.now();
  if (await isEvolveFrozen(input.workspace)) return "";
  const state = await loadBaselineState(input.workspace);
  if (state.entries.length === 0) return "";
  const context: RetrievalContext = {
    workspace: input.workspace,
    taskClass: classifyTask(input.taskContent),
    tokens: taskTokens(input.taskContent),
    signals: [],
    toolNames: [...(input.toolNames ?? [])],
    paths: [...(input.paths ?? [])],
    now,
  };
  const baseline = retrieveExperiences(state.entries, context, {
    includeStatuses: ["active"],
    maxEntries: state.budget.maxInjectedEntries,
    maxChars: state.budget.maxInjectedChars,
  });
  return renderPlaybookNote(baseline.selected);
}

/** 装配缝一行入口。失败语义由调用方兜（agent-runner 只出声，不阻塞主流程）。 */
export async function prepareEvolutionInjection(input: PrepareEvolutionInput): Promise<EvolutionInjection> {
  const now = input.now ?? Date.now();
  if (await isEvolveFrozen(input.workspace)) {
    return { note: "", assignment: null, experimentId: null, arm: "none", injectedExperienceIds: [], reason: "frozen" };
  }
  if (typeof input.sessionId === "string" && input.sessionId.length > 0) {
    await clearAssignment(input.workspace, input.sessionId);
  }
  const taskClass = classifyTask(input.taskContent);
  const tokens = taskTokens(input.taskContent);
  const state = await loadBaselineState(input.workspace);
  const { budget, entries, episodes } = state;
  const context: RetrievalContext = {
    workspace: input.workspace,
    taskClass,
    tokens,
    signals: [...new Set([
      ...(episodes === null ? [] : previousRunSignals(episodes, input.sessionId)),
      ...(input.signals ?? []),
    ])].sort(),
    toolNames: [...(input.toolNames ?? [])],
    paths: [...(input.paths ?? [])],
    now,
  };
  const baseline = retrieveExperiences(entries, context, {
    includeStatuses: ["active"],
    maxEntries: budget.maxInjectedEntries,
    maxChars: budget.maxInjectedChars,
  });
  const baselineNote = renderPlaybookNote(baseline.selected);
  const running: ExperimentRecord[] = [];
  let skippedByBudget = false;
  let budgetEpisodes: EpisodeRecord[] | null = episodes;
  for (const experiment of await listExperiments(input.workspace)) {
    if (experiment.status !== "running" || experiment.workspace !== input.workspace) continue;
    if (experiment.taskFilter.class !== undefined && !experiment.taskFilter.class.includes(taskClass)) continue;
    // 已裁决（passed/failed/unmeasurable）的实验不再继续分配：分析结果文件是终止标记。
    const decision = await loadExperimentAnalysis(input.workspace, experiment.id);
    if (decision !== null && decision.status !== "running") continue;
    // 预算硬闸门：maxRuns / maxUsd（含不可定价 fail-closed）/ maxWallMs 任一耗尽即停止新分配。
    if (budgetEpisodes === null) {
      budgetEpisodes = await loadInjectionEpisodes(input.workspace);
    }
    const agg = aggregateExperimentSamplesBySession(experiment, budgetEpisodes ?? []);
    const budgetCheck = checkExperimentBudget(experiment, {
      totalRuns: agg.totalRuns,
      totalUsd: agg.totalUsd,
      hasUnpricedRuns: agg.hasUnpricedRuns,
      now,
    });
    if (budgetCheck.exhausted) {
      skippedByBudget = true;
      continue;
    }
    running.push(experiment);
  }
  const experiments = running.sort(
    (a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );

  if (experiments.length === 0) {
    if (typeof input.sessionId === "string" && input.sessionId.length > 0) {
      await stampBaselineInjection(input.workspace, input.sessionId, baseline.selected, baselineNote, now);
    }
    return {
      note: baselineNote,
      assignment: null,
      experimentId: null,
      arm: "none",
      injectedExperienceIds: baseline.selected.map((entry) => entry.id),
      reason: skippedByBudget ? "experiment-budget-exhausted" : (baseline.selected.length > 0 ? "active" : "none"),
    };
  }

  if (typeof input.sessionId !== "string" || input.sessionId.length === 0) {
    return {
      note: baselineNote, assignment: null, experimentId: null, arm: "none",
      injectedExperienceIds: baseline.selected.map((entry) => entry.id), reason: "no-session-id",
    };
  }

  // 一次只跑一个实验：最早创建的 running 实验优先，避免经验交互污染判定。
  const experiment = experiments[0]!;
  const candidate = entries.find((entry) => entry.id === experiment.candidateRef);
  if (candidate === undefined || candidate.status === "active") {
    await stampBaselineInjection(input.workspace, input.sessionId, baseline.selected, baselineNote, now);
    return {
      note: baselineNote, assignment: null, experimentId: null, arm: "none",
      injectedExperienceIds: baseline.selected.map((entry) => entry.id), reason: "candidate-already-active",
    };
  }
  if (!retrievable(candidate, now) || !matchesContext(candidate, context)) {
    await stampBaselineInjection(input.workspace, input.sessionId, baseline.selected, baselineNote, now);
    return {
      note: baselineNote, assignment: null, experimentId: null, arm: "none",
      injectedExperienceIds: baseline.selected.map((entry) => entry.id), reason: "candidate-not-applicable",
    };
  }

  const assigned = assignArm(experiment.id, input.sessionId, experiment.treatmentPct);
  const baselineForArm = experiment.control === "current-active" ? baseline.selected : [];
  const selected = assigned.arm === "treatment"
    ? selectWithinBudget(
      [candidate, ...baselineForArm.filter((entry) => entry.id !== candidate.id)],
      budget.maxInjectedEntries,
      budget.maxInjectedChars,
    )
    : baselineForArm;
  const note = renderPlaybookNote(selected);
  const stamp: AssignmentStamp = {
    experimentId: experiment.id,
    arm: assigned.arm,
    propensity: assigned.propensity,
    policyVersion: POLICY_VERSION,
    injectedExperienceIds: selected.map((entry) => entry.id),
    injectedChars: note.length,
  };
  try {
    await writeAssignment(input.workspace, input.sessionId, stamp, now);
  } catch (err) {
    console.warn("[evolve] 分配落盘失败，本场不注入（避免无法归因的 treatment）: "
      + (err instanceof Error ? err.message : String(err)));
    return {
      note: "", assignment: null, experimentId: null, arm: "none",
      injectedExperienceIds: [], reason: "assignment-write-failed",
    };
  }
  return {
    note,
    assignment: { ...stamp, source: "sidecar" },
    experimentId: experiment.id,
    arm: assigned.arm,
    injectedExperienceIds: selected.map((entry) => entry.id),
    reason: "experiment:" + experiment.id,
  };
}
