/** 第 331 页取料诊断：留档里 `tests/typecheck-triage.test.ts` 那 4 条标题，盘上（当前树）还能逐字找到几条。 */
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { suiteRows } from "../../scripts/lib/head-cert-deps.ts";

const ROOT = resolve(import.meta.dirname, "../..");
const rows = suiteRows(readFileSync(join(ROOT, "outputs/suite-refresh-2026-10-03/suite-quiet.json"), "utf8"), ROOT + "/") ?? [];
const target = "tests/typecheck-triage.test.ts";
const mine = rows.filter((r) => r.file === target);
const disk = existsSync(join(ROOT, target)) ? readFileSync(join(ROOT, target), "utf8") : "";
console.log(`留档里该文件的行数：${String(mine.length)}`);
for (const r of mine) console.log((disk.includes(r.title) ? "  在盘上  " : "  盘上没有 ") + JSON.stringify(r.title));
console.log(`留档全量行数：${String(rows.length)}`);
