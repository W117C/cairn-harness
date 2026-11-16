// 可读性地板的纯模型（2026-11-14 · 设计规格 §5.3）。
//
// 机制抄参照仓（dsh-wallpaper-engine）：承载文字的面 =
//   color-mix(in srgb, 画布色 floor%, 玻璃色 (1-floor)%)
// 地板是**固定权重**，滑杆只改玻璃那一项 ⇒ 地板压不下去 ⇒ 对比度有下界。
// 数值**不抄**：参照仓的权重是按它自己的主题底色算的；这里按本仓的颜色**算出来**。
//
// 合成口径与 CSS color-mix 对齐（预乘空间）：
//   alphaF = floor + (1-floor) × glassAlpha
//   surface = prev×(1-alphaF) + floor×canvas + (1-floor)×glassAlpha×glass
//
// 本模块是 derived 层：**纯**（无 DOM、无时钟、无随机、无 IO、无 await、无模块级可变态）。
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** 两色线性插值：t=0 全 a，t=1 全 b（与 CSS 里逐层 mix 的口径一致）。 */
export function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t };
}

/** sRGB 通道 → 线性光（WCAG 2.x 的相对亮度口径）。 */
function channel(v: number): number {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** 相对亮度（WCAG 2.x）。 */
export function relativeLuminance(c: Rgb): number {
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
}

/** 对比度（WCAG 2.x）：黑对白 = 21。 */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * 玻璃 + 地板合成后的表面色（与 CSS 的 color-mix 逐字对应）。
 *
 * glass 自带 alpha（CSS 侧写进 --cw-glass），所以合成后相对 prev 的有效覆盖率是
 * `floor + (1-floor)×glassAlpha`：floor=0 退化为普通玻璃叠加，glassAlpha=0 退化为纯地板覆盖。
 */
export function glassSurface(
  prev: Rgb,
  glass: Rgb,
  glassAlpha: number,
  canvas: Rgb,
  floor: number,
): Rgb {
  const alphaF = floor + (1 - floor) * glassAlpha;
  return {
    r: prev.r * (1 - alphaF) + floor * canvas.r + (1 - floor) * glassAlpha * glass.r,
    g: prev.g * (1 - alphaF) + floor * canvas.g + (1 - floor) * glassAlpha * glass.g,
    b: prev.b * (1 - alphaF) + floor * canvas.b + (1 - floor) * glassAlpha * glass.b,
  };
}

export interface ThemeContrastSpec {
  /** 主题文字色。 */
  text: Rgb;
  /** 主题画布色（地板色）。 */
  canvas: Rgb;
  /** 玻璃叠色（白色釉光；alpha 由滑杆给，模型侧单列）。 */
  glass: Rgb;
  /** 该主题下最不利的壁纸像素：暗色主题怕白，亮色主题怕黑。 */
  worstWallpaper: Rgb;
}

/**
 * 两个主题的常量**是量出来的，不是抄来的**（2026-11-16 真机读数，`smoke:wallpaper` 每次重测）：
 * 亮色 body 计算色 `rgb(11 11 11)`、画布 `rgb(252 252 251)`；
 * 暗色 body 计算色 `rgb(240 239 236)`、画布 `rgb(21 21 21)`。
 *
 * 为什么这行注释重要：这里从前写的是 `#141413` / `#FAF9F5`（是 vendored token 的字面值，
 * 不是**计算后**的字面值），真机一测就漂 9–10/通道——旧常量让模型算出 45%/58% 的地板，
 * 而运行时按真实计算样式算出 43%/61%。两边各说各话时，判据（模型最差格）会误报破线。
 * 现在两边同源；`smoke:wallpaper` 里有一条「常量 vs 真机真值差 ≤2/通道」的漂移守卫钉着。
 */
export const LIGHT_SPEC: ThemeContrastSpec = {
  text: { r: 11, g: 11, b: 11 },
  canvas: { r: 252, g: 252, b: 251 },
  glass: { r: 255, g: 255, b: 255 },
  worstWallpaper: { r: 0, g: 0, b: 0 },
};

/** 暗色主题（同上：真机读数，不是 token 字面值）。 */
export const DARK_SPEC: ThemeContrastSpec = {
  text: { r: 240, g: 239, b: 236 },
  canvas: { r: 21, g: 21, b: 21 },
  glass: { r: 255, g: 255, b: 255 },
  worstWallpaper: { r: 255, g: 255, b: 255 },
};

/** 验收线：WCAG AA 正文 4.5:1。 */
export const CONTRAST_TARGET = 4.5;

/** 网格 = 三个滑杆能到的全部档。 */
export const GLASS_ALPHAS: readonly number[] = [0, 0.15, 0.3, 0.45, 0.6];
export const WALLPAPER_ALPHAS: readonly number[] = [0, 0.5, 0.9];
export const SCRIMS: readonly number[] = [0, 0.35, 1];

/** 某一格的实际表面色：壁纸压在画布上 → 画布色 scrim 压一层 → 玻璃面合成。 */
export function worstSurface(
  spec: ThemeContrastSpec,
  glassAlpha: number,
  wallpaperAlpha: number,
  scrim: number,
  floor: number,
): Rgb {
  const withWallpaper = mix(spec.canvas, spec.worstWallpaper, wallpaperAlpha);
  const withScrim = mix(withWallpaper, spec.canvas, scrim);
  return glassSurface(withScrim, spec.glass, glassAlpha, spec.canvas, floor);
}

/** 网格最差格的文字对比度。 */
export function worstContrast(spec: ThemeContrastSpec, floor: number): number {
  let worst = Number.POSITIVE_INFINITY;
  for (const ga of GLASS_ALPHAS) {
    for (const wa of WALLPAPER_ALPHAS) {
      for (const sc of SCRIMS) {
        const c = contrastRatio(spec.text, worstSurface(spec, ga, wa, sc, floor));
        if (c < worst) worst = c;
      }
    }
  }
  return worst;
}

/**
 * 最小地板：网格最差格刚够 CONTRAST_TARGET 的权重（步进 0.01）。
 * 候选值按 i/100 取（不是逐次 0.01 累加）⇒ 返回值与判卷时用的值是同一个双精度数。
 */
export function floorFor(spec: ThemeContrastSpec): number {
  for (let i = 0; i <= 100; i += 1) {
    const f = i / 100;
    if (worstContrast(spec, f) >= CONTRAST_TARGET) return f;
  }
  return 1;
}
