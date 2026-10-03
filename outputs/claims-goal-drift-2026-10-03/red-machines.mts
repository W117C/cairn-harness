/** 第 323 页 · 四台造红：四格模型可见断言（其中 goal-drift 那一格是"把没人读的字段接进出声"）。
 *  每台先跑一次未变异基线证明选择子恰好选到 1 条且绿，再变异 ⇒ 期望 failed=1 且红在该当的那条用例。
 *  读数谓词用「整条标题作为 FAIL 行的子串」，不按分隔符切片（第 322 页实测：标题里就含 `> `）。 */
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { stripAnsi, vitestSummary } from "../../scripts/lib/vitest-summary.ts";

const ROOT = join(import.meta.dirname, "../..");

interface Machine {
  id: string;
  target: string;
  judge: string;
  from: string;
  to: string;
  expectCase: string;
}

const MACHINES: Machine[] = [
  {
    id: "M1-compaction-overflow-mechanism-note-dropped",
    target: "src/agent/compaction.ts",
    judge: "tests/compaction.test.ts",
    from: "（原子单元整丢、最近 typed 用户消息未动）",
    to: "（详见事件流日志）",
    expectCase: "不调摘要器；整单元丢最旧一半；keep-first 与最近 user 消息保留",
  },
  {
    id: "M2-plugin-role-security-warning-blurred",
    target: "src/agent/sequencer.ts",
    judge: "tests/plugin-role-discoverability.test.ts",
    from: "不支持（CC 安全约束照抄 §9.6），已忽略",
    to: "未知，已忽略",
    expectCase: "安全约束那三件仍按原口径警告（本次改动不许把它们并入普通未知键）",
  },
  {
    id: "M3-glm-spec-truncation-promise-dropped",
    target: "src/agent/glm-session.ts",
    judge: "tests/optional-tool-surface.test.ts",
    from: "——正文太长会被截断并提示换更精确的地址。",
    to: "。",
    expectCase: "web_fetch 那句「正文太长会被截断并提示换更精确的地址」：规格与提示两头都得有这一件",
  },
  {
    id: "M4-goal-drift-reason-gutted",
    target: "src/agent/goal-drift.ts",
    judge: "tests/goal-drift-reason.test.ts",
    from: "单方面缩小交付面",
    to: "缩小交付范围",
    expectCase: "B 族命中：读数行里要点名「单方面缩小交付面」，不能只留一个族 id",
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
  const failLines = stripAnsi(out).split("\n").filter((l) => l.includes("FAIL"));
  return { code, sum: vitestSummary(out), failLines, ms: Date.now() - t0 };
}

const scratch = mkdtempSync(join(tmpdir(), "claims323-red-"));
let bad = 0;
/** 残骸的对照面是**开跑前那份工作树状态**，不是 HEAD：本笔自己就在改其中一支被测文件
 *  （goal-drift.ts 是这一页的实现），拿 `git status` 比 HEAD 会把"我自己在飞的那一格"读成残骸。 */
const targets = [...new Set(MACHINES.map((m) => m.target))];
const beforeRun = new Map(targets.map((t) => [t, readFileSync(join(ROOT, t), "utf8")]));
try {
  for (const m of MACHINES) {
    const abs = join(ROOT, m.target);
    const bak = join(scratch, m.target.replaceAll("/", "_") + ".bak");
    const text0 = readFileSync(abs, "utf8");
    copyFileSync(abs, bak);

    const base = runJudge(m.judge, m.expectCase);
    if (!base.sum.found || base.sum.passed !== 1 || base.sum.failed !== 0) {
      console.log(`❌ ${m.id} 选择子基线不对（passed=${String(base.sum.passed)} failed=${String(base.sum.failed)} found=${String(base.sum.found)}）⇒ 这台没跑`);
      bad += 1;
      continue;
    }
    console.log(`   ${m.id} 基线：选择子选到 1 条、绿（${String(base.ms)}ms）`);

    const hits = text0.split(m.from).length - 1;
    if (hits !== 1) {
      console.log(`❌ ${m.id} 针脚命中 ${String(hits)} 处（必须恰好 1 处）⇒ 这台没跑`);
      bad += 1;
      continue;
    }
    writeFileSync(abs, text0.replace(m.from, m.to));
    const mut = runJudge(m.judge, m.expectCase);
    if (!mut.sum.found) {
      console.log(`❌ ${m.id} 读不到 Tests 摘要行（命令没跑起来）⇒ 退出码 ${String(mut.code)}`);
      bad += 1;
    } else if (mut.sum.failed !== 1 || !mut.failLines.some((l) => l.includes(m.expectCase))) {
      console.log(`❌ ${m.id} 没红在该当的那条用例上：failed=${String(mut.sum.failed)}｜FAIL 行 ${String(mut.failLines.length)} 条`);
      for (const l of mut.failLines.slice(0, 3)) console.log("   ｜ " + l.trim().slice(0, 200));
      bad += 1;
    } else {
      console.log(`✅ ${m.id} 红在「${m.expectCase}」（failed=${String(mut.sum.failed)}，${String(mut.ms)}ms，退 ${String(mut.code)}）`);
    }
    copyFileSync(bak, abs);
    if (readFileSync(abs, "utf8") !== text0) {
      console.log(`❌ ${m.id} 复原后与备份不一致：${m.target}`);
      bad += 1;
    }
  }
  const drifted = targets.filter((t) => readFileSync(join(ROOT, t), "utf8") !== beforeRun.get(t));
  console.log(drifted.length === 0
    ? "残骸校验：四支被测文件与开跑前逐字节一致 ✅（对照面＝开跑前的工作树，本笔在飞的那一格不算残骸）"
    : `残骸校验：❌ ${drifted.join(" / ")}`);
  if (drifted.length !== 0) bad += 1;
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
console.log(bad === 0 ? "RED_MACHINES=OK" : `RED_MACHINES=BAD(${String(bad)})`);
process.exitCode = bad === 0 ? 0 : 1;
