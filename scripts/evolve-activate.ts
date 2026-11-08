// 经验激活 CLI（Cairn Evolve · P4）：候选/休眠 → active，默认 dry-run，`--apply` 才写。
// 门只认对照组实验（confidence.causal）；相关性/观测读数不参与晋升。
// 用法：
//   node --import tsx scripts/evolve-activate.ts <exp_id> [--workspace <w>] [--apply] [--json]
//   node --import tsx scripts/evolve-activate.ts list [--workspace <w>] [--json]

import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { ExperienceStatus } from "../src/agent/evolve/playbook";
import {
  activatePlaybookEntry,
  activationBlockers,
  type ActivationBlock,
  type ActivationOutcome,
} from "../src/main/evolve/activation";
import { loadPlaybook } from "../src/main/evolve/playbook-store";
import { verifyGlobalEvidence } from "../src/main/evolve/globalize";

export interface EvolveActivateOutput {
  workspace: string;
  id: string;
  applied: boolean;
  result: ActivationOutcome;
}

export interface EvolveActivateListOutput {
  workspace: string;
  entries: Array<{
    id: string;
    status: ExperienceStatus;
    activatable: boolean;
    blockers: ActivationBlock[];
  }>;
}

function workspaceOf(args: readonly string[]): string {
  const index = args.indexOf("--workspace");
  if (index === -1) return process.cwd();
  const value = args[index + 1];
  return resolve(value !== undefined && !value.startsWith("-") ? value : process.cwd());
}

/** 列出所有非 active 条目与各自还差的激活门（人读 dry-run 面；不写盘）。 */
export async function runEvolveActivateList(args: readonly string[]): Promise<EvolveActivateListOutput> {
  const workspace = workspaceOf(args);
  const now = Date.now();
  const playbook = await loadPlaybook(workspace);
  const entries = await Promise.all(playbook.entries
    .filter((entry) => entry.status !== "active")
    .map(async (entry) => {
      // 全局条目先核验再问门（与激活门、报告同一份核验；本地条目不做跨库读盘）。
      const globalCheck = entry.scope.workspace === "*"
        ? await verifyGlobalEvidence(entry.globalEvidence ?? [])
        : undefined;
      const blockers = activationBlockers(entry, playbook.entries, now, {
        ...(globalCheck !== undefined ? { globalCheck } : {}),
      });
      return { id: entry.id, status: entry.status, activatable: blockers.length === 0, blockers };
    }));
  return { workspace, entries };
}

export async function runEvolveActivate(args: readonly string[]): Promise<EvolveActivateOutput> {
  const id = args.find((arg, index) => !arg.startsWith("-") && args[index - 1] !== "--workspace");
  if (id === undefined) throw new Error("用法：evolve-activate.ts <exp_id> [--workspace <w>] [--apply] [--json]");
  const workspace = workspaceOf(args);
  const applied = args.includes("--apply");
  const result = await activatePlaybookEntry(workspace, id, { apply: applied });
  return { workspace, id, applied, result };
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;

if (invokedDirectly) {
  const args = process.argv.slice(2);
  if (args[0] === "list") {
    runEvolveActivateList(args)
      .then((out) => {
        if (args.includes("--json")) {
          console.log(JSON.stringify(out, null, 2));
          return;
        }
        console.log("workspace: " + out.workspace + " · 非 active " + String(out.entries.length) + " 条");
        if (out.entries.length === 0) console.log("  没有可激活的候选");
        for (const entry of out.entries) {
          console.log("  " + entry.id + " · " + entry.status + " · "
            + (entry.activatable ? "✅ 可激活" : "✗ " + entry.blockers.map((blocker) => blocker.code).join(",")));
        }
      })
      .catch((err: unknown) => {
        console.error("[evolve-activate] " + (err instanceof Error ? err.message : String(err)));
        process.exitCode = 1;
      });
  } else {
    runEvolveActivate(args)
      .then((out) => {
        if (args.includes("--json")) {
          console.log(JSON.stringify(out, null, 2));
          return;
        }
        console.log("workspace: " + out.workspace + " · " + out.id + (out.applied ? "（--apply）" : "（dry-run）"));
        if (out.result.outcome === "refused") {
          for (const blocker of out.result.blockers) console.log("  ✗ " + blocker.code + " · " + blocker.detail);
          return;
        }
        console.log("  " + out.result.outcome);
        if (out.result.outcome === "activated" || out.result.outcome === "already-active") {
          console.log("  status=" + out.result.entry.status + " · causal trials="
            + String(out.result.entry.confidence.causal.trials)
            + " · riskDiff=" + String(out.result.entry.confidence.causal.riskDiff));
        } else if (out.result.outcome === "frozen") {
          console.log("  STOP 冻结中：不激活");
        } else {
          console.log("  门通过；加 --apply 才写入 active");
        }
      })
      .catch((err: unknown) => {
        console.error("[evolve-activate] " + (err instanceof Error ? err.message : String(err)));
        process.exitCode = 1;
      });
  }
}
