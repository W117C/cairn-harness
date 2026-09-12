// M2g：`pnpm gates` —— 一条命令跑齐全部门并打印逐道退出码 + 汇总。
// 设计要点（任务书 §4 任务 5 / §2 裁决 2）：
//   1) **清单即事实源**：GATES 常量就是门数口径，不再靠任务书自报（M2e 16 / M2f 17 两轮口径偏差的根治）。
//   2) **恒真式体检**（静态扫描）：任何 `check(..., true)` 形式的空断言、`|| true` / `=== null || true`
//      一类恒真式、以及「暗卷段零 check/assert」都在这里报警——让门说的话等于门测的事。
//   3) 退出码 0 = 全部门绿且体检零命中；任何一道红或体检命中 → 退出码 1。
// 用法：pnpm gates            （全跑）
//       pnpm gates --only=test,tools-check   （只跑指定门，调试用）
//       pnpm gates --no-scan   （跳过恒真式体检）
import { spawn } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { countUnverified, scanAssertionHealth, scanDisjunctions, type ScanHit } from "./assertion-health";
import { checkGateManifest, EXEMPT_SCRIPTS, GATES } from "./gate-manifest";

// 断言体检实现已抽到 ./assertion-health.ts：gates.ts 顶层有 `await main()`，
// 直接 import 会跑起全套门禁——抽出去才能单测。此处再导出，对外接口不变。
export { countUnverified, scanAssertionHealth, scanDisjunctions };
export type { ScanHit };
// 清单/漂移护栏同族：清单抽到 ./gate-manifest.ts，此处再导出，对外接口不变。
export { GATES, checkGateManifest, EXEMPT_SCRIPTS };

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

interface GateResult {
  name: string;
  code: number;
  ms: number;
  output: string;
}

/** 全量体检：空断言 / 恒真式 / 无断言段 + H-1 的 AST 级析取式弱断言。 */
async function scanAll(): Promise<ScanHit[]> {
  const dir = join(ROOT, "scripts");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".ts")).sort();
  const hits: ScanHit[] = [];
  for (const f of files) {
    const src = await readFile(join(dir, f), "utf8");
    hits.push(...scanAssertionHealth(f, src));
    hits.push(...scanDisjunctions(f, src)); // H-1：AST 级析取式弱断言
  }
  return hits;
}

function runGate(name: string): Promise<GateResult> {
  return new Promise((settle) => {
    const t0 = Date.now();
    // TERM=dumb + NO_COLOR：判据不依赖调用者 TERM（M2g §1.4-2 修正：假红根因在 ANSI 序列）
    const child = spawn("pnpm", ["run", name], {
      cwd: ROOT,
      env: { ...process.env, TERM: "dumb", NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout?.on("data", (d: Buffer) => {
      out += String(d);
    });
    child.stderr?.on("data", (d: Buffer) => {
      out += String(d);
    });
    child.on("error", (err) => settle({ name, code: 127, ms: Date.now() - t0, output: String(err) }));
    child.on("close", (code) => settle({ name, code: code ?? 1, ms: Date.now() - t0, output: out }));
  });
}

async function main(): Promise<void> {
  const onlyArg = process.argv.find((a) => a.startsWith("--only="));
  const only = onlyArg ? new Set(onlyArg.slice("--only=".length).split(",").map((s) => s.trim())) : null;
  const noScan = process.argv.includes("--no-scan");
  /** H-2：严格模式——未证项直接判红（CI / 有凭据环境用）。 */
  const strictUnverified = process.argv.includes("--strict-unverified") || process.env.DSH_STRICT_UNVERIFIED === "1";
  const gates = only ? GATES.filter((g) => only.has(g)) : GATES;

  // 清单漂移护栏（在跑门之前）：GATES ↔ package.json scripts 双向一致。
  // 发现验收形态脚本既不在 GATES 也不在 EXEMPT_SCRIPTS（曾经的 provider:check），
  // 或 GATES 列了不存在的 script，一律判红——不静默冷落任何一道门。
  const pkg = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8")) as { scripts?: Record<string, string> };
  const drift = checkGateManifest(pkg.scripts ?? {});

  console.log("== pnpm gates ==");
  console.log("门清单（" + String(gates.length) + " 道，清单即事实源）：" + gates.join(" "));
  if (drift.length === 0) {
    console.log("  清单漂移校验：✅ GATES ↔ package.json scripts 一致（无孤儿验收脚本）");
  } else {
    console.log("  清单漂移校验：❌ " + String(drift.length) + " 条");
    for (const d of drift) console.log("    [" + d.kind + "] " + d.detail);
  }
  console.log("");

  const results: GateResult[] = [];
  let unverified = 0;
  for (const g of gates) {
    process.stdout.write("  ▶ " + g + " …");
    const r = await runGate(g);
    results.push(r);
    unverified += countUnverified(r.output); // H-2：未证数上浮到门禁汇总
    process.stdout.write("\r  " + (r.code === 0 ? "✅" : "❌") + " " + g.padEnd(18) + " exit=" + String(r.code) + "  " + String(r.ms) + "ms\n");
    if (r.code !== 0) {
      const tail = r.output.trim().split("\n").slice(-12).join("\n");
      console.log("      ── 失败输出尾 12 行 ──");
      console.log(tail.split("\n").map((l) => "      " + l).join("\n"));
    }
  }

  let scanHits: ScanHit[] = [];
  if (!noScan) {
    console.log("");
    console.log("== 断言体检（空断言 / 恒真式 / 暗卷段零断言 / 析取式弱断言）==");
    scanHits = await scanAll();
    if (scanHits.length === 0) console.log("  ✅ 零命中");
    else for (const h of scanHits) console.log("  ❌ " + h.file + ":" + String(h.line) + " [" + h.kind + "] " + h.text);
  }

  const failed = results.filter((r) => r.code !== 0);
  console.log("");
  console.log("== 汇总 ==");
  console.log("  绿 " + String(results.length - failed.length) + " / " + String(results.length) + "，红 " + String(failed.length) + (failed.length > 0 ? "（" + failed.map((f) => f.name).join("、") + "）" : ""));
  console.log("  逐道退出码：" + results.map((r) => r.name + "=" + String(r.code)).join(" "));
  if (scanHits.length > 0) console.log("  体检命中 " + String(scanHits.length) + " 条（见上）");
  if (unverified > 0) {
    console.log("  ⚠️  未证 " + String(unverified) + " 项（连网/凭据限制未跑到的断言——**不等于通过**）");
    console.log("     严格模式：DSH_STRICT_UNVERIFIED=1 或 --strict-unverified 可让未证直接判红");
  }

  if (drift.length > 0 || failed.length > 0 || scanHits.length > 0) {
    process.exitCode = 1;
  } else if (strictUnverified && unverified > 0) {
    // H-2：严格模式下未证 = 红（CI / 有凭据环境用），杜绝「降级成未证 yet 全绿」。
    console.log("  ❌ 严格模式：存在 " + String(unverified) + " 项未证，判红");
    process.exitCode = 1;
  } else if (unverified > 0) {
    // 未证不算绿：明确改写口径，禁止宣称「全部通过」。
    console.log("  ⚠️  " + String(results.length) + " 道门退出码全 0，但有 " + String(unverified) + " 项未证——不得宣称「全部通过」");
  } else {
    console.log("  ✅ pnpm gates 全部通过（" + String(results.length) + " 道门 + 体检零命中 + 零未证）");
  }
}

await main();
