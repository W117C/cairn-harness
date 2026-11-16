import { readAppSurface } from "./helpers/app-surface";
// 共享 Popover 判卷（《全局 UI 视觉重构》brief 交付方式 2：通用组件先行 · 阶段 1）：
// ① 展示件类族不变量与旧内联实现逐字节同形（pop + 方向 + show；role/className 透传）；
// ② 共享化哨兵——同一份「弹层基座 / 外点关闭」逻辑只许存在一处（防复制粘贴双份漂移）。
// 判卷风格与全仓一致：SSR 钉结构 + 源码哨兵钉唯一性（本仓无 jsdom，行为面靠函数式注入不可行 ⇒ 钉单源）。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Popover } from "../src/renderer/components/Popover";
import { menuNavIndex } from "../src/renderer/components/popover-keys";

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("Popover（共享弹层基座 · 展示件）", () => {
  it("open + up ⇒ class=\"pop up show\"；role 明给即带（与 Composer 旧内联实现同形）", () => {
    const html = renderToStaticMarkup(<Popover open up role="menu"><i className="x" /></Popover>);
    expect(html).toContain('class="pop up show"');
    expect(html).toContain('role="menu"');
  });

  it("closed ⇒ 无 show（保留 down 缺省方向——旧实现在关态也挂类名）", () => {
    const html = renderToStaticMarkup(<Popover open={false}><i /></Popover>);
    expect(html).toContain('class="pop down"');
    expect(html).not.toContain("show");
  });

  it("className 尾缀拼接（mp-pop 一族）+ style 透传；未给 role 不带 role 属性", () => {
    const html = renderToStaticMarkup(<Popover open up className="mp-pop" style={{ minWidth: 270 }}><i /></Popover>);
    expect(html).toContain('class="pop up show mp-pop"');
    expect(html).toContain("min-width:270px");
    expect(html).not.toContain("role=");
  });
});

describe("共享化哨兵（单源约束）", () => {
  it("弹层基座只有一份：Composer 用共享 Popover，不再自带 Pop 实现", () => {
    const src = read("../src/renderer/components/Composer.tsx");
    expect(src).toContain('from "./Popover"');
    expect(src).not.toMatch(/function Pop\s*\(/);
  });

  it("外点关闭 / Esc 逻辑收在 Popover.tsx 一处；ModelPicker 不再自持监听", () => {
    const pop = readAppSurface();
    expect(pop).toContain('document.addEventListener("mousedown"');
    expect(pop).toContain('e.key === "Escape"');
    const mp = read("../src/renderer/components/ModelPicker.tsx");
    expect(mp).toContain("usePopoverDismiss");
    expect(mp).not.toContain('document.addEventListener("mousedown"');
  });

  it("Radix 门户豁免（P2-1）：弹层里嵌 Radix 子菜单（空屏项目 chip 复用 AddProjectMenu），点它不算外点", () => {
    const pop = readAppSurface();
    expect(pop).toContain("data-radix-popper-content-wrapper");
    // 豁免紧挨外点判定：先查豁免再查 contains（顺序即语义——豁免未命中才轮得到关闭）。
    const guardAt = pop.indexOf("data-radix-popper-content-wrapper");
    const containsAt = pop.indexOf("!ref.current.contains");
    expect(guardAt).toBeGreaterThan(-1);
    expect(containsAt).toBeGreaterThan(guardAt);
  });
});

describe("菜单键盘导航（菜单按钮 / 项目弹层共用）", () => {
  it("↑↓ 环形、Home/End 直达两端；焦点在触发框时 ↓ 落首项、↑ 落末项", () => {
    expect(menuNavIndex("ArrowDown", -1, 3)).toBe(0);
    expect(menuNavIndex("ArrowUp", -1, 3)).toBe(2);
    expect(menuNavIndex("ArrowDown", 2, 3)).toBe(0);
    expect(menuNavIndex("ArrowUp", 0, 3)).toBe(2);
    expect(menuNavIndex("Home", 1, 5)).toBe(0);
    expect(menuNavIndex("End", 1, 5)).toBe(4);
    expect(menuNavIndex("Home", -1, 5)).toBe(0);
    expect(menuNavIndex("End", -1, 5)).toBe(4);
    expect(menuNavIndex("Tab", 1, 5)).toBeNull();
    expect(menuNavIndex("ArrowDown", 0, 0)).toBeNull();
  });

  it("路径右键菜单接上同一契约（↑↓ / Home / End / Tab 关闭）", () => {
    const src = read("../src/renderer/components/PathMenu.tsx");
    expect(src).toContain('role="menu"');
    expect(src).toContain("menuNavIndex(e.key, items.indexOf(document.activeElement as HTMLButtonElement), items.length)");
    expect(src).toContain('if (e.key === "Tab") { props.onClose(); return; }');
  });

  it("首项聚焦只随挂载跑一次（失败提示重渲染不抢回焦点）", () => {
    const src = read("../src/renderer/components/PathMenu.tsx");
    const focusAt = src.indexOf("first.current?.focus()");
    expect(focusAt).toBeGreaterThan(-1);
    expect(src.indexOf("}, []);", focusAt)).toBeGreaterThan(focusAt);
    expect(src).toContain("}, [props.onClose]);");
  });

  // 第 1313 页：菜单关闭 = 菜单项随卸载消失，焦点会掉回 body。只在确实丢了时交还右键那一刻的控件。
  it("路径菜单关闭把焦点交还打开它的控件（有去处时不抢）", () => {
    const src = read("../src/renderer/components/PathMenu.tsx");
    expect(src).toContain("document.activeElement instanceof HTMLElement ? document.activeElement : null");
    expect(src).toContain("if (cur !== null && cur !== document.body) return;");
    expect(src).toContain("back !== null && back.isConnected && back !== document.body");
  });
});
