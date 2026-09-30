/** 只读普查：把命中判据放宽到「-t 真做得到的宽度」（占位符按展开态匹配），名单会变成长什么样。
 *  为什么量这个：runner 把指针 escapeTitlePattern 后交给 `vitest -t`，vitest 拿它当**正则**去匹配
 *  运行时的整条标题；而 selectorAmbiguity 数的是 `it` 字面量里有没有逐字含指针。
 *  ⇒ 标题是拼出来的那批（`%s`／`${x}`），运行时选得中，静态却判 0 命中 ⇒ 白白走整文件跑法。
 *  本文件不改源、不跑判卷，只为「收紧前先量存量」（规则 235）取数。 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseAnchors } from "../../scripts/mutate-anchor-titles.ts";
import { vitestTitles } from "../../scripts/lib/mutate-gates.ts";

const PLACEHOLDER = /(\$\{[\s\S]*?\}|\$[A-Za-z_]\w*|%[sdijfovc#])/u;
const WILDCARD = "@@wildcard@@";
const literalOf = (body) => body.split(WILDCARD).join("").trim();

/** 与 vitestTitlePatterns 同一条构造，只是**按单条标题**出模式（生成式标题回 null＝丢掉）。 */
function patternOfTitle(lit) {
  const un = lit.replace(/\\(.)/gu, "$1");
  const body = un
    .split(PLACEHOLDER)
    .map((piece) => (PLACEHOLDER.test(piece) ? WILDCARD : piece.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")))
    .join("");
  if (literalOf(body) === "") return null;
  return new RegExp("^[\\s\\S]*" + body.split(WILDCARD).join("[\\s\\S]*?") + "[\\s\\S]*$");
}

const ROOT = process.cwd();
const rows = parseAnchors(readFileSync(join(ROOT, "scripts/mutate-verify.mjs"), "utf8"));
const cache = new Map();
const titlesOf = (rel) => {
  if (!cache.has(rel)) {
    try { cache.set(rel, vitestTitles(readFileSync(join(ROOT, rel), "utf8"))); }
    catch { cache.set(rel, null); }
  }
  return cache.get(rel);
};

let nowProblems = 0, newProblems = 0, flipsIn = 0, flipsOut = 0, blindNow = 0;
const became = [];
const stillBad = [];

for (const r of rows) {
  if (!r.expectFail || !r.test || !r.test.endsWith(".test.ts")) continue;
  const titles = titlesOf(r.test);
  if (titles === null) continue;
  if (titles.length === 0) { blindNow += 1; continue; }
  const literal = titles.filter((t) => t.includes(r.expectFail)).length;
  const widened = titles.filter((t) => {
    if (t.includes(r.expectFail)) return true;
    const re = patternOfTitle(t);
    return re !== null && re.test(r.expectFail);
  }).length;
  if (literal !== 1) nowProblems += 1;
  if (widened !== 1) newProblems += 1;
  if (literal !== 1 && widened === 1) { flipsIn += 1; became.push(`${r.id}  ${String(literal)}→${String(widened)}`); }
  if (literal === 1 && widened !== 1) { flipsOut += 1; stillBad.push(`${r.id}  退化成 ${String(widened)} 命中`); }
}

console.log(`当前（窄宽度）失准：${String(nowProblems)} 条｜抽不到标题的文件：${String(blindNow)} 条`);
console.log(`放宽到 -t 的宽度后失准：${String(newProblems)} 条`);
console.log(`从整文件跑法转成可选中（≠1 → 1）：${String(flipsIn)} 条`);
for (const l of became) console.log(`  + ${l}`);
console.log(`反向（本来恰好 1，放宽后反而不唯一）：${String(flipsOut)} 条`);
for (const l of stillBad) console.log(`  - ${l}`);
