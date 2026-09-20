// 能力 #5 回归网：M5b 级联升级（src/routing/cascade.ts）此前只有 routing-check 门禁级覆盖。
// 本文件锁定 runCascade 的分支语义：fail-closed 不升级 / maxRungs 上限 / 无更高档 /
// 升级决策可审计（每次执行一条 routing_decision，升级带 from）。变更语义会立刻红。
import { describe, expect, it } from "vitest";
import { cascadeLadder, runCascade, type CascadeRung } from "../src/routing/cascade";
import type { ModelTier } from "../src/providers/registry";

function rung(id: string, tier: ModelTier, ok: boolean, output = ""): CascadeRung {
  return { id, tier, run: async () => ({ ok, output }) };
}

describe("runCascade", () => {
  it("空 rungs 抛错（前置条件fail-fast）", async () => {
    await expect(runCascade({ rungs: [], hasJudge: true })).rejects.toThrow(/为空/);
  });

  it("首档即成功：tier-default 决策、零升级", async () => {
    const r = await runCascade({ rungs: [rung("a", "cheap", true)], hasJudge: true });
    expect(r.ok).toBe(true);
    expect(r.finalId).toBe("a");
    expect(r.finalTier).toBe("cheap");
    expect(r.upgrades).toBe(0);
    expect(r.decisions).toHaveLength(1);
    expect(r.decisions[0]).toMatchObject({ picked: "a", tier: "cheap", reason: "tier-default" });
    expect(r.decisions[0]!.from).toBeUndefined();
  });

  it("失败但无客观判据 → fail-closed 不升级、不猜", async () => {
    const r = await runCascade({
      rungs: [rung("a", "cheap", false, "boom"), rung("b", "strong", true)],
      hasJudge: false,
    });
    expect(r.ok).toBe(false);
    expect(r.upgrades).toBe(0);
    expect(r.finalId).toBe("a"); // 留在失败档，没偷偷升上去放行
    expect(r.blockedNote).toContain("无 verify 判据");
    expect(r.blockedNote).toContain("boom"); // 失败输出截断进说明，可审计
    expect(r.decisions).toHaveLength(1);
  });

  it("失败 + 有判据 → 升一级成功：cascade-upgrade 决策带 from", async () => {
    const r = await runCascade({
      rungs: [rung("a", "cheap", false), rung("b", "strong", true)],
      hasJudge: true,
    });
    expect(r.ok).toBe(true);
    expect(r.finalId).toBe("b");
    expect(r.upgrades).toBe(1);
    expect(r.decisions).toHaveLength(2);
    expect(r.decisions[1]).toMatchObject({
      picked: "b",
      tier: "strong",
      reason: "cascade-upgrade",
      from: "cheap",
    });
  });

  it("达到 maxRungs 上限不再爬升（防无限升级）", async () => {
    const r = await runCascade({
      rungs: [rung("a", "cheap", false), rung("b", "standard", false), rung("c", "strong", true)],
      hasJudge: true,
      maxRungs: 1,
    });
    expect(r.ok).toBe(false);
    expect(r.upgrades).toBe(1);
    expect(r.finalId).toBe("b");
    expect(r.blockedNote).toContain("maxRungs=1");
  });

  it("已在最高档仍失败 → 报无更高档可升", async () => {
    const r = await runCascade({
      rungs: [rung("a", "cheap", false), rung("b", "strong", false)],
      hasJudge: true,
    });
    expect(r.ok).toBe(false);
    expect(r.finalId).toBe("b");
    expect(r.blockedNote).toContain("无更高档");
  });

  it("多级升级到顶：每级一条决策、from 逐级记录", async () => {
    const r = await runCascade({
      rungs: [rung("a", "cheap", false), rung("b", "standard", false), rung("c", "strong", true)],
      hasJudge: true,
      maxRungs: 2,
    });
    expect(r.ok).toBe(true);
    expect(r.upgrades).toBe(2);
    expect(r.decisions.map((d) => d.reason)).toEqual(["tier-default", "cascade-upgrade", "cascade-upgrade"]);
    expect(r.decisions.map((d) => d.from)).toEqual([undefined, "cheap", "standard"]);
  });
});

// cascadeLadder 是产品路径（orchestrator.runChain 环）取阶梯的唯一入口：它的返回直接等于"再花几遍钱"。
// 所以这里锁的不是形状而是账单语义——起始档不得重跑、档数不得超预算、无档可升必须交空表。
describe("cascadeLadder", () => {
  const TABLE = [
    { id: "glm-4-flash", tier: "cheap" as ModelTier },
    { id: "glm-4.6", tier: "standard" as ModelTier },
    { id: "glm-4-plus", tier: "strong" as ModelTier },
  ];

  it("从上一档起取，起始档自己不进来（重跑已判没过的同一档 = 再花一遍钱得同一结果）", () => {
    expect(cascadeLadder("cheap", TABLE, 2).map((r) => r.tier)).toEqual(["standard", "strong"]);
    expect(cascadeLadder("cheap", TABLE, 2).map((r) => r.id)).toEqual(["glm-4.6", "glm-4-plus"]);
  });

  it("maxUpgrades 是真上限：预算 1 就只给一档，不给「先答应再超支」", () => {
    expect(cascadeLadder("cheap", TABLE, 1).map((r) => r.tier)).toEqual(["standard"]);
  });

  it("已在最高档 ⇒ 空表（调用方据此走 fail-closed，不造升级了个寂寞的空跑）", () => {
    expect(cascadeLadder("strong", TABLE, 2)).toEqual([]);
  });

  it("档位表缺中间档时跳过它，不拿别的档凑数", () => {
    const sparse = [{ id: "a", tier: "cheap" as ModelTier }, { id: "c", tier: "strong" as ModelTier }];
    expect(cascadeLadder("cheap", sparse, 2)).toEqual([{ id: "c", tier: "strong" }]);
  });

  it("未知起始档 ⇒ 空表：观察不到自己落在哪一档就不假装知道该往哪升", () => {
    expect(cascadeLadder("nonsense" as ModelTier, TABLE, 2)).toEqual([]);
  });

  it("同 provider 表喂进来即同 provider 阶梯（跨厂商升档会悄悄换掉用户的 BYOK key）", () => {
    const mixed = [...TABLE, { id: "claude-sonnet", tier: "strong" as ModelTier }];
    const glmOnly = mixed.filter((s) => s.id.startsWith("glm-"));
    expect(cascadeLadder("standard", glmOnly, 2).map((r) => r.id)).toEqual(["glm-4-plus"]);
  });
});
