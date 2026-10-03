/** 第 328 页 · 五台造红：「谁在读这段文本」这把尺的四态归位与那顶帽。
 *  一台一种病、各红在不同用例（第 324 页买进来的那条纪律）。 */
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { stripAnsi, vitestSummary } from "../../scripts/lib/vitest-summary.ts";

const ROOT = join(import.meta.dirname, "../..");
const JUDGE = "tests/text-readers.test.ts";

const MACHINES = [
  {
    id: "M1-string-contents-scanned-as-code",
    target: "scripts/lib/text-readers.ts",
    from: '    if (top.kind === "str") {',
    to: "    if (false) {",
    expectCase: "★合成源码字符串里的假调用不算（第 328 页现读：全文正则量出 403 处，其中 27 处躺在夹具正文里）",
  },
  {
    id: "M2-template-interpolation-not-code",
    target: "scripts/lib/text-readers.ts",
    from: '{ stack.push({ kind: "tmpl-expr", depth: 0 }); i += 2; continue; }',
    to: "{ i += 2; continue; }",
    expectCase: "但模板串插值里的真调用要算——整段跳过会把这一格吞掉",
  },
  {
    id: "M3-dynamic-merged-into-unknown",
    target: "scripts/lib/text-readers.ts",
    from: 'return { shape: "dynamic-identifier", kind: "dynamic", rel: null };',
    to: 'return { shape: "unknown", kind: "unknown", rel: null };',
    expectCase: "运行期路径的每一子形状分开印，且绝不并进「形状不认识」（帽是 0，混一次就永远红）",
  },
  {
    id: "M4-target-missing-counted-as-reader",
    target: "scripts/lib/text-readers.ts",
    from: "      if (h.target === null || h.targetMissing) continue;",
    to: "      if (h.target === null) continue;",
    expectCase: "仓外面（node_modules／临时盘）、指不到盘上文件的字面量、判卷读自己——三种都不进清单",
  },
  {
    id: "M5-cap-guard-dead",
    target: "scripts/text-reader-check.ts",
    from: "if (unknown > UNKNOWN_CAP) {",
    to: "if (false) {",
    expectCase: "★接线 CLI 吃的是代码态扫描器与那张帽，不是全文正则（旧写法不许回来）",
  },
];

const escapePattern = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

function runJudge(pattern: string): { code: number; sum: ReturnType<typeof vitestSummary>; failLines: string[]; ms: number } {
  const t0 = Date.now();
  let out = "";
  let code = 0;
  try {
    out = execFileSync("node", ["node_modules/vitest/vitest.mjs", "run", "--config", "tests/vitest.config.ts", JUDGE, "--testNamePattern=" + escapePattern(pattern)], {
      cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
    });
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; status?: number };
    out = (err.stdout ?? "") + (err.stderr ?? "");
    code = err.status ?? -1;
  }
  return { code, sum: vitestSummary(out), failLines: stripAnsi(out).split("\n").filter((l) => l.includes("FAIL")), ms: Date.now() - t0 };
}

const scratch = mkdtempSync(join(tmpdir(), "textreaders328-red-"));
let bad = 0;
const texts0 = new Map<string, string>();
try {
  for (const m of MACHINES) {
    const abs = join(ROOT, m.target);
    const bakName = m.target.replaceAll("/", "__") + ".bak";
    if (!texts0.has(m.target)) texts0.set(m.target, readFileSync(abs, "utf8"));
    copyFileSync(abs, join(scratch, bakName));
    const text0 = texts0.get(m.target)!;
    const hits = text0.split(m.from).length - 1;
    const base = runJudge(m.expectCase);
    console.log(`${m.id} 基线：passed=${String(base.sum.passed)} failed=${String(base.sum.failed)} found=${String(base.sum.found)}（${String(base.ms)}ms）`);
    if (!base.sum.found || base.sum.passed !== 1 || base.sum.failed !== 0) {
      console.log(`❌ ${m.id} 选择子基线不对 ⇒ 这台没跑（先查判卷能不能收集，再怀疑选择子）`);
      bad += 1;
    } else if (hits !== 1) {
      console.log(`❌ ${m.id} 针脚命中 ${String(hits)} 处（必须恰好 1 处）⇒ 这台没跑`);
      bad += 1;
    } else {
      writeFileSync(abs, text0.replace(m.from, m.to));
      const mut = runJudge(m.expectCase);
      if (!mut.sum.found) {
        console.log(`❌ ${m.id} 读不到 Tests 摘要行 ⇒ 退出码 ${String(mut.code)}`);
        bad += 1;
      } else if (mut.sum.failed !== 1 || !mut.failLines.some((l) => l.includes(m.expectCase))) {
        console.log(`❌ ${m.id} 没红在该当的那条用例上：failed=${String(mut.sum.failed)}｜FAIL 行 ${String(mut.failLines.length)} 条`);
        bad += 1;
      } else {
        console.log(`✅ ${m.id} 红在「${m.expectCase}」（failed=1，${String(mut.ms)}ms，退 ${String(mut.code)}）`);
      }
      copyFileSync(join(scratch, bakName), abs);
    }
    if (readFileSync(abs, "utf8") !== text0) {
      console.log(`❌ ${m.id} 复原与开跑前不一致：${m.target}`);
      bad += 1;
    }
  }
  if (bad === 0) console.log("残骸校验：两支被测文件与开跑前逐字节一致 ✅");
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
mkdirSync(join(import.meta.dirname), { recursive: true });
console.log(bad === 0 ? "RED_MACHINES=OK" : `RED_MACHINES=BAD(${String(bad)})`);
process.exitCode = bad === 0 ? 0 : 1;
