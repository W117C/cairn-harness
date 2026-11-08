// 候选档案（Cairn Evolve · P3）：一次实验/反思产出的候选，连同评分、族谱与元生产力。
//
// 纯函数：候选 shape、校验、Pareto 前沿、父代选择。Pareto 只看有 holdout 评分的候选；
// 当前分数不是唯一父代选择器（HGM 的元生产力—性能错配），所以选择同时看谱系产出。

import { digestOf } from "./digest";

export type CandidateOperator =
  | "reflect-delta" | "policy-tune" | "skill-synthesize" | "bundle-patch" | "experiment" | "manual";
export type CandidateStatus =
  | "draft" | "queued" | "evaluating" | "passed" | "failed" | "promoted" | "rejected";
export type CandidateSafety = "pass" | "fail" | "unknown";

export interface CandidateScores {
  /** 0..1；null = 未测。 */
  success: number | null;
  /** 越小越好；null = 未测。 */
  costUsd: number | null;
  /** 越小越好；null = 未测。 */
  latencyMs: number | null;
  safety: CandidateSafety;
}

export interface CandidateRecord {
  v: 1;
  id: string;
  workspace: string;
  parentId: string | null;
  operator: CandidateOperator;
  target: { kind: "experience"; id: string };
  body: string;
  evidence: string[];
  status: CandidateStatus;
  eval: {
    search: CandidateScores | null;
    validation: CandidateScores | null;
    /** 只有有 holdout 评分的候选才进 Pareto；P3 的实验晋升先落 validation。 */
    holdout: CandidateScores | null;
    costUsd: number | null;
  };
  lineage: { depth: number; descendants: number; acceptedDescendants: number };
  metaproductivity: { trials: number; accepted: number; yieldPerKToken: number | null };
  createdAt: number;
  updatedAt: number;
  promotion?: { bundleId: string; version: string; stagingDir: string; ts: number };
}

export interface NewCandidateInput {
  workspace: string;
  parentId?: string | null;
  operator: CandidateOperator;
  target: { kind: "experience"; id: string };
  body: string;
  evidence?: readonly string[];
  status?: CandidateStatus;
  eval?: Partial<CandidateRecord["eval"]>;
  lineage?: Partial<CandidateRecord["lineage"]>;
  metaproductivity?: Partial<CandidateRecord["metaproductivity"]>;
  id?: string;
  now: number;
}

const OPERATORS: ReadonlySet<CandidateOperator> = new Set([
  "reflect-delta", "policy-tune", "skill-synthesize", "bundle-patch", "experiment", "manual",
]);
const STATUSES: ReadonlySet<CandidateStatus> = new Set([
  "draft", "queued", "evaluating", "passed", "failed", "promoted", "rejected",
]);
const SAFETY: ReadonlySet<CandidateSafety> = new Set(["pass", "fail", "unknown"]);
const ID_RE = /^cand_[0-9a-f]{16}$/u;
const EXP_ID_RE = /^exp_[0-9a-f]{16}$/u;

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

export function newCandidate(input: NewCandidateInput): CandidateRecord {
  const evidence = uniqueSorted(input.evidence ?? []);
  const id = input.id ?? "cand_" + digestOf(JSON.stringify({
    operator: input.operator,
    target: input.target,
    body: input.body,
    evidence,
  }));
  return {
    v: 1,
    id,
    workspace: input.workspace,
    parentId: input.parentId ?? null,
    operator: input.operator,
    target: { ...input.target },
    body: input.body,
    evidence,
    status: input.status ?? "draft",
    eval: {
      search: input.eval?.search ?? null,
      validation: input.eval?.validation ?? null,
      holdout: input.eval?.holdout ?? null,
      costUsd: input.eval?.costUsd ?? null,
    },
    lineage: {
      depth: input.lineage?.depth ?? 0,
      descendants: input.lineage?.descendants ?? 0,
      acceptedDescendants: input.lineage?.acceptedDescendants ?? 0,
    },
    metaproductivity: {
      trials: input.metaproductivity?.trials ?? 0,
      accepted: input.metaproductivity?.accepted ?? 0,
      yieldPerKToken: input.metaproductivity?.yieldPerKToken ?? null,
    },
    createdAt: input.now,
    updatedAt: input.now,
  };
}

function validateScores(scores: CandidateScores | null, field: string): string[] {
  if (scores === null) return [];
  const issues: string[] = [];
  if (scores.success !== null && (typeof scores.success !== "number" || !Number.isFinite(scores.success) || scores.success < 0 || scores.success > 1)) {
    issues.push(field + ".success 必须是 0..1 或 null");
  }
  if (scores.costUsd !== null && (typeof scores.costUsd !== "number" || !Number.isFinite(scores.costUsd) || scores.costUsd < 0)) {
    issues.push(field + ".costUsd 必须是非负数或 null");
  }
  if (scores.latencyMs !== null && (typeof scores.latencyMs !== "number" || !Number.isFinite(scores.latencyMs) || scores.latencyMs < 0)) {
    issues.push(field + ".latencyMs 必须是非负数或 null");
  }
  if (!SAFETY.has(scores.safety)) issues.push(field + ".safety 不在取值域");
  return issues;
}

export function validateCandidate(record: CandidateRecord): string[] {
  const issues: string[] = [];
  if (record.v !== 1) issues.push("v 必须为 1");
  if (typeof record.id !== "string" || !ID_RE.test(record.id)) issues.push("id 必须是 cand_ + 16 位小写十六进制");
  if (typeof record.workspace !== "string" || record.workspace.length === 0) issues.push("workspace 必须是非空字符串");
  if (record.parentId !== null && (typeof record.parentId !== "string" || !ID_RE.test(record.parentId))) {
    issues.push("parentId 必须是 cand_ id 或 null");
  }
  if (!OPERATORS.has(record.operator)) issues.push("operator 不在取值域");
  if (record.target?.kind !== "experience" || typeof record.target?.id !== "string" || !EXP_ID_RE.test(record.target.id)) {
    issues.push("target 必须是 {kind: experience, id: exp_...}");
  }
  if (typeof record.body !== "string" || record.body.trim().length === 0) issues.push("body 不能为空");
  if (!Array.isArray(record.evidence) || record.evidence.some((value) => typeof value !== "string")) issues.push("evidence 必须是字符串数组");
  if (!STATUSES.has(record.status)) issues.push("status 不在取值域");
  issues.push(...validateScores(record.eval?.search ?? null, "eval.search"));
  issues.push(...validateScores(record.eval?.validation ?? null, "eval.validation"));
  issues.push(...validateScores(record.eval?.holdout ?? null, "eval.holdout"));
  if (record.eval?.costUsd !== null && (typeof record.eval?.costUsd !== "number" || !Number.isFinite(record.eval.costUsd) || record.eval.costUsd < 0)) {
    issues.push("eval.costUsd 必须是非负数或 null");
  }
  for (const key of ["depth", "descendants", "acceptedDescendants"] as const) {
    if (!Number.isInteger(record.lineage?.[key]) || record.lineage[key] < 0) issues.push("lineage." + key + " 必须是 ≥0 的整数");
  }
  for (const key of ["trials", "accepted"] as const) {
    if (!Number.isInteger(record.metaproductivity?.[key]) || record.metaproductivity[key] < 0) issues.push("metaproductivity." + key + " 必须是 ≥0 的整数");
  }
  if (record.metaproductivity?.yieldPerKToken !== null
    && (typeof record.metaproductivity?.yieldPerKToken !== "number" || !Number.isFinite(record.metaproductivity.yieldPerKToken) || record.metaproductivity.yieldPerKToken < 0)) {
    issues.push("metaproductivity.yieldPerKToken 必须是非负数或 null");
  }
  if (!Number.isFinite(record.createdAt) || !Number.isFinite(record.updatedAt)) issues.push("createdAt/updatedAt 必须是有限数");
  if (record.promotion !== undefined) {
    if (typeof record.promotion.bundleId !== "string" || typeof record.promotion.version !== "string"
      || typeof record.promotion.stagingDir !== "string" || !Number.isFinite(record.promotion.ts)) {
      issues.push("promotion 形状不合法");
    }
  }
  return issues;
}

function safetyRank(safety: CandidateSafety): number {
  return safety === "pass" ? 2 : safety === "unknown" ? 1 : 0;
}

function dominates(a: CandidateScores, b: CandidateScores): boolean {
  if (a.success === null || b.success === null) return false;
  const success = a.success >= b.success;
  const cost = (a.costUsd ?? Number.POSITIVE_INFINITY) <= (b.costUsd ?? Number.POSITIVE_INFINITY);
  const latency = (a.latencyMs ?? Number.POSITIVE_INFINITY) <= (b.latencyMs ?? Number.POSITIVE_INFINITY);
  const safety = safetyRank(a.safety) >= safetyRank(b.safety);
  const strict = a.success > b.success
    || (a.costUsd ?? Number.POSITIVE_INFINITY) < (b.costUsd ?? Number.POSITIVE_INFINITY)
    || (a.latencyMs ?? Number.POSITIVE_INFINITY) < (b.latencyMs ?? Number.POSITIVE_INFINITY)
    || safetyRank(a.safety) > safetyRank(b.safety);
  return success && cost && latency && safety && strict;
}

/** 只收有 holdout 评分的候选；非支配集。 */
export function paretoFront(candidates: readonly CandidateRecord[]): CandidateRecord[] {
  const scored = candidates.filter((candidate) => candidate.eval.holdout !== null);
  const front = scored.filter((candidate) =>
    !scored.some((other) => other.id !== candidate.id && dominates(other.eval.holdout!, candidate.eval.holdout!))
  );
  return front.sort((a, b) => {
    const sa = a.eval.holdout!.success ?? -1;
    const sb = b.eval.holdout!.success ?? -1;
    return sb - sa || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  });
}

/** 父代采样：Pareto 前沿 + 元生产力（每千 token 被接受后代）优先；同分按 id 稳定。 */
export function selectParents(candidates: readonly CandidateRecord[], limit = 4): CandidateRecord[] {
  return [...paretoFront(candidates)]
    .sort((a, b) => {
      const ya = a.metaproductivity.yieldPerKToken ?? -1;
      const yb = b.metaproductivity.yieldPerKToken ?? -1;
      return yb - ya || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    })
    .slice(0, Math.max(0, limit));
}
