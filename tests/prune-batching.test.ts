import { describe, expect, it } from "vitest";
import {
  PRUNE_BATCH_MIN_SAVED_TOKENS,
  PRUNE_BATCH_PRESSURE_RATIO,
  freeRideCoincidence,
  freshSavings,
  shouldApplyPrune,
  thresholdKnobIsWired,
} from "../src/agent/prune-batching";
import { PRUNE_MINIMUM_TOKENS } from "../src/agent/prune";
import { CHURN_RULES } from "../scripts/prefix-churn-check";

describe("分批裁剪策略：纯判据", () => {
  it("未启用 ⇒ 恒照旧（零回归支），且理由写清", () => {
    const d = shouldApplyPrune({ enabled: false, savedTokens: 1, estimatedTokens: 0, availableTokens: 1000 });
    expect(d.apply).toBe(true);
    // 「未启用」在仓里有 3 处字面量（lsp 的报错、tools-check 的说明都算）⇒ 钉这一支独有的口径
    expect(d.why).toContain("未启用分批");
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

/** 免费车：本轮前缀已被压缩打断 ⇒ 这一刀免费，不必再攒。
 *  三只测例都是「同一份输入、只差 `freeRide` 这一个旗标」——判据必须只由它翻，
 *  否则测的是别的分支而不是这条支路。 */
describe("免费车（freeRide）：断过头的那一轮不攒", () => {
  const unreachable = { minSavedTokens: 1_000_000_000 };
  const base = { enabled: true, savedTokens: 19_947, estimatedTokens: 15_196, availableTokens: 59_600 };

  it("同一份输入：旗标 true 就剪、缺省就推迟（差别只允许出在旗标上）", () => {
    const withFlag = shouldApplyPrune({ ...base, ...unreachable, freeRide: true });
    const without = shouldApplyPrune({ ...base, ...unreachable });
    expect(withFlag.apply).toBe(true);
    expect(without.apply).toBe(false);
    // 「已被压缩打断」也被 `prefix-churn-check.ts` 的说明句用着 ⇒ 收这一支独有的裁决半句
    expect(withFlag.why).toContain("已被压缩打断 ⇒ 顺手剪");
  });

  it("免费车不许绕过「未启用」与「算不出头寸」那两支的既有语义", () => {
    // 未启用 = 逐字旧行为（照剪），旗标在场也不改口径
    const disabled = shouldApplyPrune({ ...base, enabled: false, freeRide: true, savedTokens: 1 });
    expect(disabled.apply).toBe(true);
    expect(disabled.why).toContain("未启用分批");
    // 头寸紧本来就照剪：旗标不得把理由换成"蹭压缩"（否则观测时会误判成策略生效）
    const tight = shouldApplyPrune({ enabled: true, savedTokens: 1, estimatedTokens: 100_000, availableTokens: 100_000, freeRide: true });
    expect(tight.apply).toBe(true);
    expect(tight.why).toContain("头寸已紧");
  });

  it("免费车不是「每轮都剪」的通行证：只有本轮断过头才放行", () => {
    const d1 = shouldApplyPrune({ ...base, ...unreachable, freeRide: true });
    const d2 = shouldApplyPrune({ ...base, ...unreachable, freeRide: false });
    const d3 = shouldApplyPrune({ ...base, ...unreachable, freeRide: undefined });
    expect([d2.apply, d3.apply]).toEqual([false, false]);
    expect(d1.apply).toBe(true);
  });
});

/** PC9 那只判据本身：三种错法各能吃掉一半判据，所以必须各红一次。 */
describe("免费车的判据：落盘轮集合 == 压缩轮集合", () => {
  const good = [
    { prunableAtDecision: 2, compactions: 0, attachments: 0 },
    { prunableAtDecision: 3, compactions: 1, attachments: 2 },
    { prunableAtDecision: 3, compactions: 0, attachments: 0 },
    { prunableAtDecision: 4, compactions: 1, attachments: 2 },
  ];

  it("正样本绿（否则下面三条红是「永远红」的假严格）", () => {
    expect(freeRideCoincidence(good).ok).toBe(true);
  });

  it("旗标忘清零 / 无条件放行 ⇒ 红（落盘轮比压缩轮多）", () => {
    const sticky = good.map((r) => ({ ...r, attachments: 2 }));
    const v = freeRideCoincidence(sticky);
    expect(v.ok).toBe(false);
    expect(v.detail).toContain("两个集合不等");
  });

  it("整支删掉 ⇒ 红（压缩白断过头，一次都没顺手剪）", () => {
    expect(freeRideCoincidence(good.map((r) => ({ ...r, attachments: 0 })))).toMatchObject({ ok: false });
  });

  it("那条链本来没活干 ⇒ 红（推迟是沉默不是策略，判据无分辨力）", () => {
    expect(freeRideCoincidence(good.map((r) => ({ ...r, prunableAtDecision: 0 })))).toMatchObject({ ok: false });
  });

  it("轮次下标不许被 filter 重编号（先筛后编号 = 两个集合永远'相等'）", () => {
    // 落盘在头两轮、压缩在后两轮：数量相同、位置不同 ⇒ 必须红
    const shifted = [
      { prunableAtDecision: 2, compactions: 0, attachments: 2 },
      { prunableAtDecision: 2, compactions: 0, attachments: 2 },
      { prunableAtDecision: 2, compactions: 1, attachments: 0 },
      { prunableAtDecision: 2, compactions: 1, attachments: 0 },
    ];
    expect(freeRideCoincidence(shifted).ok).toBe(false);
  });
});

/** 对照臂：门槛拨到 1 之后必须真的多出「没压缩也落盘」的轮次，否则主判据那个
 *  "只有压缩轮落盘"可能只是因为别的轮没活可干（判据空转）。 */
describe("对照臂判据：门槛旋钮接得上", () => {
  it("每轮都落盘 ⇒ 绿；仍然只在压缩轮落盘 ⇒ 红（并说清是对照空了）", () => {
    const green = thresholdKnobIsWired([
      { prunableAtDecision: 2, compactions: 0, attachments: 2 },
      { prunableAtDecision: 3, compactions: 1, attachments: 2 },
    ]);
    expect(green.ok).toBe(true);
    const red = thresholdKnobIsWired([
      { prunableAtDecision: 2, compactions: 1, attachments: 2 },
      { prunableAtDecision: 3, compactions: 0, attachments: 0 },
    ]);
    expect(red.ok).toBe(false);
    expect(red.detail).toContain("对照是空的");
  });

  it("没活可干的链不算接上（prunable 全 0 时 stray 必然是 0）", () => {
    expect(thresholdKnobIsWired([{ prunableAtDecision: 0, compactions: 0, attachments: 0 }]).ok).toBe(false);
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

  /** 免费车的接线证明同样复用门里那条规则：自己搭驱动会因为时序漂（上面那条测例的教训）。
   *  这条测的是**装配链真的把旗标递给了策略**——门里那条跑的是真 provider、真压缩、真落盘。 */
  it("PC9 那条集合相等判据真能跑通（= 压缩后置位、取用即清零都接在装配链上）", async () => {
    const rule = CHURN_RULES.find((r) => r.id.startsWith("PC9"));
    expect(rule, "PC9 不在了——免费车就没有观测者").toBeDefined();
    const v = await rule!.run();
    expect(v.ok, "PC9 红了：" + v.detail).toBe(true);
    // 读数必须是「同一些轮」而不是两个空集合（空对空也算相等）
    expect(v.detail).toMatch(/落盘轮=\[\d+(,\d+)*\] 压缩轮=\[\d+(,\d+)*\]/);
    expect(v.detail).not.toMatch(/落盘轮=\[\] 压缩轮=\[\]/);
  }, 600_000);
});
