// gym case: order-pricing-triple-fix
// 规则：税额 = 小计 × taxPct / 100，结果保留两位小数。
// BUG: grandTotal 把 taxPct 的百分数原值当金额加进小计（20% 当成 20 元）。
export function withDiscount(sub, ratePct) {
  return Math.round(sub * (100 - ratePct)) / 100;
}

export function grandTotal(sub, taxPct) {
  return Math.round((sub + taxPct) * 100) / 100; // ← BUG：税应按比例算
}
