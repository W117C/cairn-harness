/** 第 329 页 · 四台造红：第二出口（语料级读取者）的三态、面是否 load-bearing、那一栏的接线与帽。
 *  一台一种病、各红在不同用例；跑完逐字节复原（第 324/328 页同一条纪律）。 */
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { stripAnsi, vitestSummary } from "../../scripts/lib/vitest-summary.ts";

const ROOT = join(import.meta.dirname, "../..");
const JUDGE = "tests/text-readers.test.ts";

const MACHINES = [
  {
    id: "M1-corpus-const-not-expanded",
    target: "scripts/lib/text-readers.ts",
    from: "consts.get(bare[0])",
    to: 'consts.get("")',
    expectCase: "★参数是裸标识符时要展开同文件的常量定义（现读第一版在这一格静默失效：那条正则没有捕获组）",
  },
  {
    id: "M2-corpus-face-not-load-bearing",
    target: "scripts/lib/text-readers.ts",
    from: "    for (const face of s.faces) {",
    to: '    for (const face of [""] as string[]) {',
    expectCase: "两向证人·闭嘴：只遍历 fixtures 的那份不许出现在改了 scripts 的清单里（清单变噪音就没人看）",
  },
  {
    id: "M3-corpus-column-dropped",
    target: "scripts/text-reader-check.ts",
    from: 'console.log("  " + corpusSummary(corpusScans));',
    to: "void corpusSummary(corpusScans);",
    expectCase: "★两栏各印一行：并成一行就分不清是「少了一条」还是「少了一类」",
  },
  {
    id: "M4-corpus-cap-guard-dead",
    target: "scripts/text-reader-check.ts",
    from: "const corpusBad = corpusUnknown > CORPUS_UNKNOWN_CAP;",
    to: "const corpusBad = false;",
    expectCase: "★第二出口那一栏的帽要接进退出码（算出来不看＝恒绿）",
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

const scratch = mkdtempSync(join(tmpdir(), "textreaders329-red-"));
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
