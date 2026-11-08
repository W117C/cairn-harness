// 把每个 z-index 声明与其**真正所属**的规则块配对（样式表里注释多，按行号猜选择器会错位）。
import { readFileSync } from "node:fs";

const css = readFileSync("src/renderer/styles.css", "utf8");
const lines = css.split("\n");

// 逐个规则块扫描：块 = 选择器行 + 其后到 `}` 之间的内容
let i = 0;
const rows = [];
while (i < lines.length) {
  const line = lines[i] ?? "";
  const m = /^([^{}\n][^{}]*)\{\s*$/.exec(line.trim() ? line : "");
  if (m === null) { i++; continue; }
  const selector = (m[1] ?? "").trim().replace(/\s+/g, " ");
  let j = i + 1;
  const body = [];
  while (j < lines.length && !(lines[j] ?? "").includes("}")) { body.push(lines[j] ?? ""); j++; }
  const text = body.join("\n");
  for (const zm of text.matchAll(/z-index:\s*(\d+)/g)) {
    rows.push({ z: Number(zm[1]), selector, line: i + 1 });
  }
  i = j + 1;
}
rows.sort((a, b) => a.z - b.z);
for (const r of rows) console.log(String(r.z).padStart(4) + "  " + r.selector.slice(0, 62) + "   (行 " + r.line + ")");
console.log("\n不同层级值：" + [...new Set(rows.map((r) => r.z))].sort((a, b) => a - b).join(", "));
