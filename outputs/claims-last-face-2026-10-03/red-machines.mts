/** 第 324 页 · 两台造红：#25 的最后一格（glm-session 注脚里那句成本框架）。
 *  两台故意挑**互相看不见**的病：M1 摘掉句子（只有正向那一格会红），M2 放宽那道门（只有反向那一格会红）。
 *  读数口径与第 323 页相同：先跑未变异基线证明选择子恰好选到 1 条且绿，再变异 ⇒ 期望 failed=1 且红在该当的那条用例；
 *  残骸对照面＝开跑前的工作树快照（不是 HEAD——本笔可能就在改那支文件）。 */
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { stripAnsi, vitestSummary } from "../../scripts/lib/vitest-summary.ts";

const ROOT = join(import.meta.dirname, "../..");

const MACHINES = [
  {
    id: "M1-glm-note-loses-cost-framing",
    target: "src/agent/glm-session.ts",
    judge: "tests/skill-tool-policy.test.ts",
    from: "派活前请把它当成不可撤销的开销。",
    to: "派活前请谨慎权衡。",
    expectCase: "注脚里那句「不可撤销的开销」要跟着后果一起给（只说撤不回＝模型没有可权衡的量）",
  },
  {
    id: "M2-glm-note-cost-gate-widened",
    target: "src/agent/glm-session.ts",
    judge: "tests/skill-tool-policy.test.ts",
    from: "    (stranded",
    to: "    (stranded || removed.length > 0",
    expectCase: "那句成本话不许逃出这道门：派活也被摘时根本没有这笔开销",
  },
];

const escapePattern = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

function runJudge(judge: string, pattern: string): { code: number; sum: ReturnType<typeof vitestSummary>; failLines: string[]; ms: number } {
  const t0 = Date.now();
  let out = "";
  let code = 0;
  try {
    out = execFileSync("node", ["node_modules/vitest/vitest.mjs", "run", "--config", "tests/vitest.config.ts", judge, "--testNamePattern=" + escapePattern(pattern)], {
      cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
    });
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; status?: number };
    out = (err.stdout ?? "") + (err.stderr ?? "");
    code = err.status ?? -1;
  }
  return { code, sum: vitestSummary(out), failLines: stripAnsi(out).split("\n").filter((l) => l.includes("FAIL")), ms: Date.now() - t0 };
}

const scratch = mkdtempSync(join(tmpdir(), "claims324-red-"));
let bad = 0;
try {
  const abs = join(ROOT, MACHINES[0]!.target);
  const bak = join(scratch, "glm-session.ts.bak");
  const text0 = readFileSync(abs, "utf8");
  copyFileSync(abs, bak);

  for (const m of MACHINES) {
    const base = runJudge(m.judge, m.expectCase);
    console.log(`${m.id} 基线：passed=${String(base.sum.passed)} failed=${String(base.sum.failed)} found=${String(base.sum.found)}（${String(base.ms)}ms）`);
    const hits = text0.split(m.from).length - 1;
    if (!base.sum.found || base.sum.passed !== 1 || base.sum.failed !== 0) {
      console.log(`❌ 选择子基线不对 ⇒ 这台没跑`);
      bad += 1;
    } else if (hits !== 1) {
      console.log(`❌ 针脚命中 ${String(hits)} 处（必须恰好 1 处）⇒ 这台没跑`);
      bad += 1;
    } else {
      writeFileSync(abs, text0.replace(m.from, m.to));
      const mut = runJudge(m.judge, m.expectCase);
      if (!mut.sum.found) {
        console.log(`❌ 读不到 Tests 摘要行 ⇒ 退出码 ${String(mut.code)}`);
        bad += 1;
      } else if (mut.sum.failed !== 1 || !mut.failLines.some((l) => l.includes(m.expectCase))) {
        console.log(`❌ 没红在该当的那条用例上：failed=${String(mut.sum.failed)}｜FAIL 行 ${String(mut.failLines.length)} 条`);
        bad += 1;
      } else {
        console.log(`✅ ${m.id} 红在「${m.expectCase}」（failed=1，${String(mut.ms)}ms，退 ${String(mut.code)}）`);
      }
      copyFileSync(bak, abs);
    }
    if (readFileSync(abs, "utf8") !== text0) {
      console.log(`❌ 复原与开跑前不一致：${m.id}`);
      bad += 1;
    }
  }
  if (bad === 0) console.log("残骸校验：被测文件与开跑前逐字节一致 ✅（对照面＝开跑前的工作树，两台共用同一份备份）");
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
console.log(bad === 0 ? "RED_MACHINES=OK" : `RED_MACHINES=BAD(${String(bad)})`);
process.exitCode = bad === 0 ? 0 : 1;
