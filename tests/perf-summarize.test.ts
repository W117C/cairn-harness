/** 第 957 页：性能读数汇总（区间 / 中位 / 离散度 / 预算判定）。
 *
 *  这一格是第 956 页教训的落地：单点对单点会把抖动写成趋势（实测启动 188–312 ms，离散度 1.66×）。
 *  所以读数一律 N≥2 汇总，只报区间与中位；DOM 是确定性读数，N 跑必须一致。
 */
import { describe, expect, it } from "vitest";
import { spreadOf, summarizeReports, type PerfReport } from "../scripts/perf-summarize";

const report = (o: Partial<PerfReport> = {}): PerfReport => ({
  startupMs: 200, openMs: 500, frameMs: { p50: 30, p95: 40, max: 45 }, dom: { nodes: 1000 }, errors: [],
  ...o,
});

describe("性能读数汇总（第 957 页）", () => {
  it("区间 / 中位 / 离散度：奇数取中位，偶数取中间两数平均", () => {
    expect(spreadOf([190, 310])).toEqual({ min: 190, median: 250, max: 310, spread: 310 / 190 });
    expect(spreadOf([3, 1, 2])).toEqual({ min: 1, median: 2, max: 3, spread: 3 });
    expect(spreadOf([5])).toEqual({ min: 5, median: 5, max: 5, spread: 1 });
    expect(() => spreadOf([])).toThrow("没有读数"); // 没读数不许算成 0
  });

  it("DOM 不一致会被点名；一致时给出那个值", () => {
    const same = summarizeReports([report(), report()]);
    expect(same.nodes).toEqual({ consistent: true, values: [1000, 1000] });
    const diff = summarizeReports([report(), report({ dom: { nodes: 999 } })]);
    expect(diff.nodes.consistent).toBe(false);
    expect(diff.nodes.values).toEqual([1000, 999]);
  });

  it("预算逐跑判定：点名是哪一趟的哪一项超帽", () => {
    const ok = summarizeReports([report(), report({ startupMs: 900 })]);
    expect(ok.budget).toEqual({ ok: true, violations: [] });
    const bad = summarizeReports([
      report(),
      report({ startupMs: 1600, frameMs: { p50: 30, p95: 260, max: 600 } }),
    ]);
    expect(bad.budget.ok).toBe(false);
    expect(bad.budget.violations).toHaveLength(3);
    expect(bad.budget.violations.join(" | ")).toContain("run2");
    expect(bad.budget.violations.join(" | ")).toContain("启动 1600.0");
  });

  it("打开会话也进预算判定（第 958 页补的那一档）", () => {
    const withOpen = summarizeReports([
      report({ budgets: { p95Ms: 200, maxMs: 500, startupMs: 1500, openMs: 1500 } }),
      report({ openMs: 1600, budgets: { p95Ms: 200, maxMs: 500, startupMs: 1500, openMs: 1500 } }),
    ]);
    expect(withOpen.budget.ok).toBe(false);
    expect(withOpen.budget.violations.join(" | ")).toContain("run2 打开会话 1600.0 > 1500");
    // 旧报告没有 openMs 字段：按默认 1500 判，不许因为字段缺席就不判
    const legacy = summarizeReports([report({ openMs: 1600 })]);
    expect(legacy.budget.ok).toBe(false);
    expect(legacy.budget.violations.join(" | ")).toContain("打开会话 1600.0 > 1500");
  });

  it("控制台错误按跑累加", () => {
    expect(summarizeReports([report({ errors: ["a"] }), report({ errors: ["b", "c"] })]).errors).toBe(3);
  });

  it("空报告数组直接抛（不许把「没跑」写成「全绿」）", () => {
    expect(() => summarizeReports([])).toThrow("没有报告");
  });
});
