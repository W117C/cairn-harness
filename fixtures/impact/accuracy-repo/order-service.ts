export function createOrder(qty: number): number {
  const total = mul(qty, 3);
  logInfo("order " + String(total));
  return add(total, 1);
}
