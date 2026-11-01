// reflect-delta CLI（Cairn Evolve · P3）：把一个已解析的反思 JSON 变成 candidate entry + 候选档案。
// 只写 candidate/draft；不晋升、不注入。
//
// 用法：
//   node --import tsx scripts/evolve-reflect.ts <target_exp_id> --workspace <w> --file <reflection.json> [--json]

import { readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { recordReflectDelta } from "../src/main/evolve/reflect-operator";

interface ParsedArgs {
  positional: string[];
  flags: Map<string, string | true>;
}

function parseArgs(args: readonly string[]): ParsedArgs {
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
  return { positional, flags };
}

export async function runEvolveReflect(args: readonly string[]): Promise<{ text: string; json: unknown }> {
  const parsed = parseArgs(args);
  const targetId = parsed.positional[0];
  if (targetId === undefined) throw new Error("需要目标经验 id");
  const workspaceFlag = parsed.flags.get("workspace");
  const workspace = resolve(typeof workspaceFlag === "string" ? workspaceFlag : process.cwd());
  const fileFlag = parsed.flags.get("file");
  if (typeof fileFlag !== "string") throw new Error("需要 --file <reflection.json>");
  const reflection: unknown = JSON.parse(readFileSync(resolve(fileFlag), "utf8"));
  const result = await recordReflectDelta({ workspace, targetId, reflection });
  const text = result.outcome === "created"
    ? "created " + String(result.path) + "（" + String(result.entry?.id) + "）"
    : result.outcome === "existing"
      ? "existing " + String(result.path) + "（" + String(result.candidate?.id) + "）"
      : result.outcome + "：" + (result.refusals ?? []).join("；");
  return { text, json: result };
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;

if (invokedDirectly) {
  const args = process.argv.slice(2);
  runEvolveReflect(args)
    .then((out) => {
      console.log(args.includes("--json") ? JSON.stringify(out.json, null, 2) : out.text);
    })
    .catch((err: unknown) => {
      console.error("[evolve-reflect] " + (err instanceof Error ? err.message : String(err)));
      process.exitCode = 1;
    });
}
