// #20 的另一半：同一棵树、同一张表，连跑 K 趟这道门，看**安静窗口**里的抖动有多大。
// 归档认证日志给的是"跨天分布"（`corpus.mts`），这份给的是"同配置重复"——两者问的不是一个问题。
// 跑法：node --import tsx outputs/needles-distribution-2026-10-03/time-gate.mts [K=5]
import { execFileSync } from "node:child_process";

const K = Number(process.argv[2] ?? "5");
const times: number[] = [];
for (let i = 0; i < K; i++) {
  const t0 = performance.now();
  const out = execFileSync("node", ["--import", "tsx", "scripts/mutate-verify.mjs", "--check-needles"],
    { cwd: process.cwd(), encoding: "utf8" });
  const ms = Math.round(performance.now() - t0);
  const summary = /针脚体检：(\d+) 条 —— 阻断 (\d+)[^\n]*/u.exec(out);
  times.push(ms);
  console.log("run=" + (i + 1) + " ms=" + ms + " 表=" + (summary?.[1] ?? "?") + " 阻断=" + (summary?.[2] ?? "?"));
}
const sorted = [...times].sort((a, b) => a - b);
const med = sorted[Math.floor((sorted.length - 1) / 2)]!;
console.log("N=" + sorted.length + " min=" + sorted[0] + " 中位=" + med + " max=" + sorted.at(-1) + " 极差=" + (sorted.at(-1)! - sorted[0]!));
