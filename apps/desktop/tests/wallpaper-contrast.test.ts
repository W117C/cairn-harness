// 可读性地板判卷（2026-11-14 · 设计规格 §5.3）：
// 地板 = 固定权重的主题底色压在玻璃色之上；滑杆只能改玻璃那一项 ⇒ 压不下去。
// 数值**算出来**，不手抄参照仓的权重。
//
// 末组是 CSS↔模型的漂移守卫：样式表里的地板公式必须与模型逐字一致，
// 玻璃面清单与层叠位置也不许悄悄漂。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CONTRAST_TARGET,
  DARK_SPEC,
  LIGHT_SPEC,
  contrastRatio,
  floorFor,
  glassSurface,
  mix,
  worstContrast,
} from "../src/renderer/derived/wallpaper-contrast";

const CSS = readFileSync(
  fileURLToPath(new URL("../src/renderer/wallpaper.css", import.meta.url)),
  "utf8",
);

describe("可读性地板", () => {
  it("地板权重算得出来，且网格最差格 ≥ 4.5:1", () => {
    for (const spec of [LIGHT_SPEC, DARK_SPEC]) {
      const floor = floorFor(spec);
      expect(floor).toBeGreaterThan(0);
      expect(worstContrast(spec, floor)).toBeGreaterThanOrEqual(CONTRAST_TARGET);
      // 再降一格就破线 ⇒ 说明这是最小地板（滑杆压不动它）
      expect(worstContrast(spec, floor - 0.01)).toBeLessThan(CONTRAST_TARGET);
    }
  });

  it("地板越大约束越紧：floor=1 时表面就是画布色", () => {
    const s = glassSurface(
      { r: 255, g: 255, b: 255 },
      { r: 255, g: 255, b: 255 },
      0.6,
      DARK_SPEC.canvas,
      1,
    );
    expect(s.r).toBeCloseTo(DARK_SPEC.canvas.r, 6);
    expect(s.g).toBeCloseTo(DARK_SPEC.canvas.g, 6);
    expect(s.b).toBeCloseTo(DARK_SPEC.canvas.b, 6);
  });

  it("玻璃透明度 0 时地板独立起作用", () => {
    const prev = mix(LIGHT_SPEC.canvas, LIGHT_SPEC.worstWallpaper, 0.9);
    const s = glassSurface(prev, LIGHT_SPEC.glass, 0, LIGHT_SPEC.canvas, 0.5);
    expect(s.r).toBeGreaterThan(prev.r);
    // 玻璃为 0 时表面只由地板与 prev 决定：floor=1 ⇒ 纯画布色
    const full = glassSurface(prev, LIGHT_SPEC.glass, 0, LIGHT_SPEC.canvas, 1);
    expect(full.r).toBeCloseTo(LIGHT_SPEC.canvas.r, 6);
  });

  it("对比度口径：黑对白 = 21", () => {
    expect(contrastRatio({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 })).toBeCloseTo(21, 5);
  });
});

describe("玻璃样式与模型的漂移守卫", () => {
  it("地板公式与模型逐字一致", () => {
    expect(CSS).toContain(
      "color-mix(in srgb, var(--cw-canvas) var(--cw-floor), var(--cw-glass) calc(100% - var(--cw-floor)))",
    );
  });

  it("五类玻璃面都在地板规则里", () => {
    const glassBlock =
      CSS.split("}").find((block) => block.includes("color-mix(in srgb, var(--cw-canvas)")) ?? "";
    for (const face of [".main", ".composer-card", ".inspector-col", ".modal-card", ".side-wrap"]) {
      expect(glassBlock).toContain(face);
    }
    expect(glassBlock).toContain("backdrop-filter");
  });

  it("壁纸层落在应用壳之下：.cw-layer 用负 z-index", () => {
    const layerRule = /\.cw-layer\s*\{([^}]*)\}/.exec(CSS)?.[1] ?? "";
    expect(layerRule).toContain("z-index: -1");
  });

  it("玻璃规则带我们自己的根属性：主题那条 (0,3,2) 会压过普通写法", () => {
    // 主题的 `html[data-theme="dark"] body[data-dsh-claude-style] [data-composer-card]` 是
    // (0,3,2)；玻璃规则若只有 (0,2,1)，composer 的不透明底色就把玻璃盖住（真渲染层实测过）。
    // 抬权重的办法是挂一个我们自己的 html 根属性（state/wallpaper.ts 单点写）。
    const glassBlock =
      CSS.split("}").find((block) => block.includes("color-mix(in srgb, var(--cw-canvas)")) ?? "";
    expect(glassBlock).toContain("data-cairn-wallpaper");
    expect(glassBlock).toContain("data-theme");
  });

  it("只写标准 backdrop-filter：压缩器去重时会挑带前缀那条，而 Chromium 只认标准写法", () => {
    // 实测：两条都写 ⇒ 产物只剩 -webkit-backdrop-filter ⇒ 计算值 = none ⇒ 玻璃没有模糊。
    const declarations = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(declarations).toContain("backdrop-filter:");
    expect(declarations).not.toContain("-webkit-backdrop-filter");
  });

  it("新样式表零字面色值（颜色一律走 --cw-* 变量）", () => {
    // 只查声明（注释里允许说明契约，但也不许出现色值——两边都守住）。
    const declarations = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(declarations).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(declarations).not.toMatch(/\b(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch)\(/);
    expect(CSS).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(CSS).not.toMatch(/\b(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch)\(/);
  });
});
