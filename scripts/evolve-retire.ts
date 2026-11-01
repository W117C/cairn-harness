// 退役/冲突 CLI（Cairn Evolve · P4）：默认 dry-run；`--apply` 才把 delta 写进 playbook。
// 过期 ⇒ retire；同触发冲突 ⇒ 两条都 deprecate（可经 patch 复活，留给人裁决）。
// 用法：
//   node --import tsx scripts/evolve-retire.ts [workspace] [--apply] [--json]

import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { retirementFindings, retirementOps, type RetirementFinding } from "../src/agent/evolve/retirement";
import { observationalStatsOf } from "../src/agent/evolve/episode";
import type { PlaybookOp } from "../src/agent/evolve/playbook";
import { appendPlaybookEvents, loadPlaybook } from "../src/main/evolve/playbook-store";
import { loadEpisodesWithUserFeedback } from "../src/main/evolve/episode-store";

export interface EvolveRetireOutput {
  workspace: string;
  findings: RetirementFinding[];
  ops: PlaybookOp[];
  applied: boolean;
}

export async function runEvolveRetire(args: readonly string[]): Promise<EvolveRetireOutput> {
  const positional = args.filter((arg) => !arg.startsWith("-"));
  const workspace = resolve(positional[0] ?? process.cwd());
  const now = Date.now();
  const loaded = await loadPlaybook(workspace);
  const episodes = await loadEpisodesWithUserFeedback(workspace);
  const findings = retirementFindings(loaded.entries, now, observationalStatsOf(episodes.episodes));
  const ops = retirementOps(findings, now);
  const applied = args.includes("--apply");
  if (applied && ops.length > 0) await appendPlaybookEvents(workspace, ops);
  return { workspace, findings, ops, applied };
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;

if (invokedDirectly) {
  const args = process.argv.slice(2);
  runEvolveRetire(args)
    .then((out) => {
      if (args.includes("--json")) {
        console.log(JSON.stringify(out, null, 2));
        return;
      }
      console.log("workspace: " + out.workspace + (out.applied ? "（已 apply）" : "（dry-run；加 --apply 才写）"));
      if (out.findings.length === 0) console.log("retire/conflict: 无");
      else {
        for (const finding of out.findings) {
          console.log("  " + finding.id + " · " + finding.reason + " · " + finding.detail);
        }
        console.log("ops: " + String(out.ops.length));
      }
    })
    .catch((err: unknown) => {
      console.error("[evolve-retire] " + (err instanceof Error ? err.message : String(err)));
      process.exitCode = 1;
    });
}
