// 在线随机对照（Cairn Evolve · P2）：预注册实验、确定性分配、两比例风险差与 Newcombe CI。
//
// 这不是“跑完看数字”的报表：实验必须在开跑前写死候选、任务过滤、样本上限与决策规则；
// 分析只按预注册规则裁决，不因中途好看而提前宣布，也不把未知结局折成失败。
// 本层不自动安装任何东西：passed 只产出 suggest-promote，晋升仍走 SEMA 与人工/P4 自治档。

import { createHash } from "node:crypto";
import type { EpisodeTaskClass } from "./episode";

export type ExperimentStatus = "draft" | "running" | "passed" | "failed" | "unmeasurable" | "aborted";
export type ExperimentDecision = "keep-running" | "suggest-promote" | "keep-old" | "stop";
export type ExperimentArm = "control" | "treatment";

export interface ExperimentDecisionRule {
  kind: "superiority";
  /** 风险差下界必须大于它才算通过；缺省 0。 */
  minRiskDiff: number;
  /** 成本改善的最小比例；P2 只报告，不单独据此晋升。 */
  minCostImprovement: number;
  requireNoRegression: boolean;
}

export interface ExperimentRecord {
  v: 1;
  id: string;
  workspace: string;
  hypothesis: string;
  candidateRef: string;
  control: "current-active" | "no-injection";
  taskFilter: { class?: EpisodeTaskClass[] };
  /** 治疗臂分配比例；0.05..0.5。propensity 记录的就是这个值（治疗概率）。 */
  treatmentPct: number;
  minSamplesPerArm: number;
  maxSamplesPerArm: number;
  decisionRule: ExperimentDecisionRule;
  budget: { maxRuns: number; maxUsd: number | null; maxWallMs: number | null };
  status: ExperimentStatus;
  createdAt: number;
  approvedBy: string;
}

export interface ExperimentSample {
  episodeId: string;
  arm: ExperimentArm;
  success: boolean;
  tokens?: number;
  usd?: number | null;
  durationMs?: number | null;
}

export interface ExperimentAnalysis {
  v: 1;
  experimentId: string;
  status: ExperimentStatus;
  decision: ExperimentDecision;
  reason: string;
  nControl: number;
  nTreatment: number;
  successControl: number;
  successTreatment: number;
  riskDiff: number | null;
  ci95: [number, number] | null;
  unknownEpisodes: number;
  cost: {
    controlTokens: number;
    treatmentTokens: number;
    controlUsd: number | null;
    treatmentUsd: number | null;
  };
}

export interface AssignedArm {
  arm: ExperimentArm;
  /** 治疗臂分配概率（不是“当前臂”的概率）；IPW 用它。 */
  propensity: number;
}

const TASK_CLASSES: ReadonlySet<EpisodeTaskClass> = new Set([
  "edit", "debug", "refactor", "test", "explain", "research", "ops", "ui", "other",
]);
const STATUSES: ReadonlySet<ExperimentStatus> = new Set([
  "draft", "running", "passed", "failed", "unmeasurable", "aborted",
]);
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u;
const EXP_ID_RE = /^exp_[0-9a-f]{16}$/u;
const Z95 = 1.959963984540054;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** 形状校验：返回问题列表；空数组 = 合法。 */
export function validateExperiment(record: ExperimentRecord): string[] {
  const issues: string[] = [];
  if (record.v !== 1) issues.push("v 必须为 1");
  if (typeof record.id !== "string" || !ID_RE.test(record.id)) issues.push("id 必须是 1..64 位字母/数字/下划线/连字符");
  if (typeof record.workspace !== "string" || record.workspace.length === 0) issues.push("workspace 必须是非空字符串");
  if (typeof record.hypothesis !== "string" || record.hypothesis.trim().length === 0) issues.push("hypothesis 不能为空");
  if (typeof record.candidateRef !== "string" || !EXP_ID_RE.test(record.candidateRef)) {
    issues.push("candidateRef 必须是 exp_ + 16 位小写十六进制");
  }
  if (record.control !== "current-active" && record.control !== "no-injection") issues.push("control 不在取值域");
  if (record.taskFilter?.class !== undefined) {
    if (!Array.isArray(record.taskFilter.class) || record.taskFilter.class.some((value) => !TASK_CLASSES.has(value))) {
      issues.push("taskFilter.class 含未知任务类");
    }
  }
  if (!isFiniteNumber(record.treatmentPct) || record.treatmentPct < 0.05 || record.treatmentPct > 0.5) {
    issues.push("treatmentPct 必须在 0.05..0.5");
  }
  if (!Number.isInteger(record.minSamplesPerArm) || record.minSamplesPerArm < 2) issues.push("minSamplesPerArm 必须是 ≥2 的整数");
  if (!Number.isInteger(record.maxSamplesPerArm) || record.maxSamplesPerArm < record.minSamplesPerArm) {
    issues.push("maxSamplesPerArm 必须是 ≥ minSamplesPerArm 的整数");
  }
  if (record.decisionRule?.kind !== "superiority") issues.push("decisionRule.kind 只收 superiority");
  if (!isFiniteNumber(record.decisionRule?.minRiskDiff) || record.decisionRule.minRiskDiff < -1 || record.decisionRule.minRiskDiff > 1) {
    issues.push("decisionRule.minRiskDiff 必须在 -1..1");
  }
  if (!isFiniteNumber(record.decisionRule?.minCostImprovement)
    || record.decisionRule.minCostImprovement < 0 || record.decisionRule.minCostImprovement > 1) {
    issues.push("decisionRule.minCostImprovement 必须在 0..1");
  }
  if (typeof record.decisionRule?.requireNoRegression !== "boolean") issues.push("decisionRule.requireNoRegression 必须是布尔");
  if (!Number.isInteger(record.budget?.maxRuns) || record.budget.maxRuns < record.minSamplesPerArm * 2) {
    issues.push("budget.maxRuns 必须 ≥ 两臂最小样本之和");
  }
  if (record.budget?.maxUsd !== null && (!isFiniteNumber(record.budget?.maxUsd) || record.budget.maxUsd < 0)) {
    issues.push("budget.maxUsd 必须是 number|null");
  }
  if (record.budget?.maxWallMs !== null && (!isFiniteNumber(record.budget?.maxWallMs) || record.budget.maxWallMs < 0)) {
    issues.push("budget.maxWallMs 必须是 number|null");
  }
  if (!STATUSES.has(record.status)) issues.push("status 不在取值域");
  if (!isFiniteNumber(record.createdAt)) issues.push("createdAt 必须是有限数");
  if (typeof record.approvedBy !== "string" || record.approvedBy.trim().length === 0) issues.push("approvedBy 不能为空");
  return issues;
}

/** 确定性分配：hash(experiment, session) → [0,1)；同输入同臂，跨进程可复算。 */
export function assignArm(experimentId: string, sessionId: string, treatmentPct: number): AssignedArm {
  const digest = createHash("sha256").update(experimentId + "\0" + sessionId).digest();
  const value = digest.readUInt32BE(0) / 0x1_0000_0000;
  return { arm: value < treatmentPct ? "treatment" : "control", propensity: treatmentPct };
}

function wilsonInterval(success: number, n: number): [number, number] {
  if (n === 0) return [0, 1];
  const p = success / n;
  const denom = 1 + (Z95 * Z95) / n;
  const center = (p + (Z95 * Z95) / (2 * n)) / denom;
  const half = (Z95 * Math.sqrt(p * (1 - p) / n + (Z95 * Z95) / (4 * n * n))) / denom;
  return [Math.max(0, center - half), Math.min(1, center + half)];
}

/** Newcombe hybrid score：两独立比例风险差的 95% CI（不假设方差相等）。 */
function newcombeInterval(
  successT: number, nT: number, successC: number, nC: number,
): [number, number] | null {
  if (nT === 0 || nC === 0) return null;
  const pT = successT / nT;
  const pC = successC / nC;
  const [lT, uT] = wilsonInterval(successT, nT);
  const [lC, uC] = wilsonInterval(successC, nC);
  const diff = pT - pC;
  const lower = diff - Math.sqrt((pT - lT) ** 2 + (uC - pC) ** 2);
  const upper = diff + Math.sqrt((uT - pT) ** 2 + (pC - lC) ** 2);
  return [Math.max(-1, lower), Math.min(1, upper)];
}

function sumOrNull(values: readonly (number | null | undefined)[]): number | null {
  let total = 0;
  for (const value of values) {
    if (value === null || value === undefined || !Number.isFinite(value)) return null;
    total += value;
  }
  return total;
}

/** 按预注册规则裁决；P2 只产出 suggest-promote，不自动安装。 */
export function analyzeExperiment(
  record: ExperimentRecord,
  samples: readonly ExperimentSample[],
  unknownEpisodes = 0,
): ExperimentAnalysis {
  const control = samples.filter((sample) => sample.arm === "control");
  const treatment = samples.filter((sample) => sample.arm === "treatment");
  const nControl = control.length;
  const nTreatment = treatment.length;
  const successControl = control.filter((sample) => sample.success).length;
  const successTreatment = treatment.filter((sample) => sample.success).length;
  const riskDiff = nControl > 0 && nTreatment > 0 ? successTreatment / nTreatment - successControl / nControl : null;
  const ci95 = newcombeInterval(successTreatment, nTreatment, successControl, nControl);
  const cost = {
    controlTokens: control.reduce((sum, sample) => sum + (sample.tokens ?? 0), 0),
    treatmentTokens: treatment.reduce((sum, sample) => sum + (sample.tokens ?? 0), 0),
    controlUsd: sumOrNull(control.map((sample) => sample.usd)),
    treatmentUsd: sumOrNull(treatment.map((sample) => sample.usd)),
  };
  const base = {
    v: 1 as const,
    experimentId: record.id,
    nControl,
    nTreatment,
    successControl,
    successTreatment,
    riskDiff,
    ci95,
    unknownEpisodes,
    cost,
  };

  if (unknownEpisodes > samples.length) {
    return {
      ...base,
      status: "unmeasurable",
      decision: "keep-old",
      reason: "未知结局 " + String(unknownEpisodes) + " 条多于可判定样本 " + String(samples.length) + " 条——不拿已知样本下结论",
    };
  }

  if (nControl < record.minSamplesPerArm || nTreatment < record.minSamplesPerArm) {
    return {
      ...base,
      status: "running",
      decision: "keep-running",
      reason: "样本不足：control " + String(nControl) + "/" + String(record.minSamplesPerArm)
        + "，treatment " + String(nTreatment) + "/" + String(record.minSamplesPerArm),
    };
  }

  if (ci95 !== null && ci95[0] > record.decisionRule.minRiskDiff) {
    return {
      ...base,
      status: "passed",
      decision: "suggest-promote",
      reason: "风险差 " + riskDiff!.toFixed(3) + "，95% CI 下界 " + ci95[0].toFixed(3)
        + " > " + String(record.decisionRule.minRiskDiff) + "——只建议晋升，不自动安装",
    };
  }

  if (ci95 !== null && ci95[1] < 0) {
    return {
      ...base,
      status: "failed",
      decision: "stop",
      reason: "风险差 " + riskDiff!.toFixed(3) + "，95% CI 上界 " + ci95[1].toFixed(3) + " < 0——治疗臂更差，停止实验",
    };
  }

  if (nControl >= record.maxSamplesPerArm && nTreatment >= record.maxSamplesPerArm) {
    return {
      ...base,
      status: "unmeasurable",
      decision: "keep-old",
      reason: "两臂都到上限 " + String(record.maxSamplesPerArm) + "，CI 仍跨 0——无法区分，保留旧版",
    };
  }

  return {
    ...base,
    status: "running",
    decision: "keep-running",
    reason: "已到最小样本但 CI 仍跨 0，继续到上限 " + String(record.maxSamplesPerArm),
  };
}

/** 人读的分析面；决策词与状态词都显式出现。 */
export function formatExperimentAnalysis(analysis: ExperimentAnalysis): string {
  const ci = analysis.ci95 === null
    ? "不可测"
    : "[" + analysis.ci95[0].toFixed(3) + ", " + analysis.ci95[1].toFixed(3) + "]";
  return [
    "Experiment " + analysis.experimentId + "：" + analysis.status + " / " + analysis.decision,
    "  样本 control " + String(analysis.nControl) + "（成功 " + String(analysis.successControl) + "）"
      + " / treatment " + String(analysis.nTreatment) + "（成功 " + String(analysis.successTreatment) + "）"
      + " / unknown " + String(analysis.unknownEpisodes),
    "  风险差 " + (analysis.riskDiff === null ? "不可测" : analysis.riskDiff.toFixed(3)) + "，95% CI " + ci,
    "  成本 tokens control " + String(analysis.cost.controlTokens)
      + " / treatment " + String(analysis.cost.treatmentTokens)
      + "；usd control " + (analysis.cost.controlUsd === null ? "不可定价" : String(analysis.cost.controlUsd))
      + " / treatment " + (analysis.cost.treatmentUsd === null ? "不可定价" : String(analysis.cost.treatmentUsd)),
    "  " + analysis.reason,
  ].join("\n");
}
