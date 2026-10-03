/** 第 336 页 · 过拟合探针：新写的头注释到底只对 L10 那一句问话生效，还是对换过说法的问话也生效。
 *  口径复用生产端：摘要＝commentSummary、分词＝tokensOf。
 *  跑法（在 .worktrees/p336-rank 里）：node --import tsx /tmp/p336-paraphrase-ze.mjs */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { commentSummary, tokensOf } from "/Users/ze/Downloads/deepseek harness/.worktrees/p336-rank/src/agent/map/retrieve.ts";

const TREE = "/Users/ze/Downloads/deepseek harness/.worktrees/p336-rank";
const rel = "src/agent/map/rank.ts";
const oldSum = commentSummary(execFileSync("git", ["-C", TREE, "show", "HEAD:" + rel], { encoding: "utf8" }));
const newSum = commentSummary(readFileSync(TREE + "/" + rel, "utf8"));

// 第 1 条＝夹具里那一题的原句（已知会红）；其余是换过说法的问话，写注释时没有参照它们。
const PHRASES = [
  ["夹具原句 L10", "仓库地图的排序权重（提到×10、被引用×50）写在哪段代码里？"],
  ["换说法 1", "符号地图的排名是怎么算出来的？谁决定哪个文件排在前面？"],
  ["换说法 2", "想调 PageRank 的系数该改哪个文件？"],
  ["换说法 3", "为什么对话里说过的名字会更早出现在地图里？"],
  ["换说法 4", "节点的边权计算和自环保底在哪里实现？"],
];

const STOP = new Set(["的", "了", "在", "是", "吗", "?"]);
const terms = (q) => [...new Set(tokensOf(q).filter((t) => !STOP.has(t) && t.length >= 2))];

console.log("码点：改前 " + String([...oldSum].length) + " ／ 改后 " + String([...newSum].length));
for (const [label, q] of PHRASES) {
  const ts = terms(q);
  const a = ts.filter((t) => oldSum.includes(t)).length;
  const b = ts.filter((t) => newSum.includes(t)).length;
  console.log(label + " 词 " + String(ts.length) + " 个 ⇒ 改前送 out " + String(a) + " ／ 改后 " + String(b) + (b > a ? "  ↑有增益" : (b === a ? "  ＝无增益" : "  ↓倒退")));
  console.log("  改后新送出的词＝" + ts.filter((t) => newSum.includes(t) && !oldSum.includes(t)).join("/"));
}
