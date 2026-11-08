/** 外部基准适配（Harbor / Terminal-Bench 形态）与运行记录。
 *
 *  规则来自设计稿：
 *  - 记录基准与数据集版本、任务 id/seed、模型/provider、工具策略、超时与预算；
 *  - 失败、中断、用量缺失都各占一格：缺用量 = null + unknown，不折成 0；
 *  - 每次只记一次尝试，不自动重试覆盖第一次结果。
 *
 *  适配是**纯函数**：不 clone、不执行、不联网；执行器由调用方注入。 */

import { isRecord } from "../is-record";
export type ExternalBenchmarkName = "harbor" | "terminal-bench";

export interface ExternalBenchmarkTask {
  benchmark: ExternalBenchmarkName;
  datasetVersion: string;
  taskId: string;
  /** 数据集没给 seed ⇒ null（未知），不是 0。 */
  seed: number | null;
  instruction: string;
  timeoutSec: number | null;
  tokenBudget: number | null;
  dollarBudget: number | null;
  source: string;
  /** 原始条目全文，保留未映射字段而不是静默丢弃。 */
  metadata: Record<string, unknown>;
}

export interface ExternalAdaptResult {
  tasks: ExternalBenchmarkTask[];
  errors: string[];
}

export interface AdaptOptions {
  datasetVersion: string;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function optionalNumber(value: unknown, label: string, errors: string[], at: string): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    errors.push(at + "：" + label + " 必须是非负有限数字（缺席 = 未知，不是 0）");
    return null;
  }
  return value;
}

function pick(raw: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const key of keys) if (raw[key] !== undefined) return raw[key];
  return undefined;
}

function adaptOne(
  benchmark: ExternalBenchmarkName,
  raw: unknown,
  opts: AdaptOptions,
  at: string,
): { task?: ExternalBenchmarkTask; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(raw)) return { errors: [at + "：任务必须是对象"] };
  const taskId = nonEmptyString(pick(raw, ["task_id", "id", "name"]));
  const instruction = nonEmptyString(pick(raw, ["instruction", "description", "problem_statement"]));
  if (taskId === null) errors.push(at + "：缺任务 id（task_id/id/name）");
  if (instruction === null) errors.push(at + "：缺指令（instruction/description/problem_statement）——空任务不许进分母");
  const seedRaw = pick(raw, ["seed"]);
  const seed = optionalNumber(seedRaw, "seed", errors, at);
  const timeoutSec = optionalNumber(pick(raw, ["max_agent_timeout_sec", "timeout_sec", "timeout"]), "timeout", errors, at);
  const tokenBudget = optionalNumber(pick(raw, ["token_budget", "max_tokens", "tokens"]), "token_budget", errors, at);
  const dollarBudget = optionalNumber(pick(raw, ["dollar_budget", "max_cost_usd", "cost_usd"]), "dollar_budget", errors, at);
  const repo = nonEmptyString(pick(raw, ["source", "repo"]));
  const commit = nonEmptyString(pick(raw, ["commit", "revision", "base_commit"]));
  const source = repo === null ? benchmark + "@" + opts.datasetVersion : commit === null ? repo : repo + "@" + commit;
  if (opts.datasetVersion.trim() === "") errors.push(at + "：datasetVersion 必须非空");
  if (errors.length > 0 || taskId === null || instruction === null) return { errors };
  return {
    task: {
      benchmark,
      datasetVersion: opts.datasetVersion,
      taskId,
      seed,
      instruction,
      timeoutSec,
      tokenBudget,
      dollarBudget,
      source,
      metadata: raw,
    },
    errors,
  };
}

function adaptList(benchmark: ExternalBenchmarkName, raw: unknown, opts: AdaptOptions): ExternalAdaptResult {
  if (!Array.isArray(raw)) return { tasks: [], errors: ["外部任务集顶层必须是数组（收到 " + typeof raw + "）"] };
  const tasks: ExternalBenchmarkTask[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  raw.forEach((entry, i) => {
    const at = "第 " + String(i + 1) + " 条";
    const result = adaptOne(benchmark, entry, opts, at);
    errors.push(...result.errors);
    if (result.task === undefined) return;
    if (seen.has(result.task.taskId)) {
      errors.push(at + "：任务 id「" + result.task.taskId + "」重复（静默去重会让分母骗人）");
      return;
    }
    seen.add(result.task.taskId);
    tasks.push(result.task);
  });
  return { tasks, errors };
}

export function adaptHarborTasks(raw: unknown, opts: AdaptOptions): ExternalAdaptResult {
  return adaptList("harbor", raw, opts);
}

export function adaptTerminalBenchTasks(raw: unknown, opts: AdaptOptions): ExternalAdaptResult {
  return adaptList("terminal-bench", raw, opts);
}

export interface ExternalUsageEvidence {
  inputTokens?: number;
  outputTokens?: number;
  dollars?: number;
}

export interface ExternalRunEvidence {
  /** unknown = 外部跑器没有回报结果；不许当成成功或重跑。 */
  outcome: "succeeded" | "failed" | "interrupted" | "unknown";
  failure?: string;
  interruption?: string;
  usage?: ExternalUsageEvidence;
}

export interface ExternalRunEnvelope {
  model: string;
  provider: string;
  toolPolicy: string;
  startedAt: number;
  finishedAt: number;
}

export interface ExternalUsageRecord {
  inputTokens: number | null;
  outputTokens: number | null;
  dollars: number | null;
  /** 缺失字段名；空数组 = 三项齐全。 */
  unknown: string[];
}

export interface ExternalRunRecord {
  schemaVersion: 1;
  benchmark: ExternalBenchmarkName;
  datasetVersion: string;
  taskId: string;
  seed: number | null;
  model: string;
  provider: string;
  toolPolicy: string;
  timeoutSec: number | null;
  tokenBudget: number | null;
  dollarBudget: number | null;
  outcome: ExternalRunEvidence["outcome"];
  failure: string | null;
  interruption: string | null;
  usage: ExternalUsageRecord;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
}

function usageNumber(value: unknown, label: string, unknown: string[]): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  unknown.push(label);
  return null;
}

/** 缺失用量保留 null 并进 unknown；绝不补 0。 */
export function recordUsage(evidence: ExternalUsageEvidence | undefined): ExternalUsageRecord {
  const unknown: string[] = [];
  const record: ExternalUsageRecord = {
    inputTokens: usageNumber(evidence?.inputTokens, "inputTokens", unknown),
    outputTokens: usageNumber(evidence?.outputTokens, "outputTokens", unknown),
    dollars: usageNumber(evidence?.dollars, "dollars", unknown),
    unknown,
  };
  return record;
}

export function toExternalRunRecord(
  task: ExternalBenchmarkTask,
  envelope: ExternalRunEnvelope,
  evidence: ExternalRunEvidence,
): ExternalRunRecord {
  const durationMs = envelope.finishedAt - envelope.startedAt;
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    throw new Error("external run: finishedAt must be >= startedAt");
  }
  return {
    schemaVersion: 1,
    benchmark: task.benchmark,
    datasetVersion: task.datasetVersion,
    taskId: task.taskId,
    seed: task.seed,
    model: envelope.model,
    provider: envelope.provider,
    toolPolicy: envelope.toolPolicy,
    timeoutSec: task.timeoutSec,
    tokenBudget: task.tokenBudget,
    dollarBudget: task.dollarBudget,
    outcome: evidence.outcome,
    failure: evidence.outcome === "failed" ? evidence.failure ?? null : null,
    interruption: evidence.outcome === "interrupted" ? evidence.interruption ?? null : null,
    usage: recordUsage(evidence.usage),
    startedAt: new Date(envelope.startedAt).toISOString(),
    finishedAt: new Date(envelope.finishedAt).toISOString(),
    durationMs,
  };
}

export interface ExternalRunContext {
  timeoutSec: number | null;
}

export interface ExternalBenchmarkRunOptions {
  tasks: readonly ExternalBenchmarkTask[];
  model: string;
  provider: string;
  toolPolicy: string;
  execute(task: ExternalBenchmarkTask, ctx: ExternalRunContext): Promise<ExternalRunEvidence>;
  now?: () => number;
}

/** 每条任务只执行一次：失败/中断原样记录，**不自动重试**抹掉第一次结果。 */
export async function runExternalBenchmark(opts: ExternalBenchmarkRunOptions): Promise<ExternalRunRecord[]> {
  const now = opts.now ?? (() => Date.now());
  const records: ExternalRunRecord[] = [];
  for (const task of opts.tasks) {
    const startedAt = now();
    let evidence: ExternalRunEvidence;
    try {
      evidence = await opts.execute(task, { timeoutSec: task.timeoutSec });
    } catch (error) {
      const name = typeof error === "object" && error !== null ? (error as { name?: unknown }).name : undefined;
      const message = error instanceof Error ? error.message : String(error);
      evidence = name === "AbortError"
        ? { outcome: "interrupted", interruption: message }
        : { outcome: "failed", failure: message };
    }
    records.push(toExternalRunRecord(task, {
      model: opts.model,
      provider: opts.provider,
      toolPolicy: opts.toolPolicy,
      startedAt,
      finishedAt: now(),
    }, evidence));
  }
  return records;
}
