/** 能力 16「读过的账」取证探针（两问，一次跑齐）：
 *  ① 真语料里「写一个本会话没读过的文件」到底多常见（缺口是不是真的存在）；
 *  ② 直接驱动真实的 write_file / edit_file，看**今天**的回执在第三方已改过的文件上说什么。
 *  跑法：TERM=dumb node --import tsx outputs/stale-view-guard-2026-09-23/measure-stale-view.mts
 *  只读语料、只往临时目录写；不碰仓库工作树，不碰判卷文件。输出不含 Date.now（可逐字复跑）。 */
import { readdirSync, readFileSync, mkdtempSync, mkdirSync, realpathSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { write_file } from "../../src/tools/write_file";
import { edit_file } from "../../src/tools/edit_file";
import { read_file } from "../../src/tools/read_file";
import type { ToolContext } from "../../src/tools/base";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const READ_TOOLS = new Set(["read_file"]);
const WRITE_TOOLS = new Set(["write_file", "edit_file"]);

interface Call { seq: number; name: string; path: string; ok: boolean | null; out: string; bytes: number; }

/** 遍历一个 events.jsonl，按 callId 把 tool_call 与 tool_result 配对。 */
function parseSession(file: string): Call[] | null {
  let raw: string;
  try { raw = readFileSync(file, "utf8"); } catch { return null; }
  const lines = raw.split("\n").filter((l) => l !== "");
  if (lines.length === 0) return null;
  const byId = new Map<string, { ok: boolean; out: string }>();
  const calls: Call[] = [];
  let seq = 0;
  for (const l of lines) {
    let e: Record<string, unknown>;
    try { e = JSON.parse(l) as Record<string, unknown>; } catch { continue; }
    if (e.type === "tool_result") {
      const cid = String(e.callId ?? "");
      byId.set(cid, { ok: Boolean(e.ok), out: String(e.output ?? "") });
      continue;
    }
    if (e.type !== "tool_call") continue;
    const name = String(e.name ?? "");
    const args = (e.args ?? {}) as Record<string, unknown>;
    const path = typeof args.path === "string" ? args.path : "";
    if (path === "") continue;
    const id = String(e.id ?? "");
    const paired = byId.get(id);
    calls.push({
      seq: seq++, name, path,
      ok: paired ? paired.ok : null,
      out: paired ? paired.out : "",
      bytes: typeof args.content === "string" ? args.content.length
        : typeof args.new_string === "string" ? args.new_string.length : 0,
    });
  }
  return calls;
}

/** 回执文本里「本会话此前没见过这个路径」的判据：只认工具自己报出的事实。 */
function sawPathEarlier(calls: Call[], i: number, path: string): { read: boolean; via: string; gapCalls: number } {
  for (let j = i - 1; j >= 0; j--) {
    const c = calls[j];
    if (c.ok === false) continue;
    if (READ_TOOLS.has(c.name) && c.path === path) return { read: true, via: c.name, gapCalls: i - j };
    // 第三方通道：shell 里 cat/head/sed/grep 该路径，同样「见过内容」，只是没走 read_file。
    if (c.name === "run_shell" && c.out !== "" && new RegExp(`\\b(${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`).test(c.out)) {
      return { read: true, via: "run_shell", gapCalls: i - j };
    }
  }
  return { read: false, via: "", gapCalls: -1 };
}

function classifyEditFailure(out: string): string {
  if (/0 处匹配/.test(out)) return "0匹配";
  if (/匹配 \d+ 处/.test(out)) return "多处匹配";
  if (/文件不存在或不可读/.test(out)) return "文件不存在";
  return "其它";
}

// ---------------- ① 真语料 ----------------
const corpusFiles: string[] = [];
for (const relDir of ["fixtures/no-progress", "outputs/ga-strategy-2026-09-20", "outputs/ga-strategy-2026-09-20-rep2",
  "outputs/ga-strategy-2026-09-20-rep3", "outputs/loop-eval-v2-base", "outputs/loop-eval-v2-short",
  "outputs/loop-eval-2026-09-20-base", "outputs/loop-eval-2026-09-20-short", "tmp/ga-smoke"]) {
  const d = join(ROOT, relDir);
  let names: string[] = [];
  try { names = readdirSync(d); } catch { continue; }
  for (const n of names) if (n.endsWith(".events.jsonl")) corpusFiles.push(join(d, n));
}

let nSessions = 0, totalCalls = 0, writes = 0, blindWrites = 0, blindWritesHard = 0;
const gaps: number[] = [];
const editFails = new Map<string, number>();
let escalations = 0, rewriteBytes = 0, editBytes = 0, repeatOverwrite = 0;
const truncatedReads = new Map<string, number>();

for (const f of corpusFiles) {
  const calls = parseSession(f);
  if (calls === null || calls.length === 0) continue;
  nSessions++; totalCalls += calls.length;
  const lastWriteOfPath = new Map<string, number>();
  for (let i = 0; i < calls.length; i++) {
    const c = calls[i];
    if (WRITE_TOOLS.has(c.name)) {
      writes++;
      const seen = sawPathEarlier(calls, i, c.path);
      if (!seen.read) { blindWrites++; if (c.name === "write_file") blindWritesHard++; }
      else if (seen.gapCalls > 0) gaps.push(seen.gapCalls);
      if (c.name === "write_file") rewriteBytes += c.bytes; else editBytes += c.bytes;
      const prev = lastWriteOfPath.get(c.path);
      if (prev !== undefined && sawPathEarlier(calls.slice(prev, i + 1), i - prev, c.path).read === false) repeatOverwrite++;
      lastWriteOfPath.set(c.path, i);
      // 升级签名：同一路径此前 edit_file 失败过。
      for (let j = 0; j < i; j++) {
        const p = calls[j];
        if (p.name === "edit_file" && p.path === c.path && p.ok === false && c.name === "write_file") { escalations++; break; }
      }
    } else if (c.name === "edit_file" && c.ok === false) {
      const k = classifyEditFailure(c.out);
      editFails.set(k, (editFails.get(k) ?? 0) + 1);
    } else if (READ_TOOLS.has(c.name) && c.ok !== false) {
      const t = /\[truncated:/.test(c.out) ? "截断" : /\[offset:/.test(c.out) ? "窗口" : "整份";
      truncatedReads.set(t, (truncatedReads.get(t) ?? 0) + 1);
    }
  }
}

const pct = (a: number, b: number) => b === 0 ? "—" : (Math.round((a / b) * 1000) / 10).toFixed(1) + "%";
console.log("## ① 真语料（本仓 events.jsonl）");
console.log(`会话文件 ${nSessions} 个 / 工具调用 ${totalCalls} 次 / 写侧调用 ${writes} 次`);
console.log(`M1 写前从未 read_file 过该路径：${blindWrites}/${writes} = ${pct(blindWrites, writes)}`);
console.log(`M1b 其中整份 write_file（最高危）：${blindWritesHard}`);
console.log(`M2 read_file 覆盖面：${[...truncatedReads.entries()].map(([k, v]) => `${k} ${v}`).join(" / ") || "无"}`);
console.log(`M3 edit_file 失败分类：${[...editFails.entries()].map(([k, v]) => `${k} ${v}`).join(" / ") || "0 次失败"}`);
console.log(`M4 升级签名（edit 失败→同路径整份重写）：${escalations}`);
console.log(`M5 同路径无重读的二次覆盖：${repeatOverwrite}`);
console.log(`M6 read→write 间隔（工具调用数）：n=${gaps.length} ${gaps.length ? "中位 " + gaps.slice().sort((a, b) => a - b)[Math.floor(gaps.length / 2)] + " 最大 " + Math.max(...gaps) : ""}`);
console.log(`M7 字节面：整份重写 ${rewriteBytes} vs 精确编辑 ${editBytes}（比值 ${rewriteBytes === 0 ? "—" : (rewriteBytes / Math.max(1, editBytes)).toFixed(1) + "×"}）`);

// ---------------- ② 实弹：驱动真实工具 ----------------
const ws = realpathSync(mkdtempSync(join(tmpdir(), "stale-view-probe-")));
const rel = "src/widget.ts";
const abs = join(ws, rel);
mkdirSync(join(ws, "src"), { recursive: true });
const V1 = "export function total(n: number): number {\n  return n * 1;\n}\n";
const V2 = "export function total(n: number): number {\n  return n * 1;\n}\n\n// 第三方加的：一行审计日志\nexport const audit = true;\n";

async function ctx(callId: string): Promise<ToolContext> {
  return { workspace: ws, callId, snapshot: false };
}

console.log("\n## ② 实弹：模型看过 V1，盘上已是 V2（第三方加了一行），模型此刻落笔");
writeFileSync(abs, V1, "utf8");
const r1 = await read_file.run({ path: rel }, await ctx("c1"));
console.log(`[read_file] ok=${r1.ok} 输出前 40 字：${r1.output.slice(0, 40).replace(/\n/g, "\\n")}…`);
writeFileSync(abs, V2, "utf8"); // 第三方（格式化器 / 并发 worker / 用户）改了盘

// (a) 模型按 V1 的整份认知做 write_file
const staleFull = V1.replace("return n * 1;", "return n * 2;");
const r2 = await write_file.run({ path: rel, content: staleFull }, await ctx("c2"));
console.log(`[write_file 回执] ok=${r2.ok} :: ${r2.output.replace(/\n/g, "\\n")}`);
const after = readFileSync(abs, "utf8");
console.log(`[盘上事实] audit 那一行还在吗：${/audit/.test(after) ? "在" : "**被静默删掉了**"}（第三方新增行数 1，回执是否提到它：${/audit/.test(r2.output) || /未读|没见过|覆盖/.test(r2.output) ? "提到了" : "**没提**"}）`);

// (b) 第三方改动之后，模型按旧视图做 edit_file（0 匹配路径的长什么样）
writeFileSync(abs, V2, "utf8");
const r3 = await edit_file.run({ path: rel, old_string: "export const audit = true;\n", new_string: "" }, await ctx("c3"));
console.log(`[edit_file 删第三方行] ok=${r3.ok} :: ${r3.output.slice(0, 90).replace(/\n/g, "\\n")}`);

// (c) 从没读过就直接写（新建 vs 覆盖，回执可分吗）
writeFileSync(abs, V2, "utf8");
const r4 = await write_file.run({ path: rel, content: "export const x = 1;\n" }, await ctx("c4"));
console.log(`[write_file 从未读过该文件] ok=${r4.ok} :: ${r4.output.replace(/\n/g, "\\n")}`);
console.log(`[判读] 这条回执说了「删了 ${V2.trimEnd().split("\n").length} 行你没读过的内容」吗：${/未读|没见过|你没|覆盖别人/.test(r4.output) ? "说了" : "**没说**"}`);

rmSync(ws, { recursive: true, force: true });
