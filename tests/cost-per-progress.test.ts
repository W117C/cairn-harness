/** 成本 ÷ 前进（cost-per-progress）的单元面。门判"这只比值能不能被信"，这里钉"分子/分母/跳过"三处算绪。 */
import { it, expect, describe } from "vitest";
import { replay } from "../src/events";
import type { AgentEvent } from "../src/events";
import {
  costPerProgress,
  denominatorCoverage,
  meanCostPerBoundary,
  splitUsageByAttribution,
  type RunRow,
} from "../src/agent/cost-per-progress";
import { COST_RULES, mixedAttributionFixture, runCpSelfTest } from "../scripts/cost-per-progress-check";

async function load(name: string): Promise<AgentEvent[]> {
  return (await replay(`fixtures/no-progress/${name}.events.jsonl`)) as unknown as AgentEvent[];
}

const row = (id: string, over: Partial<RunRow["cost"]>, outcome: RunRow["outcome"] = "green"): RunRow => ({
  id, outcome,
  cost: {
    measurable: true, reason: null, verifiedBoundaries: 1, userBoundaries: 1, mainTokens: 1000,
    excludedWorkerTokens: 0, tokensPerBoundary: 1000, spendAfterLastBoundary: 0, lastBoundaryEventId: 5, ...over,
  },
});

describe("归属拆分：分子只取主面", () => {
  it("worker 的 usage 一律落在 workerTokens/byAgent，绝不进 mainTokens", async () => {
    const split = splitUsageByAttribution(mixedAttributionFixture());
    expect(split.mainTokens).toBe(3300);
    expect(split.workerTokens).toBe(12900);
    expect(split.byAgent).toEqual({ w1: 5400, w2: 7500 });
    expect(split.totalTokens).toBe(split.mainTokens + split.workerTokens);
    expect(split.requests).toBe(4);
  });

  it("比值与缓存分列互不干扰：cacheRead 不参与分子（它是 input 的分块，加两次就翻倍）", () => {
    const ev = [{ type: "usage", inputTokens: 100, outputTokens: 10, cacheReadInputTokens: 90 }] as unknown as AgentEvent[];
    const split = splitUsageByAttribution(ev);
    expect(split.mainTokens).toBe(110);
    expect(split.cacheReadTokens).toBe(90);
  });
});

describe("比值：与分母同面，零前进是不可测", () => {
  it("真实绿跑：tokensPerBoundary = 主面 ÷ verified 边界，且最后一次前进之后没再花钱", async () => {
    const c = costPerProgress(await load("real-green-read-edit-verify"));
    expect(c.measurable).toBe(true);
    expect(c.verifiedBoundaries).toBe(1);
    expect(c.tokensPerBoundary).toBe(c.mainTokens);
    expect(c.spendAfterLastBoundary).toBe(0);
    expect(c.excludedWorkerTokens).toBe(0);
  });

  it("真实红跑：零 verified ⇒ 不可测（不是 0 也不是 Infinity），整笔主面就是死跑成本", async () => {
    const c = costPerProgress(await load("real-red-verify-stagnation"));
    expect(c.measurable).toBe(false);
    expect(c.reason).toBe("no-progress-boundary");
    expect(c.tokensPerBoundary).toBe(null);
    expect(c.mainTokens).toBe(68535);
    expect(c.spendAfterLastBoundary).toBe(c.mainTokens);
  });

  it("没有 usage：不可测且原因是 no-usage，不许把「没记账」读成「没花钱」", () => {
    const c = costPerProgress([{ type: "user_message", content: "hi" }] as unknown as AgentEvent[]);
    expect(c.reason).toBe("no-usage");
    expect(c.tokensPerBoundary).toBe(null);
    expect(c.mainTokens).toBe(0);
  });

  it("混合归属样本：worker 的 12,900 不得进比值（否则同一份输入会算出 16,200 而不是 3,300）", () => {
    const c = costPerProgress(mixedAttributionFixture());
    expect(c.measurable).toBe(true);
    expect(c.tokensPerBoundary).toBe(3300);
    expect(c.excludedWorkerTokens).toBe(12900);
  });
});

describe("均值与分母体检：不可测的点名，不并均值", () => {
  it("跳过项点名且 used 只数可测的", () => {
    const rows = [row("g", {}), row("r", { measurable: false, reason: "no-progress-boundary", verifiedBoundaries: 0, tokensPerBoundary: null, mainTokens: 9000 }, "red")];
    const m = meanCostPerBoundary(rows);
    expect(m).toEqual({ mean: 1000, used: 1, skipped: ["r:no-progress-boundary"] });
  });

  it("全不可测 ⇒ mean 为 null（不得是 0）", () => {
    const m = meanCostPerBoundary([row("r", { measurable: false, reason: "no-usage", tokensPerBoundary: null }, "unknown")]);
    expect(m.mean).toBe(null);
    expect(m.used).toBe(0);
  });

  it("分母体检要有分辨力：成功跑全取不到边界、或没有零前进的失败样本，都判红", () => {
    const good = denominatorCoverage([
      row("g1", {}),
      row("g2", { mainTokens: 2000, tokensPerBoundary: 2000 }),
      row("r", { measurable: false, reason: "no-progress-boundary", verifiedBoundaries: 0, tokensPerBoundary: null }, "red"),
    ]);
    expect(good.ok).toBe(true);
    expect(denominatorCoverage([row("a", { verifiedBoundaries: 0, measurable: false, tokensPerBoundary: null }), row("b", { verifiedBoundaries: 0, measurable: false, tokensPerBoundary: null })]).ok).toBe(false);
    expect(denominatorCoverage([row("a", {}), row("b", {})]).ok).toBe(false);
    expect(good.detail).toContain("死跑成本");
  });
});

describe("门与自检的分辨力", () => {
  it("四条规则全绿（复用门里同一只判据）", async () => {
    for (const rule of COST_RULES) {
      const v = await rule.run();
      expect(v.ok, rule.id + " 红了：" + v.detail).toBe(true);
    }
  }, 300_000);

  it("--self-test 五只反向对照全部造得红（有判据变成摆设时这条先红）", () => {
    const r = runCpSelfTest();
    expect(r.missed).toEqual([]);
    expect(r.caught).toHaveLength(5);
  });
});
