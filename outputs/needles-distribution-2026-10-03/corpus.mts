// #20 的取分布：这道门（`mutate-needles-check`）到底多贵、什么时候贵。
//
// 为什么不需要新跑：`head-cert` 每一趟都把这道门的 ms 与"起前/跑完几套判卷"一起落进留档日志，
// 本机 `outputs/**/head-cert-*.log` 就是一张同分母的免费语料（规则 250：只取那行原文，不重算）。
// 取料纪律：只认 `mutate-needles-check exit=<码> <ms>ms` 那一行与 `并发判卷=起前 A 套／跑完 B 套` 那一行；
// 两行任一读不到的文件**单独点名**，不静默跳过（静默跳过＝把"没读到"读成"没发生"）。
//
// 跑法：node --import tsx outputs/needles-distribution-2026-10-03/corpus.mts
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..", "..");
const OUT = join(ROOT, "outputs");

const rows: { file: string; ms: number; exit: number; conc: string }[] = [];
const unreadable: string[] = [];
let scanned = 0;
for (const name of readdirSync(OUT)) {
  const p = join(OUT, name);
  if (!statSync(p).isDirectory()) continue;
  for (const f of readdirSync(p)) {
    if (!/^head-cert-.*\.log$/.test(f)) continue;
    scanned++;
    const rel = name + "/" + f;
    const text = readFileSync(join(p, f), "utf8");
    const gate = /mutate-needles-check exit=(\d+) (\d+)ms/.exec(text);
    const conc = /并发判卷=起前 (\d+) 套／跑完 (\d+) 套/.exec(text);
    if (gate === null || conc === null) { unreadable.push(rel + "（" + (gate === null ? "门行读不到" : "并发行读不到") + "）"); continue; }
    rows.push({ file: rel, ms: Number(gate[2]), exit: Number(gate[1]), conc: conc[1] + "/" + conc[2] });
  }
}
if (rows.length + unreadable.length !== scanned) {
  console.log("❌ 取料不守恒：扫到 " + scanned + " 份，进样本 " + rows.length + " ＋点名取不到 " + unreadable.length + " ⇒ 有文件被静默漏掉，别把『没读到』当『没发生』");
}

const sorted = [...rows].sort((a, b) => a.ms - b.ms);
const pick = (q: number): number => sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)))]!.ms;
const quiet = rows.filter((r) => r.conc === "0/0").map((r) => r.ms).sort((a, b) => a - b);
const busy = rows.filter((r) => r.conc !== "0/0").map((r) => r.ms).sort((a, b) => a - b);
const med = (xs: number[]): number => (xs.length === 0 ? NaN : xs[Math.floor((xs.length - 1) / 2)]!);
const over = rows.filter((r) => r.ms > 20_000);

console.log("样本 N=" + rows.length + "（另有 " + unreadable.length + " 份日志取不到那两行，逐条点名见下）");
console.log("分位：min " + (sorted[0]?.ms ?? 0) + "｜p50 " + pick(0.5) + "｜p90 " + pick(0.9) + "｜max " + (sorted.at(-1)?.ms ?? 0) + "（预算 20000ms）");
console.log("超预算读数：" + over.length + " 条" + (over.length > 0 ? " ⇒ " + over.map((r) => r.ms + "ms@" + r.file.split("/").slice(-2).join("/")).join("、") : ""));
console.log("退出码非 0 的读数：" + rows.filter((r) => r.exit !== 0).length + " 条");
console.log("按并发分臂（同一条判据、两个臂）：独占 0/0 臂 N=" + quiet.length + " 中位 " + med(quiet) + " ms，min-max " + quiet[0] + "…" + quiet.at(-1));
console.log("                     有并发臂 N=" + busy.length + " 中位 " + med(busy) + " ms，min-max " + busy[0] + "…" + busy.at(-1));
console.log("逐条原始数（升序）：");
for (const r of sorted) console.log("  " + r.ms + "ms exit=" + r.exit + " 并发=" + r.conc + "  " + r.file);
if (unreadable.length > 0) {
  console.log("取不到那两行的日志（不静默跳过）：");
  for (const u of unreadable) console.log("  " + u);
}
