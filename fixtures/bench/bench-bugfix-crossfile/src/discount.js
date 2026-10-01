import { cents } from "./money.js";

export const FREE_SHIPPING_AT = cents(5000);
export const SHIPPING_FEE = cents(600);

export function percentOff(amount, percent) {
  if (percent < 0 || percent > 100) throw new RangeError("percent 必须在 0-100");
  return cents(Math.round(amount * (1 - percent / 100)));
}

export function shippingFor(amount) {
  return amount >= FREE_SHIPPING_AT ? cents(0) : SHIPPING_FEE;
}
