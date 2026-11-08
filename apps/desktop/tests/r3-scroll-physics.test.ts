// R3 滚动物理判卷（2026-10-31）：按 open-claude-ui useClaudeScrollPinning / ScrollFadeContainer。
// 40px 容差、2px 顶部、150ms 用户输入冷却；冷却只应由真实视口输入触发。
// 2026-11-01 追加：浮钮显隐 = 「视口下面还有没有内容」（真机缺陷 2：已经在底部也亮按钮）。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { USER_SCROLL_COOLDOWN_MS, isNearBottom } from "../src/renderer/useStickyScroll";
import { readAppSurface } from "./helpers/app-surface";

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

describe("浮钮显隐 = 视口下面还有内容（2026-11-01 真机缺陷 2）", () => {
  const hook = read("../src/renderer/useStickyScroll.ts");
  const surface = readAppSurface();

  it("贴底判定：装得下 ⇒ 仍在底部（不亮）；下面有内容 ⇒ 不贴底（亮）", () => {
    expect(isNearBottom({ scrollTop: 0, scrollHeight: 400, clientHeight: 500 })).toBe(true);   // 内容不足一屏
    expect(isNearBottom({ scrollTop: 0, scrollHeight: 900, clientHeight: 500 })).toBe(false);  // 下面还有 400px
    expect(isNearBottom({ scrollTop: 400, scrollHeight: 900, clientHeight: 500 })).toBe(true);  // 贴底
  });

  it("用户输入不再无条件置 false：按真实位置重判（碰一下 ≠ 离开底部）", () => {
    const handler = hook.match(/const onUserInput = \(\): void => \{([^}]*)\}/)?.[1] ?? "";
    expect(handler).toContain("isNearBottom(el)");
    expect(handler).not.toContain("setStuck(false)");
    // 全应用面里都不许再有「碰一下就置 false」的写法（挪了文件也逃不掉这张网）。
    expect(surface).not.toMatch(/setStuck\(false\)/);
  });

  it("内容长高且不跟底时也重判浮钮（下面一多内容就该亮）", () => {
    const follow = hook.match(/const follow = \(\) => \{([\s\S]*?)\n {4}\};/)?.[1] ?? "";
    expect(follow).toContain("isNearBottom(el)");
  });

  it("浮钮的显隐条件只有一个：视口下面还有内容（!stick.stuck）", () => {
    expect(surface).toContain("{!stick.stuck && (");
  });
});
