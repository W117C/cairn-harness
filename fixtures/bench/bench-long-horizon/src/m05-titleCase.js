// 每词首字母大写，**其余转小写**
export function titleCase(s) { return s.split(" ").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ") }
