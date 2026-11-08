// 实验编排 CLI（Cairn Evolve · P2）：预注册、列表、按 Episode 分析。
// 不自动晋升：analyze 只输出 suggest-promote / keep-old / stop；安装仍走 SEMA 与人工。
//
// 用法：
//   node --import tsx scripts/evolve-experiment.ts create --workspace <w> --id ex1 \
//     --candidate exp_... --hypothesis "..." [--treatment 0.5] [--min 10] [--max 20] \
//     [--class debug,test] [--approved-by owner]
//   node --import tsx scripts/evolve-experiment.ts list --workspace <w> [--json]
//   node --import tsx scripts/evolve-experiment.ts analyze ex1 --workspace <w> [--json]

import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  formatExperimentAnalysis,
  validateExperiment,
  type ExperimentRecord,
} from "../src/agent/evolve/experiment";
import type { EpisodeTaskClass } from "../src/agent/evolve/episode";
import { loadPlaybook } from "../src/main/evolve/playbook-store";
import {
  analyzeExperimentById,
  createExperiment,
  listExperiments,
} from "../src/main/evolve/experiment-store";

interface ParsedArgs {
  command: string;
  positional: string[];
  flags: Map<string, string | true>;
}

function parseArgs(args: readonly string[]): ParsedArgs {
  const command = args.find((arg) => !arg.startsWith("-")) ?? "";
  const positional: string[] = [];
  const flags = new Map<string, string | true>();
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith("-")) {
        flags.set(key, next);
        i += 1;
      } else {
        flags.set(key, true);
      }
      continue;
    }
    if (!arg.startsWith("-")) positional.push(arg);
  }
  return { command, positional: positional.filter((value) => value !== command), flags };
}

function flagString(flags: Map<string, string | true>, key: string): string | null {
  const value = flags.get(key);
  return typeof value === "string" ? value : null;
}

function flagNumber(flags: Map<string, string | true>, key: string, fallback: number): number {
  const raw = flagString(flags, key);
  if (raw === null) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function workspaceOf(flags: Map<string, string | true>): string {
  return resolve(flagString(flags, "workspace") ?? process.cwd());
}

function recordFromFlags(flags: Map<string, string | true>, workspace: string): ExperimentRecord {
  const id = flagString(flags, "id");
  const candidateRef = flagString(flags, "candidate");
  const hypothesis = flagString(flags, "hypothesis");
  if (id === null || candidateRef === null || hypothesis === null) {
    throw new Error("create 需要 --id、--candidate、--hypothesis");
  }
  const minSamples = Math.max(2, Math.trunc(flagNumber(flags, "min", 10)));
  const maxSamples = Math.max(minSamples, Math.trunc(flagNumber(flags, "max", 20)));
  const classText = flagString(flags, "class");
  const taskClasses = classText === null
    ? undefined
    : classText.split(",").map((value) => value.trim()).filter((value) => value.length > 0) as EpisodeTaskClass[];
  return {
    v: 1,
    id,
    workspace,
    hypothesis,
    candidateRef,
    control: "current-active",
    taskFilter: taskClasses === undefined ? {} : { class: taskClasses },
    treatmentPct: flagNumber(flags, "treatment", 0.5),
    minSamplesPerArm: minSamples,
    maxSamplesPerArm: maxSamples,
    decisionRule: { kind: "superiority", minRiskDiff: 0, minCostImprovement: 0.1, requireNoRegression: true },
    budget: { maxRuns: Math.max(minSamples * 2, 40), maxUsd: null, maxWallMs: null },
    status: "running",
    createdAt: Date.now(),
    approvedBy: flagString(flags, "approved-by") ?? "owner",
  };
}

export interface EvolveExperimentOutput {
  command: string;
  workspace: string;
  text: string;
  json: unknown;
}

export async function runEvolveExperiment(args: readonly string[]): Promise<EvolveExperimentOutput> {
  const parsed = parseArgs(args);
  const workspace = workspaceOf(parsed.flags);
  if (parsed.command === "list") {
    const experiments = await listExperiments(workspace);
    return {
      command: "list",
      workspace,
      text: experiments.length === 0
        ? "没有实验"
        : experiments.map((item) => item.id + " · " + item.status + " · " + item.candidateRef
          + " · treatment " + String(item.treatmentPct)).join("\n"),
      json: experiments,
    };
  }
  if (parsed.command === "create") {
    const record = recordFromFlags(parsed.flags, workspace);
    const issues = validateExperiment(record);
    if (issues.length > 0) throw new Error("实验不合法：" + issues.join("；"));
    const playbook = await loadPlaybook(workspace);
    const candidate = playbook.entries.find((entry) => entry.id === record.candidateRef);
    if (candidate === undefined) throw new Error("候选不存在：" + record.candidateRef);
    if (candidate.status === "active") throw new Error("候选已 active，不能再做实验：" + record.candidateRef);
    if (candidate.status === "retired" || candidate.status === "deprecated") {
      throw new Error("候选已退役/废弃，不能做实验：" + record.candidateRef);
    }
    const path = await createExperiment(workspace, record);
    return { command: "create", workspace, text: "created " + path, json: record };
  }
  if (parsed.command === "analyze") {
    const id = parsed.positional[0];
    if (id === undefined) throw new Error("analyze 需要实验 id");
    const result = await analyzeExperimentById(workspace, id);
    return {
      command: "analyze",
      workspace,
      text: formatExperimentAnalysis(result.analysis),
      json: result.analysis,
    };
  }
  throw new Error("未知命令（create / list / analyze）：" + parsed.command);
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;

if (invokedDirectly) {
  const args = process.argv.slice(2);
  runEvolveExperiment(args)
    .then((out) => {
      console.log(args.includes("--json") ? JSON.stringify(out.json, null, 2) : out.text);
    })
    .catch((err: unknown) => {
      console.error("[evolve-experiment] " + (err instanceof Error ? err.message : String(err)));
      process.exitCode = 1;
    });
}
