// 入场动效与减少动态（2026-10-18）：目标芯片/队列/草稿铅笔有轻量入场；系统开启“减少动态”时
// 动画与平滑滚动一律让路。全文件只留一个 reduced-motion 块（此前就有一块，本轮扩它而不是再抄一份）。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(fileURLToPath(new URL("../src/renderer/styles.css", import.meta.url)), "utf8");

describe("入场动效与减少动态", () => {
  it("目标芯片/队列/草稿有入场动画", () => {
    expect(css).toContain(".goal-chip {\n  animation: gc-in var(--t-fast);");
    expect(css).toContain(".queue-item {\n  animation: sp-flash-in var(--t-fast);");
    expect(css).toContain(".s-draft { animation: sp-flash-in var(--t-fast); }");
    expect(css).toContain("@keyframes gc-in { from { opacity: 0; transform: translateY(3px); } }");
  });

  it("reduced-motion 只有一块，且覆盖伪元素与平滑滚动", () => {
    expect(css.match(/prefers-reduced-motion/g)?.length).toBe(1);
    expect(css).toContain("*, *::before, *::after {");
    expect(css).toContain("scroll-behavior: auto !important;");
  });
});
