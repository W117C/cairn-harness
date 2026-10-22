import { readAppSurface } from "./helpers/app-surface";
// 浮层能关掉（2026-10-19 独立评审追出的真缺陷）：用量环的明细浮层两个手势都不认。
//
// 缺陷形状：Composer 只给附件/权限两个菜单接了 usePopoverDismiss，用量浮层（menu === "meter"）
// 两个都没有 ⇒ 点开用量环后按 Esc 不关、点外面也不关，它一直钉在输入框上方盖着内容，
// 用户只能再点一次环、或点里面的「压缩历史…」、或切会话才收。
// 每一个别的浮层（附件/权限/模型/芯片/mention/slash）两个手势都关，这一支独自关不掉
// 读起来就是坏控件。
//
// 判据分两面：纯函数面（哪些浮层该认外点/Esc）能真跑；接线面钉住"meter 也挂了 usePopoverDismiss"。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const composer = read("../src/renderer/components/Composer.tsx");
const popover = readAppSurface();

describe("Composer 的浮层：三个自绘菜单都认外点 + Esc", () => {
  it("meter 也接了 usePopoverDismiss（旧实现只有 attach/perm 两支）", () => {
    expect(composer).toContain("usePopoverDismiss(menu === \"meter\", closeMenu, meterWrapRef);");
  });

  it("meter 的浮层挂在 meterWrapRef 上（没有 ref，contains 永远假 ⇒ 外点判据形同虚设）", () => {
    expect(composer).toContain("const meterWrapRef = useRef<HTMLDivElement | null>(null);");
    expect(composer).toContain('<div className="usage-slot" ref={meterWrapRef}>');
  });

  it("反向锚：三个自绘菜单各有自己的一支 usePopoverDismiss（少一支就有一个关不掉）", () => {
    const calls = composer.match(/usePopoverDismiss\(menu === "(attach|perm|meter)"/g) ?? [];
    expect(calls).toHaveLength(3);
    expect(new Set(calls).size).toBe(3);
  });
});

describe("usePopoverDismiss 的两个手势（单源实现，行为面）", () => {
  it("同时挂 mousedown（外点）与 keydown（Esc）两个监听", () => {
    expect(popover).toContain('document.addEventListener("mousedown", onDoc);');
    expect(popover).toContain('document.addEventListener("keydown", onKey);');
    expect(popover).toContain('document.removeEventListener("mousedown", onDoc);');
    expect(popover).toContain('document.removeEventListener("keydown", onKey);');
  });

  it("Esc 一律关（不分是哪一个浮层）", () => {
    expect(popover).toContain('if (e.key === "Escape") close();');
  });

  it("外点关：点在 ref 之外才关；点在浮层自身之内不关", () => {
    expect(popover).toContain("if (ref.current !== null && !ref.current.contains(e.target as Node)) close();");
  });

  it("Radix 门户豁免：点在门户里（弹层内嵌子菜单）不算外点", () => {
    expect(popover).toContain("data-radix-popper-content-wrapper");
  });
});
