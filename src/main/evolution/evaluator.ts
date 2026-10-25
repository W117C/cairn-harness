// 配对评价：同一批任务、同一配置，baseline（当前 active）与 candidate 各跑一遍。
// 本模块只做**编排与裁决**，不 spawn、不读盘、不认识模型——真实执行面由调用方注入。
//
// 裁决顺序（不可颠倒）：
//  1. 证据完整性：任一 run 的 ok 为 null ⇒ unmeasurable + keep-old；
//  2. 正确性：candidate 必须在**所有**任务上为 true（含 holdout 验证任务）；
//  3. 成本/耗时：仅在正确性通过后比较；差异不足 ⇒ keep-old；
//  4. 没有 holdout 验证任务 ⇒ 不许晋升（搜索集上的改善可能是过拟合）。
import type { CandidateRun } from "./candidate-record";

export interface EvalTask {
  id: string;
  split: "search" | "validation";
}

export interface EvalRunInput {
  version: string;
  task: EvalTask;
}

export interface EvalRunOutput {
  /** null = 没有可判证据；不许折成 false。 */
  ok: boolean | null;
  costUsd: number | null;
  tokens: number | null;
  durationMs: number | null;
  artifactDigest: string | null;
  failureReason: string | null;
}

export interface PairedEvalOptions {
  baselineVersion: string;
  candidateVersion: string;
  tasks: readonly EvalTask[];
  run: (input: EvalRunInput) => Promise<EvalRunOutput>;
  /** 成本至少改善这个比例才算「有差异」；缺省 5%。 */
  minCostImprovement?: number;
  /** 成本不可比时的耗时改善线；缺省 5%。 */
  minDurationImprovement?: number;
  configDigest?: string | null;
}

export interface PairedEvalResult {
  status: "passed" | "failed" | "unmeasurable";
  decision: "promote" | "keep-old";
  reason: string;
  baselineRuns: CandidateRun[];
  candidateRuns: CandidateRun[];
  baselineCostUsd: number | null;
  candidateCostUsd: number | null;
  costMeasurable: boolean;
  configDigest: string | null;
}

const DEFAULT_MIN_IMPROVEMENT = 0.05;

function sumCost(runs: readonly CandidateRun[]): number | null {
  let total = 0;
  for (const run of runs) {
    if (run.costUsd === null) return null;
    total += run.costUsd;
  }
  return total;
}

function sumDuration(runs: readonly CandidateRun[]): number | null {
  let total = 0;
  for (const run of runs) {
    if (run.durationMs === null) return null;
    total += run.durationMs;
  }
  return total;
}

function toRun(version: string, task: EvalTask, out: EvalRunOutput): CandidateRun {
  return {
    runId: version + ":" + task.id,
    taskId: task.id,
    split: task.split,
    ok: out.ok,
    costUsd: out.costUsd,
    tokens: out.tokens,
    durationMs: out.durationMs,
    artifactDigest: out.artifactDigest,
    failureReason: out.failureReason,
  };
}

function failedRun(version: string, task: EvalTask, err: unknown): CandidateRun {
  return {
    runId: version + ":" + task.id,
    taskId: task.id,
    split: task.split,
    ok: null,
    costUsd: null,
    tokens: null,
    durationMs: null,
    artifactDigest: null,
    failureReason: "runner error: " + (err instanceof Error ? err.message : String(err)),
  };
}

/** 同一批任务、同一份配置的旧新配对。纯编排；调用方保证 run 的可复跑性。 */
export async function evaluatePaired(opts: PairedEvalOptions): Promise<PairedEvalResult> {
  const tasks = [...opts.tasks];
  if (tasks.length === 0) throw new Error("配对评价至少需要一条任务");
  const seen = new Set<string>();
  for (const task of tasks) {
    if (seen.has(task.id)) throw new Error("任务 id 重复：" + task.id);
    seen.add(task.id);
  }
  const baselineRuns: CandidateRun[] = [];
  const candidateRuns: CandidateRun[] = [];
  for (const task of tasks) {
    for (const [version, bucket] of [
      [opts.baselineVersion, baselineRuns],
      [opts.candidateVersion, candidateRuns],
    ] as const) {
      try {
        bucket.push(toRun(version, task, await opts.run({ version, task })));
      } catch (err) {
        bucket.push(failedRun(version, task, err));
      }
    }
  }

  const missing = [...baselineRuns, ...candidateRuns].filter((run) => run.ok === null);
  const baselineCostUsd = sumCost(baselineRuns);
  const candidateCostUsd = sumCost(candidateRuns);
  const costMeasurable = baselineCostUsd !== null && candidateCostUsd !== null;
  const base = {
    baselineRuns,
    candidateRuns,
    baselineCostUsd,
    candidateCostUsd,
    costMeasurable,
    configDigest: opts.configDigest ?? null,
  };

  if (missing.length > 0) {
    return {
      ...base,
      status: "unmeasurable",
      decision: "keep-old",
      reason: "有 " + String(missing.length) + " 个 run 没有可判证据（" + missing.map((r) => r.taskId).join("、") + "）——不可测不许晋升",
    };
  }

  const failed = candidateRuns.filter((run) => run.ok !== true);
  if (failed.length > 0) {
    return {
      ...base,
      status: "failed",
      decision: "keep-old",
      reason: "候选在 " + String(failed.length) + " 条任务上未通过正确性：" + failed.map((r) => r.taskId).join("、"),
    };
  }

  const validation = candidateRuns.filter((run) => run.split === "validation");
  if (validation.length === 0) {
    return {
      ...base,
      status: "passed",
      decision: "keep-old",
      reason: "没有未参与搜索的 holdout 验证任务——正确性通过也不许晋升",
    };
  }

  const baselineFailedTasks = new Set(baselineRuns.filter((run) => run.ok !== true).map((run) => run.taskId));
  const correctnessImproved = baselineFailedTasks.size > 0;
  const minCost = opts.minCostImprovement ?? DEFAULT_MIN_IMPROVEMENT;
  const minDuration = opts.minDurationImprovement ?? DEFAULT_MIN_IMPROVEMENT;

  if (costMeasurable && baselineCostUsd! > 0) {
    if (candidateCostUsd! <= baselineCostUsd! * (1 - minCost)) {
      return {
        ...base,
        status: "passed",
        decision: "promote",
        reason: "正确性不劣；成本 " + String(candidateCostUsd) + " ≤ 基线 " + String(baselineCostUsd) + " 的 " + String(1 - minCost) + " 倍",
      };
    }
  }

  if (correctnessImproved) {
    return {
      ...base,
      status: "passed",
      decision: "promote",
      reason: "候选修好了基线未通过的任务（" + [...baselineFailedTasks].join("、") + "）——正确性优先于成本",
    };
  }

  const baselineDuration = sumDuration(baselineRuns);
  const candidateDuration = sumDuration(candidateRuns);
  if (baselineDuration !== null && candidateDuration !== null && baselineDuration > 0) {
    if (candidateDuration <= baselineDuration * (1 - minDuration)) {
      return {
        ...base,
        status: "passed",
        decision: "promote",
        reason: "正确性不劣；耗时 " + String(candidateDuration) + "ms ≤ 基线 " + String(baselineDuration) + "ms 的 " + String(1 - minDuration) + " 倍",
      };
    }
  }

  return {
    ...base,
    status: "passed",
    decision: "keep-old",
    reason: "正确性不劣，但成本/耗时差异不足（成本线 " + String(minCost) + "）——保留旧版本",
  };
}
