// 把「读 App.tsx」的判卷钉住的字面量按**可迁移性**分类：
//   A 类＝标识符/短标签（例：`const fillPluginCommand`）⇒ 搬走后在 App.tsx 留一条薄别名即可继续命中；
//   B 类＝实现细节（例：`localStorage.getItem("cairn.pluginSidebar")`）⇒ 钉的是代码**在哪**，搬走就红。
// 结论决定「拆 App.tsx」要不要连带改判卷。
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const TESTS = "tests";
const lits = [];
for (const name of readdirSync(TESTS)) {
  if (!/\.test\.tsx?$/.test(name)) continue;
  const text = readFileSync(join(TESTS, name), "utf8");
  if (!text.includes("App.tsx")) continue;
  for (const m of text.matchAll(/toContain\(\s*"((?:[^"\\]|\\.)*)"\s*\)/g)) lits.push({ file: name, lit: JSON.parse(`"${m[1]}"`) });
  for (const m of text.matchAll(/toContain\(\s*'((?:[^'\\]|\\.)*)'\s*\)/g)) lits.push({ file: name, lit: m[1] });
}
const uniq = new Map();
for (const { file, lit } of lits) {
  if (lit.length < 8) continue;
  const arr = uniq.get(lit) ?? [];
  arr.push(file);
  uniq.set(lit, arr);
}

// A 类：没有调用、没有赋值、没有字面量引号 ⇒ 是名字或标签
const isNameLike = (s) => !/[("'=]/.test(s) && !/=>|\.get\(|\.set\(/.test(s);
const a = [], b = [];
for (const [lit, files] of uniq) (isNameLike(lit) ? a : b).push({ lit, files });

console.log(`钉住字面量共 ${uniq.size} 条`);
console.log(`  A 类（名字/标签，搬走可用薄别名保住）：${a.length} 条（${((a.length / uniq.size) * 100).toFixed(0)}%）`);
console.log(`  B 类（实现细节，钉的是代码在哪）：${b.length} 条（${((b.length / uniq.size) * 100).toFixed(0)}%）`);
console.log("\n--- B 类样例（前 20，看它们钉的是什么 ---");
for (const { lit, files } of b.slice(0, 20)) console.log(`  ${lit.slice(0, 88).replace(/\n/g, " ")}   ← ${files[0]}`);
console.log("\n--- A 类样例（前 12）---");
for (const { lit, files } of a.slice(0, 12)) console.log(`  ${lit.slice(0, 70).replace(/\n/g, " ")}   ← ${files[0]}`);
