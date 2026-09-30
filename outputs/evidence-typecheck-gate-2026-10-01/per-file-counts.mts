/** 逐文件危险码读数（第 259 页）。判定与解析**不吃本地重写的那一份**，直接 import
 *  `scripts/lib/evidence-typecheck.ts` 的 `tally`／`verdict`——取料面与门共用一个决策点，
 *  否则这张表就成了「尺说 10、附表说 12」的第二把尺（本仓第十三族）。
 *  用法：`node --import tsx outputs/evidence-typecheck-gate-2026-10-01/per-file-counts.mts` */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { DANGER_BASELINE, DANGER_CODES, parseTscLine, tally, verdict } from "../../scripts/lib/evidence-typecheck";

const here = fileURLToPath(new URL(".", import.meta.url));
const raw = readFileSync(join(here, "tsc-raw.log"), "utf8");
const rows = raw.split("\n");
const t = tally(rows);

const byCode: Record<string, number> = {};
for (const line of rows) {
  const h = parseTscLine(line);
  if (h === null) continue;
  byCode[h.code] = (byCode[h.code] ?? 0) + 1;
}

const danger = Object.entries(t.perFile).sort((a, b) => (a[0] < b[0] ? -1 : 1));
console.log(`总报错 ${String(t.total)} 条／解析 ${String(t.parsed)} 条／含危险码的文件 ${String(danger.length)} 个／危险码合计 ${String(danger.reduce((a, [, n]) => a + n, 0))} 条`);
console.log(`按码分布：${Object.entries(byCode).sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c}=${String(n)}`).join(" ")}`);
console.log(`危险族（本门登记的那几族）：${DANGER_CODES.join(" ")}`);
for (const [file, now] of danger) {
  const cap = DANGER_BASELINE[file];
  console.log(`  ${file} 现读 ${String(now)} 条｜登记帽 ${cap === undefined ? "（没登记 ⇒ 按 0 算，门会红）" : String(cap)}`);
}
const v = verdict({ tsc: { status: 2, out: raw }, baseline: DANGER_BASELINE });
console.log(`verdict：state=${v.state} ok=${String(v.ok)}`);
console.log(`  cell：${v.cell}`);
