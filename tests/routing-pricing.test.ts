import { describe, expect, it } from "vitest";
import { costUsd, DEFAULT_PRICE_TABLE, priceCoverage, priceOf, type ModelPrice } from "../src/routing/pricing";
import { DEFAULT_MODEL_TABLE } from "../src/providers/registry";
import { createRng, newBanditState, selectArm, updatePriced } from "../src/routing/bandit";

describe("M6 价格表", () => {
  it("priceOf 已知 id 返回单价；未知 id fail-visible 抛错", () => {
    // 缓存两列随 A1 一起入表，值 = null（待联网实测校准，2026-09-19 裁决不编数）
    expect(priceOf("glm-flash")).toEqual({ inputPerMTok: 0.2, outputPerMTok: 0.2, cacheReadPerMTok: null, cacheWritePerMTok: null });
    expect(priceOf("openai-cheap").inputPerMTok).toBe(0.15);
    expect(() => priceOf("nope-model")).toThrow(/未知 model 价格/);
  });

  it("costUsd 真钱折算：1M 输入 token @openai-cheap = $0.15", () => {
    const c = costUsd("openai-cheap", { inputTokens: 1_000_000, outputTokens: 0 });
    expect(c).toBeCloseTo(0.15, 6);
  });

  it("costUsd 输入输出分列计价", () => {
    const c = costUsd("anthropic-standard", { inputTokens: 1_000_000, outputTokens: 1_000_000 });
    expect(c).toBeCloseTo(3.0 + 15.0, 6);
  });

  it("价格表覆盖档位表全部 id（漂移护栏：新增 model 忘配价 = 显式失败）", () => {
    expect(priceCoverage()).toEqual([]);
    // 反向：故意漏配一个 → 必须被列出（证明护栏不是恒真）
    const broken = { ...DEFAULT_PRICE_TABLE } as Record<string, ModelPrice>;
    delete broken["glm-flash"];
    expect(priceCoverage(broken)).toEqual(["glm-flash"]);
    // 每个档位表 spec 都能在价格表查到价（一一对应）
    for (const s of DEFAULT_MODEL_TABLE) {
      expect(DEFAULT_PRICE_TABLE[s.id]).toBeDefined();
    }
  });

  it("updatePriced 真钱代价回灌进 beta（代价越大期望越低），同 seed 确定性", () => {
    const arms = [
      { stage: "impl", tier: "cheap" as const },
      { stage: "impl", tier: "strong" as const },
    ];
    const run = (costs: [number, number]): number[] => {
      const state = newBanditState(9);
      const picks: number[] = [];
      for (let i = 0; i < 60; i++) {
        const arm = selectArm(state.posteriors, state.rngState, arms, 0.05);
        picks.push(arm.tier === "cheap" ? 0 : 1);
        updatePriced(state.posteriors, arm, 1, arm.tier === "cheap" ? costs[0]! : costs[1]!);
      }
      return picks;
    };
    // 同 seed 两次逐字段一致（随机性显式管理）
    expect(run([0.001, 0.01])).toEqual(run([0.001, 0.01]));
    // 代价翻转改变选择轨迹（证明代价项真在起作用，非恒真）
    expect(run([0.001, 0.01])).not.toEqual(run([0.01, 0.001]));
    // rngState 独立可播种
    const r1 = createRng(3);
    const r2 = createRng(3);
    expect(r1).toEqual(r2);
  });
});
