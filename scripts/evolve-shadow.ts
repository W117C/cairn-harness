// 离线 shadow 面（Cairn Evolve · P1）：读历史 Episode 与 playbook，回答候选“本会命中哪些条目”。
// 不注入、不改运行面；`--seed` 先把旧 evolution/memory 迁成 candidate，`--index` 重建 playbook 索引。
//
// 用法：
//   node --import tsx scripts/evolve-shadow.ts [workspace] [--seed] [--json] [--index]

import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { formatShadowReport, shadowReport, type ShadowReport } from "../src/agent/evolve/shadow";
import { loadEpisodes } from "../src/main/evolve/episode-store";
import {
  loadPlaybook,
  seedPlaybookFromLegacy,
  writePlaybookIndex,
  type SeedPlaybookResult,
} from "../src/main/evolve/playbook-store";

export interface EvolveShadowOutput {
  workspace: string;
  seeded: SeedPlaybookResult | null;
  report: ShadowReport;
  playbook: { entries: number; badLines: number; refusals: number };
  indexPath: string | null;
}

export async function runEvolveShadow(args: readonly string[]): Promise<EvolveShadowOutput> {
  const flags = new Set(args.filter((arg) => arg.startsWith("-")));
  const positional = args.filter((arg) => !arg.startsWith("-"));
  const workspace = resolve(positional[0] ?? process.cwd());
  const seeded = flags.has("--seed") ? await seedPlaybookFromLegacy(workspace) : null;
  const episodes = await loadEpisodes(workspace);
  const playbook = await loadPlaybook(workspace);
  const report = shadowReport(episodes.episodes, playbook.entries);
  const indexPath = flags.has("--index") ? (await writePlaybookIndex(workspace)).path : null;
  return {
    workspace,
    seeded,
    report,
    playbook: {
      entries: playbook.entries.length,
      badLines: playbook.badLines,
      refusals: playbook.refusals.length,
    },
    indexPath,
  };
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;

if (invokedDirectly) {
  const args = process.argv.slice(2);
  runEvolveShadow(args)
    .then((out) => {
      if (args.includes("--json")) {
        console.log(JSON.stringify({
          workspace: out.workspace,
          seeded: out.seeded,
          playbook: out.playbook,
          report: out.report,
          indexPath: out.indexPath,
        }, null, 2));
        return;
      }
      console.log("workspace: " + out.workspace);
      if (out.seeded !== null) {
        console.log("seed: proposed " + String(out.seeded.proposed)
          + " / added " + String(out.seeded.added)
          + " / existing " + String(out.seeded.skippedExisting)
          + " / invalid " + String(out.seeded.skippedInvalid));
      }
      console.log(formatShadowReport(out.report));
      console.log("playbook: entries " + String(out.playbook.entries)
        + " / badLines " + String(out.playbook.badLines)
        + " / refusals " + String(out.playbook.refusals));
      if (out.indexPath !== null) console.log("index: " + out.indexPath);
    })
    .catch((err: unknown) => {
      console.error("[evolve-shadow] " + (err instanceof Error ? err.message : String(err)));
      process.exitCode = 1;
    });
}
