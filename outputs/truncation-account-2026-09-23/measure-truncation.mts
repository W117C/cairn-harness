/** 能力 31「截断账」取证探针（四问）：
 *  ① 空位核对：截断**标注**本仓做得很好（四路 notice），但那个数有没有活成**字段**？
 *  ② 真 `createOutputRing`：中文输出下，notice 里那句「省略 N 字节」报的是字节还是 UTF-16 字符？
 *  ③ 同一只 ring 被几条路共用（verify 是不是也吃这个数）。
 *  ④ 真语料：带 `[truncated` 的 result 有多少条，其后有没有回补同一文件。
 *  跑法：TERM=dumb node --import tsx outputs/truncation-account-2026-09-23/measure-truncation.mts */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createOutputRing } from "../../src/tools/output-ring";
import { middleTruncationNotice, truncationNotice } from "../../src/tools/base";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
function walk(d: string, acc: string[]): string[] {
  for (const n of readdirSync(join(ROOT, d), { withFileTypes: true })) {
    const rel = d + "/" + n.name;
    if (n.isDirectory()) walk(rel, acc);
    else if (/\.[cm]?ts$/.test(n.name)) acc.push(rel);
  }
  return acc;
}
const SRC = walk("src", []);
const body = (rel: string): string => {
  const p = join(ROOT, rel);
  return existsSync(p) ? readFileSync(p, "utf8") : "";
};
const toolResultBlock = /export interface ToolResult \{([\s\S]*?)\n\}/.exec(body("src/tools/base.ts"))?.[1] ?? "";

// ---------------- ① 标注在，字段在不在 ----------------
const noticeProducers = SRC.filter((rel) => /truncationNotice|middleTruncationNotice|\[truncated|\[行截断|\[offset:/.test(body(rel)));
const fieldOnResult = /\b(truncated\??:|omittedBytes\??:|omittedChars\??:|droppedBytes\??:)/.test(toolResultBlock);
const paramOnly = /middleTruncationNotice\(\s*omittedBytes/.test(body("src/tools/base.ts"));
console.log("## ① 截断「标注」vs 截断「字段」");
console.log(`   产出截断提示的文件 ${noticeProducers.length} 个：${noticeProducers.map((f) => f.replace("src/", "")).join(", ")}`);
console.log(`   ToolResult 的字段：${toolResultBlock.split("\n").filter((l) => /^\s*\w+\???:/.test(l)).map((l) => l.trim().split(":")[0]).join(", ")}`);
console.log(`   ToolResult 上有截断字段吗：${fieldOnResult ? "有" : "**没有**"}` +
  `（仓内那个 omittedBytes 只是 ${paramOnly ? "middleTruncationNotice 的**形参名**" : "别的东西"}——` +
  "数到形参不等于有字段，同 21 页把类型声明数成生产者的那次）");
console.log("   ⇒ 本仓把「如实报出省略了多少」做得比多数实现好（连提示行自己占的字节都留了位），");
console.log("     但那个数**只活在正文字符串里**。同文件 `exitCode` 的注释早就写明这是本仓的老毛病：");
console.log("     「结构化信号在 settle 时被丢掉 ⇒ 任何想区分…的读者只能去匹配文案」。");

// ---------------- ② 单位：字节还是字符 ----------------
function runRing(chunkText: string, chunks: number, limitBytes: number): { notice: string; keptBytes: number; fedBytes: number } {
  const ring = createOutputRing(limitBytes);
  let fed = 0;
  for (let i = 0; i < chunks; i++) { ring.push(chunkText); fed += Buffer.byteLength(chunkText, "utf8"); }
  const out = ring.read();
  const m = /省略中间 (\d+) 字节/.exec(out);
  return { notice: m === null ? "（无省略提示）" : `省略中间 ${m[1]} 字节`, keptBytes: Buffer.byteLength(out, "utf8"), fedBytes: fed };
}
const ASCII = "x".repeat(2000);
const CJK = "错".repeat(2000);
const LIM = 8192;
const a = runRing(ASCII, 8, LIM);
const c = runRing(CJK, 8, LIM);
const num = (s: string): number => Number((/(\d+)/.exec(s) ?? ["0", "0"])[1]);
console.log("\n## ② 真 createOutputRing：「省略中间 N 字节」的 N 是什么单位");
console.log(`   同一只 ring、同一个上限 ${String(LIM)}B，喂 8 块 ×2000 单元：`);
console.log(`   · 纯 ASCII：喂入 ${String(a.fedBytes)}B → 输出 ${String(a.keptBytes)}B → notice 报「${a.notice}」→ 真实省略 ${String(a.fedBytes - a.keptBytes + 0)}B 级`);
console.log(`   · 全中文（每字 3 字节）：喂入 ${String(c.fedBytes)}B → 输出 ${String(c.keptBytes)}B → notice 报「${c.notice}」`);
const asciiGap = a.fedBytes - a.keptBytes;
const cjkGap = c.fedBytes - c.keptBytes;
console.log(`   对账：ASCII 场景 |真实省略 - notice| = ${String(Math.abs(asciiGap - num(a.notice)))}；` +
  `中文场景 真实省略 = ${String(cjkGap)}B，notice 报 ${String(num(c.notice))} ⇒ 少报 ${String(cjkGap - num(c.notice))}（约 ${(cjkGap / Math.max(1, num(c.notice))).toFixed(1)}×）`);
console.log(`   **上限承诺本身**（同文件注释写的是「不给它留位就会把「输出 ≤ 上限」这句承诺撑破」）：`);
console.log(`     上限 ${String(LIM)}B ⇒ ASCII 输出 ${String(a.keptBytes)}B ${a.keptBytes <= LIM ? "守住" : "**破**"}；` +
  `中文输出 ${String(c.keptBytes)}B ${c.keptBytes <= LIM ? "守住" : "**破 " + (c.keptBytes / LIM).toFixed(1) + "×**"}`);
console.log("   ⇒ 两个症状同一只根：所有长度判据（`out.length > limitBytes`、`seen`、`tail.length > tailBytes`）");
console.log("     用的都是 **UTF-16 字符数**，而常量与文案都叫 `BYTES`/「字节」。");
console.log("     ASCII 下两者相等所以从来没露馅；中文输出下不但少报省略量，**帽也被撑破到 3×**。");
console.log("     后果面：run_shell/verify 的 32KB 帽是上下文预算的一部分（本仓 AGENTS.md 的「消耗 token 最少」），");
console.log("     一份中文报错实打实能吃掉 ~96KB，而读数上记的是 32KB。");
console.log("   机制（读码）：`read()` 里算的是 `seen - headBytes - tail.length`，而 `seen` 是**字符串累加**");
console.log("   （`seen += s.length`，UTF-16 字符数），`headBytes`/`tailBytes` 却是按字节预算命名分配的。");
console.log("   同文件注释还专门记过一笔「既有 UTF-8 字节判据实测红过一次」⇒ 这个混用不是新坑，是**又踩了一次同一个坑的另一半**。");
console.log("   ⚠️ 措辞边界：本问只断言「单位混用 ⇒ 中文输出下少报」，不断言 ring 的**保留策略**有问题（头+尾环是对的）。");

// ---------------- ③ 共用出口 ----------------
const ringUsers = SRC.filter((rel) => /createOutputRing/.test(body(rel)));
console.log("\n## ③ 同一只 ring 被几条路共用");
console.log(`   createOutputRing 的消费者：${ringUsers.map((f) => f.replace("src/", "")).join(", ")}`);
console.log("   ⇒ ② 的少报会**同时**进 run_shell 与 verify 两条路（文件头注释写明这是刻意的同份实现）：");
console.log("     verify 正是「最需要尾部结论」的那条，它的截断口径错，下游的判卷读数一起错。");

// ---------------- ④ 语料：截断发不发生、有没有回补 ----------------
function findJsonl(d: string, acc: string[]): string[] {
  const abs = join(ROOT, d);
  if (!existsSync(abs)) return acc;
  for (const n of readdirSync(abs, { withFileTypes: true })) {
    const p = join(abs, n.name);
    if (n.isDirectory()) findJsonl(d + "/" + n.name, acc);
    else if (n.name.endsWith(".events.jsonl")) acc.push(p);
  }
  return acc;
}
const files = findJsonl("outputs", []).sort();
let results = 0, truncResults = 0, truncAt32K = 0, nearLimit = 0, refilled = 0, notRefilled = 0;
for (const f of files) {
  type Ev = Record<string, unknown>;
  const evs: Ev[] = [];
  for (const line of readFileSync(f, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { evs.push(JSON.parse(line) as Ev); } catch { /* 逐行容错 */ }
  }
  const nameById = new Map<string, string>();
  const pathById = new Map<string, string>();
  const idxOfCall = new Map<string, number>();
  evs.forEach((e, i) => {
    if (e["type"] === "tool_call" && typeof e["id"] === "string") {
      nameById.set(e["id"], String(e["name"] ?? "?"));
      const args = (e["args"] ?? {}) as Record<string, unknown>;
      if (typeof args["path"] === "string") pathById.set(e["id"], args["path"]);
      idxOfCall.set(e["id"], i);
    }
  });
  for (let i = 0; i < evs.length; i++) {
    const e = evs[i]!;
    if (e["type"] !== "tool_result" || typeof e["output"] !== "string") continue;
    results++;
    const out = e["output"];
    const isTrunc = /\[truncated|\[行截断|\[offset:/.test(out);
    if (out.length >= 31 * 1024) nearLimit++;
    if (out.length >= 32 * 1024 - 300 && out.length <= 32 * 1024 + 300) truncAt32K++;
    if (!isTrunc) continue;
    truncResults++;
    const callId = String(e["callId"] ?? "");
    const path = pathById.get(callId);
    if (path === undefined) { notRefilled++; continue; }
    const later = evs.slice(i + 1).some((x) => x["type"] === "tool_call"
      && nameById.get(String(x["id"] ?? "")) === "read_file"
      && ((x["args"] as Record<string, unknown> | undefined)?.["path"]) === path);
    if (later) refilled++; else notRefilled++;
  }
}
console.log("\n## ④ 真语料（仓内 outputs/**.events.jsonl，" + String(files.length) + " 个文件，含剧本）");
console.log(`   tool_result 共 ${results} 条；带截断/偏移提示的 ${truncResults} 条；输出长度贴着 32KB 上限 ±300B 的 ${truncAt32K} 条；≥31KB 的 ${nearLimit} 条`);
console.log(`   被截断之后**同流里再读过同一文件**的 ${refilled} 条；没再读的 ${notRefilled} 条`);
console.log("   ⚠️ 分母口径：含剧本、且「再读同一文件」只按 path 全等匹配（换 offset 续读算再读，改读别的文件不算）；");
console.log("      贴着上限却没有提示的那 " + String(Math.max(0, truncAt32K - truncResults)) + " 条属**待核**（可能是别处截断、也可能提示措辞不在此正则内）。");
