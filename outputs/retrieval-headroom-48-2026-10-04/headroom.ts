/** 第 340 页 · #48：词面通道的「承重词离停用词闸还有多远」现读（只读、零花费）。
 *  闸的算法**不吃第二份实现**：`STOPWORD_DF_RATIO` 从生产模块取，`stopAt = max(3, floor(N×ratio))`
 *  与「保留条件 df ≤ stopAt」逐字照 `src/agent/map/retrieve.ts:114-116`（那是唯一事实源；抄成
 *  `df < stopAt` 就会把边界那一格读错）。语料与分母同生产：`scanSourceFilesAll` ＋ `fileSymbols` 的摘要出口。
 *  跑法（仓库根）：node --import tsx outputs/retrieval-headroom-48-2026-10-04/headroom.mjs */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { STOPWORD_DF_RATIO, commentSummary, tokensOf } from "../../src/agent/map/retrieve.ts";
import { fileSymbols } from "../../src/agent/map/parse.ts";
import { scanSourceFilesAll } from "../../src/agent/map/build.ts";

const ROOT = process.cwd();
const scanned = await scanSourceFilesAll(ROOT);
const summaries: { file: string; sum: string }[] = [];
for (const f of scanned) {
  let src = "";
  try { src = readFileSync(join(ROOT, f.rel), "utf8"); } catch { continue; }
  const ext = f.rel.slice(f.rel.lastIndexOf(".") + 1).toLowerCase();
  let summary = "";
  try { summary = (await fileSymbols(src, ext)).summary || commentSummary(src); } catch { summary = commentSummary(src); }
  summaries.push({ file: f.rel, sum: summary });
}
// df 的口径与生产一致：**每个文件的词集**（摘要＋路径），词在多少文件里出现
const df = new Map<string, number>();
for (const { file, sum } of summaries) {
  for (const t of new Set(tokensOf(sum + " " + file))) df.set(t, (df.get(t) ?? 0) + 1);
}
const n = summaries.length;
const stopAt = Math.max(3, Math.floor(n * STOPWORD_DF_RATIO));
console.log(`语料面＝${String(n)} 支（scanSourceFilesAll）｜停用词闸 stopAt＝max(3, floor(${String(n)}×${String(STOPWORD_DF_RATIO)}))＝${String(stopAt)}｜保留条件 df ≤ ${String(stopAt)}`);

const spec = JSON.parse(readFileSync(join(ROOT, "fixtures/locate/dsh-questions.json"), "utf8"));
const LIST = Array.isArray(spec) ? spec : (spec.questions ?? []);
const sumOf = new Map(summaries.map((s) => [s.file, s.sum]));

let risky = 0, dead = 0, cells = 0;
const rows: string[] = [];
for (const q of LIST) {
  const target = (q.truth ?? [])[0]?.file;
  if (typeof target !== "string") continue;
  const inSum = sumOf.get(target) ?? "";
  const terms = [...new Set(tokensOf(String(q.question ?? "")).filter((t) => t.length >= 2))];
  // 承重词＝这道题里**真的出现在目标文件摘要中**、且 df 最低的几个（它们才是命中的支撑）
  const carried = terms.filter((t) => inSum.includes(t)).map((t) => [t, df.get(t) ?? 0] as const).sort((a, b) => a[1] - b[1]);
  const top = carried.slice(0, 3);
  if (top.length === 0) { rows.push(`${q.id} ${target}：摘要里没有问句词 ⇒ 没有承重词可量（命中若存在，靠的是路径词）`); continue; }
  const dist = stopAt - top[top.length - 1]![1];   // 最弱的那个承重词离闸多远（越大越安全）
  const minDist = Math.min(...top.map(([, d]) => stopAt - d));
  for (const [, d] of top) { cells++; if (d > stopAt) dead++; }
  if (minDist < 20) risky++;
  rows.push(`${q.id} ${target}：承重词 ${top.map(([t, d]) => `「${t}」df=${String(d)}（离闸 ${String(stopAt - d)}）`).join("、")} ⇒ 最近距离 ${String(minDist)}${minDist < 20 ? "  ⚠️<20" : ""}｜距离（按最弱词）${String(dist)}`);
}
for (const r of rows) console.log(r);
console.log(`----\n题数＝${String(rows.length)}｜承重词离闸 <20 的题＝${String(risky)}｜抽样承重词格＝${String(cells)} 其中已越闸＝${String(dead)}`);
