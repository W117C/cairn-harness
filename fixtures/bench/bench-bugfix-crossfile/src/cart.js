import { cents } from "./money.js";

export function subtotal(lines) {
  return lines.reduce((sum, l) => sum + cents(l.unitPrice * l.qty), 0);
}
