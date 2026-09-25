// 复跑读数（只读）：**现行层**文档里的路径型指针，有多少已经指向不存在的东西。
//
// 为什么值得单独量：`docs-check` 现有 D-1 预算 / D-2 手抄观测值 / D-3 指针用行号 / D-4 追注 /
// D-5 rev / D-7 二进制 / D-8 复跑脚本在不在盘上——**没有一条管"正文里那个 `src/x.ts` 还存在吗"**。
// 桌面层那笔删除一次拿走 51 个测试面与整棵 renderer；现行层里凡是指向它们的句子，
// 今天都成了"读起来像事实、点开却没有"的死指针（D-3 防行号漂移，这条防文件消失）。
//
// 适用面＝`scripts/docs-check.ts` 的 `LIVE_PAGES`（与 D-1/D-2/D-4 **同一份定义**，不另立口径）：
// 提案页（docs/*-proposal.md）与带日期的 outputs/ 页**不在内**——它们本来就在写"将要有什么"和"当时发生了什么"。
//
// 三态自报（规则 104/177）：取料失败与"抽取器把真存在的指针判死"都红着退出。
// 用法：node --import tsx outputs/dead-doc-refs-2026-09-26/01-scan.mts
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { LIVE_PAGES } from "../../scripts/docs-check";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const git = (args: string[]): string => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" });
const inHead = (p: string): boolean => {
  try { execFileSync("git", ["cat-file", "-e", "HEAD:" + p], { cwd: ROOT, stdio: "ignore" }); return true; } catch { return false; }
};

/** 抽路径型指针：先宽松抓 `目录/名.扩展名`，再用白名单与**右边界**收紧。
 *  第一版把扩展名写成 `(?:ts|js|json|…)` 的交替 ⇒ `js` 排在 `json` 前面，
 *  `scripts/frozen-sha256.json` 被截成 `scripts/frozen-sha256.js` ⇒ 造出 5 条**假死指针**。
 *  现在：抓完再整段比对扩展名，且要求指针后面不接词字符。 */
const DIRS = "src|tests|scripts|docs|fixtures|outputs";
const EXTS = new Set(["ts", "tsx", "mts", "js", "mjs", "json", "md", "html", "css", "yml", "yaml", "png", "jpg", "svg", "wasm"]);
const LOOSE = new RegExp(`(?:${DIRS})\\/[\\w./-]*\\.[A-Za-z][A-Za-z0-9]{0,4}(?![\\w-])`, "g");

function pointers(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(LOOSE)) {
    const p = m[0];
    const ext = p.slice(p.lastIndexOf(".") + 1).toLowerCase();
    if (EXTS.has(ext)) out.push(p);
  }
  return out;
}

// ---- 自检：抽取器不许把长扩展名截断（这条就是抓出上一版 bug 的负控）
const probe = pointers("见 `scripts/frozen-sha256.json` 与 `src/renderer/cards/x.tsx`、`scripts/y.mjs`、`docs/z.mdx`");
const wantProbe = ["scripts/frozen-sha256.json", "src/renderer/cards/x.tsx", "scripts/y.mjs"];
const badProbe = wantProbe.filter((w) => !probe.includes(w));
const overProbe = probe.filter((p) => !wantProbe.includes(p));
if (badProbe.length > 0 || overProbe.length > 0) {
  console.log("**尺不可信**：抽取器自检失败 缺:" + (badProbe.join(",") || "无") + " 多:" + (overProbe.join(",") || "无"));
  process.exit(1);
}

const live = LIVE_PAGES.filter((p) => p !== "STATE.md"); // STATE.md 由 D-5 管（不存在时另一条出声）
/** 两个口径分开报——**提案页也算一份面**：那里"拟新增一个脚本"是合法的，
 *  但"扩展名写错、指向一个从未有过也不会有的文件"不合法。只报 LIVE_PAGES 会把提案页的真缺陷整片藏掉。 */
const allDocs = git(["ls-files", "--", "docs"]).split("\n").filter((p) => p.endsWith(".md"));
const scopes: Array<[string, string[]]> = [["现行层 LIVE_PAGES", live], ["提案/档案层 docs/*.md", allDocs.filter((p) => !live.includes(p))]];
for (const [label, list] of scopes) {
  const missing = list.filter((p) => !existsSync(join(ROOT, p)));
  const scanned = list.filter((p) => !missing.includes(p));
  if (scanned.length === 0) { console.log(`**取料失败**：${label} 一页都读不到 ⇒ 没尺，别读后面的数`); process.exit(1); }
  interface Hit { path: string; inHead: boolean; docs: Set<string> }
  const dead = new Map<string, Hit>();
  let totalRefs = 0;
  for (const f of scanned) {
    for (const p of pointers(readFileSync(join(ROOT, f), "utf8"))) {
      totalRefs++;
      if (existsSync(join(ROOT, p))) continue;
      const row = dead.get(p) ?? { path: p, inHead: inHead(p), docs: new Set<string>() };
      row.docs.add(f);
      dead.set(p, row);
    }
  }
  const goneEverywhere = [...dead.values()].filter((r) => !r.inHead).sort((a, b) => a.path.localeCompare(b.path));
  const inFlightOnly = [...dead.values()].filter((r) => r.inHead).sort((a, b) => a.path.localeCompare(b.path));
  console.log(`【${label}】受检 ${String(scanned.length)} 页` +
    (missing.length === 0 ? "" : `（另有 ${String(missing.length)} 页已被在飞删除拿走，不扫）`) +
    `｜路径型指针 ${String(totalRefs)} 处｜死指针 ${String(dead.size)} 个：HEAD 也没有 ${String(goneEverywhere.length)} 个、只在飞删除 ${String(inFlightOnly.length)} 个`);
  for (const r of goneEverywhere) console.log(`   ✗ ${r.path}   ← ${[...r.docs].join("、")}`);
  for (const r of inFlightOnly) console.log(`   ◦ ${r.path}   ← ${[...r.docs].join("、")}（HEAD 里还在：属那笔删除收尾）`);
  if (goneEverywhere.length + inFlightOnly.length !== dead.size) {
    console.log("**分类不完整**：互斥检查失败，上面的数不要引用");
    process.exit(1);
  }
}
console.log("");
console.log("口径：扩展名白名单 + 右边界收紧（防 `.json` 被截成 `.js` 造出假死指针）；指针必须带目录前缀。");
console.log("落点建议：判据只管**现行层**（提案页写的是将要有什么）；本脚本仍是读数面——docs-check 此刻是他人热文件（M）。");
process.exit(0);
