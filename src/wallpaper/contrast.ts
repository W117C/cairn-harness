// WCAG 2.x 对比度的**纯数学**（相对亮度 + 对比度）。
//
// 这里是唯一实现：渲染层的可读性地板模型（`apps/desktop/src/renderer/derived/wallpaper-contrast.ts`）
// 与验证层的标准对照报告（`src/verification/conformance.ts`）都从这里取——
// 之前验证层直接 import 渲染层文件，踩了 `desktop-boundary-check` 的红线（src 不得 import apps/desktop）。
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** sRGB 通道 → 线性光（WCAG 2.x）。 */
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
