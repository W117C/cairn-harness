/* 免费取料面第二趟：把本机归档日志里**整表跑批的健康度**读出来（存活／误伤要分开，两者的修法相反）。
 * 判据形状来自规则 233：一条锚点存活先分「实现搬家」还是「判卷零分辨力」；误伤则是改法打到了别的用例。
 * 用法：node --import tsx outputs/mutation-selector-scan-2026-09-28/table-health-from-logs.mts */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";

const ANSI = /[\u001b\u009b]\[[0-9;]*m/gu;
const rows: { f: string; ran: number; tot: number; secs: number; killed: number; alive: number; collateral: number; footer: string }[] = [];

for (const f of readdirSync("/tmp").filter((s) => s.endsWith(".log"))) {
  let t = "";
  try {
    t = readFileSync(`/tmp/${f}`, "utf8").replace(ANSI, "");
  } catch {
    continue;
  }
  const m = [...t.matchAll(/本次耗时 ([\d.]+)s · 跑了 (\d+)\/(\d+) 条/gu)].pop();
  if (m === undefined) continue;
  const ran = Number(m[2]);
  const tot = Number(m[3]);
  if (ran !== tot || tot < 500) continue;               // 只收整表面貌且没中途停的
  const alive = [...t.matchAll(/变异存活：测试全绿/gu)].length;
  const collateral = [...t.matchAll(/误伤无关用例|改法打中|误伤：/gu)].length;
  const footerM = /(\d+) 条变异存活或误伤/u.exec(t) ?? null;
  const allGreen = /全部变异被正确杀死/u.test(t);
  const sum = footerM !== undefined && footerM !== null ? Number(footerM[1]) : 0;
  rows.push({ f, ran, tot, secs: Number(m[1]), killed: allGreen ? tot : tot - sum, alive, collateral, footer: allGreen ? "全部杀死" : (footerM?.[0] ?? "") });
}
rows.sort((a, b) => a.tot - b.tot);

const lines = [
  "# 整表健康度：从本机归档日志读（09-28，零新增机器时间）",
  "",
  "口径：只收 `跑了 N/N 条` 且 N ≥ 500 的整表批；`存活` 数取自 ❌ 块里「变异存活：测试全绿」这一句的条数，",
  "`误伤` 数取自「误伤无关用例／改法打中」那一族措辞；尾行 `X 条变异存活或误伤` 是两者的合计（机器自己的口径）。",
  "⚠️ 这些批次的**表内容与判卷都在变**，所以「存活数下降」不能直接读成「判卷变好」——它是趋势线，不是同分母 A/B（规则 245）。",
  "",
  "| 日志 | 条数 | 总耗时 | 每条 | 尾行读数 | 存活句数 | 误伤句数 |",
  "|---|---|---|---|---|---|---|",
  ...rows.map((r) => `| ${r.f} | ${r.tot} | ${r.secs.toFixed(0)}s | ${(r.secs / r.tot).toFixed(2)}s | ${r.footer} | ${r.alive} | ${r.collateral} |`),
  "",
];
writeFileSync("/Users/ze/Downloads/deepseek harness/outputs/mutation-selector-scan-2026-09-28/table-health-from-logs-2026-09-28.md", lines.join("\n") + "\n");
console.log(`收 ${String(rows.length)} 份整表批`);
for (const r of rows) console.log(`  ${r.f.padEnd(30)} ${String(r.tot)} 条  尾行=${r.footer.padEnd(12)} 存活句=${String(r.alive)} 误伤句=${String(r.collateral)}`);
