/** 第 337 页 · #46 的机制读数：扩语料为什么会让原本命中的题掉出检索行——df 停用词闸把「头注释里那些独特的词」也抬进了停用词集合。
 *  两臂的摘要都由**真的 commentSummary 算**（不是本脚本重写）：A 臂 import HEAD 那份 retrieve.ts（零依赖纯模块，可单独取），
 *  B 臂 import 实验树里改过的那份。词面切词同样各用各的那一支 tokensOf（两臂实现相同，取法相同）。
 *  跑法：node --import tsx /tmp/p336-df-ze.mjs */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const TREE = "/Users/ze/Downloads/deepseek harness/.worktrees/p336-corp";
mkdirSync("/tmp/p336-corp-ze", { recursive: true });
writeFileSync("/tmp/p336-corp-ze/retrieve-head.ts",
  execFileSync("git", ["-C", TREE, "show", "HEAD:src/agent/map/retrieve.ts"], { encoding: "utf8" }), "utf8");

const A = await import("/tmp/p336-corp-ze/retrieve-head.ts");   // 顶注释（生产现状）
const B = await import(TREE + "/src/agent/map/retrieve.ts");     // 顶注释＋全文注释行（帽 220，实验臂 B1）

const RATIO = A.STOPWORD_DF_RATIO;
// 候选面**必须吃地图自己算出来的那一份**（scanSourceFilesAll），不许用 ls-files 另数一遍：
// 分母差 28 支就会把阈值从 91 挪到 87，而「工具」的 df 恰好落在这两条线之间——机制会不会成立全看分母。
const { scanSourceFilesAll } = await import(TREE + "/src/agent/map/build.ts");
const files = (await scanSourceFilesAll(TREE)).map((f) => f.rel);
console.log("候选面取料＝scanSourceFilesAll ⇒ " + String(files.length) + " 支（与 probe 的「覆盖面自述」同分母）");

const corpus = (mod) => files.map((rel) => {
  let src = "";
  try { src = readFileSync(TREE + "/" + rel, "utf8"); } catch { return new Set(); }
  return new Set(mod.tokensOf(mod.commentSummary(src) + " " + rel));
});

const dfMap = (sets) => {
  const df = new Map();
  for (const s of sets) for (const t of s) df.set(t, (df.get(t) ?? 0) + 1);
  return df;
};

const qa = corpus(A), qb = corpus(B);
const dfa = dfMap(qa), dfb = dfMap(qb);
const n = files.length;
const cap = n * RATIO;
const questions = JSON.parse(readFileSync(TREE + "/fixtures/locate/dsh-questions.json", "utf8"));
const LIST = Array.isArray(questions) ? questions : (questions.questions ?? []);

let stopA = 0, stopB = 0, newly = [];
for (const q of LIST) {
  const terms = [...new Set(A.tokensOf(String(q.question ?? "")).filter((t) => t.length >= 2))];
  for (const t of terms) {
    const sa = (dfa.get(t) ?? 0) > cap, sb = (dfb.get(t) ?? 0) > cap;
    if (sa) stopA++;
    if (sb) stopB++;
    if (!sa && sb) newly.push({ q: q.id, t, dfa: dfa.get(t) ?? 0, dfb: dfb.get(t) ?? 0 });
  }
}
console.log("文件面＝" + String(n) + " 支｜停用词闸＝df > 面 × " + String(RATIO) + " ＝ " + cap.toFixed(0));
console.log("问句词总格数＝" + String(LIST.reduce((s, q) => s + new Set(A.tokensOf(String(q.question ?? "")).filter((t) => t.length >= 2)).size, 0)) + "（按题去重后逐题计）");
console.log("被当停用词的格数：A 臂（顶注释）＝" + String(stopA) + " ｜ B1 臂（扩语料）＝" + String(stopB) + " ⇒ 新增失效 " + String(stopB - stopA));
console.log("新跨过半闸的词（前 12 个，附 df 前后）：");
for (const x of newly.slice(0, 12)) console.log("  " + x.q + " 「" + x.t + "」 df " + String(x.dfa) + " → " + String(x.dfb) + "（阈值 " + cap.toFixed(0) + "）");
