import { describe, expect, it } from "vitest";
import {
  PRUNE_BATCH_MIN_SAVED_TOKENS,
  PRUNE_BATCH_PRESSURE_RATIO,
  freshSavings,
  shouldApplyPrune,
} from "../src/agent/prune-batching";
import { PRUNE_MINIMUM_TOKENS } from "../src/agent/prune";
import { CHURN_RULES } from "../scripts/prefix-churn-check";

describe("分批裁剪策略：纯判据", () => {
  it("未启用 ⇒ 恒照旧（零回归支），且理由写清", () => {
    const d = shouldApplyPrune({ enabled: false, savedTokens: 1, estimatedTokens: 0, availableTokens: 1000 });
    expect(d.apply).toBe(true);
    expect(d.why).toContain("未启用");
  });

  it("没攒够且头寸不紧 ⇒ 推迟（不断前缀）", () => {
    const d = shouldApplyPrune({ enabled: true, savedTokens: PRUNE_BATCH_MIN_SAVED_TOKENS - 1, estimatedTokens: 1000, availableTokens: 100_000 });
    expect(d.apply).toBe(false);
    expect(d.why).toContain("先不断前缀");
  });

  it("刚好到门槛就剪（边界锁：>= 而不是 >）", () => {
    expect(shouldApplyPrune({ enabled: true, savedTokens: PRUNE_BATCH_MIN_SAVED_TOKENS, estimatedTokens: 1000, availableTokens: 100_000 }).apply).toBe(true);
  });

  it("头寸紧就必须照剪 —— 绝不因为攒批去撞最终硬闸", () => {
    const available = 100_000;
    const at = Math.floor(available * PRUNE_BATCH_PRESSURE_RATIO);
    expect(shouldApplyPrune({ enabled: true, savedTokens: 1, estimatedTokens: at, availableTokens: available }).apply).toBe(true);
    expect(shouldApplyPrune({ enabled: true, savedTokens: 1, estimatedTokens: at - 1, availableTokens: available }).apply).toBe(false);
    // 退化输入不许炸（inputLimit 可为 Infinity/0）
    expect(shouldApplyPrune({ enabled: true, savedTokens: 5, estimatedTokens: 0, availableTokens: 0 }).apply).toBe(true);
  });

  it("增量口径：已发出去的那几条不再算「攒到的量」（否则分批永远以为已经攒够）", () => {
    const saved = new Map<number, number>([[3, 19_947], [7, 19_947], [11, 19_947]]);
    expect(freshSavings(saved, new Set())).toBe(59_841);
    expect(freshSavings(saved, new Set([3, 7]))).toBe(19_947);
    expect(freshSavings(saved, new Set([3, 7, 11]))).toBe(0);
    const decision = shouldApplyPrune({ enabled: true, savedTokens: freshSavings(saved, new Set([3, 7])), estimatedTokens: 1000, availableTokens: 100_000 });
    expect(decision.apply).toBe(false); // 累计值会误判成"已攒够"
  });

  it("门槛必须高于 prune 自身的最小裁剪量，否则分批形同虚设", () => {
    expect(PRUNE_BATCH_MIN_SAVED_TOKENS).toBeGreaterThanOrEqual(PRUNE_MINIMUM_TOKENS * 2);
  });
});

/** 端到端不在这里自己搭一套驱动：`prefix-churn-check` 的 PC8 已经是「同一链开/关两支」的 A/B，
 *  自己再搭一套只会因为 I/O 形状不同而漂（本轮试过：同一份种子在门里出 5→2 的差、在这里量成 0，
 *  差异出在追加与重放的时序上，不在被测逻辑上）。**复用门里那条规则**才是稳的接线证明。 */
describe("分批裁剪：接上真装配（复用门的 PC8）", () => {
  it("PC8 那条 A/B 判据真能跑通（= pruneBatching 这个选项确实接到了装配链上）", async () => {
    const rule = CHURN_RULES.find((r) => r.id.startsWith("PC8"));
    expect(rule, "PC8 不在了——接线就没人守了").toBeDefined();
    const v = await rule!.run();
    expect(v.ok, "PC8 红了：" + v.detail).toBe(true);
    expect(v.detail).toMatch(/分批 ⇒ 断 \d+ 次/);
  }, 600_000);
});
