import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FallbackCard, KNOWN_CARD_TYPES, resolveCard } from "../src/renderer/cards/registry";

describe("卡片注册表", () => {
  it("八类已知 card_type 均注册为组件（M1a 四类 + M1b 三门三类 + M1d 压缩卡）", () => {
    expect([...KNOWN_CARD_TYPES].sort()).toEqual([
      "approval",
      "clarify_form",
      "compaction",
      "diff",
      "plan",
      "report",
      "usage_summary",
      "verify_result",
    ]);
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

  it("三门卡片可静态渲染（SSR 冒烟：clarify_form / plan / verify_result 不抛异常且内容可见）", () => {
    const clarifyHtml = renderToStaticMarkup(
      createElement(resolveCard("clarify_form"), {
        payload: {
          type: "clarify_form",
          callId: "c1",
          questions: [
            { question: "交互框架用哪个？", options: [{ label: "React" }, { label: "Vue" }] },
            { question: "要不要补测试？" },
          ],
        },
      }),
    );
    expect(clarifyHtml).toContain("交互框架用哪个？");
    expect(clarifyHtml).toContain("React");

    const planHtml = renderToStaticMarkup(
      createElement(resolveCard("plan"), {
        payload: {
          type: "plan",
          callId: "c2",
          plan: {
            goal: "修复 completedCount",
            files: [{ path: "src/todo.ts", action: "edit", summary: "过滤 done" }],
            verify: { test: ["pnpm run test"] },
          },
        },
      }),
    );
    expect(planHtml).toContain("修复 completedCount");
    expect(planHtml).toContain("src/todo.ts");

    const verifyHtml = renderToStaticMarkup(
      createElement(resolveCard("verify_result"), {
        payload: {
          type: "verify_result",
          callId: "c3",
          ok: true,
          attempt: 1,
          maxAttempts: 3,
          results: [{ command: "pnpm run test", ok: true, output: "3 passed" }],
        },
      }),
    );
    expect(verifyHtml).toContain("pnpm run test");
    expect(verifyHtml).toContain("通过");
  });
});
