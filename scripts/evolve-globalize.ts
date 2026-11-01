// 全局晋升 CLI（Cairn Evolve）：owner 显式；默认 dry-run，`--apply` 才写全局账。
// 用法：
//   node --import tsx scripts/evolve-globalize.ts <exp_id> --workspace <ws> \
//     --evidence <ws1:ep1,ws2:ep2,ws3:ep3> [--apply] [--json]
//   node --import tsx scripts/evolve-globalize.ts list [--json]
//   node --import tsx scripts/evolve-globalize.ts revoke <exp_id> [--apply] [--json]
//   node --import tsx scripts/evolve-globalize.ts activate <exp_id> [--apply] [--json]
//   node --import tsx scripts/evolve-globalize.ts freeze|unfreeze [--json]

import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  globalizeExperience,
  listGlobalExperiences,
  reactivateGlobalExperience,
  revokeGlobalExperience,
  type GlobalEvidenceRef,
  type GlobalizeOutcome,
  type ReactivateOutcome,
  type RevokeOutcome,
} from "../src/main/evolve/globalize";
import {
  globalEvolveStopPath,
  globalPlaybookPath,
  isGlobalEvolveFrozen,
  setGlobalEvolveFrozen,
} from "../src/main/evolve/global-playbook-store";
import { retirementFindings } from "../src/agent/evolve/retirement";

export interface EvolveGlobalizeOutput {
  workspace: string;
  id: string;
  evidence: GlobalEvidenceRef[];
  applied: boolean;
  result: GlobalizeOutcome;
}

export interface EvolveGlobalizeListOutput {
  path: string;
  frozen: boolean;
  /** 全局账自身的过期/同触发冲突（无观测账；负证据要靠工作区报告）。 */
  findings: Array<{ id: string; reason: string; detail: string }>;
  entries: Array<{ id: string; status: string; scope: string; evidence: number; body: string }>;
}

export interface EvolveGlobalizeFreezeOutput {
  frozen: boolean;
  path: string;
}

export interface EvolveGlobalizeRevokeOutput {
  id: string;
  applied: boolean;
  result: RevokeOutcome;
}

export interface EvolveGlobalizeActivateOutput {
  id: string;
  applied: boolean;
  result: ReactivateOutcome;
}

function flagValue(args: readonly string[], flag: string): string | null {
  const index = args.indexOf(flag);
  if (index === -1) return null;
  const value = args[index + 1];
  return value !== undefined && !value.startsWith("-") ? value : null;
}

function parseEvidence(raw: string | null): GlobalEvidenceRef[] {
  if (raw === null || raw.trim() === "") throw new Error("--evidence 必填：ws1:ep1,ws2:ep2,ws3:ep3");
  return raw.split(",").map((part) => {
    const trimmed = part.trim();
    const split = trimmed.lastIndexOf(":");
    if (split <= 0 || split === trimmed.length - 1) {
      throw new Error("证据格式应为 workspace:episodeId：" + trimmed);
    }
    return { workspace: trimmed.slice(0, split), episodeId: trimmed.slice(split + 1) };
  });
}

export async function runEvolveGlobalize(args: readonly string[]): Promise<EvolveGlobalizeOutput> {
  const workspaceRaw = flagValue(args, "--workspace");
  if (workspaceRaw === null) throw new Error("--workspace 必填");
  const id = args.find((arg, index) =>
    !arg.startsWith("-") && args[index - 1] !== "--workspace" && args[index - 1] !== "--evidence");
  if (id === undefined) throw new Error("用法：evolve-globalize.ts <exp_id> --workspace <ws> --evidence <ws:ep,...>");
  const evidence = parseEvidence(flagValue(args, "--evidence"));
  const applied = args.includes("--apply");
  const result = await globalizeExperience(resolve(workspaceRaw), id, evidence, { apply: applied });
  return { workspace: resolve(workspaceRaw), id, evidence, applied, result };
}

/** 全局经验列表（owner 只读面）。 */
export async function runEvolveGlobalizeList(): Promise<EvolveGlobalizeListOutput> {
  const [entries, frozen] = await Promise.all([listGlobalExperiences(), isGlobalEvolveFrozen()]);
  const findings = retirementFindings(entries, Date.now())
    .map((finding) => ({ id: finding.id, reason: finding.reason, detail: finding.detail }));
  return {
    path: globalPlaybookPath(),
    frozen,
    findings,
    entries: entries
      .map((entry) => ({
        id: entry.id,
        status: entry.status,
        scope: entry.scope.workspace,
        evidence: entry.evidence.episodes.length,
        body: entry.body,
      }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  };
}

/** 撤销一条全局 active 经验（默认 dry-run）。 */
export async function runEvolveGlobalizeRevoke(args: readonly string[]): Promise<EvolveGlobalizeRevokeOutput> {
  const id = args.find((arg, index) => index > 0 && !arg.startsWith("-"));
  if (id === undefined) throw new Error("用法：evolve-globalize.ts revoke <exp_id> [--apply] [--json]");
  const applied = args.includes("--apply");
  const result = await revokeGlobalExperience(id, { apply: applied });
  return { id, applied, result };
}

/** 恢复一条 dormant 全局经验（默认 dry-run；复核原晋升证据）。 */
export async function runEvolveGlobalizeActivate(args: readonly string[]): Promise<EvolveGlobalizeActivateOutput> {
  const id = args.find((arg, index) => index > 0 && !arg.startsWith("-"));
  if (id === undefined) throw new Error("用法：evolve-globalize.ts activate <exp_id> [--apply] [--json]");
  const applied = args.includes("--apply");
  const result = await reactivateGlobalExperience(id, { apply: applied });
  return { id, applied, result };
}

/** owner 全局 STOP（幂等；与 workspace STOP 分开）。 */
export async function runEvolveGlobalizeFreeze(frozen: boolean): Promise<EvolveGlobalizeFreezeOutput> {
  await setGlobalEvolveFrozen(frozen);
  return { frozen: await isGlobalEvolveFrozen(), path: globalEvolveStopPath() };
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;

if (invokedDirectly) {
  const args = process.argv.slice(2);
  if (args[0] === "freeze" || args[0] === "unfreeze") {
    runEvolveGlobalizeFreeze(args[0] === "freeze")
      .then((out) => {
        if (args.includes("--json")) {
          console.log(JSON.stringify(out, null, 2));
          return;
        }
        console.log("全局 STOP：" + (out.frozen ? "已冻结" : "已解除") + " · " + out.path);
      })
      .catch((err: unknown) => {
        console.error("[evolve-globalize] " + (err instanceof Error ? err.message : String(err)));
        process.exitCode = 1;
      });
  } else if (args[0] === "list") {
    runEvolveGlobalizeList()
      .then((out) => {
        if (args.includes("--json")) {
          console.log(JSON.stringify(out, null, 2));
          return;
        }
        console.log("全局账：" + out.path + " · " + String(out.entries.length) + " 条"
          + (out.frozen ? " · 全局 STOP 冻结中" : ""));
        for (const entry of out.entries) {
          console.log("  " + entry.id + " · " + entry.status + " · " + entry.scope
            + " · 证据 " + String(entry.evidence) + " · " + entry.body.slice(0, 60));
        }
        if (out.findings.length === 0) console.log("  体检：无");
        else {
          for (const finding of out.findings) {
            console.log("  体检 " + finding.id + " · " + finding.reason + " · " + finding.detail);
          }
        }
      })
      .catch((err: unknown) => {
        console.error("[evolve-globalize] " + (err instanceof Error ? err.message : String(err)));
        process.exitCode = 1;
      });
  } else if (args[0] === "revoke") {
    runEvolveGlobalizeRevoke(args)
      .then((out) => {
        if (args.includes("--json")) {
          console.log(JSON.stringify(out, null, 2));
          return;
        }
        console.log("revoke " + out.id + (out.applied ? "（--apply）" : "（dry-run）"));
        if (out.result.outcome === "refused") console.log("  ✗ " + out.result.reason);
        else if (out.result.outcome === "frozen") console.log("  STOP 冻结中：不撤销");
        else if (out.result.outcome === "dry-run") console.log("  门通过；加 --apply 才写 dormant");
        else console.log("  dormant → " + out.result.path);
      })
      .catch((err: unknown) => {
        console.error("[evolve-globalize] " + (err instanceof Error ? err.message : String(err)));
        process.exitCode = 1;
      });
  } else if (args[0] === "activate") {
    runEvolveGlobalizeActivate(args)
      .then((out) => {
        if (args.includes("--json")) {
          console.log(JSON.stringify(out, null, 2));
          return;
        }
        console.log("activate " + out.id + (out.applied ? "（--apply）" : "（dry-run）"));
        if (out.result.outcome === "refused") {
          console.log("  ✗ " + out.result.reason);
          if (out.result.evidence !== null) {
            console.log("  证据：workspace " + String(out.result.evidence.workspaces)
              + " / Episode " + String(out.result.evidence.episodes));
          }
        } else if (out.result.outcome === "frozen") console.log("  STOP 冻结中：不恢复");
        else if (out.result.outcome === "dry-run") {
          console.log("  门通过（" + String(out.result.evidence.workspaces) + " 个 workspace / "
            + String(out.result.evidence.episodes) + " 条可测证据）；加 --apply 才写 active");
        } else console.log("  active → " + out.result.path);
      })
      .catch((err: unknown) => {
        console.error("[evolve-globalize] " + (err instanceof Error ? err.message : String(err)));
        process.exitCode = 1;
      });
  } else {
    runEvolveGlobalize(args)
      .then((out) => {
        if (args.includes("--json")) {
          console.log(JSON.stringify(out, null, 2));
          return;
        }
        console.log("workspace: " + out.workspace + " · " + out.id
          + (out.applied ? "（--apply）" : "（dry-run）"));
        if (out.result.outcome === "refused") {
          console.log("  ✗ " + out.result.reason);
          if (out.result.evidence !== null) {
            console.log("  证据：workspace " + String(out.result.evidence.workspaces)
              + " / Episode " + String(out.result.evidence.episodes));
          }
          return;
        }
        if (out.result.outcome === "frozen") {
          console.log("  STOP 冻结中：不晋升");
          return;
        }
        if (out.result.outcome === "dry-run") {
          console.log("  门通过（" + String(out.result.evidence.workspaces) + " 个 workspace / "
            + String(out.result.evidence.episodes) + " 条可测证据）；加 --apply 才写全局账");
          return;
        }
        console.log("  globalized → " + out.result.path + " · scope=* · status=" + out.result.entry.status);
      })
      .catch((err: unknown) => {
        console.error("[evolve-globalize] " + (err instanceof Error ? err.message : String(err)));
        process.exitCode = 1;
      });
  }
}
