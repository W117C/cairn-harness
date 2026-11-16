// 单选组键盘契约（2026-11-16 · 第 1311 页）：
// 模板网格早就支持方向键循环 + 单选组单个 Tab 停点，设置面的主题 / 字号 / 尺寸 / 权限档四组
// 却只有 role="radiogroup" 的外观：方向键无反应、Tab 要逐颗经过。四组现在共用
// `renderer/radio-nav.ts` 一份下标算法与落焦逻辑——判卷钉纯函数、落焦副作用与四组接线。
import type { KeyboardEvent } from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { applyRadioNavigation, radioNavigationTarget, tabNavigationTarget } from "../src/renderer/radio-nav";
import { OptionCard } from "../src/renderer/components/settings-ui";
import { readAppSurface, readRendererFile } from "./helpers/app-surface";

describe("radioNavigationTarget（纯函数）", () => {
  it("方向键循环，Home / End 到首尾，其余键不劫持", () => {
    expect(radioNavigationTarget("ArrowRight", 0, 4)).toBe(1);
    expect(radioNavigationTarget("ArrowDown", 2, 4)).toBe(3);
    expect(radioNavigationTarget("ArrowLeft", 0, 4)).toBe(3);
    expect(radioNavigationTarget("ArrowUp", 3, 4)).toBe(2);
    expect(radioNavigationTarget("Home", 2, 4)).toBe(0);
    expect(radioNavigationTarget("End", 1, 4)).toBe(3);
    expect(radioNavigationTarget("Enter", 1, 4)).toBeNull();
    expect(radioNavigationTarget(" ", 1, 4)).toBeNull();
  });

  it("空组不返回下标；当前项越界时从第一颗起算（方向键仍可用）", () => {
    expect(radioNavigationTarget("ArrowRight", 0, 0)).toBeNull();
    expect(radioNavigationTarget("Home", 0, -1)).toBeNull();
    expect(radioNavigationTarget("ArrowRight", -1, 3)).toBe(1);
    expect(radioNavigationTarget("ArrowRight", 9, 3)).toBe(1);
    expect(radioNavigationTarget("ArrowLeft", -1, 3)).toBe(2);
  });
});

describe("tabNavigationTarget（水平 / 垂直 tablist）", () => {
  it("水平组：←/→ 循环、Home / End 到首尾；↑/↓ 不劫持（水平组的上下键属于滚动）", () => {
    expect(tabNavigationTarget("ArrowRight", 1, 3)).toBe(2);
    expect(tabNavigationTarget("ArrowRight", 2, 3)).toBe(0);
    expect(tabNavigationTarget("ArrowLeft", 0, 3)).toBe(2);
    expect(tabNavigationTarget("Home", 2, 3)).toBe(0);
    expect(tabNavigationTarget("End", 0, 3)).toBe(2);
    expect(tabNavigationTarget("ArrowUp", 1, 3)).toBeNull();
    expect(tabNavigationTarget("ArrowDown", 1, 3)).toBeNull();
  });

  it("垂直组：↑/↓ 换页，←/→ 不劫持（供应商列表是竖排）", () => {
    expect(tabNavigationTarget("ArrowDown", 1, 3, "vertical")).toBe(2);
    expect(tabNavigationTarget("ArrowDown", 2, 3, "vertical")).toBe(0);
    expect(tabNavigationTarget("ArrowUp", 0, 3, "vertical")).toBe(2);
    expect(tabNavigationTarget("Home", 2, 3, "vertical")).toBe(0);
    expect(tabNavigationTarget("End", 0, 3, "vertical")).toBe(2);
    expect(tabNavigationTarget("ArrowLeft", 1, 3, "vertical")).toBeNull();
    expect(tabNavigationTarget("ArrowRight", 1, 3, "vertical")).toBeNull();
  });

  it("空组或当前项越界给 null（不猜落点）", () => {
    expect(tabNavigationTarget("ArrowRight", 0, 0)).toBeNull();
    expect(tabNavigationTarget("ArrowRight", 3, 3)).toBeNull();
    expect(tabNavigationTarget("Home", -1, 3)).toBeNull();
    expect(tabNavigationTarget("ArrowDown", 3, 3, "vertical")).toBeNull();
  });
});

describe("applyRadioNavigation（选择 + 焦点）", () => {
  it("吃掉按键、选中目标下标、把焦点搬到同一颗 radio", () => {
    const selected: number[] = [];
    const focused: number[] = [];
    let prevented = false;
    const radios = [{ focus: () => focused.push(0) }, { focus: () => focused.push(1) }];
    const e = {
      key: "ArrowRight",
      currentTarget: { parentElement: { querySelectorAll: () => radios } },
      preventDefault: () => { prevented = true; },
    } as unknown as KeyboardEvent<HTMLButtonElement>;
    applyRadioNavigation(e, 0, 2, (index) => selected.push(index));
    expect(prevented).toBe(true);
    expect(selected).toEqual([1]);
    expect(focused).toEqual([1]);
  });

  it("非导航键原样放行（不 preventDefault、不选中、不搬焦点）", () => {
    const selected: number[] = [];
    let prevented = false;
    const e = {
      key: "Enter",
      currentTarget: { parentElement: { querySelectorAll: () => [] } },
      preventDefault: () => { prevented = true; },
    } as unknown as KeyboardEvent<HTMLButtonElement>;
    applyRadioNavigation(e, 0, 2, (index) => selected.push(index));
    expect(prevented).toBe(false);
    expect(selected).toEqual([]);
  });
});

describe("接线：应用内单选组共用同一套契约", () => {
  const count = (src: string, needle: string): number => src.split(needle).length - 1;

  it("设置面四组（主题 / 字号 / 尺寸 / 权限档）都走 helper，且只有选中项可 Tab", () => {
    const general = readRendererFile("components/settings/GeneralSection.tsx");
    expect(count(general, "applyRadioNavigation(e, current,")).toBe(3);
    expect(count(general, "? 0 : -1}")).toBe(3);
    const permissions = readRendererFile("components/settings/PermissionsSection.tsx");
    expect(count(permissions, "applyRadioNavigation(e, selectedIndex,")).toBe(1);
    expect(permissions).toContain("tabIndex={selectablePermissionMode(props.settings.mode) === m.id ? 0 : -1}");
  });

  it("模板网格走同一个 helper，全应用不再有第二份下标算法", () => {
    expect(readRendererFile("components/NewProjectDialog.tsx")).toContain("applyRadioNavigation(e, current,");
    // 读面：旧名字只要还在任何渲染层文件里，就说明还有一份平行实现。
    expect(readAppSurface()).not.toContain("templateNavigationTarget");
  });

  it("OptionCard 把 Tab 停点渲染到按钮上（组内单停点不是只写在调用处）", () => {
    const html = renderToStaticMarkup(
      <OptionCard checked={false} title="x" tabIndex={-1} onSelect={() => undefined} />,
    );
    expect(html).toContain('role="radio"');
    expect(html).toContain('tabindex="-1"');
  });
});
