/** 第 275 页的取料探针：如果把「凭证对账面」那一行的几个数也抽进 D-9 的读数面，现在会有多少条找不到原文。
 *  页侧按 `^### ` 切段（与 `credentialPages` 同一切法，并核两边段数相等＝哨兵），目录名取自门给的 `dirs`。
 *  只读，不改任何文件。 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { credentialPages, type CredFaceFile } from "../../scripts/docs-check.ts";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** 候选严格式（都只取第一捕获组，与 `CRED_NUMBER_RES` 同形状）。 */
const CANDIDATES: readonly { name: string; re: RegExp }[] = [
  { name: "可比对", re: /可比对 (\d+) 个读数/u },
  { name: "证人无身份行", re: /证人无身份行 (\d+) 对/u },
  { name: "未点名页", re: /未点名页 (\d+) 页/u },
  { name: "弱证", re: /弱证 (\d+) 对/u },
];

function pull(text: string): Set<string> {
  const nums = new Set<string>();
  for (const c of CANDIDATES) {
    for (const m of text.matchAll(new RegExp(c.re.source, "gu"))) {
      const g = m[1];
      if (typeof g === "string") nums.add(g);
    }
  }
  return nums;
}

const readFace = (dir: string): CredFaceFile[] | null => {
  const abs = join(ROOT, "outputs", dir);
  if (!existsSync(abs)) return null;
  return readdirSync(abs)
    .filter((f) => !f.endsWith(".mjs") && !f.endsWith(".mts"))
    .map((f) => {
      let text = "";
      try { text = readFileSync(join(abs, f), "utf8"); } catch { text = ""; }
      return { name: f, text };
    });
};

const ledger = readFileSync(join(ROOT, "PROGRESS.md"), "utf8");
const pages = credentialPages(ledger);

/** 段体：按 `^### ` 的起点切片，第 i 段到第 i+1 段起点为止；**再照 `credentialPages` 的口径只留标题含「凭证」的那些段**（第 275 页：哨兵第一次跑就把我这条切法差异抓出来了）。 */
const heads = [...ledger.matchAll(/^### .*/gmu)];
const allBodies = heads.map((h, i) => {
  const start = h.index + h[0].length;
  const next = i + 1 < heads.length ? heads[i + 1]!.index : ledger.length;
  return { head: h[0], body: ledger.slice(start, next) };
});
const credBodies = allBodies.filter((x) => x.head.includes("凭证"));

if (credBodies.length !== pages.length) {
  console.log(`❌ 段数对不上：我切出 ${String(credBodies.length)} 段凭证，门给出 ${String(pages.length)} 张页 ⇒ 切法不同源，这份探针的数不算数`);
  process.exit(1);
}
const bodies = credBodies.map((x) => x.body);

let pagesWithDirs = 0;
let witnessed = 0;
let unreadableDirs = 0;
const missing: string[] = [];

pages.forEach((p, i) => {
  const pageNums = pull(bodies[i] ?? "");
  if (pageNums.size === 0) return;
  if (p.dirs.length > 0) pagesWithDirs++;
  const faceNums = new Set<string>();
  for (const d of p.dirs) {
    const list = readFace(d);
    if (list === null) { unreadableDirs++; continue; }
    for (const f of list) for (const n of pull(f.text)) faceNums.add(n);
  }
  for (const n of pageNums) {
    if (faceNums.has(n)) witnessed++;
    else missing.push(`${p.key}｜目录 ${p.dirs.length} 个｜${n}`);
  }
});

console.log(`候选四式（可比对／证人无身份行／未点名页／弱证）：凭证页 ${String(pages.length)} 张，其中点了目录的 ${String(pagesWithDirs)} 张`);
console.log(`页侧条数 ${String(witnessed + missing.length)}｜有原文 ${String(witnessed)} 条｜没原文 ${String(missing.length)} 条｜点到的目录读不到 ${String(unreadableDirs)} 次`);
for (const m of missing.slice(0, 30)) console.log("  缺证人：" + m);
if (missing.length > 30) console.log(`  …另有 ${String(missing.length - 30)} 条`);
