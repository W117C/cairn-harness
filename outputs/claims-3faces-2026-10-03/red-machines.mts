/** 第 321 页 · 三台造红：三格"半句没人钉"的模型可见文案。
 *  针脚必须恰好 1 处、每台红在不同用例上、cp 复原＋逐字节校验＋零残骸（规矩见第 318/319/320 页）。 */
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
    id: "M1-remember-decision-reject-dropped",
    target: "src/tools/remember.ts",
    judge: "tests/remember.test.ts",
    from: 'if (k === "decision" && op === "replace") {',
    to: "if (false) {",
    expectCase: "DECISIONS 的拒因要带出路：光说「追加式」，模型不知道下一次该怎么写",
  },
  {
    id: "M2-cap-cause-note-negative-cause-list-dropped",
    target: "src/agent/impact/coverage.ts",
    judge: "tests/impact-query.test.ts",
    from: "（被忽略规则/噪声目录排除、后缀不支持仍然成立）",
    to: "。",
    expectCase: "覆盖面自述的阴性臂也要出声：与帽无关时点名其余成因，且不许留一句「调大」的假出路",
  },
  {
    id: "M3-write-file-hint-tail-promise-swapped",
    target: "src/tools/write_file.ts",
    judge: "tests/write-line-delta.test.ts",
    from: "也不会漏抄未改的行",
    to: "省一些字",
    expectCase: "那句「也不会漏抄未改的行」与它承诺的事一起钉：补丁改一行就只有一行不同",
  },
];

const scratch = mkdtempSync(join(tmpdir(), "claims321-red-"));
let bad = 0;
try {
  for (const m of MACHINES) {
    const abs = join(ROOT, m.target);
    const bak = join(scratch, m.target.replaceAll("/", "_") + ".bak");
    const text0 = readFileSync(abs, "utf8");
    copyFileSync(abs, bak);
    const hits = text0.split(m.from).length - 1;
    if (hits !== 1) {
      console.log(`❌ ${m.id} 针脚命中 ${String(hits)} 处（必须恰好 1 处）⇒ 这台没跑`);
      bad += 1;
      continue;
    }
    writeFileSync(abs, text0.replace(m.from, m.to));
    const t0 = Date.now();
    let out = "";
    let code = 0;
    try {
      out = execFileSync("node", ["node_modules/vitest/vitest.mjs", "run", "--config", "tests/vitest.config.ts", m.judge], {
        cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
      });
    } catch (e) {
      const err = e as { stdout?: string; stderr?: string; status?: number };
      out = (err.stdout ?? "") + (err.stderr ?? "");
      code = err.status ?? -1;
    }
    const ms = Date.now() - t0;
    const sum = vitestSummary(out);
    const titles = [...new Set(stripAnsi(out).split("\n")
      .filter((l) => l.includes("FAIL") && l.includes(m.judge))
      .map((l) => l.slice(l.lastIndexOf("> ") + 2).trim()))];
    if (!sum.found) {
      console.log(`❌ ${m.id} 读不到 Tests 摘要行（命令没跑起来）⇒ 退出码 ${String(code)}`);
      bad += 1;
    } else if (!titles.includes(m.expectCase)) {
      console.log(`❌ ${m.id} 没红在该当的那条用例上：failed=${String(sum.failed)}｜红的是 ${titles.join(" / ") || "（无）"}`);
      bad += 1;
    } else {
      console.log(`✅ ${m.id} 红在「${m.expectCase}」（failed=${String(sum.failed)}，${String(ms)}ms，退 ${String(code)}）`);
      console.log(`   其余红：${titles.filter((t) => t !== m.expectCase).join(" / ") || "（无）"}`);
    }
    copyFileSync(bak, abs);
    if (readFileSync(abs, "utf8") !== text0) {
      console.log(`❌ ${m.id} 复原后与备份不一致：${m.target}`);
      bad += 1;
    }
  }
  const residue = execFileSync("git", ["status", "--porcelain", "--", ...MACHINES.map((m) => m.target)], { cwd: ROOT, encoding: "utf8" }).trim();
  console.log(residue === "" ? "残骸校验：三支被测文件零 diff ✅" : `残骸校验：❌ ${residue}`);
  if (residue !== "") bad += 1;
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
console.log(bad === 0 ? "RED_MACHINES=OK" : `RED_MACHINES=BAD(${String(bad)})`);
process.exitCode = bad === 0 ? 0 : 1;
