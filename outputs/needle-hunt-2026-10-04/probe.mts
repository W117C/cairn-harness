/* #39 只剩的那条红，断言里只有数字（`notResolved` 期望 0 收到 2）。这里跑的是**同一把尺的同一份取料**
 * （`suiteRows`／`budgetFromTestSource`／`timingNearCapCell` 全部 import 门自己那一套），只多问一句：
 * 那 2 条到底是哪两条。跑法（必须在一棵干净的 HEAD 树里，取料面才与判卷一致）：
 *   cd .worktrees/verify-<sha7> && node --import tsx outputs/needle-hunt-2026-10-04/probe.mts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { budgetFromTestSource, defaultTimeoutFromConfig, suiteRows } from "../../scripts/lib/head-cert-deps";

const repoRoot = process.cwd();
const jsonPath = join(repoRoot, "outputs/suite-refresh-2026-10-03/suite-quiet.json");
const rows = suiteRows(readFileSync(jsonPath, "utf8"), repoRoot + "/");
if (rows === null) {
  console.log("suiteRows 取不到 ⇒ 这份取料面没尺，先修取料");
  process.exit(1);
}
const defBudget = defaultTimeoutFromConfig(readFileSync(join(repoRoot, "tests/vitest.config.ts"), "utf8"));
console.log(`取料：${jsonPath.replace(repoRoot + "/", "")}｜行 ${String(rows.length)}｜默认预算 ${String(defBudget.ms)}ms`);

const cache = new Map<string, string | null>();
const read = (rel: string): string | null => {
  if (!cache.has(rel)) {
    try { cache.set(rel, readFileSync(join(repoRoot, rel), "utf8")); } catch { cache.set(rel, null); }
  }
  return cache.get(rel) ?? null;
};

const byKind = { explicit: 0, implicit: 0, nonliteral: 0, "not-resolved": 0 } as Record<string, number>;
const unresolved: Array<{ file: string; title: string; ms: number; fileMissing: boolean }> = [];
for (const r of rows) {
  const text = read(r.file);
  if (text === null) {
    unresolved.push({ file: r.file, title: r.title, ms: r.ms, fileMissing: true });
    byKind["not-resolved"] += 1;
    continue;
  }
  const l = budgetFromTestSource(text, r.title);
  byKind[l.kind] = (byKind[l.kind] ?? 0) + 1;
  if (l.kind === "not-resolved") unresolved.push({ file: r.file, title: r.title, ms: r.ms, fileMissing: false });
}
console.log(`分档：explicit ${String(byKind.explicit)}｜implicit ${String(byKind.implicit)}｜nonliteral ${String(byKind.nonliteral)}｜not-resolved ${String(byKind["not-resolved"])}`);
console.log("取不到成因的逐条（文件／标题／当时耗时／文件在不在）：");
for (const u of unresolved) {
  console.log(`  ${u.file}｜“${u.title}”｜${String(u.ms)}ms｜文件${u.fileMissing ? "缺失" : "在"}`);
  const text = read(u.file);
  if (text !== null) {
    const sameFile = rows.filter((r) => r.file === u.file).map((r) => r.title);
    console.log(`     └ 该文件里留档还有的标题：${sameFile.slice(0, 6).join(" ／ ")}`);
  }
}
