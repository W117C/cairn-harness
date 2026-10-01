/** 选择子退化条目的逐条诊断（2026-09-30，待办 #26 的下游）。
 *
 * 为什么要它：`--check-needles` 只点名「零命中 11 条／多命中 2 条」和 id，
 * 而修法要的是**那条标题今天到底长什么样**。走整文件跑法的单价是宿主时长 ×3
 * （第 168/170 页实测 8.0s/拍 vs `-t` 0.14s/拍），13 条每趟整表 ≈ 白付三分钟。
 *
 * 取料与判据**共用生产端那两份**：`parseAnchors`（表的行抽取）与 `vitestTitles`（标题抽取），
 * 命中数按 `titles.includes(pointer)` —— 与 `scripts/lib/mutate-gates.ts:765` 同一个决策点，
 * 不在这里另算一遍（规则：判卷自己再算一遍＝对生产零分辨力）。
 *
 * 只读：不写源文件、不跑判卷、不改表。结论落同目录 findings.md。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseAnchors } from "../../scripts/mutate-anchor-titles.ts";
import { vitestTitles } from "../../scripts/lib/mutate-gates.ts";

const ROOT = process.cwd();
const tableText = readFileSync(join(ROOT, "scripts/mutate-verify.mjs"), "utf8");
const rows = parseAnchors(tableText);

const titleCache = new Map();
const titlesOf = (rel) => {
  if (!titleCache.has(rel)) {
    try { titleCache.set(rel, vitestTitles(readFileSync(join(ROOT, rel), "utf8"))); }
    catch { titleCache.set(rel, null); }
  }
  return titleCache.get(rel);
};

// 哨兵：先证明取料面自己打得通，再谈命中数（一片 0 先怀疑尺，规则 237）。
const withPointer = rows.filter((r) => r.expectFail);
const resolvable = withPointer.filter((r) => r.test && titlesOf(r.test) && titlesOf(r.test).length > 0);
console.log(`取料哨兵：parseAnchors 抽到 ${String(rows.length)} 行｜带 expectFail ${String(withPointer.length)} 条｜`
  + `判卷标题抽得到的 ${String(resolvable.length)} 条（这三格任一为 0 ＝ 本探针瞎了，别把它的 0 当读数）`);

/** 模板标题里 vitest 会在运行时展开的占位符。 */
const PLACEHOLDER = /%[sdfi#%]/;

function nearestTitles(pointer, titles) {
  // 零命中时找「最像的那条」：按最长公共子串长度排序，只回前三名当证据。
  const lcs = (a, b) => {
    let best = 0, bestAt = 0;
    for (let i = 0; i < a.length; i++) {
      for (let j = 0; j < b.length; j++) {
        let k = 0;
        while (i + k < a.length && j + k < b.length && a[i + k] === b[j + k]) k++;
        if (k > best) { best = k; bestAt = j; }
      }
    }
    return { len: best, at: bestAt };
  };
  return titles
    .map((t) => ({ t, ...lcs(pointer, t) }))
    .sort((x, y) => y.len - x.len)
    .slice(0, 3)
    .filter((x) => x.len >= 4);
}

const problems = [];
for (const r of withPointer) {
  if (!r.test || !r.test.endsWith(".test.ts")) continue;
  const titles = titlesOf(r.test);
  if (titles === null) { problems.push({ ...r, kind: "unreadable", hits: -1, titles: [] }); continue; }
  if (titles.length === 0) { problems.push({ ...r, kind: "blind-file", hits: -1, titles: [] }); continue; }
  const hits = titles.filter((t) => t.includes(r.expectFail));
  if (hits.length === 1) continue;
  problems.push({
    ...r,
    hits: hits.length,
    kind: hits.length === 0 ? "zero" : "multi",
    titles: hits.length > 0 ? hits : nearestTitles(r.expectFail, titles).map((x) => x.t),
    templated: titles.some((t) => PLACEHOLDER.test(t)) && hits.length === 0,
  });
}

const byKind = {};
for (const p of problems) byKind[p.kind] = (byKind[p.kind] ?? 0) + 1;
console.log(`退化：共 ${String(problems.length)} 条 —— ${
  Object.entries(byKind).map(([k, n]) => `${k} ${String(n)}`).join("｜")}`);

for (const p of problems) {
  console.log("\n────────────────────────────────────────");
  console.log(`id        ${p.id}`);
  console.log(`判卷      ${p.test}   （命中 ${String(p.hits)} 条标题）`);
  console.log(`成因      ${p.kind}${p.templated ? "（该文件确有模板标题：运行时名 != 字面名）" : ""}`);
  console.log(`现指针    ${JSON.stringify(p.expectFail)}`);
  for (const t of p.titles) console.log(`最像标题  ${JSON.stringify(t)}`);
  if (p.hits > 1) {
    const uniq = p.titles.map((t) => {
      const others = p.titles.filter((o) => o !== t);
      let cut = t.length;
      for (let i = 0; i < t.length; i++) if (others.some((o) => o.includes(t.slice(i)))) { cut = i; break; }
      return { t, tail: t.slice(Math.max(0, cut - 1)) };
    });
    for (const u of uniq) console.log(`可切到    ${JSON.stringify(u.tail)}`);
  }
}
console.log("\n（本探针不改表；改法与实跑验证记在同目录 findings.md）");
