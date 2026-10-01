import { toCsv } from "./export.js";

const HEADER = ["id", "name", "note"];

// 把记录导成 CSV（含表头）
export function exportUsers(users) {
  return toCsv([HEADER, ...users.map((u) => [u.id, u.name, u.note ?? ""])])
}
