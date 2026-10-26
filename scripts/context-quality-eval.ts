import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  runContextQualityEvaluation,
  type ContextQualityCases,
  type ContextQualityReport,
} from "../src/agent/context-quality-eval";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function markdown(report: ContextQualityReport, generatedAt: string): string {
  const lines = [
    "# Context Quality Paired Evaluation",
    "",
    "Generated: " + generatedAt,
    "",
    "| Case | Arm | Hit | Tokens | Latency ms | Failed | Unknown |",
    "|---|---|---:|---:|---:|---:|---|",
  ];
  for (const row of report.rows) {
    lines.push("| " + [
      row.caseId,
      row.arm,
      String(row.hit),
      row.returnedTokens.toFixed(1),
      row.latencyMs.toFixed(3),
      String(row.failed),
      row.unknown.join("; ") || "-",
    ].join(" | ") + " |");
  }
  lines.push("", "## Summary", "", "```json", JSON.stringify(report.summary, null, 2), "```", "");
  return lines.join("\n");
}

async function main(): Promise<void> {
  const fixture = argument("--cases") ?? join(process.cwd(), "fixtures", "context-quality", "cases.json");
  const outDir = resolve(argument("--out") ?? join(process.cwd(), "outputs", "context-quality-latest"));
  const cases = JSON.parse(await readFile(fixture, "utf8")) as ContextQualityCases;
  const report = await runContextQualityEvaluation(cases);
  const generatedAt = new Date().toISOString();
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, "report.json"), JSON.stringify({ generatedAt, ...report }, null, 2) + "\n", "utf8");
  await writeFile(join(outDir, "report.md"), markdown(report, generatedAt), "utf8");
  process.stdout.write(JSON.stringify({ outDir, summary: report.summary }, null, 2) + "\n");
}

main().catch((error) => {
  process.stderr.write(error instanceof Error ? error.stack ?? error.message : String(error));
  process.stderr.write("\n");
  process.exitCode = 1;
});

