// Evolve 汇总报告（Cairn Evolve · P5）：把 Episode / playbook / 实验 / 候选 / 预算 / 冻结态
// 折成一份只读快照，供 CLI 与未来桌面 Evolution 面板消费。报告不改变任何状态。

import { detectConflicts, type ExperienceEntry, type ExperienceKind } from "../../agent/evolve/playbook";
import { observationalStatsOf, type EpisodeRecord } from "../../agent/evolve/episode";
import { retirementFindings } from "../../agent/evolve/retirement";
import { activationBlockers } from "./activation";
import { verifyGlobalEvidence, type GlobalEvidenceCheck } from "./globalize";
import type { CandidateRecord } from "../../agent/evolve/candidates";
import type { EpisodeSummary } from "./episode-store";
import { loadEpisodesWithUserFeedback, summarizeEpisodes } from "./episode-store";
import { loadPlaybook } from "./playbook-store";
import { listExperiments, loadExperimentAnalysis } from "./experiment-store";
import { listCandidates } from "./candidate-store";
import { isEvolveFrozen, loadEvolveBudget, type LoadedEvolveBudget } from "./governance";
import { isGlobalEvolveFrozen, loadGlobalPlaybook } from "./global-playbook-store";

export interface EvolveExperimentSummary {
  id: string;
  status: string;
  candidateRef: string;
  analysisStatus: string | null;
  decision: string | null;
  nControl: number;
  nTreatment: number;
}

/** 全局经验（owner 显式晋升；跨 workspace 注入）的只读摘要。 */
export interface EvolveGlobalEntrySummary {
  id: string;
  status: string;
  kind: string;
  body: string;
  evidence: number;
  workspaces: number;
  /** 当前 workspace 的观测（global id 也进 Episode 的注入账）。 */
  trials: number;
  successes: number;
  /** 晋升证据里**其他** workspace 的观测（当前库不计，避免与上面重复）。 */
  evidenceTrials: number;
  evidenceSuccesses: number;
}

export interface EvolveReport {
  v: 1;
  ts: number;
  workspace: string;
  frozen: boolean;
  budget: LoadedEvolveBudget;
  episodes: EpisodeSummary;
  playbook: {
    total: number;
    byStatus: Record<string, number>;
    byKind: Record<string, number>;
    conflicts: number;
    expired: number;
    negative: number;
    /** 过激活门、等人拍板的条目 id（只读提示；报告不改状态）。 */
    activatable: string[];
    badLines: number;
    refusals: number;
  };
  experiments: EvolveExperimentSummary[];
  candidates: { total: number; byStatus: Record<string, number> };
  /** 过激活门、等人拍板的条目详情（面板确认卡用；ids 另见 playbook.activatable）。 */
  activationCandidates: Array<{
    id: string;
    kind: ExperienceKind;
    body: string;
    riskDiff: number | null;
    trials: number;
    evidence: number;
  }>;
  /** 负证据详情（面板「转 dormant」确认卡用；判定口径同 retirement 的负证据门）。 */
  negativeCandidates: Array<{
    id: string;
    kind: ExperienceKind;
    body: string;
    trials: number;
    successes: number;
  }>;
  /** run 中途经验提醒的命中面（按 Episode 证据；ids 最多列前 10）。 */
  nudges: { episodes: number; ids: number; byId: Record<string, number> };
  /** 全局经验（owner 显式晋升；跨 workspace 注入）——含冻结/坏行，管理入口在 CLI。 */
  global: {
    frozen: boolean;
    total: number;
    byStatus: Record<string, number>;
    entries: EvolveGlobalEntrySummary[];
    /** 复用 retirement 判据：过期/本库负证据/同触发冲突（含全局×本地投影）；只提示，不改状态。 */
    findings: Array<{ id: string; reason: string; detail: string }>;
    badLines: number;
    refusals: number;
  };
}

function countBy<T>(items: readonly T[], key: (item: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) {
    const value = key(item);
    out[value] = (out[value] ?? 0) + 1;
  }
  return out;
}

export async function buildEvolveReport(workspace: string, now: number = Date.now()): Promise<EvolveReport> {
  const [episodesLoaded, playbook, experiments, candidates, budget, frozen, globalPlaybook, globalFrozen] = await Promise.all([
    loadEpisodesWithUserFeedback(workspace),
    loadPlaybook(workspace),
    listExperiments(workspace),
    listCandidates(workspace),
    loadEvolveBudget(workspace),
    isEvolveFrozen(workspace),
    loadGlobalPlaybook(),
    isGlobalEvolveFrozen(),
  ]);
  const episodes = summarizeEpisodes(episodesLoaded);
  const experimentSummaries: EvolveExperimentSummary[] = [];
  for (const experiment of experiments) {
    const analysis = await loadExperimentAnalysis(workspace, experiment.id);
    experimentSummaries.push({
      id: experiment.id,
      status: experiment.status,
      candidateRef: experiment.candidateRef,
      analysisStatus: analysis?.status ?? null,
      decision: analysis?.decision ?? null,
      nControl: analysis?.nControl ?? 0,
      nTreatment: analysis?.nTreatment ?? 0,
    });
  }
  const observations = observationalStatsOf(episodesLoaded.episodes);
  const findings = retirementFindings(playbook.entries, now, observations);
  const negativeIds = new Set(findings.filter((finding) => finding.reason === "negative").map((finding) => finding.id));
  const negativeCandidates = playbook.entries
    .filter((entry) => negativeIds.has(entry.id))
    .map((entry) => {
      const stat = observations.get(entry.id);
      return {
        id: entry.id,
        kind: entry.kind,
        body: entry.body,
        trials: stat?.trials ?? 0,
        successes: stat?.successes ?? 0,
      };
    })
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  // 全局作用域条目要过跨库核验才算"可激活"（核验话术与激活门同源，不各写一份）。
  // 本地 playbook 里通常没有 `workspace:"*"` 条目，这一圈一般是空的。
  const globalForActivation = playbook.entries.filter((entry) => entry.status !== "active" && entry.scope.workspace === "*");
  const globalChecks = new Map<string, GlobalEvidenceCheck>();
  await Promise.all(globalForActivation.map(async (entry) => {
    globalChecks.set(entry.id, await verifyGlobalEvidence(entry.globalEvidence ?? []));
  }));
  const activationCandidates = playbook.entries
    .filter((entry) => entry.status !== "active")
    .filter((entry) => activationBlockers(entry, playbook.entries, now, {
      ...(globalChecks.get(entry.id) !== undefined ? { globalCheck: globalChecks.get(entry.id) } : {}),
    }).length === 0)
    .map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      body: entry.body,
      riskDiff: entry.confidence.causal.riskDiff,
      trials: entry.confidence.causal.trials,
      evidence: entry.evidence.episodes.length,
    }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const activatable = activationCandidates.map((candidate) => candidate.id);
  const nudgeCounts = new Map<string, number>();
  let nudgeEpisodes = 0;
  for (const episode of episodesLoaded.episodes) {
    const ids = episode.evidence.nudgedExperienceIds ?? [];
    if (ids.length === 0) continue;
    nudgeEpisodes += 1;
    for (const id of ids) nudgeCounts.set(id, (nudgeCounts.get(id) ?? 0) + 1);
  }
  const nudgeById = Object.fromEntries(
    [...nudgeCounts.entries()]
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .slice(0, 10),
  );
  // 跨库体检：全局条目在晋升证据的其他 workspace 里的实际注入读数。
  // 当前库不计入 evidence（它已在本地 observations 里），避免同一场 Episode 双计。
  const evidenceWorkspaces = new Set<string>();
  for (const entry of globalPlaybook.entries) {
    for (const ref of entry.globalEvidence ?? []) {
      if (ref.workspace !== workspace) evidenceWorkspaces.add(ref.workspace);
    }
  }
  const evidenceLoads = await Promise.all(
    [...evidenceWorkspaces].map((evidenceWorkspace) => loadEpisodesWithUserFeedback(evidenceWorkspace)),
  );
  const evidenceEpisodes = new Map<string, EpisodeRecord>();
  for (const loaded of evidenceLoads) {
    for (const episode of loaded.episodes) evidenceEpisodes.set(episode.id, episode);
  }
  const evidenceObservations = observationalStatsOf([...evidenceEpisodes.values()]);
  const combinedObservations = new Map(observations);
  for (const entry of globalPlaybook.entries) {
    const cross = evidenceObservations.get(entry.id);
    if (cross === undefined) continue;
    const local = observations.get(entry.id);
    combinedObservations.set(entry.id, {
      trials: (local?.trials ?? 0) + cross.trials,
      successes: (local?.successes ?? 0) + cross.successes,
      failures: (local?.failures ?? 0) + cross.failures,
      lastUsedAt: Math.max(local?.lastUsedAt ?? 0, cross.lastUsedAt),
    });
  }

  // 体检按「本库实际生效集」算：全局条目投影到当前 workspace（本地同 id 优先，与运行时一致），
  // 这样全局×本地的同触发冲突也能被同一把 retirement 判据看见。
  const localIds = new Set(playbook.entries.map((entry) => entry.id));
  const projectedGlobal = globalPlaybook.entries
    .filter((entry) => !localIds.has(entry.id))
    .map((entry) => entry.scope.workspace === "*"
      ? { ...entry, scope: { ...entry.scope, workspace } }
      : entry);
  const globalIds = new Set(projectedGlobal.map((entry) => entry.id));
  const globalFindings = retirementFindings([...playbook.entries, ...projectedGlobal], now, combinedObservations)
    .filter((finding) => globalIds.has(finding.id))
    .map((finding) => ({ id: finding.id, reason: finding.reason, detail: finding.detail }));
  const globalEntries: EvolveGlobalEntrySummary[] = globalPlaybook.entries
    .map((entry) => {
      const stat = observations.get(entry.id);
      const evidenceStat = evidenceObservations.get(entry.id);
      return {
        id: entry.id,
        status: entry.status,
        kind: entry.kind,
        body: entry.body,
        evidence: entry.evidence.episodes.length,
        workspaces: new Set((entry.globalEvidence ?? []).map((ref) => ref.workspace)).size,
        trials: stat?.trials ?? 0,
        successes: stat?.successes ?? 0,
        evidenceTrials: evidenceStat?.trials ?? 0,
        evidenceSuccesses: evidenceStat?.successes ?? 0,
      };
    })
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return {
    v: 1,
    ts: now,
    workspace,
    frozen,
    budget,
    episodes,
    playbook: {
      total: playbook.entries.length,
      byStatus: countBy(playbook.entries, (entry: ExperienceEntry) => entry.status),
      byKind: countBy(playbook.entries, (entry: ExperienceEntry) => entry.kind),
      conflicts: detectConflicts(playbook.entries).length,
      expired: findings.filter((finding) => finding.reason === "expired").length,
      negative: findings.filter((finding) => finding.reason === "negative").length,
      activatable,
      badLines: playbook.badLines,
      refusals: playbook.refusals.length,
    },
    experiments: experimentSummaries,
    candidates: {
      total: candidates.length,
      byStatus: countBy(candidates, (candidate: CandidateRecord) => candidate.status),
    },
    nudges: { episodes: nudgeEpisodes, ids: nudgeCounts.size, byId: nudgeById },
    activationCandidates,
    negativeCandidates,
    global: {
      frozen: globalFrozen,
      total: globalPlaybook.entries.length,
      byStatus: countBy(globalPlaybook.entries, (entry: ExperienceEntry) => entry.status),
      entries: globalEntries,
      findings: globalFindings,
      badLines: globalPlaybook.badLines,
      refusals: globalPlaybook.refusals.length,
    },
  };
}

/** 人读面；所有“不可测/冻结/坏档”都显式出现。 */
export function formatEvolveReport(report: EvolveReport): string {
  const statuses = Object.entries(report.playbook.byStatus).map(([key, value]) => key + "×" + String(value)).join("、") || "无";
  const kinds = Object.entries(report.playbook.byKind).map(([key, value]) => key + "×" + String(value)).join("、") || "无";
  const candidateStatuses = Object.entries(report.candidates.byStatus).map(([key, value]) => key + "×" + String(value)).join("、") || "无";
  const globalStatuses = Object.entries(report.global.byStatus).map(([key, value]) => key + "×" + String(value)).join("、") || "无";
  const globalEntries = report.global.entries.length === 0
    ? "    （无）"
    : report.global.entries.map((entry) =>
      "    " + entry.id + " · " + entry.status + " · " + String(entry.workspaces) + " 库 / "
      + String(entry.evidence) + " 证据 · 本库观测 " + String(entry.successes) + "/" + String(entry.trials)
      + " · 证据库观测 " + String(entry.evidenceSuccesses) + "/" + String(entry.evidenceTrials)
      + " · " + entry.body
    ).join("\n");
  const globalFindings = report.global.findings.length === 0
    ? "    （体检无异常）"
    : report.global.findings.map((finding) =>
      "    " + finding.id + " · " + finding.reason + " · " + finding.detail
    ).join("\n");
  const experiments = report.experiments.length === 0
    ? "无"
    : report.experiments.map((experiment) =>
      "  " + experiment.id + " · " + experiment.status
      + " · analysis " + (experiment.analysisStatus ?? "未分析")
      + " · " + (experiment.decision ?? "-")
      + " · control " + String(experiment.nControl) + " / treatment " + String(experiment.nTreatment)
    ).join("\n");
  return [
    "Cairn Evolve 报告 · " + new Date(report.ts).toISOString() + (report.frozen ? " · FROZEN（STOP 存在）" : ""),
    "  预算（" + report.budget.source + "）：注入 " + String(report.budget.budget.maxInjectedEntries) + " 条 / "
      + String(report.budget.budget.maxInjectedChars) + " 字符；playbook " + String(report.budget.budget.maxPlaybookEntries)
      + "；实验 " + String(report.budget.budget.maxExperiments) + "；候选 " + String(report.budget.budget.maxCandidates),
    "  Episode：总数 " + String(report.episodes.total) + "｜success " + String(report.episodes.byOutcome.success)
      + " / failure " + String(report.episodes.byOutcome.failure) + " / unknown " + String(report.episodes.byOutcome.unknown),
    "  快环提醒：场次 " + String(report.nudges.episodes) + "｜经验 " + String(report.nudges.ids)
      + (report.nudges.ids === 0
        ? ""
        : "｜" + Object.entries(report.nudges.byId).slice(0, 3).map(([id, count]) => id + "×" + String(count)).join("、")),
    "  Playbook：总数 " + String(report.playbook.total) + "｜" + statuses + "｜" + kinds
      + "｜冲突 " + String(report.playbook.conflicts) + "｜过期 " + String(report.playbook.expired)
      + "｜负证据 " + String(report.playbook.negative)
      + "｜可激活 " + (report.playbook.activatable.length === 0
        ? "0"
        : String(report.playbook.activatable.length) + "（" + report.playbook.activatable.slice(0, 3).join("、")
          + (report.playbook.activatable.length > 3 ? " 等" : "") + "）")
      + "｜坏行 " + String(report.playbook.badLines) + "｜拒单 " + String(report.playbook.refusals),
    "  全局经验：总数 " + String(report.global.total) + "｜" + globalStatuses
      + (report.global.frozen ? "｜全局 STOP 冻结中" : "")
      + "｜体检 " + String(report.global.findings.length)
      + "｜坏行 " + String(report.global.badLines) + "｜拒单 " + String(report.global.refusals),
    globalEntries,
    globalFindings,
    "  实验：",
    experiments,
    "  候选：总数 " + String(report.candidates.total) + "｜" + candidateStatuses,
  ].join("\n");
}
