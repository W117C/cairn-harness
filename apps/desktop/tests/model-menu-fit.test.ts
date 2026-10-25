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

  it("上限 560、下限 240：贴近顶部不压成一条缝，贴底不无限长", () => {
    expect(modelMenuMaxHeight(900)).toBe(560);
    expect(modelMenuMaxHeight(100)).toBe(240);
    expect(modelMenuMaxHeight(0)).toBe(240);
  });

  it("接线：打开时测量并传 style；菜单自身可滚动", () => {
    const picker = readRendererFile("components/ModelPicker.tsx");
    expect(picker).toContain("modelMenuMaxHeight(top)");
    expect(picker).toContain("maxHeight: props.maxHeight");
    const css = readRendererFile("styles.css");
    expect(css).toContain(".mp-pop { min-width: 300px; max-width: 380px; max-height: min(480px, 62vh); overflow-y: auto;");
  });
});
