// 用量数字格式化（原 TokenPanel.tsx 的同名函数）。TokenPanel 组件自 M2 起就没被渲染过，
// 批 98 把它删掉：Composer 底部用量环（↑in ↓out / 缓存 / 轮数）才是唯一消费面。
// 保留独立模块而不是塞回 Composer——纯函数有判卷（model-picker.test）且以后状态条可复用。

/** 元位数字：过 1000 显 k 一位小数（12400 → "12.4k"），未过原样。 */
export function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}
