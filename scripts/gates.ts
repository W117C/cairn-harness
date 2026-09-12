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

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** 全部门清单（清单即事实源）：六道门 + 13 个 -check。 */
export const GATES: readonly string[] = [
  "typecheck",
  "test",
  "e2e",
  "ipc:check",
  "sandbox:check",
  "build",
  "fork-check",
  "gate-check",
  "autonomy-check",
  "compaction-check",
  "panels-check",
  "tools-check",
  "map-check",
  "prune-check",
  "providers-check",
  "memory-check",
  "plugins-check",
  "sidechat-check",
  "security-check",
  "agents-check",
  "schedule-check",
];

interface GateResult {
  name: string;
  code: number;
  ms: number;
  output: string;
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

// ---- 恒真式体检（静态扫描，机械可执行）----
/** 空断言：check/assert/ok 的第一或第二实参字面量 true。 */
const EMPTY_ASSERT = /(?:check|assert|ok)\s*\(\s*(?:[^()]*,\s*true\s*\)|true\s*,)/;
/** 恒真式：`X || true` / `X === null || true`。 */
const TAUTOLOGY = /\|\|\s*true\b/;
/** 暗卷/暗盒段：函数名或紧邻注释含「暗卷」「暗盒」「darkBox」「dark」。 */
const DARK_SEGMENT = /(暗卷|暗盒|darkBox)/;
const HAS_ASSERTION = /(?:check|assert|ok)\s*\(/;

export interface ScanHit {
  file: string;
  line: number;
  kind: "empty-assert" | "tautology" | "dark-no-assert";
  text: string;
}

/** 扫描一个脚本源码：返回命中清单（纯函数，可单测）。 */
export function scanAssertionHealth(file: string, src: string): ScanHit[] {
  const hits: ScanHit[] = [];
  const lines = src.split("\n");
  lines.forEach((raw, i) => {
    const line = raw.replace(/\/\*.*?\*\//g, "").replace(/\/\/.*$/, ""); // 去注释（行内块注释 + 行注释），避免注释/文档串里的示例误伤
    if (EMPTY_ASSERT.test(line)) hits.push({ file, line: i + 1, kind: "empty-assert", text: raw.trim() });
    else if (TAUTOLOGY.test(line)) hits.push({ file, line: i + 1, kind: "tautology", text: raw.trim() });
  });
  // 暗卷段零断言：以顶层 async function 为粒度，段内无 check/assert/ok 即报警
  const fnRe = /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm;
  const marks: { name: string; start: number; headerLine: number }[] = [];
  for (let m = fnRe.exec(src); m !== null; m = fnRe.exec(src)) {
    marks.push({ name: m[1]!, start: m.index, headerLine: src.slice(0, m.index).split("\n").length });
  }
  for (let k = 0; k < marks.length; k++) {
    const cur = marks[k]!;
    const end = k + 1 < marks.length ? marks[k + 1]!.start : src.length;
    const body = src.slice(cur.start, end);
    // 段头注释（函数声明前 3 行）或函数名含暗卷标记
    const headerFrom = Math.max(0, cur.headerLine - 4);
    const header = lines.slice(headerFrom, cur.headerLine).join("\n");
    if (!DARK_SEGMENT.test(cur.name) && !DARK_SEGMENT.test(header)) continue;
    if (!HAS_ASSERTION.test(body)) {
      hits.push({ file, line: cur.headerLine, kind: "dark-no-assert", text: "function " + cur.name + "（暗卷段内无 check/assert）" });
    }
  }
  return hits;
}

async function scanAll(): Promise<ScanHit[]> {
  const dir = join(ROOT, "scripts");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".ts")).sort();
  const hits: ScanHit[] = [];
  for (const f of files) {
    const src = await readFile(join(dir, f), "utf8");
    hits.push(...scanAssertionHealth(f, src));
  }
  return hits;
}

async function main(): Promise<void> {
  const onlyArg = process.argv.find((a) => a.startsWith("--only="));
  const only = onlyArg ? new Set(onlyArg.slice("--only=".length).split(",").map((s) => s.trim())) : null;
  const noScan = process.argv.includes("--no-scan");
  const gates = only ? GATES.filter((g) => only.has(g)) : GATES;

  console.log("== pnpm gates ==");
  console.log("门清单（" + String(gates.length) + " 道，清单即事实源）：" + gates.join(" "));
  console.log("");

  const results: GateResult[] = [];
  for (const g of gates) {
    process.stdout.write("  ▶ " + g + " …");
    const r = await runGate(g);
    results.push(r);
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
    console.log("== 恒真式体检（空断言 / 恒真式 / 暗卷段零断言）==");
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

  if (failed.length > 0 || scanHits.length > 0) {
    process.exitCode = 1;
  } else {
    console.log("  ✅ pnpm gates 全部通过（" + String(results.length) + " 道门 + 体检零命中）");
  }
}

await main();
