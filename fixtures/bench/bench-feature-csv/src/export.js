// 把二维数组转成 CSV。目前只做了「用逗号连起来」——转义还没做（见 README）。
export function toCsv(rows) {
  return rows.map((r) => r.join(",")).join("\n")
}
