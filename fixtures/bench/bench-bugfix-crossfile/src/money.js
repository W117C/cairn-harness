export function cents(n) {
  if (!Number.isInteger(n)) throw new TypeError("cents 必须是整数（分）");
  return n;
}
