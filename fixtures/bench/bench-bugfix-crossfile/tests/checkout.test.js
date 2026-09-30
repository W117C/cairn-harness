import test from "node:test";
import assert from "node:assert/strict";
import { checkoutTotal } from "../src/checkout.js";

test("无券：商品金额 + 运费", () => {
  assert.equal(checkoutTotal([{ unitPrice: 1000, qty: 2 }], 0), 2600);
});

test("已包邮：只付商品金额", () => {
  assert.equal(checkoutTotal([{ unitPrice: 6000, qty: 1 }], 0), 6000);
});

test("券后金额跌破包邮线，应当收运费", () => {
  // 原价 6000（包邮）→ 打 20% 后 4800（不到 5000）⇒ 应收 600 运费，合计 5400
  assert.equal(checkoutTotal([{ unitPrice: 6000, qty: 1 }], 20), 5400);
});
