// 模型菜单向上开时不许顶穿标题栏（2026-10-22）。
//
// 真机复现：空屏输入卡在屏幕中部（触发条 top≈420），模型菜单自然高 393px，向上开到
// top≈11px —— 第一行「deepseek-chat」被窗口上沿切掉。修法是按触发条位置算可用高度，
// 超出部分在菜单内滚动；这里钉住算法与接线。
import { describe, expect, it } from "vitest";
import { modelMenuMaxHeight } from "../src/renderer/components/ModelPicker";
import { readRendererFile } from "./helpers/app-surface";

describe("模型菜单高度", () => {
  it("按触发条上沿留出标题栏：420 → 376（空屏实测）", () => {
    expect(modelMenuMaxHeight(420)).toBe(376);
  });

  it("上限 560，不能用最小高度突破真实可用空间", () => {
    expect(modelMenuMaxHeight(900)).toBe(560);
    expect(modelMenuMaxHeight(100)).toBe(56);
    expect(modelMenuMaxHeight(0)).toBe(0);
  });

  it("接线：打开时测量可用空间，列表独立滚动，底部控制区可见", () => {
    const picker = readRendererFile("components/ModelPicker.tsx");
    expect(picker).toContain("modelMenuLayout(rect.top, rect.bottom, window.innerHeight)");
    expect(picker).toContain("maxHeight: props.maxHeight");
    const css = readRendererFile("components/model-menu.css");
    expect(css).toMatch(/\.mp-pop \.mp-models\s*\{[^}]*min-height: 0;[^}]*overflow-y: auto/s);
    expect(css).toMatch(/\.pop\.mp-pop\.show\s*\{[^}]*overflow: hidden/s);
    expect(css).toContain(".mp-pop .mp-controls { flex: none;");
  });
});
