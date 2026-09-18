// 能力 #5 回归网：M5b 级联升级（src/routing/cascade.ts）此前只有 routing-check 门禁级覆盖。
// 本文件锁定 runCascade 的分支语义：fail-closed 不升级 / maxRungs 上限 / 无更高档 /
// 升级决策可审计（每次执行一条 routing_decision，升级带 from）。变更语义会立刻红。
import { describe, expect, it } from "vitest";
import { runCascade, type CascadeRung } from "../src/routing/cascade";
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
