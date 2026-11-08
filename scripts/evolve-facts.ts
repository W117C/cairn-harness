// Episode 证据的 facts 面（Evolve P0）：读 `<workspace>/.agent/evolve/episodes.jsonl`，
// 输出总数/结局/未知面/成本分列。默认工作区 = 当前目录；`--json` 输出机器可读；
// `--index` 顺带重建 `episodes.index.json`（索引是投影，不是事实源）。
//
// 用法：
//   node --import tsx scripts/evolve-facts.ts [workspace] [--json] [--index]

import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  formatEpisodeSummary,
  loadEpisodes,
  summarizeEpisodes,
  writeEpisodeIndex,
} from "../src/main/evolve/episode-store";

export interface EvolveFactsOutput {
  workspace: string;
  summary: ReturnType<typeof summarizeEpisodes>;
  indexPath: string | null;
}

export async function runEvolveFacts(args: readonly string[]): Promise<EvolveFactsOutput> {
  const flags = new Set(args.filter((arg) => arg.startsWith("-")));
  const positional = args.filter((arg) => !arg.startsWith("-"));
  const workspace = resolve(positional[0] ?? process.cwd());
  const summary = summarizeEpisodes(await loadEpisodes(workspace));
  let indexPath: string | null = null;
  if (flags.has("--index")) indexPath = (await writeEpisodeIndex(workspace)).path;
  return { workspace, summary, indexPath };
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;

if (invokedDirectly) {
  const args = process.argv.slice(2);
  runEvolveFacts(args)
    .then((out) => {
      if (args.includes("--json")) console.log(JSON.stringify(out.summary, null, 2));
      else {
        console.log("workspace: " + out.workspace);
        console.log(formatEpisodeSummary(out.summary));
      }
      if (out.indexPath !== null) console.log("index: " + out.indexPath);
    })
    .catch((err: unknown) => {
      console.error("[evolve-facts] " + (err instanceof Error ? err.message : String(err)));
      process.exitCode = 1;
    });
}
