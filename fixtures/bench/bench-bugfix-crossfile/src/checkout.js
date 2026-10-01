import { subtotal } from "./cart.js";
import { percentOff, shippingFor } from "./discount.js";

// 券后总额 = 折扣后的金额 + 运费
export function checkoutTotal(lines, couponPercent) {
  const sub = subtotal(lines);
  const shipping = shippingFor(sub);
  const discounted = couponPercent ? percentOff(sub, couponPercent) : sub;
  return discounted + shipping;
}
