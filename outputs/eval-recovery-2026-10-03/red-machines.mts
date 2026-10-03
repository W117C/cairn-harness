/** 第 325 页 · 五台造红：返修那一格（能力 5 的分子）。
 *  设计约束（第 324 页刚买进的教训）：**每台必须红在不同用例上**——所以判卷先把六态各拆成一条 `it()`，
 *  这里每台只挑一条。读数口径同第 323/324 页：未变异先跑一次基线（要求 found && passed==1 && failed==0），
 *  再变异 ⇒ 期望 failed=1 且 FAIL 行里点名那条用例；残骸对照面＝**开跑前的工作树快照**（不是 HEAD）。 */
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { stripAnsi, vitestSummary } from "../../scripts/lib/vitest-summary.ts";

const ROOT = join(import.meta.dirname, "../..");
const JUDGE = "tests/eval-validity.test.ts";

const MACHINES = [
  {
    id: "M1-counts-greens-before-first-red",
    target: "scripts/lib/eval-validity.ts",
    from: "  const greens = beats.slice(firstRed + 1).filter((b) => b.ok);",
    to: "  const greens = beats.filter((b) => b.ok);",
    expectCase: "只数**第一枚红之后**的绿：红之前那枚绿不能顶账",
  },
  {
    id: "M2-harness-green-credited-to-model",
    target: "scripts/lib/eval-validity.ts",
    from: '  if (greens.some((b) => b.by === "model")) return "modelRecovery";',
    to: '  if (greens.length > 0) return "modelRecovery";',
    expectCase: "★红过、绿了，但那几枚绿全是闸补的 ⇒ harnessOnly：账记 harness，不记模型",
  },
  {
    id: "M3-unknown-attribution-guesses-model",
    target: "scripts/lib/eval-validity.ts",
    from: '  return "attributionUnknown";',
    to: '  return "modelRecovery";',
    expectCase: "归属读不出的一拍在场时不许猜 ⇒ attributionUnknown（宁可说不出，也不替模型认账）",
  },
  {
    id: "M4-criterion-reads-last-green-only",
    target: "scripts/loop-eval.ts",
    from: 'r.verifyRecovery !== "modelRecovery"',
    to: "r.verifyOkLast !== true",
    expectCase: "★接线① 跑器那一支吃的是这一格，不是「最后一拍绿没绿」（旧口径不许藏在同一支里当第二把尺）",
  },
  {
    id: "M5-sentinel-string-recopied",
    target: "scripts/loop-eval.ts",
    from: "verifyBeatFace(v, verifyCallIds, HARNESS_VERIFY_CALL_ID)",
    to: 'verifyBeatFace(v, verifyCallIds, "harness-auto-verify")',
    expectCase: "★接线③ 归属判定吃的是生产端导出的那枚哨兵，且谓词只有 `verifyBeatFace` 一份",
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

const scratch = mkdtempSync(join(tmpdir(), "evalrecovery325-red-"));
let bad = 0;
const texts0 = new Map<string, string>();
const backedUp = new Set<string>();
try {
  for (const m of MACHINES) {
    const abs = join(ROOT, m.target);
    if (!texts0.has(m.target)) texts0.set(m.target, readFileSync(abs, "utf8"));
    if (!backedUp.has(m.target)) {
      copyFileSync(abs, join(scratch, m.target.replaceAll("/", "__") + ".bak"));
      backedUp.add(m.target);
    }
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
      copyFileSync(join(scratch, m.target.replaceAll("/", "__") + ".bak"), abs);
    }
    if (readFileSync(abs, "utf8") !== text0) {
      console.log(`❌ ${m.id} 复原与开跑前不一致：${m.target}`);
      bad += 1;
    }
  }
  if (bad === 0) console.log("残骸校验：两支被测文件与开跑前逐字节一致 ✅（对照面＝开跑前的工作树）");
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
console.log(bad === 0 ? "RED_MACHINES=OK" : `RED_MACHINES=BAD(${String(bad)})`);
process.exitCode = bad === 0 ? 0 : 1;
