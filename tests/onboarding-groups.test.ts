// §13 引导七组的观察者（第 125 页）。
//
// 为什么现在补：core-only 迁移落地（`69fbb0d`）删掉 50 个测试文件，其中 `tests/projections.test.ts` 是
// **唯一**直接测这份数据的；而它原本的机制面（`groupOnboardingSteps`）住在已删的渲染层里，
// 旧门 `scripts/commercial-check.ts`（D1 引导七组覆盖）同日删除、门表里也从没有它
// ⇒ 这份仍在发货的数据（`src/main/settings-handlers.ts` 的 `onboardingGroups()` 在用它）一度无人守。
//
// 两半配对（规则 208）：运行面钉「形状＋步号域＋消费者拿到的是副本」，
// 编译面用 `Record<OnboardingGroup["id"], true>` 全映射钉「类型联合与这份表同增同删」——
// 只加类型不改表、或只改表不改类型，都会在 typecheck 红，而不是等运行时才发现。
import { describe, expect, it } from "vitest";
import { ONBOARDING_GROUPS, type OnboardingGroup } from "../src/main/onboarding-groups";
import { onboardingGroups } from "../src/main/settings-handlers";

/** 编译面：少一个键或多一个键都过不了 typecheck（这就是"表与类型同源"的那一半）。 */
const SPEC_IDS: Record<OnboardingGroup["id"], true> = {
  provider: true, permission: true, ui: true, schedule: true, memory: true, telemetry: true, about: true,
};

describe("§13 引导七组（数据面形状）", () => {
  it("id 唯一，且与类型联合一一对应（多一个/少一个都红）", () => {
    const ids = ONBOARDING_GROUPS.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.sort()).toEqual(Object.keys(SPEC_IDS).sort());
  });

  it("步号只用 1–4，且四步全有归属（向导不会渲染出空步，也不会出现第 5 步）", () => {
    const steps = [...new Set(ONBOARDING_GROUPS.map((g) => g.step))].sort((a, b) => a - b);
    expect(steps).toEqual([1, 2, 3, 4]);
    for (const g of ONBOARDING_GROUPS) expect([1, 2, 3, 4]).toContain(g.step);
  });

  it("每组都有 label 与「去哪儿找」的 entry（引导页不能出现空壳条目）", () => {
    for (const g of ONBOARDING_GROUPS) {
      expect(g.label.trim().length, g.id).toBeGreaterThan(0);
      expect(g.entry.trim().length, g.id).toBeGreaterThan(0);
    }
  });
});

describe("消费者面：settings 服务给出去的是这份数据，且是副本", () => {
  it("内容与常量一致", async () => {
    expect(await onboardingGroups()).toEqual([...ONBOARDING_GROUPS]);
  });

  it("返回的是新数组：消费者排序/清空都不会改到模块常量（`[...ONBOARDING_GROUPS]` 那半边的存在理由）", async () => {
    const first = await onboardingGroups();
    expect(first).not.toBe(ONBOARDING_GROUPS);
    first.length = 0;
    expect(ONBOARDING_GROUPS.length).toBeGreaterThan(0);
    expect((await onboardingGroups()).length).toBe(ONBOARDING_GROUPS.length);
  });
});
