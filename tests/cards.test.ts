import { describe, expect, it } from "vitest";
import { FallbackCard, KNOWN_CARD_TYPES, resolveCard } from "../src/renderer/cards/registry";

describe("卡片注册表", () => {
  it("四类已知 card_type 均注册为组件", () => {
    expect([...KNOWN_CARD_TYPES].sort()).toEqual(["approval", "diff", "report", "usage_summary"]);
    for (const t of KNOWN_CARD_TYPES) {
      expect(typeof resolveCard(t)).toBe("function");
      expect(resolveCard(t)).not.toBe(FallbackCard);
    }
  });

  it("未知 card_type 落到兜底卡且不抛异常", () => {
    expect(resolveCard("bogus_card")).toBe(FallbackCard);
    expect(() => resolveCard("bogus_card")({ payload: { type: "bogus_card", x: 1 } })).not.toThrow();
    expect(() => resolveCard("")({ payload: {} })).not.toThrow();
    // 兜底卡自身渲染载荷也不抛
    expect(() => FallbackCard({ payload: { type: "bogus_card", weird: { a: 1 } } })).not.toThrow();
  });
});
