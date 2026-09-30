import { money } from "./format.js";

export function receiptLine(name, cents) {
  return name + ": " + money(cents);
}

export function receipt(lines) {
  return lines.map((l) => receiptLine(l.name, l.cents)).join("\n");
}
