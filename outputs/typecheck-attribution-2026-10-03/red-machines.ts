/** 第 330 页 · 六台造红：typecheck 归因的第三档（在飞 tracked）、第四档（取不到）、那句假绿守卫，
 *  以及两处**消费侧**接线（清单传进门、两栏前缀不许同名）。一台一种病、各红在不同用例。 */
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { stripAnsi, vitestSummary } from "../../scripts/lib/vitest-summary.ts";

const ROOT = join(import.meta.dirname, "../..");
const LIB = "scripts/lib/typecheck-triage.ts";
const GATE = "scripts/typecheck.ts";
const CLI = "scripts/text-reader-check.ts";
const T_JUDGE = "tests/typecheck-triage.test.ts";
const R_JUDGE = "tests/text-readers.test.ts";

const MACHINES = [
  {
    id: "M1-scratches-into-head",
    target: LIB, judge: T_JUDGE,
    from: "    if (untracked.has(f)) { scratch.push(f); continue; }",
    to: "    if (untracked.has(f)) { head.push(f); continue; }",
    expectCase: "全在未跟踪草稿：head 空、scratch 列出该文件，并明说 HEAD 类型干净",
  },
  {
    id: "M2-clean-verdict-unearned",
    target: LIB, judge: T_JUDGE,
    from: "if (t.head.length === 0 && t.dirtyTracked.length === 0 && t.undetermined.length === 0) {",
    to: "if (t.head.length === 0) {",
    expectCase: "★已跟踪但工作树脏 ⇒ 归「在飞改动中的 tracked」，既不算 HEAD 缺陷也不算草稿（两次现读的都是这一格）",
  },
  {
    id: "M3-undetermined-read-as-defect",
    target: LIB, judge: T_JUDGE,
    from: "    if (dirty === null) { undetermined.push(f); continue; }",
    to: "    if (dirty === null) { head.push(f); continue; }",
    expectCase: "零报错不打任何归因行；工作树状态取不到时归「没有归位」，两头结论都不许给",
  },
  {
    id: "M4-dirty-set-not-wired",
    target: GATE, judge: T_JUDGE,
    from: "triageTypecheck(out, untrackedSet(process.cwd()), dirtyTrackedSet(process.cwd()))",
    to: "triageTypecheck(out, untrackedSet(process.cwd()), new Set<string>())",
    expectCase: "★接线：门把 dirtyTrackedSet 真的传进归因（算出来不接＝恒绿）",
  },
  {
    id: "M5-dirty-set-fallback-empty",
    target: GATE, judge: T_JUDGE,
    from: "  if (r.status !== 0) return null;",
    to: "  if (r.status !== 0) return new Set();",
    expectCase: "★工作树状态取不到时返回 null，不许退回空集（空集＝向归因谎报「全都干净」）",
  },
  {
    id: "M6-column-prefix-merged",
    target: CLI, judge: R_JUDGE,
    from: "      必跑：${m.judge}",
    to: "      要跑：${m.judge}",
    expectCase: "★两栏的名单前缀不同字，且第二栏另给一行可直接粘贴的整串",
  },
];

const escapePattern = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

function runJudge(judgeFile: string, pattern: string): { code: number; sum: ReturnType<typeof vitestSummary>; failLines: string[]; ms: number } {
  const t0 = Date.now();
  let out = "";
  let code = 0;
  try {
    out = execFileSync("node", ["node_modules/vitest/vitest.mjs", "run", "--config", "tests/vitest.config.ts", judgeFile, "--testNamePattern=" + escapePattern(pattern)], {
      cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
    });
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; status?: number };
    out = (err.stdout ?? "") + (err.stderr ?? "");
    code = err.status ?? -1;
  }
  return { code, sum: vitestSummary(out), failLines: stripAnsi(out).split("\n").filter((l) => l.includes("FAIL")), ms: Date.now() - t0 };
}

const scratch = mkdtempSync(join(tmpdir(), "tc-attrib-330-red-"));
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
    const base = runJudge(m.judge, m.expectCase);
    console.log(`${m.id} 基线：passed=${String(base.sum.passed)} failed=${String(base.sum.failed)} found=${String(base.sum.found)}（${String(base.ms)}ms）`);
    if (!base.sum.found || base.sum.passed !== 1 || base.sum.failed !== 0) {
      console.log(`❌ ${m.id} 选择子基线不对 ⇒ 这台没跑（先查判卷能不能收集，再怀疑选择子）`);
      bad += 1;
    } else if (hits !== 1) {
      console.log(`❌ ${m.id} 针脚命中 ${String(hits)} 处（必须恰好 1 处）⇒ 这台没跑`);
      bad += 1;
    } else {
      writeFileSync(abs, text0.replace(m.from, m.to));
      const mut = runJudge(m.judge, m.expectCase);
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
  if (bad === 0) console.log("残骸校验：三支被测文件与开跑前逐字节一致 ✅");
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
mkdirSync(join(import.meta.dirname), { recursive: true });
console.log(bad === 0 ? "RED_MACHINES=OK" : `RED_MACHINES=BAD(${String(bad)})`);
process.exitCode = bad === 0 ? 0 : 1;
