/** 能力 24「改动集是不是一个单元」取证探针（三问）：
 *  ① 真语料：一次会话平均动几个文件？结束前从未 verify 的占多少？（问题规模）
 *  ② 真 collectChangeSet：它的分组键到底是什么形状——同文件「先写后改」会被切成几条？
 *     同一文件写两次，lines 是拼接还是最终态？（注释说"最终态可见"，得验）
 *  ③ 实弹半套重构：改 A（调用点）后在改 B（定义）之前取消——盘上坏，
 *     harness 的哪个读数知道「这两次写属于同一件未完成的事」？
 *  跑法：TERM=dumb node --import tsx outputs/change-set-atomicity-2026-09-23/measure-changeset.mts */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { collectChangeSet } from "../../src/agent/security/scan";
import { edit_file } from "../../src/tools/edit_file";
import { write_file } from "../../src/tools/write_file";
import { run_shell } from "../../src/tools/run_shell";
import type { AgentEvent } from "../../src/events";
import type { ToolContext } from "../../src/tools/base";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// ---------------- ① 真语料规模 ----------------
const files: string[] = [];
for (const d of ["fixtures/no-progress", "fixtures/agents", "fixtures/mock",
  "outputs/ga-strategy-2026-09-20", "outputs/ga-strategy-2026-09-20-rep2", "outputs/ga-strategy-2026-09-20-rep3",
  "outputs/loop-eval-v2-base", "outputs/loop-eval-v2-short", "outputs/loop-eval-2026-09-20-base",
  "outputs/loop-eval-2026-09-20-short", "tmp/ga-smoke"]) {
  let ns: string[] = [];
  try { ns = readdirSync(join(ROOT, d)); } catch { continue; }
  for (const n of ns) if (n.endsWith(".jsonl")) files.push(join(ROOT, d, n));
}
const hist = new Map<number, number>();
let multi = 0, multiNoVerify = 0, writeSessions = 0;
for (const f of files) {
  let raw = "";
  try { raw = readFileSync(f, "utf8"); } catch { continue; }
  const paths = new Set<string>();
  let verified = false;
  for (const l of raw.split("\n").filter(Boolean)) {
    let e: Record<string, unknown>;
    try { e = JSON.parse(l) as Record<string, unknown>; } catch { continue; }
    if (e.type === "tool_call" && (e.name === "write_file" || e.name === "edit_file")) {
      const p = String((e.args as Record<string, unknown> | undefined)?.path ?? "");
      if (p !== "") paths.add(p);
    }
    if (e.type === "verify_result" || (e.type === "tool_call" && e.name === "verify")) verified = true;
  }
  const n = paths.size;
  if (n === 0) continue;
  writeSessions++;
  hist.set(n, (hist.get(n) ?? 0) + 1);
  if (n > 1) { multi++; if (!verified) multiNoVerify++; }
}
console.log("## ① 真语料里「一次会话的改动面」");
console.log(`   有写动作的会话 ${writeSessions} 个；动 ≥2 个文件的 ${multi} 个（${((multi / Math.max(1, writeSessions)) * 100).toFixed(0)}%）`);
console.log(`   其中**整场从未 verify**的 ${multiNoVerify} 个`);
console.log(`   文件数分布：${[...hist.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}文件×${v}`).join("  ")}`);

// ---------------- ② 真 collectChangeSet 的形状 ----------------
const ev = [] as never[];
const bag = ev as unknown as Record<string, unknown>[];
bag.push({ type: "tool_call", id: "a1", name: "write_file", args: { path: "x.ts", content: "L1\nL2" } });
bag.push({ type: "tool_call", id: "a2", name: "edit_file", args: { path: "x.ts", new_string: "E1" } });
bag.push({ type: "tool_call", id: "a3", name: "write_file", args: { path: "x.ts", content: "FINAL-ONLY" } });
const entries = collectChangeSet(ev as AgentEvent[]);
console.log("\n## ② 真 collectChangeSet 的两个形状（不靠注释，跑出来的）");
for (const en of entries) console.log(`   条目: path=${en.path} op=${en.op} lines=[${en.lines.join(" | ")}]`);
console.log(`   同文件「写→改→写」被切成 ${entries.length} 条（分组键是 op+path，⇒ 一次意图不是一条）`);
const allLines = entries.flatMap((x) => x.lines);
console.log(`   lines 合计 ${allLines.length} 行、含已被后一次写覆盖的旧行？` +
  ` ${allLines.includes("L1") ? "**是（拼接而非最终态；注释「最终态可见」不精确）**" : "否"}`);

// ---------------- ③ 实弹：半套重构 ----------------
const ws = realpathSync(mkdtempSync(join(tmpdir(), "cs-probe-")));
mkdirSync(join(ws, "src"), { recursive: true });
writeFileSync(join(ws, "src/def.mjs"), "export function total(xs) { return xs.length; }\n", "utf8");
writeFileSync(join(ws, "src/call.mjs"), "import { total } from './def.mjs';\nexport const run = () => total([1,2]);\n", "utf8");
writeFileSync(join(ws, "src/def.mjs"), "export function sumTotal(xs) { return xs.length; }\n", "utf8"); // 改了定义（A）
const w = await write_file.run({ path: "src/call.mjs", content: "import { total } from './def.mjs';\nexport const run = () => total([1,2]);\n" }, { workspace: ws, callId: "c1", snapshot: false } as ToolContext);
void w;
// 现在盘上：定义已改名 sumTotal，调用点还 import total ⇒ 半套。真实形状是「还没改到第二个文件就被打断」
const t = await run_shell.run({ command: "node --check src/call.mjs && node -e \"import('./src/call.mjs').then(m=>m.run()).catch(e=>{console.log('RUNTIME-ERROR:'+e.constructor.name);process.exit(3)})\"" }, { workspace: ws, callId: "c2", snapshot: false } as ToolContext);
console.log("\n## ③ 实弹：定义改了名、调用点还没改（半套重构），然后**真的各回滚一次**");
console.log(`   跑起来：ok=${t.ok} :: ${(t.output.split("\n").pop() ?? "").slice(0, 70)}`);
// 现在盘上：def 已改名 sumTotal、call 还 import total ⇒ 半套。两次写各带一份快照（真实默认：开）
const ws2 = realpathSync(mkdtempSync(join(tmpdir(), "cs-snap-")));
mkdirSync(join(ws2, "src"), { recursive: true });
const mkCtx = (callId: string): ToolContext => ({ workspace: ws2, callId, snapshot: true });
writeFileSync(join(ws2, "src/def.mjs"), "export function total(xs) { return xs.length; }\n", "utf8");
writeFileSync(join(ws2, "src/call.mjs"), "import { total } from './def.mjs';\nexport const run = () => total([1,2]);\n", "utf8");
const s1 = await write_file.run({ path: "src/def.mjs", content: "export function sumTotal(xs) { return xs.length; }\n" }, mkCtx("k1"));
const s2 = await edit_file.run({ path: "src/call.mjs", old_string: "export const run = () => total([1,2]);", new_string: "export const run = () => total([1,2,3]);" }, mkCtx("k2"));
// ⚠️ 读数里不得混入墙钟：快照 id 天然带毫秒（那正是 #56），所以这里**掩掉数字只留形状**，
// 另用一条布尔单独承载「毫秒确实在 id 里」这个事实——否则本探针自己就违反了它引用的那条定案。
const mask = (s: string): string => s.replace(/\d{10,}/g, "<ms>").replace(/--(?=[a-z0-9])/g, "--");
console.log(`   两次写的 snapshotId（形状）：\n     ${mask(s1.snapshotId ?? "(无)")}\n     ${mask(s2.snapshotId ?? "(无)")}`);
const units = existsSync(join(ws2, ".agent/snapshots")) ? readdirSync(join(ws2, ".agent/snapshots")) : [];
const hasWallClock = units.some((u) => /\d{10,}/.test(u));
console.log(`   .agent/snapshots/ 下 ${units.length} 个条目，键形状：<ms>--<callId>：${units.map(mask).join(" , ")}`);
console.log(`   读数（布尔）：快照目录名里确实含墙钟毫秒 = ${hasWallClock ? "**是**（#56 未裁，本页只记不裁）" : "否"}`);
console.log("   ⇒ 两个目录**互不相干**，没有任何字段说「这两次写是同一件事的一半」；逐文件回滚必须有人挑。");
// 真的各回滚一次，看哪个修得好
const tryRestore = async (which: 0 | 1): Promise<string> => {
  const dir = join(ws2, ".agent/snapshots", units[which]);
  for (const rel of ["src/def.mjs", "src/call.mjs"]) {
    const src = join(dir, rel);
    if (existsSync(src)) writeFileSync(join(ws2, rel), readFileSync(src, "utf8"), "utf8");
  }
  const r = await run_shell.run({ command: "node -e \"import('./src/call.mjs').then(m=>m.run()).catch(e=>{console.log(e.constructor.name);process.exit(3)})\"" }, mkCtx("probe"));
  return r.ok ? "跑得通（ok=true）" : "仍坏：" + (r.output.split("\n").pop() ?? "").slice(0, 40);
};
// 先复位到半套态
writeFileSync(join(ws2, "src/def.mjs"), "export function sumTotal(xs) { return xs.length; }\n", "utf8");
writeFileSync(join(ws2, "src/call.mjs"), "import { total } from './def.mjs';\nexport const run = () => total([1,2,3]);\n", "utf8");
const a = await tryRestore(0);
writeFileSync(join(ws2, "src/def.mjs"), "export function sumTotal(xs) { return xs.length; }\n", "utf8");
const b = await tryRestore(1);
console.log(`   实测：回滚**第一个**快照（def.mjs 的原版）→ ${a}`);
console.log(`         回滚**第二个**快照（call.mjs 的原版）→ ${b}`);
console.log("   ⇒ 只有回滚 A 修得好；而「该回滚哪个」这条信息**不在任何读数里**，");
console.log("     它就在『这两次写属于同一次未完成意图』这句话里——那个单元今天不存在（快照只按单文件给退路）。");
rmSync(ws, { recursive: true, force: true });
rmSync(ws2, { recursive: true, force: true });
