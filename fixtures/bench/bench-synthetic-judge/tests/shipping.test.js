import test from "node:test";
import assert from "node:assert/strict";
import { applyCoupon, feeBreakdown, shippingCents, BASE_SHIPPING_CENTS } from "../src/shipping.js";

// 「券后正好过线」这一条在起点态是红的（judge.failToPass 收的就是它）。
test("券后过线免运费", () => {
  assert.equal(shippingCents(12000, 2000), 0);
});

// 下面两条起点态就是绿的（judge.passToPass）：它们替这一格守住「别把别的行为一起改坏」。
test("原价未过线收运费", () => {
  assert.equal(shippingCents(8000), BASE_SHIPPING_CENTS);
});

test("券后价不为负且总价含运费", () => {
  assert.equal(applyCoupon(1000, 3000), 0);
  assert.deepEqual(feeBreakdown(5000), { shipping: BASE_SHIPPING_CENTS, total: 5600 });
});
