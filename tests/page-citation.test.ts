/** 第 929 页：页号引用不许指向不存在的页。
 *  动因：台账正文与源码注释里散着几处「第 N 页」，其中一些号台账里根本没有那一页（旧页 914 那一类）——
 *  读者按号去翻，翻到的只有空白。台账只准追加，旧页追不回来（登记为存量，只准调低）；
 *  但**新写的代码注释**不该再制造新断链，所以这一把尺盯源码那一面，台账那一面只盯「有没有新增」。
 *  范围：只认落在台账页号区间内的号（更小的号是 outputs/ 里取证页的编号，不是台账）。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");

/** 台账页号：页标题里的 `第 N 页` 与 `第 N–M 页` 两种写法都算（后者是区间页）。 */
function ledgerPages(): Set<number> {
  const text = readFileSync(join(ROOT, "PROGRESS.md"), "utf8");
  const out = new Set<number>();
  for (const line of text.split("\n")) {
    if (!/^#{2,4}\s/u.test(line)) continue;
    for (const m of line.matchAll(/第\s*(\d{1,4})\s*[–—~-]\s*(\d{1,4})\s*页/gu)) {
      for (let n = Number(m[1]); n <= Number(m[2]); n++) out.add(n);
    }
    for (const m of line.matchAll(/第\s*(\d{1,4})\s*页/gu)) out.add(Number(m[1]));
  }
  return out;
}

/** 台账正文里被引用、但台账里没有那一页的号（旧账，登记在下面，只准调低）。 */
function ledgerGhosts(pages: Set<number>): number[] {
  const text = readFileSync(join(ROOT, "PROGRESS.md"), "utf8");
  const lo = Math.min(...pages);
  const hi = Math.max(...pages);
  const out = new Set<number>();
  for (const line of text.split("\n")) {
    if (/^#{2,4}\s/u.test(line)) continue;
    for (const m of line.matchAll(/第\s*(\d{1,4})\s*页/gu)) {
      const n = Number(m[1]);
      if (n >= lo && n <= hi && !pages.has(n)) out.add(n);
    }
  }
  return [...out].sort((a, b) => a - b);
}

function sourceFiles(dir: string, exts: readonly string[]): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      const st = statSync(p);
      if (st.isDirectory()) { if (name !== "node_modules") walk(p); continue; }
      if (exts.some((e) => name.endsWith(e))) out.push(p);
    }
  };
  walk(dir);
  return out;
}

/** 源码注释里的页号引用：落在台账区间内、又不是「outputs/… 第 N 页」「xxx.md 第 N 页」那种外部取证页。 */
function sourceGhosts(pages: Set<number>): string[] {
  const lo = Math.min(...pages);
  const hi = Math.max(...pages);
  const bad: string[] = [];
  const files = [
    ...sourceFiles(join(ROOT, "src"), [".ts"]),
    ...sourceFiles(join(ROOT, "apps/desktop/src"), [".ts", ".tsx"]),
    ...sourceFiles(join(ROOT, "scripts"), [".mjs"]),
  ];
  for (const f of files) {
    const text = readFileSync(f, "utf8");
    for (const m of text.matchAll(/第\s*(\d{1,4})\s*页/gu)) {
      const n = Number(m[1]);
      if (n < lo || n > hi || pages.has(n)) continue;
      const before = text.slice(Math.max(0, (m.index ?? 0) - 40), m.index ?? 0);
      if (before.includes("outputs/") || before.includes(".md")) continue; // 取证文档自己的页号，不是台账
      const line = text.slice(0, m.index ?? 0).split("\n").length;
      bad.push(`${f.slice(ROOT.length + 1)}:${String(line)} → 第 ${String(n)} 页`);
    }
  }
  return bad;
}

/** 存量登记：这些号被正文提到、但台账里没有那一页。两类——
 *  · 90 / 248 / 254：正文在讲「这个号让给了别人」「台账里没有这一页」，是自指，本来就该没有页；
 *  · 405 / 408 / 454 / 673 / 759 / 914：旧账的引用，页没写出来，只准追加的台账追不回来。
 *  修掉一处就把它从这里删掉（登记不删就是假存量）。 */
const REGISTERED_LEDGER_GHOSTS = [90, 248, 254, 405, 408, 454, 673, 759, 914] as const;

describe("页号引用不许指向不存在的页（第 929 页）", () => {
  it("源码注释里没有断链的台账页号", () => {
    const pages = ledgerPages();
    const ghosts = sourceGhosts(pages);
    expect(ghosts, "这些注释引用的页在台账里不存在：\n" + ghosts.join("\n")).toEqual([]);
  });

  it("台账正文里没有**新增**的断链页号（旧账登记，只准调低）", () => {
    const pages = ledgerPages();
    const ghosts = ledgerGhosts(pages);
    const registered = new Set<number>(REGISTERED_LEDGER_GHOSTS);
    const added = ghosts.filter((n) => !registered.has(n));
    expect(added, "新出现的断链页号（台账里没有那一页）：" + added.join(" | ")).toEqual([]);
    const vanished = REGISTERED_LEDGER_GHOSTS.filter((n) => !ghosts.includes(n));
    expect(vanished, "这几号已经不再是断链了，把登记删掉（登记不删就是假存量）：" + vanished.join(" | ")).toEqual([]);
  });
});
