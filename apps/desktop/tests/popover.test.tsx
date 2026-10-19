// 共享 Popover 判卷（《全局 UI 视觉重构》brief 交付方式 2：通用组件先行 · 阶段 1）：
// ① 展示件类族不变量与旧内联实现逐字节同形（pop + 方向 + show；role/className 透传）；
// ② 共享化哨兵——同一份「弹层基座 / 外点关闭」逻辑只许存在一处（防复制粘贴双份漂移）。
// 判卷风格与全仓一致：SSR 钉结构 + 源码哨兵钉唯一性（本仓无 jsdom，行为面靠函数式注入不可行 ⇒ 钉单源）。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Popover } from "../src/renderer/components/Popover";

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
    const pop = read("../src/renderer/components/Popover.tsx");
    expect(pop).toContain('document.addEventListener("mousedown"');
    expect(pop).toContain('e.key === "Escape"');
    const mp = read("../src/renderer/components/ModelPicker.tsx");
    expect(mp).toContain("usePopoverDismiss");
    expect(mp).not.toContain('document.addEventListener("mousedown"');
  });

  it("Radix 门户豁免（P2-1）：弹层里嵌 Radix 子菜单（空屏项目 chip 复用 AddProjectMenu），点它不算外点", () => {
    const pop = read("../src/renderer/components/Popover.tsx");
    expect(pop).toContain("data-radix-popper-content-wrapper");
    // 豁免紧挨外点判定：先查豁免再查 contains（顺序即语义——豁免未命中才轮得到关闭）。
    const guardAt = pop.indexOf("data-radix-popper-content-wrapper");
    const containsAt = pop.indexOf("!ref.current.contains");
    expect(guardAt).toBeGreaterThan(-1);
    expect(containsAt).toBeGreaterThan(guardAt);
  });
});
