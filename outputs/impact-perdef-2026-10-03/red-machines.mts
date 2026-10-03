/** 第 326 页 · 两台造红：#19 裁「不改口径」之后那格出口的两种病。
 *  读数口径同第 323–325 页：未变异先跑一次基线（found && passed==1 && failed==0），变异⇒ failed=1 且红在该当的那条用例；
 *  残骸对照面＝开跑前的工作树快照。 */
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { stripAnsi, vitestSummary } from "../../scripts/lib/vitest-summary.ts";

const ROOT = join(import.meta.dirname, "../..");
const JUDGE = "tests/impact-attribution.test.ts";

const MACHINES = [
  {
    id: "M1-same-file-shortcut-dropped",
    target: "src/agent/impact/index.ts",
    from: '  if (refFile === defFile) return "kept";',
    to: '  if (false && refFile === defFile) return "kept";',
    expectCase: "引用方自己就是那份定义 ⇒ 一律 kept，哪怕它把这个名字绑去了别处",
  },
  {
    id: "M2-somewhere-recopies-binding",
    target: "src/agent/impact/index.ts",
    from: "    if (attributableToDef(graph, refFile, symbol, defFile) !== \"dropped\") return true;",
    to: "    if (attributeRefToDef({ known: true, sources: [] }, defFile) !== \"dropped\") return true;",
    expectCase: "★接线 并集那一支吃的是这一份出口，不在 `attributableSomewhere` 里再构造一次 binding",
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

const scratch = mkdtempSync(join(tmpdir(), "perdef326-red-"));
let bad = 0;
try {
  const abs = join(ROOT, MACHINES[0]!.target);
  const bak = join(scratch, "impact-index.ts.bak");
  const text0 = readFileSync(abs, "utf8");
  copyFileSync(abs, bak);
  for (const m of MACHINES) {
    const base = runJudge(m.expectCase);
    console.log(`${m.id} 基线：passed=${String(base.sum.passed)} failed=${String(base.sum.failed)} found=${String(base.sum.found)}（${String(base.ms)}ms）`);
    const hits = text0.split(m.from).length - 1;
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
      copyFileSync(bak, abs);
    }
    if (readFileSync(abs, "utf8") !== text0) {
      console.log(`❌ ${m.id} 复原与开跑前不一致`);
      bad += 1;
    }
  }
  if (bad === 0) console.log("残骸校验：被测文件与开跑前逐字节一致 ✅（对照面＝开跑前的工作树，两台共用同一份备份）");
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
console.log(bad === 0 ? "RED_MACHINES=OK" : `RED_MACHINES=BAD(${String(bad)})`);
process.exitCode = bad === 0 ? 0 : 1;
