// gym case: order-pricing-triple-fix
// 规则：重量 ≥ freeOver 公斤免运费；否则按**向上取整**的整公斤数 × perKg。
// BUG: 整公斤数用了向下取整（2.2kg 按 2kg 计价）。
export function shippingCost(weightKg, freeOver, perKg) {
  if (weightKg >= freeOver) return 0;
  return Math.floor(weightKg) * perKg;
}
