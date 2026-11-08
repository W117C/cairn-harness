/** 外部基准适配 CLI：把 Harbor / Terminal-Bench 形态的任务集读成统一任务，
 *  再把外部跑器的证据（成功/失败/中断/缺用量）落成 ExternalRunRecord JSONL。
 *
 *  用法：
 *    pnpm external-bench --adapter harbor --tasks <file.json> --dataset-version <v> [--evidence <file.json>] [--out <file.jsonl>]
 *
 *  没有证据时只做适配与分母核对（缺一条就 exit 1，不出部分分母）。 */

import { readFile, writeFile } from "node:fs/promises";
import {
  adaptHarborTasks,
  adaptTerminalBenchTasks,
  toExternalRunRecord,
  type ExternalBenchmarkTask,
  type ExternalRunEvidence,
  type ExternalRunRecord,
} from "../src/interop/benchmarks";
import { isRecord } from "../src/is-record";

interface Args {
  adapter: "harbor" | "terminal-bench";
  tasks: string;
  datasetVersion: string;
  evidence?: string;
  out?: string;
}

function parseArgs(argv: readonly string[]): Args {
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith("--")) throw new Error("unexpected argument: " + arg);
    const key = arg.slice(2);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) throw new Error("missing value for --" + key);
    values.set(key, value);
    i++;
  }
  const adapter = values.get("adapter");
  if (adapter !== "harbor" && adapter !== "terminal-bench") throw new Error("--adapter must be harbor or terminal-bench");
  const tasks = values.get("tasks");
  if (tasks === undefined) throw new Error("--tasks is required");
  const datasetVersion = values.get("dataset-version");
  if (datasetVersion === undefined) throw new Error("--dataset-version is required");
  return {
    adapter,
    tasks,
    datasetVersion,
    ...(values.get("evidence") !== undefined ? { evidence: values.get("evidence")! } : {}),
    ...(values.get("out") !== undefined ? { out: values.get("out")! } : {}),
  };
}

interface EvidenceFile {
  model: string;
  provider: string;
  toolPolicy: string;
  startedAt: number;
  finishedAt: number;
  runs: unknown[];
}

function parseEvidence(raw: unknown): EvidenceFile {
  if (!isRecord(raw)) throw new Error("evidence 顶层必须是对象");
  for (const key of ["model", "provider", "toolPolicy"] as const) {
    if (typeof raw[key] !== "string" || raw[key].trim() === "") throw new Error("evidence." + key + " 必须是非空字符串");
  }
  const startedAt = typeof raw.startedAt === "string" ? Date.parse(raw.startedAt) : Number.NaN;
  const finishedAt = typeof raw.finishedAt === "string" ? Date.parse(raw.finishedAt) : Number.NaN;
  if (!Number.isFinite(startedAt) || !Number.isFinite(finishedAt)) throw new Error("evidence.startedAt/finishedAt 必须是 ISO 时间");
  if (!Array.isArray(raw.runs)) throw new Error("evidence.runs 必须是数组");
  return {
    model: raw.model as string,
    provider: raw.provider as string,
    toolPolicy: raw.toolPolicy as string,
    startedAt,
    finishedAt,
    runs: raw.runs,
  };
}

const OUTCOMES = new Set(["succeeded", "failed", "interrupted", "unknown"]);

function evidenceOf(raw: unknown): ExternalRunEvidence {
  if (!isRecord(raw)) throw new Error("run 证据必须是对象");
  if (typeof raw.taskId !== "string" || raw.taskId.trim() === "") throw new Error("run 证据缺 taskId");
  if (typeof raw.outcome !== "string" || !OUTCOMES.has(raw.outcome)) {
    throw new Error("run " + raw.taskId + " outcome 必须是 succeeded/failed/interrupted/unknown");
  }
  const usage = isRecord(raw.usage)
    ? {
        ...(typeof raw.usage.inputTokens === "number" ? { inputTokens: raw.usage.inputTokens } : {}),
        ...(typeof raw.usage.outputTokens === "number" ? { outputTokens: raw.usage.outputTokens } : {}),
        ...(typeof raw.usage.dollars === "number" ? { dollars: raw.usage.dollars } : {}),
      }
    : undefined;
  return {
    outcome: raw.outcome as ExternalRunEvidence["outcome"],
    ...(typeof raw.failure === "string" ? { failure: raw.failure } : {}),
    ...(typeof raw.interruption === "string" ? { interruption: raw.interruption } : {}),
    ...(usage !== undefined ? { usage } : {}),
  };
}

function runTimes(raw: unknown, fallback: { startedAt: number; finishedAt: number }): { startedAt: number; finishedAt: number } {
  if (!isRecord(raw)) return fallback;
  const startedAt = typeof raw.startedAt === "string" ? Date.parse(raw.startedAt) : fallback.startedAt;
  const finishedAt = typeof raw.finishedAt === "string" ? Date.parse(raw.finishedAt) : fallback.finishedAt;
  if (!Number.isFinite(startedAt) || !Number.isFinite(finishedAt) || finishedAt < startedAt) {
    throw new Error("run " + String(raw.taskId) + " 的 startedAt/finishedAt 不是合法区间");
  }
  return { startedAt, finishedAt };
}

function taskIdOf(raw: unknown): string | null {
  return isRecord(raw) && typeof raw.taskId === "string" ? raw.taskId : null;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const text = await readFile(args.tasks, "utf8");
  const raw: unknown = JSON.parse(text);
  const opts = { datasetVersion: args.datasetVersion };
  const result = args.adapter === "harbor" ? adaptHarborTasks(raw, opts) : adaptTerminalBenchTasks(raw, opts);
  if (result.errors.length > 0) {
    for (const error of result.errors) console.error("[external-bench] " + error);
    console.error("[external-bench] 适配有 " + String(result.errors.length) + " 条错误 ⇒ 不出分母");
    process.exit(1);
  }
  if (args.evidence === undefined) {
    console.log(JSON.stringify({
      benchmark: args.adapter,
      datasetVersion: args.datasetVersion,
      taskCount: result.tasks.length,
      tasks: result.tasks.map((t: ExternalBenchmarkTask) => ({ taskId: t.taskId, seed: t.seed, timeoutSec: t.timeoutSec, tokenBudget: t.tokenBudget, dollarBudget: t.dollarBudget })),
    }, null, 2));
    return;
  }

  const evidence = parseEvidence(JSON.parse(await readFile(args.evidence, "utf8")));
  const byTask = new Map<string, unknown>();
  for (const run of evidence.runs) {
    const taskId = taskIdOf(run);
    if (taskId === null) throw new Error("run 证据缺 taskId");
    if (byTask.has(taskId)) throw new Error("run 证据里 taskId 重复：" + taskId);
    byTask.set(taskId, run);
  }
  const knownTasks = new Set(result.tasks.map((task) => task.taskId));
  const unknownEvidence = [...byTask.keys()].filter((taskId) => !knownTasks.has(taskId));
  if (unknownEvidence.length > 0) {
    throw new Error("证据里有点名了但任务集里没有的 taskId：" + unknownEvidence.join("、") + "（静默丢弃会让分母骗人）");
  }
  const records: ExternalRunRecord[] = result.tasks.map((task) => {
    const run = byTask.get(task.taskId);
    const times = runTimes(run, evidence);
    const runEvidence: ExternalRunEvidence = run === undefined ? { outcome: "unknown" } : evidenceOf(run);
    return toExternalRunRecord(task, {
      model: evidence.model,
      provider: evidence.provider,
      toolPolicy: evidence.toolPolicy,
      startedAt: times.startedAt,
      finishedAt: times.finishedAt,
    }, runEvidence);
  });
  const lines = records.map((record) => JSON.stringify(record)).join("\n") + "\n";
  if (args.out !== undefined) await writeFile(args.out, lines, "utf8");
  else process.stdout.write(lines);
  const counts = new Map<string, number>();
  for (const record of records) counts.set(record.outcome, (counts.get(record.outcome) ?? 0) + 1);
  const usageUnknown = records.filter((record) => record.usage.unknown.length > 0).length;
  console.error("[external-bench] " + String(records.length) + " 条记录："
    + [...counts.entries()].map(([k, v]) => k + "=" + String(v)).join(" ")
    + "；用量未知 " + String(usageUnknown) + "/" + String(records.length));
}

await main();
