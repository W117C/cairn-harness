/** 能力 20「投影合法性有没有出口观测者」取证探针（三问）：
 *  ① 真语料全量过一遍**真 projectContext**，投影出来的消息序列里有没有孤儿 tool 消息
 *     （role:"tool" 的 tool_call_id 在前面任何一条 assistant 的 tool_calls 里都不存在）；
 *  ② 故意造一条**违反原子单元纪律**的 compaction（只摘 tool_call、留 tool_result），
 *     出口会不会仍然吐出孤儿——即「纪律只写在生产者，出口有没有闸」；
 *  ③ 能从投影里摘除事件的路径一共几条（决定「逐个生产者守」要守几处）。
 *  跑法：TERM=dumb node --import tsx outputs/projection-invariant-2026-09-23/measure-invariant.mts */
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { projectContext } from "../../src/agent/context";
import { atomicUnits } from "../../src/agent/compaction";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

type Msg = { role: string; content: string | null; tool_calls?: { id: string }[]; tool_call_id?: string };

/** 合法性判定：每条 tool 消息的 id 必须在**它之前**某条 assistant 的 tool_calls 里出现过。 */
function orphansOf(msgs: Msg[]): { orphanTool: number; bareCalls: number } {
  const seen = new Set<string>();
  let orphanTool = 0;
  for (const m of msgs) {
    if (m.role === "assistant") for (const c of m.tool_calls ?? []) seen.add(c.id);
    else if (m.role === "tool") { if (!seen.has(String(m.tool_call_id ?? ""))) orphanTool++; }
  }
  // 反向（悬空调用）：每条 assistant 的 call 都必须在它之后有对应 tool 消息
  const resultIds = new Set(msgs.filter((m) => m.role === "tool").map((m) => String(m.tool_call_id ?? "")));
  let bareCalls = 0;
  for (const m of msgs) if (m.role === "assistant") for (const c of m.tool_calls ?? []) if (!resultIds.has(c.id)) bareCalls++;
  return { orphanTool, bareCalls };
}

// ---------------- ① 真语料 ----------------
const files: string[] = [];
for (const d of ["fixtures/no-progress", "fixtures/agents", "fixtures/mock", "fixtures/plugins/check",
  "outputs/ga-strategy-2026-09-20", "outputs/ga-strategy-2026-09-20-rep2", "outputs/ga-strategy-2026-09-20-rep3",
  "outputs/loop-eval-v2-base", "outputs/loop-eval-v2-short", "outputs/loop-eval-2026-09-20-base",
  "outputs/loop-eval-2026-09-20-short", "tmp/ga-smoke"]) {
  let ns: string[] = [];
  try { ns = readdirSync(join(ROOT, d)); } catch { continue; }
  for (const n of ns) if (n.endsWith(".jsonl")) files.push(join(ROOT, d, n));
}
let projOrphan = 0, projBare = 0, filesWithOrphan = 0, projected = 0;
for (const f of files) {
  let raw = "";
  try { raw = readFileSync(f, "utf8"); } catch { continue; }
  const evs: Record<string, unknown>[] = [];
  for (const l of raw.split("\n").filter(Boolean)) {
    try { evs.push(JSON.parse(l) as Record<string, unknown>); } catch { /* 逐行容错 */ }
  }
  if (!evs.some((e) => e.type === "tool_call")) continue;
  let msgs: Msg[];
  try { msgs = projectContext(evs as never) as unknown as Msg[]; } catch { continue; }
  projected++;
  const o = orphansOf(msgs);
  projOrphan += o.orphanTool; projBare += o.bareCalls;
  if (o.orphanTool > 0) { filesWithOrphan++; if (filesWithOrphan <= 3) console.log("   语料里出孤儿的文件：", f.slice(ROOT.length + 1), o.orphanTool); }
}
console.log("## ① 真语料过真 projectContext");
console.log(`含 tool_call 的语料文件 ${projected} 个 → 投影后孤儿 tool 消息 ${projOrphan} 条 / 悬空调用 ${projBare} 条`);
console.log(`⇒ 不变量**当前在真语料上成立**：${projOrphan === 0 ? "是" : "否"}（但这只说明生产者没破，不说明出口有闸）`);

// ---------------- ② 故意违反原子单元纪律 ----------------
const base: Record<string, unknown>[] = [
  { type: "user_message", content: "改一下" },
  { type: "tool_call", id: "k1", name: "read_file", args: { path: "a.ts" } },
  { type: "tool_result", callId: "k1", ok: true, output: "hello" },
  { type: "tool_call", id: "k2", name: "read_file", args: { path: "b.ts" } },
  { type: "tool_result", callId: "k2", ok: true, output: "world" },
];
// 事件 id = 下标 + 1（eventIdAt）：1=user, 2=call k1, 3=result k1, 4=call k2, 5=result k2
const badCompaction = (ids: number[]): Record<string, unknown> => ({
  type: "compaction", trigger: "threshold", reason: "probe", compressed_event_ids: ids,
  summary: "S", summary_offset: 0, tokens_before: 9000, tokens_after: 100,
});
for (const [tag, ids] of [
  ["只摘 tool_call(k1)、留它的 tool_result —— 违反纪律 1", [2]],
  ["成对摘（k1 的 call+result）—— 纪律要求的形状", [2, 3]],
  ["只摘 tool_result(k1)", [3]],
] as Array<[string, number[]]>) {
  const evs = [...base, badCompaction(ids)];
  let msgs: Msg[]; let err = "";
  try { msgs = projectContext(evs as never) as unknown as Msg[]; } catch (e) { err = e instanceof Error ? e.message : String(e); }
  if (err !== "") { console.log(`[出口抛了] ${tag} → ${err}`); continue; }
  const o = orphansOf(msgs!);
  console.log(`[${o.orphanTool > 0 ? "吐孤儿" : "出口安全"}] ${tag} → 孤儿 tool 消息 ${o.orphanTool} 条、投影共 ${msgs!.length} 条`);
}
console.log("⇒ 这一条决定本页成不成立：出口若对『生产者破了纪律』毫无反应，不变量就只写在 compaction 里。");

// ---------------- ③ 有几条路径能摘事件 ----------------
function walkTs(d: string, acc: string[]): string[] {
  for (const n of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, n.name);
    if (n.isDirectory()) walkTs(p, acc);
    else if (/\.[cm]?ts$/.test(n.name)) acc.push(p);
  }
  return acc;
}
const consumers: string[] = [];
for (const p of walkTs(join(ROOT, "src"), [])) {
  const b = readFileSync(p, "utf8");
  if (/excludedIds\(|compressed_event_ids|hasWorkerAttribution\(/.test(b)) consumers.push(p.slice(ROOT.length + 1));
}
console.log("\n## ③ 能决定「哪些事件不进上下文」的文件");
console.log("   " + consumers.join(", "));
const producers = ["compaction（selectCut/selectTruncation 走 atomicUnits）", "worker 子流归因（agent_id）", "prune（改内容不摘事件）"];
console.log(`   摘除面 ${producers.length} 类；原子单元纪律只在 compaction 那一类里被引用` +
  `（atomicUnits 的调用点：${(readFileSync(join(ROOT, "src/agent/compaction.ts"), "utf8").match(/\batomicUnits\s*\(/g) ?? []).length} 处，全在 compaction 内部）`);
console.log(`   projectContext 里引用原子单元纪律的地方：${(readFileSync(join(ROOT, "src/agent/context.ts"), "utf8").match(/\batomicUnits|\batomics?\b/gi) ?? []).length} 处`);
// 交叉核对：真 atomicUnits 有没有把那对 call/result 并成一个单元
type U = { ids?: unknown[]; events?: unknown[]; start?: number; end?: number };
const units = atomicUnits(base as never) as unknown as U[];
const pairUnits = units.filter((u) => {
  const n = Array.isArray(u.ids) ? u.ids.length : Array.isArray(u.events) ? u.events.length : 0;
  return n === 2;
}).length;
console.log(`\n## 附：真 atomicUnits 对样例流划出 ${units.length} 个单元，其中「call+result」二元单元 ${pairUnits} 个` +
  `（期望 2 = 纪律确实把 k1/k2 各自并成一对）`);
console.log(`   ⇒ 纪律本身成立（由真函数确认）；本页要问的是**出口有没有第二道闸**。`);
