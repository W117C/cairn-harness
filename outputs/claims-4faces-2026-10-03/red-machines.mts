/** 第 319 页 · 四台造红：四格「模型可见承诺」的新判卷各要有一台只有它看得见的机器。
 *  针脚必须恰好命中 1 处；每台红在**不同用例**；跑完 cp 复原并逐字节校验。 */
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
    id: "M1-web-search-early-return-dropped",
    target: "src/tools/web-search.ts",
    judge: "tests/web-search.test.ts",
    from: "if (cfg === null) {",
    to: "if (false) {",
    expectCase: "没配端点时一次出网都没有：那句「本工具不做默认厂商」由请求计数钉住，不只由文案钉住",
  },
  {
    id: "M2-autonomy-consent-gap-arm-inverted",
    target: "src/permissions/autonomy.ts",
    judge: "tests/permissions.test.ts",
    from: "chain.consentGap === true",
    to: "chain.consentGap === false",
    expectCase: "自主档真出卡，且理由说的是「同意范围」不是「ask 规则命中」",
  },
  {
    id: "M3-cap-way-out-arms-swapped",
    target: "src/agent/impact/coverage.ts",
    judge: "tests/impact-query.test.ts",
    from: "return capAtCeiling(cap)",
    to: "return !capAtCeiling(cap)",
    expectCase: "出路那支纯函数两侧都钉：未到顶给「调大 maxFiles 后重问」，顶到上限给「调不上去⇒直读或拆仓」",
  },
  {
    id: "M4-ceiling-comparison-widened",
    target: "src/tools/impact-query.ts",
    judge: "tests/impact-query.test.ts",
    from: "raw > IMPACT_MAX_FILES_CEILING",
    to: "raw > Number.MAX_SAFE_INTEGER",
    expectCase: "越界那句拒绝文案点名「只能往小调」，而顶格本身是可传的（拒的是越界，不是上限）",
  },
];

const scratch = mkdtempSync(join(tmpdir(), "claims319-red-"));
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
  console.log(residue === "" ? "残骸校验：四支被测文件零 diff ✅" : `残骸校验：❌ ${residue}`);
  if (residue !== "") bad += 1;
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
console.log(bad === 0 ? "RED_MACHINES=OK" : `RED_MACHINES=BAD(${String(bad)})`);
process.exitCode = bad === 0 ? 0 : 1;
