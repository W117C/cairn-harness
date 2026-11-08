#!/usr/bin/env node
// 性能读数汇总（第 957 页）：把 N 次 performance-smoke 的 JSON 汇成「区间 + 中位 + 离散度」。
//
// 为什么需要：这台机上单跑之间的启动时间是 188–312 ms（离散度 1.66×，见第 956 页），
// 拿单点对单点写「涨了 2×」只是把抖动当趋势。所以读数一律按 N≥5 跑汇总，只报区间与中位。
//
// 用法：node --import tsx scripts/perf-summarize.ts run1.json run2.json …（N≥2）
import { readFileSync } from "node:fs";

export interface PerfReport {
  startupMs: number;
  openMs: number;
  frameMs: { p50: number; p95: number; max: number };
  dom: { nodes: number };
  errors: readonly unknown[];
  budgets?: { p95Ms: number; maxMs: number; startupMs: number; openMs?: number };
}

export interface Spread {
  min: number;
  median: number;
  max: number;
  /** max/min，越小越稳；1.00 = 完全一致。 */
  spread: number;
}

/** 中位数（偶数个取中间两数平均）。空数组抛错——不许把「没读数」算成 0。 */
export function spreadOf(values: readonly number[]): Spread {
  if (values.length === 0) throw new Error("没有读数");
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  const min = sorted[0]!;
  const max = sorted[sorted.length - 1]!;
  return { min, median, max, spread: min === 0 ? Number.POSITIVE_INFINITY : max / min };
}

export interface PerfSummary {
  runs: number;
  startup: Spread;
  open: Spread;
  p50: Spread;
  p95: Spread;
  max: Spread;
  /** DOM 节点：确定性读数，N 跑必须完全一致；不一致时给出所有取值。 */
  nodes: { consistent: boolean; values: readonly number[] };
  /** 预算判定：任一趟超帽即 red，并点名是哪一趟的哪一项。 */
  budget: { ok: boolean; violations: readonly string[] };
  errors: number;
}

export function summarizeReports(reports: readonly PerfReport[]): PerfSummary {
  if (reports.length === 0) throw new Error("没有报告");
  const budgets = reports[0]!.budgets ?? { p95Ms: 200, maxMs: 500, startupMs: 1500 };
  const openCap = budgets.openMs ?? 1500; // 旧报告没有这一档：按默认帽判，别因为字段缺席就不判
  const violations: string[] = [];
  reports.forEach((r, i) => {
    const tag = `run${String(i + 1)}`;
    if (r.frameMs.p95 > budgets.p95Ms) violations.push(`${tag} 帧 p95 ${r.frameMs.p95.toFixed(1)} > ${String(budgets.p95Ms)}`);
    if (r.frameMs.max > budgets.maxMs) violations.push(`${tag} 帧 max ${r.frameMs.max.toFixed(1)} > ${String(budgets.maxMs)}`);
    if (r.startupMs > budgets.startupMs) violations.push(`${tag} 启动 ${r.startupMs.toFixed(1)} > ${String(budgets.startupMs)}`);
    if (r.openMs > openCap) violations.push(`${tag} 打开会话 ${r.openMs.toFixed(1)} > ${String(openCap)}`);
  });
  const nodes = reports.map((r) => r.dom.nodes);
  return {
    runs: reports.length,
    startup: spreadOf(reports.map((r) => r.startupMs)),
    open: spreadOf(reports.map((r) => r.openMs)),
    p50: spreadOf(reports.map((r) => r.frameMs.p50)),
    p95: spreadOf(reports.map((r) => r.frameMs.p95)),
    max: spreadOf(reports.map((r) => r.frameMs.max)),
    nodes: { consistent: new Set(nodes).size === 1, values: nodes },
    budget: { ok: violations.length === 0, violations },
    errors: reports.reduce((n, r) => n + r.errors.length, 0),
  };
}

function fmt(s: Spread): string {
  return `${s.min.toFixed(1)}–${s.max.toFixed(1)}（中位 ${s.median.toFixed(1)}，离散度 ${s.spread.toFixed(2)}×）`;
}

function main(files: readonly string[]): number {
  if (files.length < 2) {
    console.error("至少给两份报告：node --import tsx scripts/perf-summarize.ts run1.json run2.json …");
    return 2;
  }
  const reports = files.map((f) => JSON.parse(readFileSync(f, "utf8")) as PerfReport);
  const s = summarizeReports(reports);
  console.log(`跑数 ${String(s.runs)}｜启动 ${fmt(s.startup)}`);
  console.log(`首开 ${fmt(s.open)}`);
  console.log(`帧 p50 ${fmt(s.p50)}｜p95 ${fmt(s.p95)}｜max ${fmt(s.max)}`);
  console.log(`DOM 节点 ${s.nodes.consistent ? String(s.nodes.values[0]) + "（各跑一致）" : "不一致：" + s.nodes.values.join(" / ")}`);
  console.log(`控制台错误 ${String(s.errors)} 条`);
  console.log(s.budget.ok ? "预算：全过" : "预算：超帽 → " + s.budget.violations.join("；"));
  return s.budget.ok ? 0 : 1;
}

if (import.meta.main === true) process.exit(main(process.argv.slice(2)));
