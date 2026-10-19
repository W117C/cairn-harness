import { describe, expect, it } from "vitest";
import { mixedAttributionFixture } from "../scripts/cost-per-progress-check";
import { costPerProgress, meanCostPerBoundary } from "../src/agent/cost-per-progress";

describe("成本读数：缺失主面用量与验证后的首笔开销", () => {
  it("只有 worker 用量时主面成本不可测，聚合均值必须跳过这条跑", () => {
    const workerOnly = mixedAttributionFixture().filter(
      (e) => e.type !== "usage" || e.agent_id !== undefined,
    );
    const cost = costPerProgress(workerOnly);
    expect(cost).toMatchObject({
      measurable: false,
      reason: "no-usage",
      verifiedBoundaries: 1,
      tokensPerBoundary: null,
      excludedWorkerTokens: 12900,
    });
    expect(meanCostPerBoundary([
      { id: "mixed", outcome: "green", cost: costPerProgress(mixedAttributionFixture()) },
      { id: "worker-only", outcome: "green", cost },
    ])).toEqual({ mean: 3300, used: 1, skipped: ["worker-only:no-usage"] });
  });

  it("显式记录了主面零用量时仍可测，不得把真实零与缺失混为一谈", () => {
    const events = mixedAttributionFixture().map((e) =>
      e.type === "usage" && e.agent_id === undefined
        ? { ...e, inputTokens: 0, outputTokens: 0 }
        : e,
    );
    expect(costPerProgress(events)).toMatchObject({
      measurable: true,
      reason: null,
      tokensPerBoundary: 0,
      excludedWorkerTokens: 12900,
    });
  });

  it.each([true, false])("验证后的第一条主面用量必须计入尾部开销（generic result=%s）", (genericResult) => {
    const events = mixedAttributionFixture().filter(
      (e) => genericResult || e.type !== "tool_result" || e.callId !== "v1",
    );
    expect(costPerProgress(events)).toMatchObject({
      measurable: true,
      verifiedBoundaries: 1,
      mainTokens: 3300,
      excludedWorkerTokens: 12900,
      spendAfterLastBoundary: 2100,
    });
  });
});
