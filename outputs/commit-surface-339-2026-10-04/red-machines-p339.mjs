/** 第 339 页 · commit-surface 尺的造红四台＋一台（判卷层，不碰 CLI 的取料）。
 *  每台改一处、跑一次判卷、要求红在不同用例；跑完逐字节复原并校验。
 *  跑法：node --import tsx redmachines-p339.mjs <树根> */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { stripAnsi } from "./scripts/lib/vitest-summary.js";

const TREE = process.argv[2];
if (!TREE) { console.error("缺树根参数"); process.exit(2); }
const LIB = join(TREE, "scripts/lib/commit-surface.ts");
const CLI = join(TREE, "scripts/commit-surface-check.ts");
const orig = { lib: readFileSync(LIB, "utf8"), cli: readFileSync(CLI, "utf8") };
const backupDir = mkdtempSync(join(process.env["TMPDIR"] ?? "/tmp", "p339-bak-"));
writeFileSync(join(backupDir, "lib.ts"), orig.lib);
writeFileSync(join(backupDir, "cli.ts"), orig.cli);

const MACHINES = [
  { name: "A blob 不同也报「一致」（该出声不出声＝这一格永远绿）", file: "lib", from: 'kind = h === i ? "aligned" : "staleInIndex";', to: 'kind = "aligned";' },
  { name: "B 别人新暂存被读成「index 缺」（误报方向：把邻座的在飞算成我的债）", file: "lib", from: 'else kind = "stagedNew";', to: 'else kind = "missingInIndex";' },
  { name: "C landedGap 不再问哪一格坏（返回该笔全部路径＝误报）", file: "lib", from: "return [...new Set(revTouched)].filter((p) => bad.has(p)).sort();", to: "void bad; return [...new Set(revTouched)].sort();" },
  { name: "D 门名匹配不剥扩展名（9 道门全被读成非门）", file: "lib", from: "const stem = base.replace(/\\.mjs$/, \"\").replace(/\\.ts$/, \"\");", to: "const stem = base;" },
  { name: "E 写动作漏出 --sync 分支（自动同步别人的暂存面）", file: "cli", from: "const face = gateFaceDiff(dirtyScripts, GATES);", to: 'if (gap.length > 0) execFileSync("git", ["update-index", "--add", "--cacheinfo", `100644,x,${gap[0]}`], { cwd: ROOT });\nconst face = gateFaceDiff(dirtyScripts, GATES);' },
];

const cases = (out) => [...out.matchAll(/^\s*[×x]\s+(.+?)(?:\s+\d+ms)?$/gmu)].map((m) => m[1].trim());
const rows = [];
for (const m of MACHINES) {
  const cur = orig[m.file];
  const hits = cur.split(m.from).length - 1;
  if (hits !== 1) { rows.push({ ...m, hits, verdict: `针脚命中 ${String(hits)} 处 ⇒ 这台没跑`, list: [] }); continue; }
  const path = m.file === "lib" ? LIB : CLI;
  writeFileSync(path, cur.replace(m.from, m.to));
  const r = spawnSync("node", ["node_modules/vitest/vitest.mjs", "run", "--config", "tests/vitest.config.ts", "tests/commit-surface-check.test.ts"], { cwd: TREE, encoding: "utf8" });
  const out = stripAnsi(r.stdout + r.stderr);
  rows.push({ name: m.name, hits, verdict: r.status !== 0 ? "红" : "绿 ⇒ 这台没有分辨力", list: cases(out), summary: (out.match(/Tests\s+(.+)/u) ?? [])[1] ?? "" });
  writeFileSync(path, cur);
}
console.log("=== commit-surface 造红读数");
for (const r of rows) {
  console.log(`${r.name}\n  针脚 ${String(r.hits)} ｜ ${r.verdict}｜${r.summary ?? ""}`);
  for (const c of r.list.slice(0, 4)) console.log(`    ❌ ${c}`);
}
const seen = new Map();
for (const r of rows) for (const c of r.list) { if (seen.has(c)) console.log(`⚠️ 两台红在同一条用例：${c}`); seen.set(c, 1); }
console.log("=== 复原校验");
for (const [tag, p] of [["lib", LIB], ["cli", CLI]]) {
  console.log(`  ${tag}: ${readFileSync(p, "utf8") === readFileSync(join(backupDir, tag + ".ts"), "utf8") ? "与备份逐字节一致 ✅" : "不一致 ❌ 残骸"}`);
}
