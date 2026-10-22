#!/usr/bin/env node
// 比较两份 `$eipc_message$` 通道清单（extract-channels.mjs 的产物）。
// 用法：node diff-channels.mjs <old.txt> <new.txt>
// 归一化：去掉 UUID 前缀，先按 `namespace$_Controller$_method` 比；再按
// `Controller$_method` 比一次（v3 把若干 controller 搬进了 claude.internal.computerUse，
// 只看 namespace 会把「搬家」误报成删除+新增）。
import { readFileSync } from "node:fs";

const [oldPath, newPath] = process.argv.slice(2);
if (oldPath === undefined || newPath === undefined) {
  console.error("用法：node diff-channels.mjs <old.txt> <new.txt>");
  process.exit(2);
}
const load = (p) =>
  readFileSync(p, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("$eipc_message$_"))
    .map((c) => c.replace(/^\$eipc_message\$_[^_]+_\$_/, ""));
const ns = (s) => s.split("_$_")[0];
const key = (s) => s.split("_$_").slice(-2).join("_$_");
const countBy = (arr, f) => {
  const m = new Map();
  for (const x of arr) m.set(f(x), (m.get(f(x)) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1]);
};
const oldAll = load(oldPath);
const newAll = load(newPath);
const oldNs = new Set(oldAll.map(ns));
const newNs = new Set(newAll.map(ns));
const oldKeys = new Set(oldAll.map(key));
const newKeys = new Set(newAll.map(key));
const addedNs = [...newNs].filter((x) => !oldNs.has(x));
const removedNs = [...oldNs].filter((x) => !newNs.has(x));
const added = [...newKeys].filter((x) => !oldKeys.has(x)).sort();
const removed = [...oldKeys].filter((x) => !newKeys.has(x)).sort();

console.log(`old: ${oldAll.length} 条 / ${oldNs.size} 命名空间  ${oldPath}`);
console.log(`new: ${newAll.length} 条 / ${newNs.size} 命名空间  ${newPath}`);
console.log(`\n命名空间新增 ${addedNs.length}：${addedNs.join(", ") || "（无）"}`);
console.log(`命名空间消失 ${removedNs.length}：${removedNs.join(", ") || "（无）"}`);
console.log(`\n按 Controller+method 新增 ${added.length}：`);
for (const x of added) console.log(`  + ${x}`);
console.log(`\n按 Controller+method 删除 ${removed.length}：`);
for (const x of removed) console.log(`  - ${x}`);
if (addedNs.length + removedNs.length + added.length + removed.length === 0) {
  console.log("\n无差异。");
  process.exit(0);
}
process.exit(1);
