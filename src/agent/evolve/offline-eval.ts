// 离线配对评估（Cairn Evolve · P3 补齐）：search/validation/holdout 三分片，
// 同一批任务上 baseline 与候选配对；holdout 是晋升的必要条件，不能拿 search 上的改善冒充泛化。
//
// 纯函数：给定 run 记录 ⇒ 给定裁决；不 spawn、不读盘、不认识模型。
// 统计口径：
//  · 二元结果用 McNemar 精确检验（配对）；
//  · 风险差/成本只报可核实的数；不可测一律 unmeasurable，不折成失败或通过；
//  · 基线过而候选挂 = 回归，直接失败并点名任务。

import type { CandidateSafety, CandidateScores } from "./candidates";

export type OfflineSplit = "search" | "validation" | "holdout";

export interface OfflineTask {
  id: string;
  split: OfflineSplit;
}

export interface OfflineRun {
  taskId: string;
  /** null = 没有可判证据；不许折成失败。 */
  ok: boolean | null;
  costUsd?: number | null;
  latencyMs?: number | null;
}

export interface OfflineEvalInput {
  tasks: readonly OfflineTask[];
  baseline: readonly OfflineRun[];
  candidate: readonly OfflineRun[];
  minCostImprovement?: number;
}

export interface OfflineEvalResult {
  status: "passed" | "failed" | "unmeasurable";
  decision: "promote" | "keep-old";
  reason: string;
  searchScores: CandidateScores | null;
  validationScores: CandidateScores | null;
  holdoutScores: CandidateScores | null;
  mcnemarP: number | null;
  regressions: string[];
}

function binomialTerm(n: number, k: number): number {
  // P(X=k), X~Bin(n,0.5)，递推避免组合数溢出。
  let term = Math.pow(0.5, n);
  for (let i = 0; i < k; i += 1) term *= (n - i) / (i + 1);
  return term;
}

/** McNemar 精确检验（双侧）；b/c 为两类不一致对的计数。 */
export function mcnemarExactP(b: number, c: number): number {
  const n = b + c;
  if (n === 0) return 1;
  const k = Math.min(b, c);
  let tail = 0;
  for (let i = 0; i <= k; i += 1) tail += binomialTerm(n, i);
  return Math.min(1, 2 * tail);
}

function sumOrNull(values: readonly (number | null | undefined)[]): number | null {
  let total = 0;
  for (const value of values) {
    if (value === null || value === undefined || !Number.isFinite(value)) return null;
    total += value;
  }
  return total;
}

function scoresFor(
  tasks: readonly OfflineTask[],
  candidate: ReadonlyMap<string, OfflineRun>,
  regressions: ReadonlySet<string>,
): CandidateScores | null {
  if (tasks.length === 0) return null;
  const runs = tasks.map((task) => candidate.get(task.id)!);
  const failures = runs.filter((run) => run.ok !== true).length;
  const safety: CandidateSafety = failures > 0 || tasks.some((task) => regressions.has(task.id)) ? "fail" : "pass";
  return {
    success: (tasks.length - failures) / tasks.length,
    costUsd: sumOrNull(runs.map((run) => run.costUsd)),
    latencyMs: sumOrNull(runs.map((run) => run.latencyMs)),
    safety,
  };
}

/** 配对评估。任务必须有 baseline 与 candidate 两边各一条 run；缺一即不可测。 */
export function evaluateOffline(input: OfflineEvalInput): OfflineEvalResult {
  const baseline = new Map(input.baseline.map((run) => [run.taskId, run]));
  const candidate = new Map(input.candidate.map((run) => [run.taskId, run]));

  const missing: string[] = [];
  for (const task of input.tasks) {
    const b = baseline.get(task.id);
    const c = candidate.get(task.id);
    if (b === undefined || c === undefined || b.ok === null || c.ok === null) missing.push(task.id);
  }
  if (missing.length > 0) {
    return {
      status: "unmeasurable",
      decision: "keep-old",
      reason: "有 " + String(missing.length) + " 个任务不可测（缺 run 或 ok=null）：" + missing.slice(0, 8).join("、"),
      searchScores: null, validationScores: null, holdoutScores: null,
      mcnemarP: null, regressions: [],
    };
  }

  const holdout = input.tasks.filter((task) => task.split === "holdout");
  if (holdout.length === 0) {
    return {
      status: "unmeasurable",
      decision: "keep-old",
      reason: "没有 holdout 分片——search 上的改善可能是过拟合，不许晋升",
      searchScores: null, validationScores: null, holdoutScores: null,
      mcnemarP: null, regressions: [],
    };
  }

  const regressions = input.tasks
    .filter((task) => baseline.get(task.id)!.ok === true && candidate.get(task.id)!.ok !== true)
    .map((task) => task.id);
  const regressionSet = new Set(regressions);
  const searchScores = scoresFor(input.tasks.filter((task) => task.split === "search"), candidate, regressionSet);
  const validationScores = scoresFor(input.tasks.filter((task) => task.split === "validation"), candidate, regressionSet);
  const holdoutScores = scoresFor(holdout, candidate, regressionSet);

  const holdoutFailures = holdout.filter((task) => candidate.get(task.id)!.ok !== true).map((task) => task.id);
  if (regressions.length > 0 || holdoutFailures.length > 0) {
    return {
      status: "failed",
      decision: "keep-old",
      reason: "候选在 holdout 有失败或回归："
        + (regressions.length > 0 ? "回归 " + regressions.join("、") + "；" : "")
        + (holdoutFailures.length > 0 ? "holdout 未全过 " + holdoutFailures.join("、") : ""),
      searchScores, validationScores, holdoutScores,
      mcnemarP: null, regressions,
    };
  }

  const baselineOnly = holdout.filter((task) => baseline.get(task.id)!.ok === true && candidate.get(task.id)!.ok !== true).length;
  const candidateOnly = holdout.filter((task) => baseline.get(task.id)!.ok !== true && candidate.get(task.id)!.ok === true).length;
  const p = mcnemarExactP(baselineOnly, candidateOnly);

  if (candidateOnly > baselineOnly && p < 0.05) {
    return {
      status: "passed",
      decision: "promote",
      reason: "holdout 显著改善：候选多过 " + String(candidateOnly) + " 个、基线多过 " + String(baselineOnly)
        + " 个，McNemar p=" + p.toFixed(4),
      searchScores, validationScores, holdoutScores, mcnemarP: p, regressions,
    };
  }

  const baselineCost = sumOrNull(holdout.map((task) => baseline.get(task.id)!.costUsd));
  const candidateCost = sumOrNull(holdout.map((task) => candidate.get(task.id)!.costUsd));
  const minImprovement = input.minCostImprovement ?? 0.05;
  if (baselineCost !== null && candidateCost !== null && baselineCost > 0
    && candidateCost <= baselineCost * (1 - minImprovement)) {
    return {
      status: "passed",
      decision: "promote",
      reason: "正确性不劣；holdout 成本 " + String(candidateCost) + " ≤ 基线 " + String(baselineCost)
        + " 的 " + String(1 - minImprovement) + " 倍",
      searchScores, validationScores, holdoutScores, mcnemarP: p, regressions,
    };
  }

  return {
    status: "passed",
    decision: "keep-old",
    reason: "正确性不劣，但 holdout 没有显著改善、成本差异也不足——保留旧版",
    searchScores, validationScores, holdoutScores, mcnemarP: p, regressions,
  };
}
