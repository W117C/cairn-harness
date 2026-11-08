import { describe, expect, it } from "vitest";
import { describeAsk } from "../src/renderer/components/cards";

describe("browser approval descriptions", () => {
  it("shows the destination before approving navigation", () => {
    expect(describeAsk({ tool: "browser_navigate", args: { url: "https://example.com/docs" } }))
      .toEqual({ title: "打开浏览器页面", subject: "https://example.com/docs" });
  });

  it("distinguishes reading the current page from opening another page", () => {
    expect(describeAsk({ tool: "browser_snapshot", args: {} }))
      .toEqual({ title: "读取浏览器页面" });
  });

  it("shows the element selector being inspected", () => {
    expect(describeAsk({ tool: "browser_pick", args: { selector: "button.primary", max: 3 } }))
      .toEqual({ title: "查找网页元素", body: "button.primary" });
  });
});
