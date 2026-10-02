// 第 302 页的造红台（一次性取证脚本，跑完即复原 ⇒ 不进 package.json 的门表）。
//
// 为什么要单独一份：`pnpm mutate-verify` 量的是 **HEAD**，而这一笔的尺与针脚是同一笔落库的
// （规则 217）——落库前没有任何东西能验「这九条锚点的判卷真会红」。所以这里在工作树上逐台改、
// 逐台跑、逐台用备份复原，并且每台都核：
//   ⑴ 改前那一串在被改文件里**恰好 1 处**（0 处＝空操作，2 处＝钉不准）；
//   ⑵ 复原后与备份**逐字节相同**（`cmp` 由调用方在外面再核一遍）；
//   ⑶ 读 `Tests …` 摘要前先 stripAnsi（复用 `scripts/lib/vitest-summary.ts` 那一支，不另抄正则）。
import { execFileSync } from "node:child_process";
import { copyFileSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = resolve(import.meta.dirname, "..", "..");
const { vitestSummary } = await import(pathToFileURL(resolve(ROOT, "scripts/lib/vitest-summary.ts")).href);

const FILE = (rel) => resolve(ROOT, rel);
const MACHINES = [
  { name: "M1-stopword-gate-never-drops", file: "src/agent/map/retrieve.ts", old: "Math.max(3, Math.floor(n * ratio))", new: "Math.max(3, n)" },
  { name: "M2-corpus-from-empty-summary", file: "src/agent/map/build.ts", old: 'summary: i.summary ?? ""', new: 'summary: ""' },
  { name: "M3-budget-not-deducted", file: "src/agent/map/build.ts", old: "budgetAfterRetrievalLine(budget, prefix)", new: "budget" },
  { name: "M4-line-not-prepended", file: "src/agent/map/build.ts", old: "const text = prefix + rendered.text;", new: "const text = rendered.text;" },
  { name: "M5-cache-guard-two-exits-only", file: "src/agent/map/build.ts", old: ' && typeof e.summary === "string"', new: "" },
  { name: "M6-session-does-not-pass-query", file: "src/agent/glm-session.ts", old: "queryText: lastUserContent(events),", new: "" },
  { name: "M7-javadoc-only-first-line", file: "src/agent/map/retrieve.ts", old: "inBlock = true;", new: "inBlock = false;" },
];

function runVitest() {
  let out = "";
  let code = 0;
  try {
    out = execFileSync("node", [
      "node_modules/vitest/vitest.mjs", "run", "--config", "tests/vitest.config.ts", "tests/map-retrieval.test.ts",
    ], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 300_000 });
  } catch (err) {
    out = String(err.stdout ?? "") + String(err.stderr ?? "");
    code = typeof err.status === "number" ? err.status : -1;
  }
  const summary = vitestSummary(out);
  const plain = out.replace(/\x1b\[[0-9;]*m/g, "");
  const cases = plain.split("\n").filter((l) => /^\s+[×✓]/u.test(l)).map((l) => l.trim());
  const failed = cases.filter((l) => l.startsWith("×")).map((l) => l.slice(2).trim());
  return { code, summary, failedCount: failed.length, failed, duration: /Duration\s+([\d.]+\s*m?s)/u.exec(plain)?.[1] ?? "?" };
}

console.log(`# 造红台 基准（未改任何文件）`);
{
  const base = runVitest();
  console.log(`  exit=${String(base.code)} tests=${JSON.stringify(base.summary)} 用时=${base.duration}`);
  if (base.code !== 0 || base.summary.found === false || base.summary.failed !== 0) {
    console.log("  ❌ 基准不绿 ⇒ 后面的每台红都说明不了任何事，先修基准");
    process.exit(1);
  }
  console.log("  ✅ 基准全绿");
}

const restored = [];
for (const m of MACHINES) {
  const path = FILE(m.file);
  const bak = `/tmp/dsh-lex-${m.name}.bak`;
  const src = readFileSync(path, "utf8");
  const hits = src.split(m.old).length - 1;
  copyFileSync(path, bak);
  process.stdout.write(`# ${m.name}  ${m.file}  命中=${String(hits)} 处\n`);
  if (hits !== 1) {
    console.log(`  ❌ 针脚命中 ${String(hits)} 处（要求恰好 1）⇒ 这台不算分辨力证据，跳过`);
    rmSync(bak, { force: true });
    continue;
  }
  const mutated = src.replace(m.old, m.new);
  if (readFileSync(path, "utf8") !== src) { console.log("  ❌ 备份之后文件被改动过（撞窗？）⇒ 停，先查谁在写"); rmSync(bak, { force: true }); process.exit(1); }
  const t0 = Date.now();
  let r = { code: -1, summary: { found: false, failed: -1, passed: -1 }, failedCount: 0, failed: [], duration: "?" };
  try {
    writeFileSync(path, mutated, "utf8"); // 就地改（与变异机同一形状），复原放在 finally：被杀掉也不留残骸
    r = runVitest();
  } finally {
    copyFileSync(bak, path);
    rmSync(bak, { force: true });
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(2);
  const same = readFileSync(path, "utf8") === src;
  restored.push(`${m.name}:${same ? "复原一致" : "复原不一致"}`);
  console.log(`  exit=${String(r.code)} 摘要=${JSON.stringify(r.summary)} 红用例=${String(r.failedCount)} 条 用时=${secs}s`);
  for (const f of r.failed) console.log(`    × ${f}`);
  console.log(`  复原：${same ? "✅ 与备份逐字节一致" : "❌ 不一致，立刻手工核对"}`);
  if (r === undefined || r.code === 0 || r.failedCount === 0) console.log("  ❌ 这台**没红** ⇒ 那条断言对这种坏法零分辨力");
}
console.log(`# 复原汇总 ${JSON.stringify(restored)}`);
console.log(`# 残骸清点 /tmp/dsh-lex-*.bak 剩余=${String(execFileSync("sh", ["-c", "ls /tmp/dsh-lex-*.bak 2>/dev/null | wc -l | tr -d ' '"]).toString().trim())}`);
