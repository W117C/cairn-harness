/** 第 334 页 四台造红（#41 第一半：认证那一趟的「温度」要落进工件）。
 *  逐台＝把本笔四条锚点的 apply 原样抄过来（针脚与改法必须与表里一致，否则这台红不算锚点的红），
 *  备份 → 单点替换（命中数必须为 1）→ 只跑 tests/head-cert-provenance.test.ts → 记下红的用例标题 → 复原并逐字节校验。
 *  用法：node outputs/cert-provenance-2026-10-04/red-machine-334.mjs（读数由调用方 tee 到 red-machine-334.log） */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, copyFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const SUITE = "tests/head-cert-provenance.test.ts";
const stripAnsi = (s) => s.replace(/\u001b\[[0-9;]*m/gu, "");
const ART = "outputs/cert-provenance-2026-10-04";

const MACHINES = [
  {
    tag: "M1 摘掉 measured 那一半（scripts/lib/head-cert-provenance.ts）",
    id: "cert-provenance-unknown-branch-dropped",
    file: "scripts/lib/head-cert-provenance.ts",
    from: '  if (!measured || before < 0 || after < 0) return "unknown";',
    to: '  if (before < 0 || after < 0) return "unknown";',
  },
  {
    tag: "M2 摘掉头部温度那一行（scripts/lib/head-cert-provenance.ts）",
    id: "cert-provenance-doc-temperature-line-dropped",
    file: "scripts/lib/head-cert-provenance.ts",
    from: '    `- ${citableLine(o.citable)}`,',
    to: "    ``,",
  },
  {
    tag: "M3 温度写死成 citable（scripts/head-cert.ts）",
    id: "cert-provenance-wiring-hardcoded",
    file: "scripts/head-cert.ts",
    from: "  const citable = citableOf(psBefore, psAfter, testStatus !== null);",
    to: '  const citable = "citable" as const; void citableOf;',
  },
  {
    tag: "M4 把冒号放回时间戳（scripts/lib/head-cert-provenance.ts）",
    id: "cert-provenance-stamp-colon-back",
    file: "scripts/lib/head-cert-provenance.ts",
    from: 'return m === null ? "未知时刻" : `${m[1]}-${m[2]}${m[3]}`;',
    to: 'return m === null ? "未知时刻" : `${m[1]}-${m[2]}:${m[3]}`;',
  },
  {
    tag: "M5 摘掉头部生成时刻那一行（scripts/lib/head-cert-provenance.ts）",
    id: "cert-provenance-head-stamp-line-dropped",
    file: "scripts/lib/head-cert-provenance.ts",
    from: '`- 生成时刻=${o.stamp}（UTC',
    to: '`（UTC',
  },
];

const results = [];
const only = process.argv[2] ?? "";
for (const m of MACHINES) {
  if (only !== "" && !m.tag.startsWith(only) && m.id !== only) continue;
  const path = join(ROOT, m.file);
  const bak = join(ROOT, `${ART}/${m.file.split("/").pop()}.red-machine.bak`);
  const original = readFileSync(path, "utf8");
  const hits = original.split(m.from).length - 1;
  if (hits !== 1) {
    console.log(`\n### ${m.tag}\n针脚命中 ${String(hits)} 处（必须 1）⇒ 这台不改，先看量法`);
    results.push({ tag: m.tag, hits, failed: [] });
    continue;
  }
  copyFileSync(path, bak);
  writeFileSync(path, original.replace(m.from, m.to));
  const r = spawnSync(process.execPath, ["node_modules/vitest/vitest.mjs", "run", "--config", "tests/vitest.config.ts", SUITE],
    { cwd: ROOT, encoding: "utf8" });
  const out = stripAnsi(r.stdout + r.stderr);
  const failed = [...new Set(
    out.split("\n")
      .filter((l) => /^\s*×\s+\S/u.test(l))
      .map((l) => l.replace(/^\s*×\s+/u, "").replace(/\s+\d+(\.\d+)?\s*(ms|s)$/u, "").trim()),
  )];
  const summary = out.split("\n").filter((l) => /Test Files|Tests\s/u.test(l)).map((l) => l.trim());
  results.push({ tag: m.tag, hits, exit: r.status, failed, files: summary[0] ?? "", tests: summary[1] ?? "" });
  console.log(`\n### ${m.tag}（锚点 ${m.id}）`);
  console.log(`退出码 ${String(r.status)}｜用例级红 ${String(failed.length)} 条`);
  for (const t of failed) console.log("  × " + t);
  for (const s of summary) console.log("  | " + s);
  copyFileSync(bak, path);
  const back = readFileSync(path, "utf8");
  console.log("  复原逐字节一致 = " + String(back === original));
  rmSync(bak);
  if (back !== original) {
    console.log("  ❌ 复原失败，停在这里（不要用 git checkout 兜——那会抹掉别人在飞改动）");
    process.exit(3);
  }
}
console.log("\n=== 汇总（每台应有自己那条红，两台同条＝其中一条没分辨力）===");
const seen = new Map();
for (const x of results) {
  console.log(`${x.tag} ⇒ 红 ${String(x.failed.length)} 条：${x.failed.map((f) => f.slice(0, 40)).join(" ／ ") || "（无）"}`);
  for (const f of x.failed) seen.set(f.slice(0, 40), [...(seen.get(f.slice(0, 40)) ?? []), x.tag.slice(0, 2)]);
}
const dup = [...seen.entries()].filter(([, v]) => v.length > 1);
console.log(dup.length === 0
  ? `✅ ${String(results.length)} 台红在 ${String(results.length)} 条不同用例上（每台各有自己那一格分辨力）`
  : `❌ 有 ${String(dup.length)} 条用例被两台同时打红：${dup.map(([k, v]) => `${k}←${v.join("+")}`).join(" ／ ")}`);
