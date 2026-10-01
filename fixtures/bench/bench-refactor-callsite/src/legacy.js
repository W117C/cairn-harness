// 历史遗留：不经 format.money，自己拼字符串（当初为了避开 money 的缺陷）。
import { money } from "./format.js";

export function legacyTotal(cents) {
  if (cents % 100 === 0) return "$" + (cents / 100) + ".00";
  return money(cents);
}
