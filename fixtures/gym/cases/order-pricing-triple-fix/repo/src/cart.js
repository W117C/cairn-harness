// gym case: order-pricing-triple-fix
// BUG: subtotal 只累加单价，漏乘数量 qty。
export function subtotal(items) {
  let sum = 0;
  for (const it of items) sum += it.price;
  return sum;
}

/** 件数（这条是对的，判卷里也断言了——防「顺手改坏无关函数」）。 */
export function itemCount(items) {
  return items.reduce((n, it) => n + it.qty, 0);
}
