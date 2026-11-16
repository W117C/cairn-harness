// 一页总判：把各道门真跑一遍，折成一个 verdict（`outputs/verify-all/summary.json`）。
//
// 用法：npx tsx scripts/verify-all.ts [--fast]
//   --fast 只跑核心门（typecheck / docs-check / 两份报告），不跑测试套件与真机冒烟。
// 纪律：没跑（例如被跳过）记 `missing`，**不算通过**——与标准对照报告同一条。
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { summarise, verdictOfExit, type GateResult } from "../src/verification/summary";

const root = process.cwd();
const fast = process.argv.includes("--fast");
const outDir = join(root, "outputs", "verify-all");

function run(gate: string, cmd: string, args: string[], cwd = root): GateResult {
  const started = Date.now();
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", stdio: "pipe", timeout: 30 * 60_000 });
  const code = r.status;
  return {
    gate,
    verdict: verdictOfExit(code),
    detail: `${cmd} ${args.join(" ")} ⇒ exit ${String(code)}（${String(Math.round((Date.now() - started) / 1000))}s）`,
  };
}

const gates: GateResult[] = [
  run("typecheck", "node", ["--import", "tsx", "scripts/typecheck.ts"]),
  run("docs-check", "npx", ["tsx", "scripts/docs-check.ts"]),
  run("bot-report", "npx", ["tsx", "scripts/bot-report.ts"]),
  run("standard-report", "npx", ["tsx", "scripts/standard-report.ts"]),
  run("parity", "npx", ["vitest", "run", "--config", "tests/vitest.config.ts", "tests/parity-standard.test.ts"]),
];

if (!fast) {
  gates.push(run("core-suite", "pnpm", ["test:capped"]));
  gates.push(run("desktop-suite", "npx", ["vitest", "run", "--config", "vitest.config.ts"], join(root, "apps/desktop")));
}

const summary = summarise(gates);
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "summary.json"), JSON.stringify({ at: new Date().toISOString(), fast, ...summary }, null, 2));

console.log(`verify-all: ${summary.verdict}`);
for (const g of summary.gates) console.log(`  ${g.verdict.padEnd(8)} ${g.gate.padEnd(15)} ${g.detail ?? ""}`);
if (summary.failed.length > 0) console.log(`  失败：${summary.failed.join("、")}`);
if (summary.missing.length > 0) console.log(`  没跑：${summary.missing.join("、")}`);
console.log(`→ ${join(outDir, "summary.json")}`);
process.exit(summary.verdict === "pass" ? 0 : summary.verdict === "fail" ? 1 : 2);
