/** 第 328 页的现读探针：把「认不出的读取调用」按窗口原文分桶，给形状表提供取料依据。
 *  只读盘、只印读数，不判红。跑法：`node --import tsx outputs/text-readers-2026-10-03/shapes.mts` */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
const CALL = /\b(?:await\s+)?(?:readFileSync|readFile|readTextFileSync)\s*\(/gu;

const files: string[] = [];
const walk = (dir: string): void => {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    const st = statSync(p);
    if (st.isDirectory()) { if (!n.startsWith(".")) walk(p); continue; }
    if (/\.(ts|mts)$/.test(n)) files.push(p);
  }
};
walk(join(ROOT, "tests"));

const buckets = new Map<string, string[]>();
let total = 0;
for (const f of files) {
  const rel = f.slice(ROOT.length + 1);
  const text = readFileSync(f, "utf8");
  for (const m of text.matchAll(CALL)) {
    total += 1;
    const win = text.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 90).replace(/\s+/gu, " ").trim();
    // 自己的一套粗分桶（只为看形状分布，不等同于生产形状表）
    let key = "Z-其他";
    if (/^["'][^"']+["']\s*[,)]/u.test(win)) key = "A-裸字面量";
    else if (/^join\(\s*REPO/u.test(win)) key = "B-join(REPO,";
    else if (/^join\(\s*ROOT/u.test(win)) key = "C-join(ROOT,";
    else if (/^join\(\s*dir\b|^join\(\s*[a-zA-Z_$]/u.test(win)) key = "D-join(变量,";
    else if (/^fileURLToPath/u.test(win)) key = "E-fileURLToPath";
    else if (/^new URL\(/u.test(win)) key = "F-new URL";
    else if (/^[a-zA-Z_$][\w$]*\s*[,)]/u.test(win)) key = "G-纯变量";
    else if (/^\[/u.test(win)) key = "H-数组";
    const list = buckets.get(key) ?? [];
    list.push(rel + " :: " + win.slice(0, 70));
    buckets.set(key, list);
  }
}
console.log(`读取调用共 ${String(total)} 处，分桶：`);
for (const [k, v] of [...buckets.entries()].sort()) console.log(`  ${k}：${String(v.length)} 处`);
for (const k of ["Z-其他", "H-数组", "G-纯变量"]) {
  const v = buckets.get(k);
  if (v) { console.log(`--- ${k} 样本 ---`); for (const s of v.slice(0, 12)) console.log("   " + s); }
}
