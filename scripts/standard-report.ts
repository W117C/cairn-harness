// 从**真机读数**生成公开标准对照报告（`outputs/standard-conformance/`）。
//
// 用法：npx tsx scripts/standard-report.ts [读数目录]
// 退出码：0 = 全 pass；1 = 有 fail；2 = 有 missing（读数没跑，不可当通过）。
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildConformanceReport, reportVerdict } from "../src/verification/conformance";
import { redactSecrets } from "../src/events/redact";

const root = process.cwd();
const outDir = join(root, "outputs", "standard-conformance");

function latestReadings(): { path: string; data: unknown } | null {
  const base = join(root, "outputs");
  if (!existsSync(base)) return null;
  const runs = readdirSync(base)
    .filter((n) => n.startsWith("wallpaper-deep-"))
    .map((n) => join(base, n, "readings.json"))
    .filter((p) => existsSync(p))
    .sort();
  const path = runs[runs.length - 1];
  if (path === undefined) return null;
  return { path, data: JSON.parse(readFileSync(path, "utf8")) as unknown };
}

const readings = latestReadings();
const checklist = JSON.parse(readFileSync(join(root, "fixtures", "parity", "checklist.json"), "utf8")) as {
  items: { status: string }[];
};
const parity = {
  total: checklist.items.length,
  covered: checklist.items.filter((i) => i.status === "covered").length,
  partial: checklist.items.filter((i) => i.status === "partial").length,
  absent: checklist.items.filter((i) => i.status === "absent").length,
  out: checklist.items.filter((i) => i.status === "out").length,
};

// 冒烟里暗色那一臂叫 `darkContrast`（含 text/canvas 与算好的 worst），亮色叫 `light`。
const raw = readings?.data as { darkContrast?: unknown; light?: unknown; negativeControl?: unknown } | undefined;
// OWASP A09：拿一个**真会泄露**的样本跑一遍产品自己的脱敏，数残留（不是读代码猜）。
const SAMPLE_SECRET = "sk-live-abcdef0123456789";
const masked = redactSecrets(`curl -H "Authorization: Bearer ${SAMPLE_SECRET}"`).text;
const occurrencesAfter = masked.split(SAMPLE_SECRET).length - 1;

const rows = buildConformanceReport({
  isolation: (raw as { rendererIsolation?: unknown } | undefined)?.rendererIsolation,
  csp: typeof (raw as { builtCsp?: unknown } | undefined)?.builtCsp === "string" ? (raw as { builtCsp: string }).builtCsp : null,
  // 键盘路径：冒烟里真有 Tab/Enter 走通并把设置写进去，才记 1。
  keyboardPick: (() => {
    const kb = (raw as { keyboardPick?: { path?: unknown; kind?: unknown } } | undefined)?.keyboardPick;
    return kb === undefined || typeof kb.path !== "string" ? null : { picked: kb.kind === "image" && kb.path !== "" };
  })(),
  redaction: { occurrencesAfter },
  readings: raw === undefined ? null : { dark: raw.darkContrast, light: raw.light, negativeControl: raw.negativeControl },
  readingsPath: readings?.path ?? "(没有真机读数)",
  parity,
});
const verdict = reportVerdict(rows);

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "report.json"), JSON.stringify({ at: new Date().toISOString(), verdict, parity, rows }, null, 2));
writeFileSync(
  join(outDir, "report.md"),
  [
    "# 公开标准对照（由真机读数生成）",
    "",
    `生成于 ${new Date().toISOString()}｜总判：**${verdict}**`,
    "",
    "| 标准 · 条款 | 阈值 | 实测 | 判定 | 来源 |",
    "|---|---|---|---|---|",
    ...rows.map((r) => `| ${r.standard} · ${r.clause} | ${String(r.threshold)} ${r.unit} | ${r.measured === null ? "—" : String(r.measured)} | ${r.verdict} | \`${r.source}\` |`),
    "",
  ].join("\n"),
);
console.log(`standard-report: ${verdict}`);
for (const r of rows) console.log(`  ${r.verdict.padEnd(8)} ${r.standard} · ${r.clause}｜实测 ${String(r.measured)} ${r.unit}｜阈值 ${String(r.threshold)}`);
console.log(`→ ${join(outDir, "report.json")}`);
process.exit(verdict === "pass" ? 0 : verdict === "fail" ? 1 : 2);
