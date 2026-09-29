/** 第 170 页闸的一处自测：`-t` 的正则是拿**整条全名**（describe > it）去搜的，
 *  而我那把准入闸只数了 `it` 标题里的逐字命中。若某条指针在「describe 尾 + it 头」的接缝上，
 *  或在另一条用例的**全名**里也成句，就会被选中 2 条——那时 `selected >= 1` 这道闸不拦，
 *  归因也可能领到别条用例的红。这里只做一个筛选读数：现读到底有多少条这种风险。
 *
 *  用法：node --import tsx outputs/mutation-selector-scan-2026-09-28/fullname-screen.mts
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

const out = execFileSync(process.execPath, ["--import", "tsx", join(ROOT, "scripts/mutate-verify.mjs"), "--list"], {
  cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
});
const rows = out.split("\n").filter((l) => l.split("\t").length >= 5).map((l) => {
  const p = l.split("\t");
  return { id: p[0] ?? "", test: p[3] ?? "", expectFail: JSON.parse(p[4] ?? '""') as string };
});

/** 逐行扫：记住最后一条 describe 的标题（近似——嵌套 describe 只取最近那一层，够筛选用了）。 */
function fullNames(rel: string): string[] {
  let src: string;
  try { src = readFileSync(join(ROOT, rel), "utf8"); } catch { return []; }
  const titles: string[] = [];
  let describe = "";
  const lineRe = /^\s*(describe|it|test)(?:\.\w+)?\s*\(\s*(["`'])((?:\\.|(?!\2)[^\\])*)\2/gmu;
  for (const m of src.matchAll(lineRe)) {
    const kind = m[1] ?? "";
    const title = m[3] ?? "";
    if (kind === "describe") { describe = title; continue; }
    titles.push(describe === "" ? title : `${describe} > ${title}`);
  }
  return titles;
}

const cache = new Map<string, string[]>();
const nameListOf = (rel: string) => {
  let v = cache.get(rel);
  if (v === undefined) { v = fullNames(rel); cache.set(rel, v); }
  return v;
};

let itUnique = 0;
let fullNameMulti = 0;
const risky: string[] = [];
let noTitles = 0;

for (const r of rows) {
  if (r.expectFail === "" || !r.test.endsWith(".test.ts")) continue;
  const names = nameListOf(r.test);
  if (names.length === 0) { noTitles++; continue; }
  const itHits = names.filter((n) => n.split(" > ").pop()!.includes(r.expectFail)).length;
  if (itHits !== 1) continue; // 那条闸已经把它们挡在名单外了
  itUnique += 1;
  const fullHits = names.filter((n) => n.includes(r.expectFail)).length;
  if (fullHits !== 1) { fullNameMulti++; risky.push(`${r.id}(${String(fullHits)})`); }
}

console.log(`只数 it 标题时唯一的那些条：${String(itUnique)}`);
console.log(`按全名（describe > it）却不止一条：${String(fullNameMulti)}${risky.length === 0 ? "" : " ⇒ " + risky.slice(0, 30).join("、")}${risky.length > 30 ? "…" : ""}`);
console.log(`判卷里没有 describe/it 标题（读不到或非 vitest）：${String(noTitles)}`);
