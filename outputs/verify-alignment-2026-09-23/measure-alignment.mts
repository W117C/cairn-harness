/** 能力 25「验面绿不绿，别交给 shell 的管道语义」取证探针（四问）：
 *  ① 同一条必红的测试：裸跑 / 管道接 tail / 加 pipefail —— 退出码各是多少（真跑 bash）；
 *  ② 规模：真语料里 run_shell/verify 有多少条命令含管道（＝ok 只代表最后一段）；配置面几条；
 *  ③ 实弹（无管道）：改了 A、只验 B ⇒ 绿；改动面 ∩ 验面 = 空，有读数说得出吗；
 *  ④ 机制是不是已经有了：真 `globIntersects` 换个配对跑一遍；并记**我自己两次判据缺陷**
 *     （命令文本不能当验面：`tests/run.mjs` 看着带范围其实是全量；目录级抽到空集必须是 unknown）。
 *  跑法：TERM=dumb node --import tsx outputs/verify-alignment-2026-09-23/measure-alignment.mts
 *  只在 mkdtemp 临时目录写；输出不含墙钟。 */
import { writeFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { globIntersects } from "../../src/agent/lease-conflicts";
import { write_file } from "../../src/tools/write_file";
import { run_shell } from "../../src/tools/run_shell";
import type { ToolContext } from "../../src/tools/base";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel: string): string => {
  const p = join(ROOT, rel);
  return existsSync(p) ? readFileSync(p, "utf8") : "";
};
const codeOf = (script: string): number => {
  try { execFileSync("bash", ["-c", script], { stdio: "pipe", encoding: "utf8" }); return 0; } catch (e) {
    const err = e as { status?: number };
    return typeof err.status === "number" ? err.status : -1;
  }
};

// ---------------- ① 退出码诚实性（同一条必红的测试） ----------------
const ws0 = realpathSync(mkdtempSync(join(tmpdir(), "pipe-probe-")));
writeFileSync(join(ws0, "t.test.mjs"), 'import { test } from "node:test";\ntest("x", () => { throw new Error("boom"); });\n', "utf8");
const T = "node --test t.test.mjs";
const bare = codeOf(`cd ${ws0} && ${T} >/dev/null 2>&1`);
const piped = codeOf(`cd ${ws0} && ${T} 2>&1 | tail -3 >/dev/null`);
const pipefail = codeOf(`cd ${ws0} && set -o pipefail; ${T} 2>&1 | tail -3 >/dev/null`);
console.log("## ① 同一条**必红**的测试，三种写法各自的退出码");
console.log(`   裸跑                       → ${bare}  ${bare === 0 ? "（绿＝假绿）" : "（诚实的红）"}`);
console.log(`   管道接 tail（本仓剧本形状） → ${piped}  ${piped === 0 ? "**← 失败被吞成 0**" : ""}`);
console.log(`   加 set -o pipefail 再接    → ${pipefail}`);
const seen = ["src/tools/run_shell.ts", "src/agent/verify.ts", "src/tools/process.ts"].map(read).join("\n");
console.log(`   全仓（run_shell / verify / process）里设过 pipefail 吗：${/pipefail/.test(seen) ? "有" : "**从未**"}`);
console.log("   ⇒ `ok: code === 0` 读的是**最后一个管道段**的状态；模型把 `npx vitest run 2>&1 | tail -30`");
console.log("     当「我跑过测试了」，而 vitest 红不红根本不参与这个 ok。");
rmSync(ws0, { recursive: true, force: true });

// ---------------- ② 规模 ----------------
const dirs = ["fixtures/mock", "fixtures/agents", "fixtures/no-progress", "fixtures/plugins/check",
  "outputs/loop-eval-v2-base", "outputs/loop-eval-v2-short", "outputs/loop-eval-2026-09-20-base",
  "outputs/loop-eval-2026-09-20-short", "outputs/ga-strategy-2026-09-20", "outputs/ga-strategy-2026-09-20-rep2",
  "outputs/ga-strategy-2026-09-20-rep3", "tmp/ga-smoke"];
const files: string[] = [];
for (const d of dirs) {
  let ns: string[] = [];
  try { ns = readdirSync(join(ROOT, d)); } catch { continue; }
  for (const n of ns) if (n.endsWith(".jsonl")) files.push(join(ROOT, d, n));
}
let shellish = 0, pipedN = 0; const shapeSeen = new Map<string, number>();
for (const f of files) {
  // ⚠️ 不能用上面的 read(rel)：它把路径再和 ROOT 拼一次，绝对路径会变成 ROOT/ROOT/... ⇒ 全读成空串。
  // 这一版本第一版就是这么读到「0 次调用」的——0 命中先怀疑判据，别先怀疑事实。
  let body = "";
  try { body = readFileSync(f, "utf8"); } catch { continue; }
  for (const l of body.split("\n").filter(Boolean)) {
    let e: Record<string, unknown>;
    try { e = JSON.parse(l) as Record<string, unknown>; } catch { continue; }
    if (e.type !== "tool_call") continue;
    const nm = String(e.name ?? "");
    if (nm !== "run_shell" && nm !== "verify") continue;
    const args = (e.args ?? {}) as Record<string, unknown>;
    const cmd = typeof args.command === "string" ? args.command : JSON.stringify(args);
    shellish++;
    if (cmd.includes("|")) {
      pipedN++;
      const key = /\b(vitest|jest|node --test|pytest|cargo test|go test)\b/.test(cmd) ? "测试命令 + 管道" : "其它命令 + 管道";
      shapeSeen.set(key, (shapeSeen.get(key) ?? 0) + 1);
    }
  }
}
let cfgPiped = 0, cfgTotal = 0;
for (const rel of ["package.json", "fixtures/todo-app/package.json"]) {
  for (const m of read(rel).matchAll(/"(?:test|lint|e2e|typecheck)"\s*:\s*"([^"]+)"/g)) { cfgTotal++; if (m[1].includes("|")) cfgPiped++; }
}
console.log("\n## ② 规模");
console.log(`   真语料（${files.length} 个文件）里 run_shell/verify 调用 ${shellish} 次，含管道 ${pipedN} 次 = ${((pipedN / Math.max(1, shellish)) * 100).toFixed(1)}%`);
for (const [k, v] of shapeSeen) console.log(`      ${k}: ${v}`);
console.log(`   配置面（本仓 + 靶子的 scripts.test 等）${cfgTotal} 条，含管道 ${cfgPiped} 条`);
console.log("   ⇒ 分工：verify 的**配置命令**干净（那三道闸没被吞），被吞的是**模型自己跑测试**那条路");
console.log("     ——而模型那句 `ok:true` 正是能力 5 收束闸、能力 14 停滞签名、能力 21 增量的共同输入。");

// ---------------- ③ 实弹（无管道）：改了 A，只验 B ----------------
const ws = realpathSync(mkdtempSync(join(tmpdir(), "align-probe-")));
mkdirSync(join(ws, "src"), { recursive: true });
mkdirSync(join(ws, "tests"), { recursive: true });
writeFileSync(join(ws, "package.json"), '{"name":"p","type":"module"}\n', "utf8");
writeFileSync(join(ws, "src", "a.mjs"), "export const tax = (x) => x * 0.2;\n", "utf8");
writeFileSync(join(ws, "src", "b.mjs"), "export const net = (x) => x - 1;\n", "utf8");
writeFileSync(join(ws, "tests", "a.test.mjs"),
  'import { test } from "node:test";\nimport assert from "node:assert";\nimport { tax } from "../src/a.mjs";\ntest("tax", () => assert.strictEqual(tax(100), 20));\n', "utf8");
writeFileSync(join(ws, "tests", "b.test.mjs"),
  'import { test } from "node:test";\nimport assert from "node:assert";\nimport { net } from "../src/b.mjs";\ntest("net", () => assert.strictEqual(net(10), 9));\n', "utf8");
const ctx = (callId: string): ToolContext => ({ workspace: ws, callId, snapshot: false });
console.log("\n## ③ 实弹（这次不带管道，只测对齐度）");
const wr = await write_file.run({ path: "src/a.mjs", content: "export const tax = (x) => x * 0.5; // 手滑改错\n" }, ctx("w1"));
const vB = await run_shell.run({ command: "node --test tests/b.test.mjs" }, ctx("v1"));
const vBoth = await run_shell.run({ command: "node --test tests/a.test.mjs tests/b.test.mjs" }, ctx("v2"));
const sum = (s: string): string => `pass ${/# pass (\d+)/.exec(s)?.[1] ?? "?"} / fail ${/# fail (\d+)/.exec(s)?.[1] ?? "?"}`;
console.log(`   写盘回执：${wr.output.replace(/\n/g, "\\n")}`);
console.log(`   只验 B（带范围）：ok=${vB.ok} :: ${sum(vB.output)}`);
console.log(`   验 A+B（全量）  ：ok=${vBoth.ok} :: ${sum(vBoth.output)}`);
console.log("   ⇒ 同一处改错：带范围的验面**绿**，把 A 纳进来才**红**。");
const says = /范围|未覆盖|没测|align|不在验面/.test(vB.output + wr.output);
console.log(`   两次回执里有没有任何一处说「改动的 src/a.mjs 不在本次验面内」：${says ? "有" : "**没有**"}`);
rmSync(ws, { recursive: true, force: true });

// ---------------- ④ 机制已在 + 我两次判据缺陷 ----------------
const changed = ["src/a.mjs"];
const cases: Array<[string, string]> = [
  ["node --test tests/b.test.mjs", "真 misaligned"],
  ["node tests/run.mjs", "看着带范围、其实是该仓库的全量 ⇒ 文本判不出来"],
  ["node --test tests/", "抽到空集 ⇒ 必须 unknown，不得判成不相交"],
];
console.log("\n## ④ 同一个配对换个用法（真 globIntersects）");
for (const [cmd, want] of cases) {
  const pats = (cmd.match(/(?:^|\s)((?:tests?|src)\/[^\s|&;]+)/g) ?? []).map((s) => s.trim());
  const verdict = pats.length === 0 ? "unknown   "
    : changed.some((f) => pats.some((p) => globIntersects(f, p) || globIntersects(p, f))) ? "aligned   " : "misaligned";
  console.log(`   命令 ${cmd.padEnd(32)} 验面=[${pats.join(",")}]`.padEnd(74) + `判定=${verdict} ← ${want}`);
}
console.log("   ⇒ **两条我自己踩到的判据坑**（写进 00 §五，不涂掉）：");
console.log("     ① 命令里有路径 ≠ 范围有限：靶子的 `node tests/run.mjs` 就是那仓库的全量；");
console.log("     ② 抽不到路径 = unknown，**绝不许**当成「不相交」——否则每条 `pnpm test` 都会被误报成没覆盖改动。");
console.log("     ⇒ 所以验面必须**声明**或由 runner summary 得出，不能从命令文本猜。");
const consumers = ["src/agent/orchestrator.ts", "src/agent/lease-conflicts.ts", "src/permissions/index.ts"]
  .filter((rel) => /globIntersects\s*\(/.test(read(rel)));
console.log(`   真 globIntersects 的调用方：${consumers.join(", ")} —— 今天只用于 forbidden 路径检查；`);
console.log("     换成「改动面 ∩ 验面」是同一个函数的第二个配对 ⇒ L2 又不需要新机制（免费车，同 13/19/24）。");
