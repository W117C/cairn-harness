// 一次性对照（用完即删）：同名的 ref→def 全连接（rank.ts:126）下，
// 「现状权重」与「两种修法」各自把谁排到前面。不改生产代码，只按同一公式复算入边质量。
import { scanSourceFiles } from "../../src/agent/map/build";
import { fileTags } from "../../src/agent/map/parse";
import { readFile } from "node:fs/promises";

const files = await scanSourceFiles(process.cwd());
const perFile: { file: string; defs: Set<string>; refCounts: Map<string, number> }[] = [];
for (const f of files) {
  let src: string;
  try { src = await readFile(f.abs, "utf8"); } catch { continue; }
  const ext = f.rel.slice(f.rel.lastIndexOf(".") + 1).toLowerCase();
  let tags;
  try { tags = await fileTags(src, ext); } catch { continue; }
  const defs = new Set<string>();
  const refCounts = new Map<string, number>();
  for (const t of tags) {
    if (t.kind === "def") defs.add(t.name);
    else refCounts.set(t.name, (refCounts.get(t.name) ?? 0) + 1);
  }
  perFile.push({ file: f.rel, defs, refCounts });
}

// 名字级统计（与 buildGraph 同口径的两张表）
const defCount = new Map<string, number>();
const refFiles = new Map<string, number>();
for (const f of perFile) {
  for (const n of f.defs) defCount.set(n, (defCount.get(n) ?? 0) + 1);
  for (const n of f.refCounts.keys()) refFiles.set(n, (refFiles.get(n) ?? 0) + 1);
}

/** 三种口径下，某文件从每个引用方收到的入边总质量。 */
function inbound(name: string, mode: "current" | "split" | "splitIdf"): number {
  const defsOfName = defCount.get(name) ?? 0;
  const rf = refFiles.get(name) ?? 0;
  let mass = 0;
  for (const f of perFile) {
    const k = f.refCounts.get(name);
    if (k === undefined) continue;
    if (f.defs.has(name) && defsOfName === 1) continue; // 单文件独占该名字：自环不参与跨文件比较
    let mul = 1;
    if (name.length >= 8) mul *= 10;
    if (name.startsWith("_")) mul *= 0.1;
    if (defsOfName > 5) mul *= 0.1;
    let w = mul * Math.sqrt(k);
    if (mode === "split" || mode === "splitIdf") w /= Math.max(1, defsOfName);       // 一份引用只有一票，按候选平分
    if (mode === "splitIdf") w /= Math.log(1 + Math.max(1, rf));                       // 被 284 个文件引用的名字不值 284 票
    mass += w;
  }
  return mass;
}

const targets = [
  "fixtures/gym/cases/todo-completed-count/repo/tests/run.mjs",
  "src/agent/ledger.ts",
  "src/events/index.ts",
  "src/main/agent-runner.ts",
  "src/main/settings.ts",
  "src/agent/verify.ts",
  "src/agent/no-progress.ts",
  "src/tools/grep.ts",
];
const byFile = new Map<string, Record<string, number>>();
const namesAll = new Set<string>();
for (const n of [...defCount.keys(), ...refFiles.keys()]) namesAll.add(n);
for (const f of perFile) {
  const row: Record<string, number> = { current: 0, split: 0, splitIdf: 0 };
  for (const n of f.defs) for (const m of ["current", "split", "splitIdf"] as const) row[m] += inbound(n, m);
  byFile.set(f.file, row);
}
const rankOf = (mode: string) => perFile.map((f) => f.file).sort((a, b) => byFile.get(b)![mode]! - byFile.get(a)![mode]!);
const ranks = { current: rankOf("current"), split: rankOf("split"), splitIdf: rankOf("splitIdf") };

console.log("文件  现状名次  平分票数名次  平分+IDF名次   (总数 " + String(perFile.length) + ")");
for (const t of targets) {
  console.log(`${t}  ${String(ranks.current.indexOf(t) + 1)}  ${String(ranks.split.indexOf(t) + 1)}  ${String(ranks.splitIdf.indexOf(t) + 1)}`);
}
for (const m of ["current", "split", "splitIdf"] as const) {
  console.log(`\n[${m}] 前 8：` + ranks[m].slice(0, 8).map((f) => `${f}=${Math.round(byFile.get(f)![m])}`).join(", "));
}
const worst = [...namesAll].map((n) => [n, defCount.get(n) ?? 0, refFiles.get(n) ?? 0] as const)
  .sort((a, b) => (b[2] * (b[1] <= 5 && b[0].length >= 8 ? 10 : 1)) - (a[2] * (a[1] <= 5 && a[0].length >= 8 ? 10 : 1)));
console.log("\n制造全连接质量最多的名字（name / 同名 def 数 / 引用方文件数）：");
for (const [n, d, r] of worst.slice(0, 8)) console.log(`  ${n}: defs=${String(d)} refFiles=${String(r)}${d <= 5 && n.length >= 8 ? "  ← 吃 ×10 长度加成、又不触发 >5 阻尼" : ""}`);
