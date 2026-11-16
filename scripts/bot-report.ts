// 生成 Bot 侧对照报告：`outputs/bot-conformance/{report.json,report.md}`
//
// 用法：npx tsx scripts/bot-report.ts
// 退出码：0 = 全 covered 且证人齐全；1 = 有 missing/partial（那就不是「做完了」）。
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildBotReport } from "../src/verification/bot-report";

const root = process.cwd();
const checklist = JSON.parse(readFileSync(join(root, "fixtures", "parity", "checklist.json"), "utf8")) as {
  items: { id: string; capability: string; status: string; evidence?: string[]; ours?: string }[];
};
const report = buildBotReport({ items: checklist.items, root: root + "/" });

const outDir = join(root, "outputs", "bot-conformance");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "report.json"), JSON.stringify({ at: new Date().toISOString(), ...report }, null, 2));
writeFileSync(
  join(outDir, "report.md"),
  [
    "# Bot 侧对照报告（生成物）",
    "",
    `生成于 ${new Date().toISOString()}｜总判：**${report.verdict}**`,
    "",
    `覆盖：${String(report.summary.covered)} / 共 ${String(report.summary.total)}｜partial ${String(report.summary.partial)}｜out ${String(report.summary.out)}｜missing ${String(report.summary.missing)}`,
    "",
    "| 能力 | 状态 | 证人 | 边界 |",
    "|---|---|---|---|",
    ...report.rows.map((r) => `| ${r.capability}（\`${r.id}\`） | ${r.status} | ${r.witnesses.map((w) => `\`${w}\``).join("、")} | ${r.note ?? ""} |`),
    "",
  ].join("\n"),
);
console.log(`bot-report: ${report.verdict}`);
console.log(`  ${String(report.summary.covered)}/${String(report.summary.total)} covered｜partial ${String(report.summary.partial)}｜out ${String(report.summary.out)}｜missing ${String(report.summary.missing)}`);
for (const r of report.rows) if (r.status !== "covered") console.log(`  ${r.status.padEnd(8)} ${r.id}${r.missingWitnesses.length ? `（缺：${r.missingWitnesses.join("、")}）` : ""}`);
console.log(`→ ${join(outDir, "report.json")}`);
process.exit(report.verdict === "pass" ? 0 : 1);
