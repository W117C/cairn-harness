// 检查器启动开合：显式偏好 > 恢复内容 > 默认收起。
// 旧实现把「有恢复窗格」放在显式偏好之前 ⇒ 用户关掉检查器后，只要盘上还有窗格，
// 下一次启动就会被强行掰开。行为判据落在纯函数上，而不是只钉 App.tsx 的源码串。
import { describe, expect, it } from "vitest";
import { initialInspectorOpen } from "../src/renderer/inspector-pref";

describe("检查器启动开合优先级", () => {
  it("显式开 ⇒ 开（即使没有窗格）", () => {
    expect(initialInspectorOpen({ prefSet: true, defaultOpen: true, paneCount: 0 })).toBe(true);
  });

  it("显式关 ⇒ 关（即使有恢复窗格；这是旧实现翻车的形状）", () => {
    expect(initialInspectorOpen({ prefSet: true, defaultOpen: false, paneCount: 2 })).toBe(false);
  });

  it("没偏好 + 有窗格 ⇒ 开（否则恢复的窗格藏在 width 0 的栏里）", () => {
    expect(initialInspectorOpen({ prefSet: false, defaultOpen: false, paneCount: 1 })).toBe(true);
  });

  it("没偏好 + 没窗格 ⇒ 收起（brief 七的默认值）", () => {
    expect(initialInspectorOpen({ prefSet: false, defaultOpen: false, paneCount: 0 })).toBe(false);
  });
});
