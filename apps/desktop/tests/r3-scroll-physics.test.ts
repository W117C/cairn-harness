// R3 滚动物理判卷（2026-10-31）：按 open-claude-ui useClaudeScrollPinning / ScrollFadeContainer。
// 40px 容差、2px 顶部、150ms 用户输入冷却；冷却只应由真实视口输入触发。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { USER_SCROLL_COOLDOWN_MS } from "../src/renderer/useStickyScroll";

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("粘底滚动：参考库物理常数", () => {
  const hook = read("../src/renderer/useStickyScroll.ts");

  it("40px 贴底容差；150ms 冷却常量对外可见", () => {
    expect(USER_SCROLL_COOLDOWN_MS).toBe(150);
    expect(hook).toContain("const NEAR_BOTTOM_PX = 40;");
    expect(hook).toContain("const USER_SCROLL_COOLDOWN_MS = 150;");
  });

  it("用户滚轮/触摸/滚动条按下会立即 unpin 并记时；正文里的点击不算", () => {
    expect(hook).toContain('el.addEventListener("wheel", onUserInput, { passive: true })');
    expect(hook).toContain('el.addEventListener("touchstart", onUserInput, { passive: true })');
    expect(hook).toContain("if (e.target === el) onUserInput();");
    expect(hook).toContain("lastUserInputAt.current = performance.now();");
  });

  it("跟底观察器在冷却窗内不抢视口", () => {
    expect(hook).toContain("if (performance.now() - lastUserInputAt.current <= USER_SCROLL_COOLDOWN_MS) return;");
  });

  it("顶部判定是 2px，不是 1px", () => {
    expect(hook).toContain("const AT_TOP_PX = 2;");
    expect(hook).toContain("setAtTop(el.scrollTop <= AT_TOP_PX);");
  });
});
