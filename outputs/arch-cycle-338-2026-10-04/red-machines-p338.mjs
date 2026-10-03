/** 第 338 页 · 造红四台＋一台复原校验（尺的分辨力证人）。
 *  每台只改一处、跑一次判卷、要求红在**不同用例**上；跑完立即用备份逐字节复原并 cmp。
 *  跑法（在干净树里）：node --import tsx /tmp/p338-redmachines-ze.mjs <树根> */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, cpSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripAnsi } from "./scripts/lib/vitest-summary.js";

const TREE = process.argv[2];
if (!TREE) { console.error("用法：node --import tsx /tmp/p338-redmachines-ze.mjs <树根>"); process.exit(2); }
const CYC = join(TREE, "scripts/lib/arch-cycles.ts");
const CLI = join(TREE, "scripts/arch-cycle-check.ts");
const DEBT = join(TREE, "scripts/lib/arch-cycle-debt.ts");
const backup = mkdtempSync(join(tmpdir(), "p338-bak-"));
for (const [tag, p] of [["cyc", CYC], ["cli", CLI], ["debt", DEBT]]) cpSync(p, join(backup, tag + ".ts"));
const src = { cyc: readFileSync(CYC, "utf8"), cli: readFileSync(CLI, "utf8"), debt: readFileSync(DEBT, "utf8") };

/** 一台＝一枚改动。`needle` 必须在盘上逐字命中一次——命中 0 次的机器等于没跑（空操作变异）。 */
const MACHINES = [
  { name: "A 谓词取反：单节点也算圈", file: "cyc", from: "if (comp.length >= 2) out.push(comp.sort());", to: "if (comp.length >= 1) out.push(comp.sort());" },
  { name: "B 漏掉 lowlink 交回父帧（该合成的圈合成不出来＝漏报）", file: "cyc", from: "          low.set(parent.v, Math.min(low.get(parent.v) ?? Number.POSITIVE_INFINITY, childLow));", to: "          void childLow; // 故意不交回父帧" },
  { name: "C 类型边也入图（A6 说的那 4 个假圈回来）", file: "cli", from: "    if (ir.typeOnly) { typeOnlySkipped++; continue; }", to: "    if (false && ir.typeOnly) { typeOnlySkipped++; continue; }" },
  { name: "D 登记表里那条债改成乱序（与 found 的规范化对不上）", file: "debt", from: `["src/agent/glm-session.ts", "src/agent/memory/inject.ts", "src/agent/memory/lessons.ts", "src/agent/worker-shell-tools.ts", "src/agent/write-face.ts"],`, to: `["src/agent/write-face.ts", "src/agent/glm-session.ts", "src/agent/memory/inject.ts", "src/agent/memory/lessons.ts", "src/agent/worker-shell-tools.ts"],` },
  { name: "E 退出码写死成 0（新圈红也不出声）", file: "cli", from: "process.exit(findings.length === 0 ? 0 : 1);", to: "process.exit(0);" },
];

const failedCases = (out) => [...out.matchAll(/^\s*[×x]\s+(.+?)(?:\s+\d+ms)?$/gmu)].map((m) => m[1].trim());
const results = [];
for (const m of MACHINES) {
  const cur = src[m.file];
  const hits = cur.split(m.from).length - 1;
  if (hits !== 1) { results.push({ ...m, hits, red: "针脚命中 " + String(hits) + " 处 ⇒ 这台没跑（先修针脚）", cases: [] }); continue; }
  writeFileSync(join(TREE, m.file === "cyc" ? "scripts/lib/arch-cycles.ts" : m.file === "cli" ? "scripts/arch-cycle-check.ts" : "scripts/lib/arch-cycle-debt.ts"), cur.replace(m.from, m.to));
  const r = spawnSync("node", ["node_modules/vitest/vitest.mjs", "run", "--config", "tests/vitest.config.ts", "tests/arch-cycle-check.test.ts"], { cwd: TREE, encoding: "utf8" });
  const out = stripAnsi(r.stdout + r.stderr);
  const summary = (out.match(/Tests\s+(.+)/u) ?? [])[1] ?? "读不到汇总行";
  results.push({ name: m.name, hits, red: r.status !== 0 ? "红" : "绿 ⇒ 这台没分辨力！", summary, cases: failedCases(out) });
  writeFileSync(join(TREE, m.file === "cyc" ? "scripts/lib/arch-cycles.ts" : m.file === "cli" ? "scripts/arch-cycle-check.ts" : "scripts/lib/arch-cycle-debt.ts"), cur);
}
console.log("=== 造红读数");
for (const r of results) {
  console.log(`${r.name}\n  针脚命中 ${String(r.hits)} ｜结果 ${r.red}｜汇总 ${r.summary ?? ""}`);
  for (const c of (r.cases ?? []).slice(0, 4)) console.log(`    ❌ ${c}`);
}
const seen = new Map();
for (const r of results) for (const c of r.cases ?? []) { if (seen.has(c)) console.log(`⚠️ 两台红在同一条用例：${c}（＝其中一台没分辨力）`); seen.set(c, (seen.get(c) ?? 0) + 1); }
console.log("=== 复原校验（逐字节）");
for (const [tag, p] of [["cyc", CYC], ["cli", CLI], ["debt", DEBT]]) {
  const same = readFileSync(p, "utf8") === readFileSync(join(backup, tag + ".ts"), "utf8");
  console.log(`  ${tag}: ${same ? "与备份逐字节一致 ✅" : "不一致 ❌ 残骸！"}`);
}
