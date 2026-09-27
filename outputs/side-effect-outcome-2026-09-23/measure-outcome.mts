/** 能力 17「结果未知三态」取证探针（三问，一次跑齐）：
 *  ① 真语料里 ok:false 的 tool_result 各自属于哪一类（今天全塌成一个字符串）；
 *  ② 「副作用已发生但回执是失败」能不能实弹复现（超时 / 取消两条路）；
 *  ③ 本仓到底有几份「这是不是写副作用」的名单（设计要复用哪一份）。
 *  跑法：TERM=dumb node --import tsx outputs/side-effect-outcome-2026-09-23/measure-outcome.mts
 *  ② 的超时那条会真等 60s（SHELL_TIMEOUT_MS 是常量、不可注入）——要快就加 --skip-timeout。
 *  只往 mkdtemp 临时目录写，不碰仓库工作树，不碰判卷文件；输出不含 Date.now。 */
import { readdirSync, readFileSync, mkdtempSync, mkdirSync, realpathSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { run_shell } from "../../src/tools/run_shell";
import type { ToolContext } from "../../src/tools/base";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SKIP_TIMEOUT = process.argv.includes("--skip-timeout");

// ---------------- ① 真语料：ok:false 的分类学 ----------------
const BUCKETS: Array<[string, RegExp]> = [
  ["动过手·超时", /超时（60s）/],
  ["动过手·取消", /随会话取消终止/],
  ["确定跑过·非零退出", /\[exit code: /],
  ["没动手·权限门", /\[permission denied\]/],
  ["没动手·参数或前置校验", /0 处匹配|匹配 \d+ 处|必须是非空字符串|必须是字符串|文件不存在或不可读|unknown tool|超过 50KB 上限|必须是非空/],
];
const corpusFiles: string[] = [];
for (const relDir of ["fixtures/no-progress", "fixtures/agents", "fixtures/mock", "fixtures/plugins/check",
  "outputs/ga-strategy-2026-09-20", "outputs/ga-strategy-2026-09-20-rep2", "outputs/ga-strategy-2026-09-20-rep3",
  "outputs/loop-eval-v2-base", "outputs/loop-eval-v2-short", "outputs/loop-eval-2026-09-20-base",
  "outputs/loop-eval-2026-09-20-short", "tmp/ga-smoke"]) {
  const d = join(ROOT, relDir);
  let names: string[] = [];
  try { names = readdirSync(d); } catch { continue; }
  for (const n of names) if (n.endsWith(".jsonl")) corpusFiles.push(join(d, n));
}
let results = 0, notOk = 0, dangling = 0;
const bucket = new Map<string, number>();
const unclassified: string[] = [];
const danglingNames = new Map<string, number>();
for (const f of corpusFiles) {
  let raw = "";
  try { raw = readFileSync(f, "utf8"); } catch { continue; }
  const done = new Set<string>();
  const calls: Array<{ id: string; name: string }> = [];
  for (const l of raw.split("\n").filter(Boolean)) {
    let e: Record<string, unknown>;
    try { e = JSON.parse(l) as Record<string, unknown>; } catch { continue; }
    if (e.type === "tool_result") {
      done.add(String(e.callId ?? ""));
      results++;
      if (e.ok === true) continue;
      notOk++;
      const out = String(e.output ?? "");
      const hit = BUCKETS.find(([, re]) => re.test(out));
      if (hit) bucket.set(hit[0], (bucket.get(hit[0]) ?? 0) + 1);
      else { bucket.set("未分类", (bucket.get("未分类") ?? 0) + 1); if (unclassified.length < 6) unclassified.push(out.slice(0, 70).replace(/\s+/g, " ")); }
    } else if (e.type === "tool_call") calls.push({ id: String(e.id ?? ""), name: String(e.name ?? "") });
  }
  for (const c of calls) if (!done.has(c.id)) { dangling++; danglingNames.set(c.name, (danglingNames.get(c.name) ?? 0) + 1); }
}
console.log("## ① 真语料（", corpusFiles.length, "个 jsonl）");
console.log(`tool_result ${results} 条 / 其中 ok:false ${notOk} 条（${notOk === 0 ? "—" : ((notOk / results) * 100).toFixed(1) + "%"}）`);
for (const [k, v] of [...bucket.entries()].sort((a, b) => b[1] - a[1])) console.log(`   ${k}: ${v}`);
if (unclassified.length > 0) console.log("   未分类样本：", unclassified.map((s) => `「${s}」`).join(" | "));
console.log(`无 tool_result 的调用（悬空 = 崩在中间的那种）：${dangling} 条`,
  "→", [...danglingNames.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k} ${v}`).join(" / "));

// ---------------- ② 实弹：副作用发生了，回执说什么 ----------------
const ws = realpathSync(mkdtempSync(join(tmpdir(), "outcome-probe-")));
mkdirSync(join(ws, "work"), { recursive: true });
const mkCtx = (callId: string, signal?: AbortSignal): ToolContext => ({ workspace: ws, callId, ...(signal ? { signal } : {}) });

console.log("\n## ② 实弹：命令先落一个副作用、再卡住");
writeFileSync(join(ws, "work/marker.txt"), "before\n", "utf8");
const cancel = new AbortController();
setTimeout(() => cancel.abort(), 400);
const rCancel = await run_shell.run(
  { command: "echo landed-by-agent > work/marker.txt; sleep 5" }, mkCtx("c-cancel", cancel.signal));
console.log(`[取消路] ok=${rCancel.ok} :: 回执尾行：${rCancel.output.split("\n").pop() ?? "(无)"}`);
console.log(`         盘上事实：marker.txt = ${readFileSync(join(ws, "work/marker.txt"), "utf8").trim()}` +
  ` ⇒ 副作用**确实发生了**${existsSync(join(ws, "work/marker.txt")) && readFileSync(join(ws, "work/marker.txt"), "utf8").includes("landed-by-agent") ? "，但回执只有 ok:false + 一句中文" : ""}`);

if (!SKIP_TIMEOUT) {
  writeFileSync(join(ws, "work/marker2.txt"), "before\n", "utf8");
  const rTo = await run_shell.run({ command: "echo wrote-then-hung > work/marker2.txt; sleep 120" }, mkCtx("c-timeout"));
  console.log(`[超时路] ok=${rTo.ok} :: 回执尾行：${rTo.output.split("\n").pop() ?? "(无)"}`);
  console.log(`         盘上事实：marker2.txt = ${readFileSync(join(ws, "work/marker2.txt"), "utf8").trim()} ⇒ 半跑：写已落、进程被组杀`);
} else console.log("[超时路] 已跳过（--skip-timeout）");

// 「没动手」的对照：同一张 ok:false，语义完全相反
let preflight = "";
try { await run_shell.run({ command: "   " }, mkCtx("c-bad")); } catch (err) { preflight = err instanceof Error ? err.message : String(err); }
console.log(`[前置校验失败路] 抛出 → loop 转成 ok:false :: ${preflight}`);
console.log(`判读：上面三条落进事件流之后**逐字段相同**（type/callId/ok/output），` +
  `模型只能靠中文文案猜「要不要重发」——而「重发」对第一条是**重复副作用**，对第三条是**安全的**。`);

// ---------------- ③ 「这是不是写副作用」的名单有几份 ----------------
function walkTs(d: string, acc: string[]): string[] {
  for (const n of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, n.name);
    if (n.isDirectory()) walkTs(p, acc);
    else if (n.name.endsWith(".ts")) acc.push(p);
  }
  return acc;
}
const TAX = ["isSideEffectTool", "isSideEffect", "WRITE_TOOLS", "mainSessionSideEffect", "isWriteCall", "destructive"];
const hits = new Map<string, string[]>();
for (const p of walkTs(join(ROOT, "src"), [])) {
  const body = readFileSync(p, "utf8");
  for (const t of TAX) if (new RegExp(`\\b${t}\\b`).test(body)) {
    hits.set(t, [...(hits.get(t) ?? []), p.slice(ROOT.length + 1)]);
  }
}
console.log("\n## ③ 「副作用 / 写工具」名单有几份（设计要复用哪一份，而不是再抄一份）");
for (const t of TAX) {
  const where = hits.get(t) ?? [];
  console.log(`   ${t}: ${where.length} 处${where.length ? " → " + where.join(", ") : ""}`);
}
console.log(`   合计不同名字 ${TAX.length} 个 / 落在 ${new Set([...hits.values()].flat()).size} 个文件里`);
rmSync(ws, { recursive: true, force: true });
