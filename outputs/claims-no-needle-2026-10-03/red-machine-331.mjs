/** 第 331 页 三台造红（#34：第四态「尺读不出」有帽＋接线）。
 *  逐台：备份 → 单点替换（替换命中数必须为 1）→ 只跑那一支判卷 → 记下红的用例标题 → cmp 复原。
 *  用法：node outputs/claims-no-needle-2026-10-03/red-machine-331.mjs
 *  读数写进 outputs/claims-no-needle-2026-10-03/red-machine-331.log（由调用方 tee）。 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, copyFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const SRC = join(ROOT, "scripts/probe-promise-recall.ts");
const SUITE = "tests/promise-recall-inventory.test.ts";
const BAK = join(ROOT, "outputs/claims-no-needle-2026-10-03/probe.ts.red-machine.bak");
const stripAnsi = (s) => s.replace(/\u001b\[[0-9;]*m/gu, "");

const MACHINES = [
  {
    tag: "M1 第四态并进欠证人",
    from: "    if (runs.length === 0) { noNeedle.push(k); continue; }",
    to: "    if (runs.length === 0) { unwitnessed.push(k); continue; }",
  },
  {
    tag: "M2 帽抬一档",
    from: "export const CLAIM_NO_NEEDLE_CAP = 5;",
    to: "export const CLAIM_NO_NEEDLE_CAP = 6;",
  },
  {
    tag: "M3 接线摘掉（拿常量喂读数）",
    from: "const needleCeil = claimCountCeiling(cf.noNeedle.length, CLAIM_NO_NEEDLE_CAP);",
    to: "const needleCeil = claimCountCeiling(0, CLAIM_NO_NEEDLE_CAP);",
  },
];

copyFileSync(SRC, BAK);
const original = readFileSync(SRC, "utf8");
const results = [];
for (const m of MACHINES) {
  const hits = original.split(m.from).length - 1;
  if (hits !== 1) { results.push({ ...m, hits, note: "针脚命中数不是 1，跳过" }); continue; }
  writeFileSync(SRC, original.replace(m.from, m.to));
  const r = spawnSync(process.execPath, ["node_modules/vitest/vitest.mjs", "run", "--config", "tests/vitest.config.ts", SUITE],
    { cwd: ROOT, encoding: "utf8" });
  const out = stripAnsi(r.stdout + r.stderr);
  const failed = [...out.matchAll(/^\s*(?:×|✗|FAIL ✕)?\s*×\s*(.+?)\s*$/gmu)].map((x) => x[1]);
  const uniq = [...new Set(failed)];
  const summary = out.split("\n").filter((l) => /Test Files|Tests\s/.test(l)).map((l) => l.trim());
  results.push({ tag: m.tag, hits, exit: r.status, failed: uniq, summary });
  console.log(`\n### ${m.tag}`);
  console.log(`退出码 ${String(r.status)}｜用例级红 ${String(uniq.length)} 条`);
  for (const t of uniq) console.log("  × " + t);
  for (const s of summary) console.log("  | " + s);
}
// 复原：逐字节校验，不许用 git checkout（那会连带抹掉别人的在飞改动）
copyFileSync(BAK, SRC);
const back = readFileSync(SRC, "utf8");
console.log("\n复原：逐字节一致 = " + String(back === original) + "｜残骸（与备份不等）= " + String(back !== original));
rmSync(BAK);
const leftovers = spawnSync("git", ["status", "--porcelain", SRC], { cwd: ROOT, encoding: "utf8" }).stdout;
console.log("残骸检查（本笔自己的改动应仍在，且只含本页内容）：\n" + leftovers);
console.log(JSON.stringify(results.map((x) => ({ tag: x.tag, exit: x.exit, failed: x.failed })), null, 1));
