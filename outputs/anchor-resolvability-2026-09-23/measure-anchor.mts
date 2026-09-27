/** 能力 30「锚点可解性」取证探针（三问）：
 *  ① D-3 那条「文档指针不许用行号」的规矩，究竟管到哪一层？——把一份 .md 喂给**真函数**看它报不报。
 *  ② 散文页里今天有多少条 `file.ts:123` 指针？逐条对着**今天的源文件**解：文件不在 / 行号越界 /
 *     那行是空行或纯符号 ⇒ 三态读数。本程序自己的页单列（自我指控面）。
 *  ③ 锚点所称的符号是否真在所指行附近？（同一行文档里用反引号点名的标识符，离目标行超过 ±3 行 = 漂了）
 *  跑法：TERM=dumb node --import tsx outputs/anchor-resolvability-2026-09-23/measure-anchor.mts */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { checkLineCitations, listSourceFiles, type SourceFile } from "../../scripts/docs-check";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const readAbs = (abs: string): string => (existsSync(abs) ? readFileSync(abs, "utf8") : "");

// ---------------- ① D-3 到底管哪一层 ----------------
const CIT = listSourceFiles(ROOT); // 缺省 dirs = src|scripts|tests
const citIsCode = CIT.every((p) => /\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(p));
const mdProbe: SourceFile[] = [{
  path: "docs/probe.md",
  text: "见 src/agent/loop.ts:1 的实现；另有 src/agent/stuck.ts:99999 与不存在的 src/nope.ts:3。\n",
}];
const mdReported = checkLineCitations(mdProbe);
const codeWithTs: SourceFile[] = [{ path: "src/probe.ts", text: "// 参照 src/agent/loop.ts:1 那句\nexport const x = 1;\n" }];
const codeWithMd: SourceFile[] = [{ path: "src/probe.ts", text: "// 参照 docs/plan.md:1 那句\nexport const x = 1;\n" }];
const tsReported = checkLineCitations(codeWithTs);
const mdTargetReported = checkLineCitations(codeWithMd);
console.log("## ① D-3「文档指针必须用标签锚点，不能用行号」的实际管辖面");
console.log(`   喂给门的文件集 listSourceFiles(ROOT) 共 ${CIT.length} 个，全部是代码扩展名吗：${citIsCode ? "**是**（.md 内容不进 D-3 的扫描面）" : "否"}`);
console.log(`   真函数三对照（同一只 checkLineCitations）：`);
console.log(`     · .md 文件正文里 3 条 \`x.ts:NNN\` 指针 → 报 ${mdReported.length} 条`);
console.log(`     · .ts 注释里 1 条 \`src/agent/loop.ts:1\` → 报 ${tsReported.length} 条`);
console.log(`     · .ts 注释里 1 条 \`docs/plan.md:1\`      → 报 ${mdTargetReported.length} 条`);
console.log("   ⇒ 读出真身：D-3 的正则是 `[\\w./#-]+\\.(?:md|markdown):[0-9]+`——**只管指向 .md 的行号指针，且只在代码文件里管**。");
console.log("     于是最常见的 `verify.ts:43` 这种形态**两处都不管**：写在 .md 里不在扫描面，写在 .ts 里目标扩展名不匹配。");
console.log("     （第一版我把这条读成「规则能判、只是没喂散文」，也是错的——真因在目标扩展名白名单，不是文件集。已按实跑改。）");

// ---------------- ② 散文锚点普查 ----------------
function walkMd(dir: string, rel: string, acc: string[]): string[] {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) return acc;
  for (const n of readdirSync(abs, { withFileTypes: true })) {
    if (n.name === "node_modules" || n.name.startsWith(".")) continue;
    const d = dir + "/" + n.name, r = rel ? rel + "/" + n.name : n.name;
    if (n.isDirectory()) walkMd(d, r, acc);
    else if (n.name.endsWith(".md")) acc.push(r);
  }
  return acc;
}
const mdFiles = ["AGENTS.md", "PROGRESS.md", ...walkMd("docs", "docs", []), ...walkMd("outputs", "outputs", [])]
  .filter((p, i, a) => a.indexOf(p) === i && existsSync(join(ROOT, p)));
const ANCHOR = /[\w][\w./-]*\.(?:ts|tsx|js|jsx|mjs|cjs|json|md|py|sh):(\d+)(?:[-–](\d+))?/g;
const lineCache = new Map<string, string[]>();
const linesOf = (rel: string): string[] | null => {
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) return null;
  let l = lineCache.get(rel);
  if (l === undefined) { l = readFileSync(abs, "utf8").split("\n"); lineCache.set(rel, l); }
  return l;
};
/** 仓内源文件索引（basename → 全路径[]）：散文里大量锚点只写 `verify.ts:43` 这种裸名，
 *  直接按 ROOT 解必然假红——这一层不存在就没有 ② 的正确读数。 */
const byBase = new Map<string, string[]>();
(() => {
  const walk = (d: string): void => {
    const abs = join(ROOT, d);
    if (!existsSync(abs)) return;
    for (const n of readdirSync(abs, { withFileTypes: true })) {
      if (n.name === "node_modules" || n.name.startsWith(".")) continue;
      const r = d ? d + "/" + n.name : n.name;
      if (n.isDirectory()) walk(r);
      else if (/\.[cm]?[jt]sx?$|\.json$|\.md$|\.sh$/.test(n.name)) {
        byBase.set(n.name, [...(byBase.get(n.name) ?? []), r]);
      }
    }
  };
  for (const d of ["src", "scripts", "tests", "docs", "outputs", "fixtures", "."]) walk(d);
})();
/** 解一条锚点 → 状态 + 实际行数组。 */
function resolveAnchor(target: string): { kind: "path" | "basename-unique" | "basename-ambiguous" | "dead"; lines: string[] | null; howMany: number } {
  const direct = linesOf(target);
  if (direct !== null) return { kind: "path", lines: direct, howMany: 1 };
  const base = target.split("/").pop() ?? target;
  const hits = (byBase.get(base) ?? []).filter((p) => !p.startsWith("outputs/") || target.includes("/"));
  if (hits.length === 0) return { kind: "dead", lines: null, howMany: 0 };
  if (hits.length === 1) return { kind: "basename-unique", lines: linesOf(hits[0]!), howMany: 1 };
  return { kind: "basename-ambiguous", lines: linesOf(hits[0]!), howMany: hits.length };
}
interface Anchor { doc: string; target: string; line: number; docLine: string }
const anchors: Anchor[] = [];
for (const doc of mdFiles) {
  const text = readAbs(join(ROOT, doc));
  let off = 0;
  for (const raw of text.split("\n")) {
    for (const m of raw.matchAll(ANCHOR)) {
      anchors.push({ doc, target: m[0].replace(/:\d+(-\d+)?$/, ""), line: Number(m[1]), docLine: raw });
    }
    off += raw.length + 1;
  }
  void off;
}
type Bucket = "path-ok" | "basename-unique" | "basename-ambiguous" | "dead-file" | "out-of-range" | "blank-ish";
const tally: Record<Bucket, number> = { "path-ok": 0, "basename-unique": 0, "basename-ambiguous": 0, "dead-file": 0, "out-of-range": 0, "blank-ish": 0 };
const worst: string[] = [];
const progTally: Record<Bucket, number> = { ...tally };
for (const a of anchors) {
  const r = resolveAnchor(a.target);
  let b: Bucket;
  if (r.kind === "dead") b = "dead-file";
  else if (r.lines === null) b = "dead-file";
  else if (r.line > r.lines.length || r.line < 1) b = "out-of-range";
  else if ((r.lines[a.line - 1] ?? "").trim() === "" || /^\s*(?:[)}\];,]|\/\/)/.test(r.lines[a.line - 1] ?? "  ")) b = "blank-ish";
  else b = r.kind === "path" ? "path-ok" : r.kind === "basename-ambiguous" ? "basename-ambiguous" : "basename-unique";
  tally[b]++;
  if (a.doc.startsWith("outputs/")) progTally[b]++;
  if ((b === "dead-file" || b === "out-of-range") && worst.length < 10) worst.push(`     [${b}] ${a.doc} → ${a.target}:${String(a.line)}`);
}
console.log("\n## ② 散文页行号锚点普查（对着今天的源文件逐条解，含裸名回退）");
console.log(`   扫描面：${mdFiles.length} 个 .md（AGENTS.md/PROGRESS.md/docs/**/outputs/**），锚点共 ${anchors.length} 条`);
for (const k of Object.keys(tally) as Bucket[]) {
  console.log(`   ${k.padEnd(19)} ${String(tally[k]).padStart(4)} 条（本程序页 ${String(progTally[k]).padStart(3)}）  占比 ${anchors.length ? ((100 * tally[k]) / anchors.length).toFixed(1) : "n/a"}%`);
}
for (const w of worst) console.log(w);
console.log(`   硬事实两态合计（dead-file + out-of-range）= ${tally["dead-file"] + tally["out-of-range"]} 条 / ${anchors.length}（这些是「今天按这条指针找不到东西」）`);
console.log(`   「找得到但没写清是谁」（basename-ambiguous）= ${tally["basename-ambiguous"]} 条：同一个名字在仓里有多份，读者得自己猜是哪一本`);
console.log("   ⚠️ 第一版读数作废并记录：把裸名锚点（`loop.ts:128`）按 ROOT 相对路径解，得出过 **78.1% file-missing** 的假数——");
console.log("      真实分布见上。教训同 25 页那条 `read(rel)` 双重 join：**分母错了比结论错了更难发现**。");
console.log("      ⚠️ blank-ish 是弱信号（锚漂到邻行也落这里），不与两个硬态混报一个数。");

// ---------------- ③ 锚点↔所称符号一致性 ----------------
const ID = /`([A-Za-z_$][\w$]{3,})`/g;
let checked = 0, drifted = 0;
const driftSamples: string[] = [];
for (const a of anchors) {
  const r = resolveAnchor(a.target);
  if (r.lines === null) continue;
  const names = [...a.docLine.matchAll(ID)].map((m) => m[1]!);
  if (names.length === 0) continue;
  const lo = Math.max(0, a.line - 4), hi = Math.min(r.lines.length, a.line + 3);
  const window = r.lines.slice(lo, hi).join("\n");
  for (const nm of names) {
    checked++;
    if (!window.includes(nm)) {
      drifted++;
      if (driftSamples.length < 8) driftSamples.push(`     ${a.doc} 说 ${a.target}:${String(a.line)} 是 \`${nm}\` ⇒ 该行的 ±3 行窗口里没有这个标识符`);
    }
  }
}
console.log("\n## ③ 锚点所称的符号，真在所指行附近吗（±3 行窗口）");
console.log(`   可检配对 ${checked} 组（文档同一行用反引号点名了标识符、且目标文件在盘上），其中 ${drifted} 组窗口里没有那个名字`);
for (const s of driftSamples) console.log(s);
console.log("   ⚠️ 这一问是**近似**：窗口里没有标识符可能是别名、跨行调用、或文档在说别处——");
console.log("      故它只能当「待核清单」的规模读数，不能当判卷；真正判卷用 ② 里那两个硬态。");
