// 变异验证器：证明单元测试不是恒真的（make-neg-controls.mjs 的逻辑层泛化）。
//
// 理念：门禁体检只能静态查出「恒真式/空断言」；一条断言即便非空，也可能根本不针对
// 被测逻辑。唯一可靠的经验证法是**注入一处行为突变，看测试是否真的红**：
//   存活（mutation survived）= 测试对该逻辑无分辨力 = 恒真式等价物。
// 这把「我觉得代码能跑」变成「我证明了换掉这段逻辑，验收会抓住」。
//
// 用法：
//   node scripts/mutate-verify.mjs                 # 跑配置表里全部条目
//   node scripts/mutate-verify.mjs <id>            # 只跑一条
//   node scripts/mutate-verify.mjs --list          # 列出条目
//
// 安全：被测源文件先备份，finally 原样还原；进程退出前强制再校验一次
// `git diff HEAD --quiet`——还原失败即判红，绝不把突变留在工作树里。
// （与 M7 在飞集零相交：只动自己登记的源文件，且进出都校验零 diff。）

import { cpSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const VITEST = join(ROOT, "node_modules/vitest/vitest.mjs");

/** 变异配置表：每条 = 一处语义突变 + 期望被它杀死的具体用例标题。新增模块只追加。 */
const MUTATIONS = [
  {
    id: "cascade-fail-closed",
    src: "src/routing/cascade.ts",
    test: "tests/cascade.test.ts",
    desc: "去掉 fail-closed：无客观判据时也升级（放行）",
    apply: (s) => s.replace("if (!opts.hasJudge)", "if (false)"),
    expectFail: "失败但无客观判据 → fail-closed 不升级、不猜",
  },
  {
    id: "cascade-max-rungs",
    src: "src/routing/cascade.ts",
    test: "tests/cascade.test.ts",
    desc: "去掉 maxRungs 上限检查（允许无限爬升）",
    apply: (s) => s.replace("if (upgrades >= maxRungs)", "if (false)"),
    expectFail: "达到 maxRungs 上限不再爬升（防无限升级）",
  },
  {
    id: "frozen-s3-9",
    src: "src/frozen.ts",
    test: "tests/frozen-drift.test.ts",
    desc: "S3-9 原 bug 复活：清单单文件无条件计入盘上集合（掩盖判卷文件消失）",
    apply: (s) => s.replace(
      "if (await stat(join(root, f)).then(() => true, () => false))",
      "if (true)",
    ),
    expectFail: "S3-9 回归：gym/index.json 不存在时不算入盘上集合（不掩盖判卷文件消失）",
  },
];

function runTest(testRel) {
  try {
    const out = execFileSync(process.execPath, [
      VITEST, "run", "--pool=threads", "--config", "tests/vitest.config.ts", testRel,
    ], { cwd: ROOT, env: { ...process.env, TERM: "dumb" }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout ?? "") + (e.stderr ?? "") };
  }
}

function verifyEntry(m) {
  const srcAbs = join(ROOT, m.src);
  const backup = `${srcAbs}.mutbak`;
  const original = readFileSync(srcAbs, "utf8");
  cpSync(srcAbs, backup);
  let restored = false;
  try {
    // ① 基线：突变前该测试必须绿
    const base = runTest(m.test);
    if (base.code !== 0) return { m, ok: false, why: `基线就不是全绿（不应发生）:\n${base.out.slice(-800)}` };

    // ② 注入突变
    const mutated = m.apply(original);
    if (mutated === original) return { m, ok: false, why: "突变未生效（锚点可能已失效）" };
    writeFileSync(srcAbs, mutated);

    // ③ 突变后必须红，且红在期望的那条用例上
    const hit = runTest(m.test);
    writeFileSync(srcAbs, original); // 尽早还原
    restored = true;
    if (hit.code === 0) return { m, ok: false, why: "变异存活：测试全绿 = 对该逻辑无分辨力（恒真等价）" };
    if (!hit.out.includes(m.expectFail)) {
      return { m, ok: false, why: `测试红了但没红在期望用例「${m.expectFail}」上——可能误伤无关用例:\n${hit.out.slice(-800)}` };
    }
    // ④ 还原后必须恢复全绿
    const back = runTest(m.test);
    if (back.code !== 0) return { m, ok: false, why: `还原后未恢复全绿:\n${back.out.slice(-800)}` };
    return { m, ok: true };
  } finally {
    if (!restored) writeFileSync(srcAbs, original);
    rmSync(backup, { force: true });
  }
}

const args = process.argv.slice(2);
if (args.includes("--list")) {
  for (const m of MUTATIONS) console.log(`${m.id}\t${m.src}\t${m.desc}`);
  process.exit(0);
}

const targets = args.filter((a) => !a.startsWith("--"));
const entries = targets.length ? MUTATIONS.filter((m) => targets.includes(m.id)) : MUTATIONS;
if (targets.length && entries.length !== targets.length) {
  console.error(`未知 id: ${targets.filter((t) => !MUTATIONS.some((m) => m.id === t)).join(", ")}`);
  process.exit(2);
}

console.log(`变异验证：${entries.length} 条`);
const results = entries.map((m) => {
  const r = verifyEntry(m);
  console.log(`${r.ok ? "✅" : "❌"} ${m.id} — ${m.desc}`);
  if (!r.ok) console.log(`   ${r.why}`);
  return r;
});

// 强制收尾校验：所有被测源文件必须零 diff（还原失败 = 判红）
const srcs = [...new Set(entries.map((m) => m.src))];
const leftover = execFileSync("git", ["diff", "HEAD", "--name-only", "--", ...srcs], {
  cwd: ROOT, encoding: "utf8",
}).trim();
if (leftover) {
  console.error(`⚠️ 还原失败，以下源文件残留突变（必须人工检查）：\n${leftover}`);
  process.exit(1);
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${failed.length === 0 ? "全部变异被正确杀死（断言非恒真）" : `${failed.length} 条变异存活或误伤`}`);
process.exit(failed.length === 0 ? 0 : 1);
