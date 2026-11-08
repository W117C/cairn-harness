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

describe("首启文案是用户语言（不是设置审计）", () => {
  it("labels / entries 不出现 BYOK、单价表、license、沙箱状态、面板布局等工程词", () => {
    const banned = /BYOK|单价表|license|沙箱状态|产出代码安全模式|面板布局|Provider 管理|遥测开关/;
    for (const group of ONBOARDING_GROUPS) {
      expect(group.label, group.id).not.toMatch(banned);
      expect(group.entry, group.id).not.toMatch(banned);
    }
  });

  it("每一组都有一句「这格是干什么的」——不是只有名词", () => {
    for (const group of ONBOARDING_GROUPS) {
      expect(group.entry.length, group.id).toBeGreaterThan(8);
      expect(group.entry, group.id).toMatch(/[。；]|可以|随时|这里|默认|查看|填入/);
    }
  });
});

describe("entry 不许把 label 换个说法再念一遍（2026-11-01 第 896 页 · 业主「让布局说话」）", () => {
  // 这四句此前就在屏上：它们只重排了格子标题里的词，读完不知道会看到什么新东西。
  // 保留「每组必须有 entry」的既有裁决，所以处理方式是**改写成不可推导的事实**
  // （何时发生 / 能做什么 / 默认状态），不是删掉。
  const RESTATED = [
    "需要定时跑的任务在这里安排",
    "查看版本、许可证与更新",
    "选主题；布局随时可在右栏调整",
    "会话结束后自动沉淀项目约定，可在记忆页查看",
  ];
  it("被撤的复述句不许回来（逐句点名）", () => {
    for (const gone of RESTATED) {
      for (const g of ONBOARDING_GROUPS) {
        expect(g.entry, `这句是复述标题：${gone}`).not.toBe(gone);
      }
    }
  });

  it("反向自证：上面四条确实曾经在这份数据里出现过（不是恒真的空名单）", () => {
    // 名单里每一条都对应一个真实 label；若哪天 label 被改掉，这条会提醒我们同步名单。
    const labels = ONBOARDING_GROUPS.map((g) => g.label);
    for (const l of ["定时任务", "版本与更新", "主题与布局", "记忆"]) {
      expect(labels, `复述名单里点名的格子（${l}）还在屏上——名单不许悄悄失效`).toContain(l);
    }
    // 再证一层：这四格现在的 entry 与名单里的旧句都不同（改写过，不是没执行）
    const byLabel = new Map(ONBOARDING_GROUPS.map((g) => [g.label, g.entry]));
    expect(byLabel.get("定时任务")).not.toBe("需要定时跑的任务在这里安排");
    expect(byLabel.get("版本与更新")).not.toBe("查看版本、许可证与更新");
    expect(byLabel.get("主题与布局")).not.toBe("选主题；布局随时可在右栏调整");
    expect(byLabel.get("记忆")).not.toBe("会话结束后自动沉淀项目约定，可在记忆页查看");
  });

  it("每格仍带一句非复述的事实（不许退化成空壳或纯名词）", () => {
    for (const g of ONBOARDING_GROUPS) {
      expect(g.entry.trim().length, g.id).toBeGreaterThan(8);
      // 事实标记：时间/默认/能力/落点之一
      expect(g.entry, `${g.id} 的 entry 要带不可推导的信息`).toMatch(/自动|默认|随时|可|这里|填入|诊断/);
    }
  });
});
