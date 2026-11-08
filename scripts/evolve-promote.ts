// 候选 / 晋升 CLI（Cairn Evolve · P3）：实验通过 → 候选档案 → SEMA staging。
// 不安装、不激活；安装仍需 SEMA 的人工审批与 canary。
//
// 用法：
//   node --import tsx scripts/evolve-promote.ts list --workspace <w> [--json]
//   node --import tsx scripts/evolve-promote.ts from-experiment ex1 --workspace <w> [--json]
//   node --import tsx scripts/evolve-promote.ts promote cand_... --workspace <w> [--json]

import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { listCandidates } from "../src/main/evolve/candidate-store";
import { createCandidateFromExperiment } from "../src/main/evolve/experiment-candidate";
import { promoteCandidateToSema } from "../src/main/evolve/promotion";

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

export interface EvolvePromoteOutput {
  command: string;
  workspace: string;
  text: string;
  json: unknown;
}

export async function runEvolvePromote(args: readonly string[]): Promise<EvolvePromoteOutput> {
  const parsed = parseArgs(args);
  const workspace = workspaceOf(parsed.flags);
  if (parsed.command === "list") {
    const candidates = await listCandidates(workspace);
    return {
      command: "list",
      workspace,
      text: candidates.length === 0
        ? "没有候选"
        : candidates.map((item) => item.id + " · " + item.status + " · " + item.operator
          + " · " + item.target.id + " · " + item.body.slice(0, 60)).join("\n"),
      json: candidates,
    };
  }
  if (parsed.command === "from-experiment") {
    const id = parsed.positional[0];
    if (id === undefined) throw new Error("from-experiment 需要实验 id");
    const result = await createCandidateFromExperiment(workspace, id);
    return {
      command: "from-experiment",
      workspace,
      text: (result.created ? "created " : "existing ") + result.path,
      json: result.candidate,
    };
  }
  if (parsed.command === "promote") {
    const id = parsed.positional[0];
    if (id === undefined) throw new Error("promote 需要候选 id");
    const result = await promoteCandidateToSema(workspace, id);
    if (result.outcome === "submitted") {
      return {
        command: "promote",
        workspace,
        text: "submitted " + result.bundleId + "@" + result.version + "（staging: " + result.stagingDir + "；未安装）",
        json: result,
      };
    }
    return {
      command: "promote",
      workspace,
      text: result.outcome + "：" + result.reason,
      json: result,
    };
  }
  throw new Error("未知命令（list / from-experiment / promote）：" + parsed.command);
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;

if (invokedDirectly) {
  const args = process.argv.slice(2);
  runEvolvePromote(args)
    .then((out) => {
      console.log(args.includes("--json") ? JSON.stringify(out.json, null, 2) : out.text);
    })
    .catch((err: unknown) => {
      console.error("[evolve-promote] " + (err instanceof Error ? err.message : String(err)));
      process.exitCode = 1;
    });
}
