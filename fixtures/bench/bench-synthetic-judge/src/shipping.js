// 合成靶子（第 422 页）：给「逐名判卷」那条路准备的最小仓库。
// 约定：金额一律整数「分」。起点态的 BUG：免运费门槛写成**严格大于**，
// 于是「券后正好过线」那一单仍然收运费——它对应的就是 judge.failToPass 那一条。
export const FREE_SHIPPING_THRESHOLD_CENTS = 10000;
export const BASE_SHIPPING_CENTS = 600;

export function applyCoupon(subtotalCents, discountCents) {
  return Math.max(0, subtotalCents - discountCents);
}

export function shippingCents(subtotalCents, discountCents = 0) {
  const after = applyCoupon(subtotalCents, discountCents);
  return after > FREE_SHIPPING_THRESHOLD_CENTS ? 0 : BASE_SHIPPING_CENTS;
}

export function feeBreakdown(subtotalCents, discountCents = 0) {
  const shipping = shippingCents(subtotalCents, discountCents);
  return { shipping, total: subtotalCents - discountCents + shipping };
}
