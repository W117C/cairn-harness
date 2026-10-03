/** 第 333 页 四台造红（#40：派生必然为 0 的提示要在开树之前出声）。
 *  逐台：备份 → 单点替换（命中数必须为 1）→ 只跑 `tests/mutate-verify-gates.test.ts` → 记下红的用例标题 → 复原并逐字节校验。
 *  用法：node outputs/pre-tree-hint-2026-10-03/red-machine-333.mjs（读数由调用方 tee 到 red-machine-333.log） */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, copyFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const SUITE = "tests/mutate-verify-gates.test.ts";
const stripAnsi = (s) => s.replace(/\u001b\[[0-9;]*m/gu, "");

const MACHINES = [
  {
    tag: "M1 摘掉开树前的那句打印（scripts/mutate-verify.mjs）",
    file: "scripts/mutate-verify.mjs",
    from: "prevRev });\n      if (hint !== null) console.log(",
    to: "prevRev });\n      if (hint !== null && false) console.log(",
  },
  {
    tag: "M2 gitOk 挪成常量（scripts/mutate-verify.mjs）",
    file: "scripts/mutate-verify.mjs",
    from: 'split("\\n"), gitOk: diff.status === 0',
    to: 'split("\\n"), gitOk: false',
  },
  {
    tag: "M3 摘掉「取不到」那一支（scripts/lib/mutate-gates.ts）",
    file: "scripts/lib/mutate-gates.ts",
    from: "  if (!mat.gitOk) {",
    to: "  if (false) {",
  },
  {
    tag: "M4 every 改成 some（scripts/lib/mutate-gates.ts）",
    file: "scripts/lib/mutate-gates.ts",
    from: "  if (files.every(isLedger)) {",
    to: "  if (files.some(isLedger)) {",
  },
];

const results = [];
const only = process.argv[2] ?? "";
for (const m of MACHINES) {
  if (only !== "" && !m.tag.startsWith(only)) continue;
  const path = join(ROOT, m.file);
  const bak = join(ROOT, `outputs/pre-tree-hint-2026-10-03/${m.file.split("/").pop()}.red-machine.bak`);
  const original = readFileSync(path, "utf8");
  const hits = original.split(m.from).length - 1;
  if (hits !== 1) { console.log(`\n### ${m.tag}\n针脚命中 ${String(hits)} 处（必须 1）⇒ 这台不改，先看量法`); results.push({ tag: m.tag, hits, failed: [] }); continue; }
  copyFileSync(path, bak);
  writeFileSync(path, original.replace(m.from, m.to));
  const r = spawnSync(process.execPath, ["node_modules/vitest/vitest.mjs", "run", "--config", "tests/vitest.config.ts", SUITE],
    { cwd: ROOT, encoding: "utf8" });
  const out = stripAnsi(r.stdout + r.stderr);
  const failed = [...new Set([...out.matchAll(/^\s*×\s*(.+?)\s+\d+ms\s*$/gmu)].map((x) => x[1]))];
  const summary = out.split("\n").filter((l) => /Test Files|Tests\s/.test(l)).map((l) => l.trim());
  results.push({ tag: m.tag, hits, exit: r.status, failed, files: summary[0] ?? "", tests: summary[1] ?? "" });
  console.log(`\n### ${m.tag}`);
  console.log(`退出码 ${String(r.status)}｜用例级红 ${String(failed.length)} 条`);
  for (const t of failed) console.log("  × " + t);
  for (const s of summary) console.log("  | " + s);
  copyFileSync(bak, path);
  const back = readFileSync(path, "utf8");
  console.log("  复原逐字节一致 = " + String(back === original));
  rmSync(bak);
  if (back !== original) { console.log("  ❌ 复原失败，停在这里（不要用 git checkout 兜——那会抹掉别人在飞改动）"); process.exit(3); }
}
console.log("\n=== 汇总（每台应有自己那条红，两台同条＝其中一条没分辨力）===");
for (const x of results) console.log(`${x.tag} ⇒ 红 ${String(x.failed.length)} 条：${x.failed.map((f) => f.slice(0, 46)).join(" ／ ") || "（无）"}`);
