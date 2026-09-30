import test from "node:test";
import assert from "node:assert/strict";
import { receiptLine, receipt } from "../src/receipt.js";
import { legacyTotal } from "../src/legacy.js";
import { money } from "../src/format.js";

test("money 一律两位小数", () => {
  assert.equal(money(350), "$3.50");
  assert.equal(money(300), "$3.00");
  assert.equal(money(5), "$0.05");
});

test("receiptLine 用 format.money 渲染", () => {
  assert.equal(receiptLine("Coffee", 350), "Coffee: $3.50");
});

test("legacyTotal 与 receiptLine 渲染一致", () => {
  assert.equal(legacyTotal(350), "$3.50");
});

test("receipt 逐行渲染", () => {
  assert.equal(receipt([{ name: "A", cents: 100 }, { name: "B", cents: 250 }]), "A: $1.00\nB: $2.50");
});
