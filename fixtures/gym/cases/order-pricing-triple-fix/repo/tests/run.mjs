// 判卷文件（冻结）：三处规则各自的期望值都写在这里——修哪个函数、修成什么样，以本文件为准。
import { itemCount, subtotal } from "../src/cart.js";
import { grandTotal, withDiscount } from "../src/totals.js";
import { shippingCost } from "../src/shipping.js";

let failures = 0;
const expect = (actual, want, msg) => {
  if (actual !== want) {
    failures++;
    console.error("FAIL: " + msg + "（期望 " + String(want) + "，实得 " + String(actual) + "）");
  }
};

// ---- cart：数量必须进价格 ----
const items = [
  { sku: "A", price: 12.5, qty: 2 },
  { sku: "B", price: 4, qty: 3 },
];
expect(subtotal(items), 37, "subtotal 要按 price×qty 累加");
expect(itemCount(items), 5, "itemCount 统计件数（本来就该过，防「顺手改坏无关函数」）");

// ---- totals：折扣与税额都保留两位，税额按比例算 ----
expect(withDiscount(100, 20), 80, "八折：100 → 80");
expect(grandTotal(80, 20), 96, "税额 = 小计 × 20 / 100，不是把 20 当金额加");
expect(grandTotal(37.55, 7), 40.18, "非整数小计按比例并四舍五入到分");

// ---- shipping：满 freeOver 免运费，否则向上取整整公斤计价 ----
expect(shippingCost(12, 10, 8), 0, "12kg ≥ 10kg 免运费");
expect(shippingCost(2.2, 10, 8), 24, "2.2kg 按 3kg 计（向上取整）");
expect(shippingCost(1, 10, 8), 8, "整 1kg 仍按 1kg（向上取整不得吃掉整数值）");

if (failures > 0) {
  console.error(failures + " 项断言失败");
  process.exit(1);
}
console.log("order-pricing-triple-fix: all ok");
