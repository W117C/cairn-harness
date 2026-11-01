// Evolve 报告 CLI（Cairn Evolve · P5）：只读快照，供人/未来桌面面板消费。
// 用法：
//   node --import tsx scripts/evolve-report.ts [workspace] [--json]

import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { buildEvolveReport, formatEvolveReport, type EvolveReport } from "../src/main/evolve/report";

export interface EvolveReportOutput {
  workspace: string;
  report: EvolveReport;
}

export async function runEvolveReport(args: readonly string[]): Promise<EvolveReportOutput> {
  const positional = args.filter((arg) => !arg.startsWith("-"));
  const workspace = resolve(positional[0] ?? process.cwd());
  return { workspace, report: await buildEvolveReport(workspace) };
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;

if (invokedDirectly) {
  const args = process.argv.slice(2);
  runEvolveReport(args)
    .then((out) => {
      if (args.includes("--json")) console.log(JSON.stringify(out.report, null, 2));
      else {
        console.log("workspace: " + out.workspace);
        console.log(formatEvolveReport(out.report));
      }
    })
    .catch((err: unknown) => {
      console.error("[evolve-report] " + (err instanceof Error ? err.message : String(err)));
      process.exitCode = 1;
    });
}
