/** 把同目录的 probe*.log 按「臂」汇总成读数（第 245 页的取料面，只读）。
 *
 *  为什么要单独一个汇总器：上一版用一条 awk 现场聚合，把「每圈一行」当成「每臂一行」印了出来，
 *  于是 12 圈读数是 12 行、臂名重复三遍——那副表读不出「哪一臂翻了几次」，而这一页要答的正是那个问题。
 *  计数类结论必须能指着原始行复核（规则 245：比值/汇总要回逐笔原始数）。
 *
 *  跑法：node --import tsx outputs/inflight-index-witness-2026-09-30/summarize.mts [log_glob...]
 *  缺省收 probe.log 与 probe-r*.log。退出码 0＝有读数；2＝一个 log 都没读到（那是「没量到」，不是「没有翻转」）。 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// 走仓里既有的写法（`scripts/facts.ts:122` 等）：`URL.pathname` 会把目录名里的空格留在百分号编码里
// （这棵树叫 `deepseek harness` ⇒ `deepseek%20harness` ⇒ scandir ENOENT，而异常退出码是 1、不是我预留的 2）。
const HERE = resolve(dirname(fileURLToPath(import.meta.url)));
const files = process.argv.slice(2).length > 0
  ? process.argv.slice(2)
  : readdirSync(HERE).filter((f) => /^probe(-r\d+)?\.log$/.test(f)).map((f) => join(HERE, f));
if (files.length === 0) {
  console.error("一个 log 都没收到 ⇒ 这是「没量到」，不是「没有翻转」");
  process.exit(2);
}

/** 一臂的计数：`ino`／`mtime`／`sha` 各翻了几圈，外加这一臂的 git 退出码分布。 */
type Bucket = { flip: Record<string, number>; total: number; exits: Record<number, number> };
const byArm = new Map<string, Bucket>();
let current = "";

for (const f of files) {
  for (const line of readFileSync(f, "utf8").split("\n")) {
    const m = /^\s+\[.*?\] (内容\S+) · (.*?)：$/.exec(line);
    if (m) { current = `${m[1]} · ${m[2]}`; continue; }
    if (current === "" || !line.includes("git退")) continue;
    const b = byArm.get(current) ?? { flip: { ino: 0, mtime: 0, sha: 0, ns: 0 }, total: 0, exits: {} };
    b.total += 1;
    for (const k of ["ino", "mtime", "sha", "ns"] as const) {
      // 这三列的字面是 `X 变`／`X 不变`，所以「含空格的 `X 变`」这个子串本身就排除了否定式
      // （上一版在这里写了一个残缺的负向先行断言，正则坏了却照样跑出数字——计数尺的尺也要有哨兵）。
      if (line.includes(`${k} 变`)) b.flip[k] += 1;
    }
    const e = /git退(\d+)/.exec(line);
    if (e) b.exits[Number(e[1])] = (b.exits[Number(e[1])] ?? 0) + 1;
    byArm.set(current, b);
  }
}

console.log(`收到 ${String(files.length)} 份 log：${files.map((f) => f.split("/").pop()).join("、")}`);
let anyRow = false;
for (const [arm, b] of byArm) {
  anyRow = true;
  const flips = Object.entries(b.flip).map(([k, v]) => `${k} ${String(v)}/${String(b.total)}`).join("｜");
  const exits = Object.entries(b.exits).map(([k, v]) => `退${k}×${String(v)}`).join(" ");
  console.log(`  ${arm.padEnd(38, "　")} ${exits}｜翻圈数 ${flips}`);
}
if (!anyRow) {
  console.error("收到的 log 里一行读数都没有（形状对不上？）⇒ 这是「没量到」，不是「没有翻转」");
  process.exit(2);
}
