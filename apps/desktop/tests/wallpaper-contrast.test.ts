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

  it("玻璃材质三件套在面规则里：saturate 耦合 / 分层内阴影 / 外部景深", () => {
    // 2026-11-17 材质升级的防回归：blur×saturate 是「透而不灰」的一半；sheen/shade/edge
    // 三层内阴影 + 外部落影是「有厚度的玻璃」。这四样缺一样，玻璃就退化回「半透明色块」。
    const glassBlock =
      CSS.split("}").find((block) => block.includes("color-mix(in srgb, var(--cw-canvas)")) ?? "";
    expect(glassBlock).toContain("saturate(var(--cw-glass-saturate");
    expect(glassBlock).toContain("inset 0 1px 0 var(--cw-glass-sheen)");
    expect(glassBlock).toContain("inset 0 -1px 0 var(--cw-glass-shade)");
    expect(glassBlock).toContain("inset 0 0 0 1px var(--cw-glass-edge)");
    expect(glassBlock).toContain("var(--cw-glass-shadow)");
  });

  it("设置行的三个类都有样式：.cw-settings / .cw-settings-actions / .cw-slider 不许是裸 HTML", () => {
    // 2026-11-15 实测：GeneralSection 里写了这三个类名，但没有任何样式表定义它们 ⇒
    // 三个没有名字的蓝条与「未设置/清除」两个按钮挤在同一 flex 行里互相压缩。
    // 这条判据钉「组件用了的类，样式表里必须有规则」，而不是「看着还行」。
    // 钉**顶层**规则（行首无缩进）：只在 @container 里写一条，窄窗以外的宽度就全裸奔了——
    // 第一版判据用 `toContain` 正好被这条挡住（变异测试实测：删掉顶层 `.cw-slider {` 判据仍绿）。
    for (const cls of [".cw-settings", ".cw-settings-actions", ".cw-slider"]) {
      const pattern = new RegExp("^" + cls.replace(/\./g, "\\.") + " \\{", "m");
      expect(CSS, `${cls} 在 wallpaper.css 里没有顶层规则`).toMatch(pattern);
    }
  });

  it("壁纸层落在应用壳之下：.cw-layer 用负 z-index", () => {
    const layerRule = /\.cw-layer\s*\{([^}]*)\}/.exec(CSS)?.[1] ?? "";
    expect(layerRule).toContain("z-index: -1");
  });

  it("设置整页不在画布让位名单里：它是 z-index:60 的覆盖层，透明会把工作台文字叠进设置文字", () => {
    // 2026-11-15 真机截图取证：让位名单里带 .sp-page 时，composer 与空态文案整层透在设置行下面。
    // 整页态的页面自己就是画布（设计规格：设置页是整页态，非浮层），保持实体底色。
    const yieldBlock = /body\[data-we-wallpaper\] :is\(([^)]*)\)/.exec(CSS)?.[1] ?? "";
    expect(yieldBlock).toContain(".app");
    expect(yieldBlock).not.toContain(".sp-page");
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

  it("新样式表零字面色值：颜色只许经主题变量进来", () => {
    // 本仓的颜色消费形制是 `hsl(var(--token))`（token 存 HSL 三元组，见 tokens.css）——
    // 那不是字面色值，而是把主题变量接进 CSS 颜色的**唯一正确写法**，所以判据放行它。
    // 真正要禁的是「颜色函数里没有 var()」：`hsl(15 63.1% 59.6%)`、`#fcfcfb`、`rgb(20,20,19)`。
    // 2026-11-15 收紧这处：旧判据连 `hsl(var(--x))` 一起禁，于是任何要上强调色的新规则都写不了
    // （只能自绘色值或干脆不写样式——后者正是设置行裸奔的原因之一）。
    const declarations = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
    const withoutTokenColors = declarations.replace(
      /(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch)\(\s*var\([^)]*\)[^)]*\)/g,
      "VARCOLOR",
    );
    expect(withoutTokenColors).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(withoutTokenColors).not.toMatch(/\b(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch)\(/);
    // 注释里同样不许藏整色值（注释会被抄进新文件，是泄漏面；三元组形制不算）。
    const comments = CSS.replace(/\/\*([\s\S]*?)\*\//g, "$1");
    expect(comments).not.toMatch(/#[0-9a-fA-F]{6}\b/);
  });
});
