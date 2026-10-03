/** 第 322 页 · 五台造红：CLI 两道用法闸的两半（拒因／合法形状）＋规格里那句文件数帽的数字来源。
 *  每台必须红在**不同**用例上；先用未变异的判卷证明这一条选择子选得中（1 passed），
 *  再变异 ⇒ 期望 1 failed。针脚命中必须恰好 1 处；跑完用备份逐字节复原并核零残骸。 */
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
    id: "M1-cli-goal-log-remedy-dropped",
    target: "src/cli.ts",
    judge: "tests/cli-surface.test.ts",
    from: "：目标只能挂在会话上（去掉 --log，日志落在 <ws>/.agent/sessions/）",
    to: "！",
    expectCase: "拒 --goal 与 --log 同行时，理由与出路要跟着拒一起给（后半句是给模型的下一步）",
  },
  {
    id: "M2-cli-goal-log-guard-widened",
    target: "src/cli.ts",
    judge: "tests/cli-surface.test.ts",
    from: "if (flagLog !== null && goal !== null) {",
    to: "if (goal !== null) {",
    expectCase: "那道 goal/log 闸不许吃掉单边写法：只给 --goal 或只给 --log 都要放行到后面那道闸",
  },
  {
    id: "M3-cli-workspace-dup-guard-dropped",
    target: "src/cli.ts",
    judge: "tests/cli-surface.test.ts",
    from: "if (flagWorkspace !== null && positional.length === 2) {",
    to: "if (false) {",
    expectCase: "--workspace 与位置参数同时给 ⇒ 拒，拒因说清「二者只能取一」",
  },
  {
    id: "M4-cli-workspace-dup-guard-widened",
    target: "src/cli.ts",
    judge: "tests/cli-surface.test.ts",
    from: "if (flagWorkspace !== null && positional.length === 2) {",
    to: "if (positional.length === 2) {",
    expectCase: "工作区的两种合法形状各自放行（无条件拒会把 `m0 <目录> <任务>` 这条主路杀掉）",
  },
  {
    id: "M5-impact-spec-cap-number-hardcoded",
    target: "src/tools/impact-query.ts",
    judge: "tests/impact-query.test.ts",
    from: "缺省＝上限 ${String(MAX_FILES_DEFAULT)}",
    to: "缺省＝上限 5007",
    expectCase: "规格里那句 maxFiles 说明也不许承诺一条拧不动的出路（规格每轮重送，比文案更贵）",
  },
];

/** 标题当正则用 ⇒ 元字符要转义（这条用例标题里有括号、反引号、`$`）。值一律用 `--flag=` 等号形，
 *  不然以 `--` 开头的标题会被参数解析器当成选项吃掉（规则 251 的第二个洞）。 */
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
  // 标题里就含 `> `（例如 `` `m0 <目录> <任务>` ``），所以**不能**按"最后一个 > 之后"切——
  // 那样切出来的是残片，会把"真红了"读成"没红在该当的那条用例上"。谓词改成：整条标题作为子串出现在某条 FAIL 行里。
  const failLines = stripAnsi(out).split("\n").filter((l) => l.includes("FAIL"));
  return { code, sum: vitestSummary(out), failLines, ms: Date.now() - t0 };
}

const scratch = mkdtempSync(join(tmpdir(), "claims322-red-"));
let bad = 0;
try {
  for (const m of MACHINES) {
    const abs = join(ROOT, m.target);
    const bak = join(scratch, m.target.replaceAll("/", "_") + ".bak");
    const text0 = readFileSync(abs, "utf8");
    copyFileSync(abs, bak);

    // ① 先证选得中：未变异时这一条必须恰好 1 passed（选不中＝后面的红读数字分会是假的）
    const base = runJudge(m.judge, m.expectCase);
    if (!base.sum.found || base.sum.passed !== 1 || base.sum.failed !== 0) {
      console.log(`❌ ${m.id} 选择子基线不对（passed=${String(base.sum.passed)} failed=${String(base.sum.failed)} 找到=${String(base.sum.found)}）⇒ 这台没跑`);
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
      console.log(`❌ ${m.id} 没红在该当的那条用例上：failed=${String(mut.sum.failed)}｜FAIL 行 ${mut.failLines.length} 条`);
      for (const l of mut.failLines) console.log("   ｜ " + l.trim().slice(0, 200));
      bad += 1;
    } else {
      console.log(`✅ ${m.id} 红在「${m.expectCase}」（failed=${String(mut.sum.failed)}，${String(mut.ms)}ms，退 ${String(mut.code)}）`);
      const others = mut.failLines.filter((l) => !l.includes(m.expectCase));
      if (others.length > 0) console.log(`   其余 FAIL 行 ${String(others.length)} 条（选择子只该放一条进来，出现即说明取料面比预想宽）`);
    }
    copyFileSync(bak, abs);
    if (readFileSync(abs, "utf8") !== text0) {
      console.log(`❌ ${m.id} 复原后与备份不一致：${m.target}`);
      bad += 1;
    }
  }
  const residue = execFileSync("git", ["status", "--porcelain", "--", ...new Set(MACHINES.map((m) => m.target))], { cwd: ROOT, encoding: "utf8" }).trim();
  console.log(residue === "" ? "残骸校验：两支被测文件零 diff ✅" : `残骸校验：❌ ${residue}`);
  if (residue !== "") bad += 1;
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
console.log(bad === 0 ? "RED_MACHINES=OK" : `RED_MACHINES=BAD(${String(bad)})`);
process.exitCode = bad === 0 ? 0 : 1;
