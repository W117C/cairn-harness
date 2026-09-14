import { describe, expect, it } from "vitest";
import { routeFor, tierForStage } from "../src/routing/policy";
import type { ModelSpec } from "../src/providers/registry";

/** 自定义档位表（单测注入：可删档位测降级链）。 */
const T = (entries: Array<[string, string, string, number]>): ModelSpec[] =>
  entries.map(([id, provider, model, ctxWindow]) => ({ id, provider, model, tier: id.split("-")[1] as ModelSpec["tier"], ctxWindow }));

const FULL = T([
  ["g1-cheap", "g1", "m-cheap", 1000],
  ["g1-standard", "g1", "m-standard", 2000],
  ["g1-strong", "g1", "m-strong", 3000],
]);

describe("M5b 路由策略（步骤 7）", () => {
  it("pin 优先：model id 精确命中 → reason=pinned", () => {
    const d = routeFor({ pin: "g1-strong", table: FULL });
    expect(d.picked).toBe("g1-strong");
    expect(d.tier).toBe("strong");
    expect(d.reason).toBe("pinned");
    expect(d.candidates.map((c) => c.id)).toEqual(["g1-cheap", "g1-standard", "g1-strong"]);
  });

  it("pin 优先：档位名 → 该档首个 spec，reason=pinned", () => {
    const d = routeFor({ pin: "cheap", table: FULL });
    expect(d.picked).toBe("g1-cheap");
    expect(d.reason).toBe("pinned");
  });

  it("未知 pin fail-visible 抛错，不静默回落", () => {
    expect(() => routeFor({ pin: "nope", table: FULL })).toThrow(/未知 pin/);
    expect(() => routeFor({ pin: "nope-model", table: FULL })).toThrow(/未知 pin/);
  });

  it("无 pin 走档位：implement → cheap，reason=tier-default", () => {
    const d = routeFor({ stage: "implement", table: FULL });
    expect(d.picked).toBe("g1-cheap");
    expect(d.reason).toBe("tier-default");
  });

  it("review → strong；test → standard；自定义角色回落 standard", () => {
    expect(routeFor({ stage: "review", table: FULL }).picked).toBe("g1-strong");
    expect(routeFor({ stage: "test", table: FULL }).picked).toBe("g1-standard");
    expect(routeFor({ stage: "plugin-custom-role", table: FULL }).picked).toBe("g1-standard");
    expect(tierForStage(undefined)).toBe("standard");
  });

  it("档位不可用走降级链：cheap 缺档 → standard，reason=fallback + from=cheap", () => {
    const noCheap = T([
      ["g1-standard", "g1", "m-standard", 2000],
      ["g1-strong", "g1", "m-strong", 3000],
    ]);
    const d = routeFor({ stage: "implement", table: noCheap });
    expect(d.picked).toBe("g1-standard");
    expect(d.reason).toBe("fallback");
    expect(d.from).toBe("cheap");
  });

  it("strong 缺档 → 先向后无档再向前：回落 standard（from=strong）", () => {
    const noStrong = T([
      ["g1-cheap", "g1", "m-cheap", 1000],
      ["g1-standard", "g1", "m-standard", 2000],
    ]);
    const d = routeFor({ stage: "review", table: noStrong });
    expect(d.picked).toBe("g1-standard");
    expect(d.reason).toBe("fallback");
    expect(d.from).toBe("strong");
  });

  it("空表 fail-visible 抛错", () => {
    expect(() => routeFor({ stage: "implement", table: [] })).toThrow(/档位表为空/);
  });

  it("pin 与候选可审计面：candidates 永远记录全表（不只记结果）", () => {
    const d = routeFor({ stage: "implement", table: FULL });
    expect(d.candidates).toEqual([
      { id: "g1-cheap", tier: "cheap" },
      { id: "g1-standard", tier: "standard" },
      { id: "g1-strong", tier: "strong" },
    ]);
  });
});
