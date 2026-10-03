/** 第 327 页 · 六台造红：判据名 fail-closed（登记表 ↔ 分支表 ↔ 跑器入口）。
 *  一台一种病、各红在不同用例（第 324 页买进来的那条纪律）。
 *  M4/M6 是同一格的两向（恒 null 与恒出事）：第一版把「出声」写成一张全违规面，
 *  被自己的尺判红——那一张面不存在（wroteTest 与 testNotRewritten 读同一个字段、极性相反），
 *  所以两向各用枚举的面、也各配一台造红。 */
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { stripAnsi, vitestSummary } from "../../scripts/lib/vitest-summary.ts";

const ROOT = join(import.meta.dirname, "../..");
const JUDGE = "tests/eval-task-set.test.ts";

const MACHINES = [
  {
    id: "M1-registry-typo-accepted",
    target: "src/agent/eval/task-set.ts",
    from: "  return expects.filter((e) => !EXPECT_SET.has(e));",
    to: "  return [];",
    expectCase: "解析期拒收：带未登记判据名的那条任务**不进分母**，且错误里点名那一枚",
  },
  {
    id: "M2-branch-table-key-drifts",
    target: "scripts/lib/eval-expects.ts",
    from: '  wroteTest: (r) => (!r.wroteTests ? "没补测试" : null),',
    to: "  // 漂：wroteTest 的分支被摘掉",
    expectCase: "★两支键集相等：登记的每一枚都有分支，分支里的每一枚都登记（抄两份清单＝各写各的）",
  },
  {
    id: "M3-unregistered-name-silent-at-entry",
    target: "scripts/lib/eval-expects.ts",
    from: "  if (!h) return `判据名「${name}」既不在登记表、也没有判定分支 ⇒ 这一格根本没判（绕过了任务集解析）`;",
    to: "  if (!h) return null;",
    expectCase: "绕过解析（内建任务写错名）也要出声：入口自己那一支兜住",
  },
  {
    id: "M4-branch-never-fails",
    target: "scripts/lib/eval-expects.ts",
    from: 'judgeUntouched: (r) => (r.touchedJudge ? "改了判卷面" : null),',
    to: "judgeUntouched: () => null,",
    expectCase: "两向证人·出声：枚举的面里每一枚判据至少开口一次（恒 null 的分支＝那一格没在判）",
  },
  {
    id: "M6-branch-always-fails",
    target: "scripts/lib/eval-expects.ts",
    from: 'clarify: (r) => (r.clarified < 1 ? "没 clarify（歧义靠猜）" : null),',
    to: 'clarify: () => "恒出事",',
    expectCase: "两向证人·闭嘴：枚举的面里每一枚判据至少过一次（恒出事的判据会把合法任务全判死）",
  },
  {
    id: "M5-grade-bypasses-table",
    target: "scripts/loop-eval.ts",
    from: "const why = expectFailReason(e, face);",
    to: "const why = null;",
    expectCase: "★接线 跑器不再自己判每一枚名字（旧那串 if 不许回来）",
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

const scratch = mkdtempSync(join(tmpdir(), "expectreg327-red-"));
let bad = 0;
const texts0 = new Map<string, string>();
const keys = new Set<string>();
try {
  for (const m of MACHINES) {
    const abs = join(ROOT, m.target);
    const bakName = m.target.replaceAll("/", "__") + ".bak";
    if (!texts0.has(m.target)) texts0.set(m.target, readFileSync(abs, "utf8"));
    if (!keys.has(m.target)) { copyFileSync(abs, join(scratch, bakName)); keys.add(m.target); }
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
  if (bad === 0) console.log("残骸校验：三支被测文件与开跑前逐字节一致 ✅（对照面＝开跑前的工作树）");
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
mkdirSync(join(import.meta.dirname), { recursive: true });
console.log(bad === 0 ? "RED_MACHINES=OK" : `RED_MACHINES=BAD(${String(bad)})`);
process.exitCode = bad === 0 ? 0 : 1;
