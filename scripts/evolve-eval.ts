// 离线评估 CLI（Cairn Evolve · P3 补齐）：从 JSON 读 baseline/candidate runs，配对评估并写候选档案。
// 不自动晋升；promotion 会再查 holdout。
//
// 输入 JSON：
//   { "tasks": [{"id":"t1","split":"holdout"}],
//     "baseline": [{"taskId":"t1","ok":true,"costUsd":1}],
//     "candidate": [{"taskId":"t1","ok":true,"costUsd":1}] }
//
// 用法：
//   node --import tsx scripts/evolve-eval.ts record <cand_id> --workspace <w> --file <input.json> [--json]
//   node --import tsx scripts/evolve-eval.ts show <cand_id> --workspace <w> [--json]

import { readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { OfflineEvalInput } from "../src/agent/evolve/offline-eval";
import { loadCandidate } from "../src/main/evolve/candidate-store";
import { recordOfflineEvaluation } from "../src/main/evolve/offline-eval-store";
import { isRecord } from "../src/is-record";

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

function workspaceOf(flags: Map<string, string | true>): string {
  const value = flags.get("workspace");
  return resolve(typeof value === "string" ? value : process.cwd());
}

function readInput(path: string): OfflineEvalInput {
  const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!isRecord(raw)
    || !Array.isArray(raw.tasks) || !Array.isArray(raw.baseline) || !Array.isArray(raw.candidate)) {
    throw new Error("输入 JSON 必须是 {tasks, baseline, candidate} 三个数组");
  }
  return {
    tasks: raw.tasks as OfflineEvalInput["tasks"],
    baseline: raw.baseline as OfflineEvalInput["baseline"],
    candidate: raw.candidate as OfflineEvalInput["candidate"],
    ...(typeof raw.minCostImprovement === "number" ? { minCostImprovement: raw.minCostImprovement } : {}),
  };
}

export interface EvolveEvalOutput {
  command: string;
  text: string;
  json: unknown;
}

export async function runEvolveEval(args: readonly string[]): Promise<EvolveEvalOutput> {
  const parsed = parseArgs(args);
  const workspace = workspaceOf(parsed.flags);
  const id = parsed.positional[0];
  if (id === undefined) throw new Error(parsed.command + " 需要候选 id");
  if (parsed.command === "record") {
    const file = parsed.flags.get("file");
    if (typeof file !== "string") throw new Error("record 需要 --file <input.json>");
    const recorded = await recordOfflineEvaluation(workspace, id, readInput(resolve(file)));
    const result = recorded.result;
    return {
      command: "record",
      text: [
        "candidate " + recorded.candidate.id + " → " + recorded.candidate.status,
        "offline " + result.status + " / " + result.decision,
        "holdout " + (result.holdoutScores === null ? "不可测" : "success " + String(result.holdoutScores.success)
          + " / cost " + (result.holdoutScores.costUsd === null ? "不可定价" : String(result.holdoutScores.costUsd))
          + " / safety " + result.holdoutScores.safety),
        "McNemar p " + (result.mcnemarP === null ? "不可测" : result.mcnemarP.toFixed(4)),
        result.reason,
      ].join("\n"),
      json: recorded,
    };
  }
  if (parsed.command === "show") {
    const candidate = await loadCandidate(workspace, id);
    if (candidate === null) throw new Error("候选不存在或坏档：" + id);
    return {
      command: "show",
      text: candidate.id + " · " + candidate.status + "\n" + JSON.stringify(candidate.eval, null, 2),
      json: candidate,
    };
  }
  throw new Error("未知命令（record / show）：" + parsed.command);
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;

if (invokedDirectly) {
  const args = process.argv.slice(2);
  runEvolveEval(args)
    .then((out) => {
      console.log(args.includes("--json") ? JSON.stringify(out.json, null, 2) : out.text);
    })
    .catch((err: unknown) => {
      console.error("[evolve-eval] " + (err instanceof Error ? err.message : String(err)));
      process.exitCode = 1;
    });
}
