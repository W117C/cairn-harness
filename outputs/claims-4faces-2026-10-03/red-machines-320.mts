/** 第 320 页 · 三台造红：clampTier／supervise 契约／provider key 闸。
 *  规矩同第 319 页：针脚恰好 1 处、每台红在**不同用例**、cp 复原＋逐字节校验＋零残骸。 */
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
    id: "M1-clamp-tier-equal-rank-clamps",
    target: "src/agent/worker-report.ts",
    judge: "tests/permission-mode-single-source.test.ts",
    from: "if (permissionModeRank(requested) <= permissionModeRank(parent)) return { mode: requested, clamped: false };",
    to: "if (permissionModeRank(requested) < permissionModeRank(parent)) return { mode: requested, clamped: false };",
    expectCase: "clampTier 两支都钉：越界回父档并给出整句警告，不越界原样放过且不给警告",
  },
  {
    id: "M2-supervise-unknown-keys-accepted",
    target: "src/agent/supervise-contract.ts",
    judge: "tests/supervise-contract.test.ts",
    from: "const unknown = Object.keys(o).filter((k) => !legal.includes(k));",
    to: "const unknown: string[] = [];",
    expectCase: "拒因里那句「拼错的键不会生效」跟着拒一起走：删掉它行为一件不变、模型少知道一件事",
  },
  {
    id: "M3-provider-key-blank-counts-configured",
    target: "src/main/provider-runtime.ts",
    judge: "tests/providers.test.ts",
    from: 'return typeof value === "string" && value.trim() !== "";',
    to: 'return typeof value === "string";',
    expectCase: "反向：key 在场就放行——只有全空/纯空白算缺（一律拒会把这条闸变成装饰）",
  },
];

const scratch = mkdtempSync(join(tmpdir(), "claims320-red-"));
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
