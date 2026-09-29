/* 取料：/tmp/*.log 里已经花掉的整表跑批时间 ⇒ 旧跑法（整文件三拍）的整表单价。
 * 只收 `跑了 N/N 条`（中途停的分母不同）且 N ≥ 500（整表面貌）。
 * 用法：node --import tsx outputs/mutation-selector-scan-2026-09-28/old-price-from-logs.mts */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";

const rows: { f: string; tot: number; secs: number; per: number }[] = [];
for (const f of readdirSync("/tmp").filter((s) => s.endsWith(".log"))) {
  let t = "";
  try {
    t = readFileSync(`/tmp/${f}`, "utf8");
  } catch {
    continue;
  }
  const all = [...t.matchAll(/本次耗时 ([\d.]+)s · 跑了 (\d+)\/(\d+) 条/gu)];
  const m = all[all.length - 1];
  if (m === undefined) continue;
  const secs = Number(m[1]);
  const ran = Number(m[2]);
  const tot = Number(m[3]);
  if (ran !== tot) continue;
  if (tot < 500) continue;
  rows.push({ f, tot, secs, per: secs / tot });
}
rows.sort((a, b) => a.tot - b.tot);
const ps = rows.map((r) => r.per).sort((a, b) => a - b);
const mid = ps[Math.floor(ps.length / 2)] ?? 0;

const out: string[] = [
  "# 整表跑批的历史单价（旧跑法＝整文件三拍）— 取料：/tmp/*.log 现读 2026-09-28",
  "",
  "取料口径：只收 `跑了 N/N 条`（预算用尽／中途停下的一律不收，分母不同），且 N ≥ 500（整表面貌）。",
  "这一份不是新的测量，而是**把已经花掉的机器时间读完**：第 170 页的收益以前只有 24.3× 那个单点 A/B（同锚点同宿主同树），缺整表形状的同分母对照。",
  "",
  "| 日志 | 条数 | 总耗时 | 每条 |",
  "|---|---|---|---|",
];
for (const r of rows) out.push(`| ${r.f} | ${r.tot} | ${r.secs.toFixed(1)}s | **${r.per.toFixed(2)}s** |`);
out.push(
  "",
  `旧跑法整表单价中位 = **${mid.toFixed(2)}s/条**（n=${ps.length}，区间 ${ps[0]?.toFixed(2)}–${ps[ps.length - 1]?.toFixed(2)}s）。`,
  "今天新跑法（selector）现读：`481.6s／294 条 = 1.64s/条`（预算用尽那一次的前缀，独占窗口）。",
  `⇒ 整表形状上的收益约 **${(mid / 1.64).toFixed(2)}×**，而不是 24.3×：多数锚点的判卷文件本来就便宜（一拍的大头是 vitest 启动而不是跑用例），`,
  "   24.3× 说的是「挂在贵宿主上的那批」。两个数都真，分母不同，不许互借（规则 245）。",
  "",
  "⚠️ 这些历史日志**没有并发声明**（隔壁会话当时是否在跑，无从考证）⇒ 本表只当**方向性对照**。",
  "   要升成凭证，需要在同一棵树上做「强制整文件跑法 vs 默认跑法」的同表 A/B（仪器已并入任务 #10）。",
  "",
);
const dest = "/Users/ze/Downloads/deepseek harness/outputs/mutation-selector-scan-2026-09-28/old-mode-price-from-logs-2026-09-28.md";
writeFileSync(dest, out.join("\n"));
console.log(`n=${ps.length} 中位=${mid.toFixed(2)}s/条 → ${dest}`);
