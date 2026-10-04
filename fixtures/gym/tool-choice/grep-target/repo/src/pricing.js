// 计价：按重量分档，不同档位用不同的每公斤单价（公斤价，不是总价）。
export const TIERS = [
  { maxKg: 1, perKg: 18 },
  { maxKg: 5, perKg: 15 },
  { maxKg: 20, perKg: 12 },
];

/** 找一个档位。找不到返回 undefined。 */
export function tierOf(kg) {
  return TIERS.find((t) => kg <= t.maxKg);
}

/**
 * 算总价。BUG：跨档位时把**每一公斤**都按最终档位的单价算，
 * 于是 30 公斤全被当成 20 公斤档（12 元/公斤），少收一大截。
 */
export function total(kg) {
  const t = tierOf(kg);
  if (!t) return Infinity;
  return kg * t.perKg;
}