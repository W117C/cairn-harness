#!/usr/bin/env node
// 比较两份 extract-tokens.mjs 产物，回答「Claude 升级后设计令牌到底动了什么」。
// 用法：node diff-tokens.mjs <old.json> <new.json>
// 输出：新增 / 删除 / 改值 三张清单 + 家族级计数；退出码 0=无差异，1=有差异（便于脚本消费）。
import { readFileSync } from "node:fs";

const [oldPath, newPath] = process.argv.slice(2);
if (oldPath === undefined || newPath === undefined) {
  console.error("用法：node diff-tokens.mjs <old.json> <new.json>");
  process.exit(2);
}
const load = (p) => JSON.parse(readFileSync(p, "utf8"));
const oldDoc = load(oldPath);
const newDoc = load(newPath);
const oldT = oldDoc.tokens ?? {};
const newT = newDoc.tokens ?? {};

const added = Object.keys(newT).filter((k) => !(k in oldT)).sort();
const removed = Object.keys(oldT).filter((k) => !(k in newT)).sort();
const changed = Object.keys(newT)
  .filter((k) => k in oldT && oldT[k] !== newT[k])
  .sort();

const family = (k) => {
  const m = k.match(/^--cds-([a-z]+)-/);
  return m === null ? "other" : m[1];
};
const byFamily = (keys) => {
  const counts = new Map();
  for (const k of keys) counts.set(family(k), (counts.get(family(k)) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]);
};

console.log(`old: ${oldDoc.source ?? oldPath}  ${oldDoc.tokenCount ?? Object.keys(oldT).length} tokens`);
console.log(`new: ${newDoc.source ?? newPath}  ${newDoc.tokenCount ?? Object.keys(newT).length} tokens`);
console.log(`\n新增 ${added.length}：`);
for (const k of added) console.log(`  + ${k} = ${newT[k]}`);
console.log(`\n删除 ${removed.length}：`);
for (const k of removed) console.log(`  - ${k} (was ${oldT[k]})`);
console.log(`\n改值 ${changed.length}：`);
for (const k of changed) console.log(`  ~ ${k}: ${oldT[k]}  →  ${newT[k]}`);

if (added.length + removed.length + changed.length === 0) {
  console.log("\n无差异。");
  process.exit(0);
}
console.log("\n新增按族：", byFamily(added).map(([f, n]) => `${f}:${n}`).join(" "));
console.log("删除按族：", byFamily(removed).map(([f, n]) => `${f}:${n}`).join(" "));
process.exit(1);
