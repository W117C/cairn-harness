/** 只读普查：selectorAmbiguity 自带的那份 TITLE_RE 与 lib 里共用的 vitestTitles 差多少。
 *  结论写进 findings.md，本文件不改任何源文件、不跑判卷。 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseAnchors } from "../../scripts/mutate-anchor-titles.ts";
import { vitestTitles } from "../../scripts/lib/mutate-gates.ts";

const ROOT = process.cwd();
const rows = parseAnchors(readFileSync(join(ROOT, "scripts/mutate-verify.mjs"), "utf8"));

// 与 selectorAmbiguity:737 逐字同一份窄抽取
const NARROW = /^\s*(?:it|test)(?:\.\w+)?\s*\(\s*(["`'])((?:\\.|(?!\1)[^\\])*)\1/gmu;

const cache = new Map();
const both = (rel) => {
  if (!cache.has(rel)) {
    try {
      const text = readFileSync(join(ROOT, rel), "utf8");
      cache.set(rel, {
        narrow: [...text.matchAll(NARROW)].map((m) => m[2] ?? ""),
        wide: vitestTitles(text),
      });
    } catch { cache.set(rel, null); }
  }
  return cache.get(rel);
};

const affectedFiles = new Map();
let anchorsBlind = 0;
let hitsMove = 0;
const moveDetail = [];

for (const r of rows) {
  if (!r.expectFail || !r.test || !r.test.endsWith(".test.ts")) continue;
  const pair = both(r.test);
  if (!pair) continue;
  if (pair.narrow.length !== pair.wide.length) {
    if (!affectedFiles.has(r.test)) affectedFiles.set(r.test, { narrow: pair.narrow.length, wide: pair.wide.length, ids: [] });
    affectedFiles.get(r.test).ids.push(r.id);
    if (pair.narrow.length === 0) anchorsBlind += 1;
  }
  const hn = pair.narrow.filter((t) => t.includes(r.expectFail)).length;
  const hw = pair.wide.filter((t) => t.includes(r.expectFail)).length;
  if (hn !== hw) { hitsMove += 1; moveDetail.push(`${r.id}  窄=${String(hn)} 宽=${String(hw)}`); }
}

console.log(`表内锚点（带 expectFail 且判卷是 .test.ts）：${String(rows.filter((r) => r.expectFail && r.test && r.test.endsWith(".test.ts")).length)} 条`);
console.log(`抽取条数不一致的判卷文件：${String(affectedFiles.size)} 个`);
for (const [f, v] of affectedFiles) console.log(`  ${f}  窄抽 ${String(v.narrow)} 条 / 宽抽 ${String(v.wide)} 条  ⇒ 挂 ${String(v.ids.length)} 条锚点：${v.ids.join("、")}`);
console.log(`因窄抽取而整片瞎（宽抽有标题、窄抽 0 条）的锚点：${String(anchorsBlind)} 条`);
console.log(`命中数会因换抽取而变的锚点：${String(hitsMove)} 条`);
for (const l of moveDetail) console.log(`  ${l}`);
