// 模型菜单向上开时不许顶穿标题栏（2026-10-22）。
//
// 真机复现：空屏输入卡在屏幕中部（触发条 top≈420），模型菜单自然高 393px，向上开到
// top≈11px —— 第一行「deepseek-chat」被窗口上沿切掉。修法是按触发条位置算可用高度，
// 超出部分在菜单内滚动；这里钉住算法与接线。
import { describe, expect, it } from "vitest";
import { modelMenuLeft, modelMenuMaxHeight, MODEL_MENU_WIDTH } from "../src/renderer/components/ModelPicker";
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

  it("窗口右沿的触发条：菜单向左让位，右半不再被窗口切掉", () => {
    // 产品最小宽度 880：输入框右侧的触发条 left≈760，344px 的菜单会越出 224px。
    expect(modelMenuLeft(760, 880)).toBe(880 - 12 - MODEL_MENU_WIDTH);
    // 1440 宽且右边有空间：保持左对齐，不被无谓地推开。
    expect(modelMenuLeft(1000, 1440)).toBe(1000);
    // 左沿同样留 12px。
    expect(modelMenuLeft(0, 1440)).toBe(12);
    // 窗口比菜单窄：菜单宽度收到 100vw-24，落点固定为 12。
    expect(modelMenuLeft(200, 300)).toBe(12);
    // 扫描任意触发位置 / 窗口宽度：菜单左右沿都不许出窗口。
    for (let viewport = 240; viewport <= 1600; viewport += 13) {
      const width = Math.min(MODEL_MENU_WIDTH, viewport - 24);
      for (let triggerLeft = -20; triggerLeft <= viewport + 20; triggerLeft += 17) {
        const left = modelMenuLeft(triggerLeft, viewport);
        expect(left, `left=${left} viewport=${viewport}`).toBeGreaterThanOrEqual(12);
        expect(left + width, `right=${left + width} viewport=${viewport}`).toBeLessThanOrEqual(viewport - 12);
      }
    }
  });

  it("接线：打开时测量可用空间，列表独立滚动，底部控制区可见", () => {
    const picker = readRendererFile("components/ModelPicker.tsx");
    expect(picker).toContain("modelMenuLayout(rect.top, rect.bottom, window.innerHeight)");
    // 右沿按最近的裁剪祖先算（右侧窗格打开时主区比窗口窄），不能只看 window.innerWidth。
    expect(picker).toContain("modelMenuLeft(rect.left - bounds.left, bounds.right - bounds.left)");
    expect(picker).toContain("getComputedStyle(el).overflowX");
    expect(picker).toContain("maxHeight: props.maxHeight");
    const css = readRendererFile("components/model-menu.css");
    // 水平夹取用的是同一个宽度：CSS 改了宽度而 JS 常量没跟，右沿又会算错。
    expect(css).toContain(`width: min(${MODEL_MENU_WIDTH}px, calc(100vw - 24px))`);
    expect(css).toMatch(/\.mp-pop \.mp-models\s*\{[^}]*min-height: 0;[^}]*overflow-y: auto/s);
    expect(css).toMatch(/\.pop\.mp-pop\.show\s*\{[^}]*overflow: hidden/s);
    expect(css).toContain(".mp-pop .mp-controls { flex: none;");
  });
});
