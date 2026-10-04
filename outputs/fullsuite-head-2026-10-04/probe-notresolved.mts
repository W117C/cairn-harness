// 取证探针：把 tests/head-cert-deps.test.ts:1272 那条红（notResolved=2）的两条名字现读跑出来。
// 复用判卷自己那套 helper（不重抄逻辑），取料＝判卷点名的那份留档 json。
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { budgetFromTestSource, defaultTimeoutFromConfig, suiteRows, timingNearCapCell } from "../../scripts/lib/head-cert-deps";

const repoRoot = resolve(process.cwd());
const jsonPath = join(repoRoot, "outputs/suite-refresh-2026-10-03/suite-quiet.json");
const cfgText = readFileSync(join(repoRoot, "tests/vitest.config.ts"), "utf8");
const defBudget = defaultTimeoutFromConfig(cfgText);

const rows = suiteRows(readFileSync(jsonPath, "utf8"), repoRoot + "/");
console.log("留档 json=" + jsonPath);
console.log("rows=" + (rows?.length ?? "null") + "  缺省帽=" + defBudget.ms + "（" + defBudget.source + "）");

const textCache = new Map<string, string>();
const unresolved: Array<{ file: string; title: string; why: string }> = [];
for (const r of rows ?? []) {
  if (!textCache.has(r.file)) {
    try { textCache.set(r.file, readFileSync(join(repoRoot, r.file), "utf8")); } catch { textCache.set(r.file, ""); }
  }
  const l = budgetFromTestSource(textCache.get(r.file) ?? "", r.title);
  if (l.kind === "not-resolved") unresolved.push({ file: r.file, title: r.title, why: l.why });
}
console.log("not-resolved 条数=" + unresolved.length);
for (const u of unresolved) console.log("  " + u.file + "  ·  「" + u.title + "」  ← " + u.why);

const cell = timingNearCapCell(rows ?? [], { defaultBudget: defBudget, readTest: (rel) => { try { return readFileSync(join(repoRoot, rel), "utf8"); } catch { return null; } } });
console.log("cell.notResolved=" + cell.notResolved + "  cell.total=" + cell.total + "  state=" + cell.state);
console.log("cell.notResolvedWhy=" + JSON.stringify(cell.notResolvedWhy));
