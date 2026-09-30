// 真仓影响面准确率探针（固化版，任务书任务 3）：沿用 outputs/impact-accuracy-2026-09-30/probe.mts
// 的 4 符号真值集合与 grep 口径，改写成可重复、带 precision/recall 读数的脚本。
// 口径（与图合同对齐，登记如下）：
//  1. 真值 = grep `\b<sym>\(` 的 (file,line)，剔除定义行与 import 行——同 09-30；
//  2. 再剔除「定义所在文件内的调用行」：同文件边不入图是登记的设计边界，不算 recall 损失；
//  3. 两边同滤噪声前缀（.claude/ .worktrees/ oh-src）：隔壁会话的 worktree 见证树会随其
//     开关进出图与 grep，不滤则读数漂移——两边同滤，读数只随主仓源码变。
// 用法：node --import tsx outputs/impact-index-2026-10-01/accuracy-prod.mts
import { buildImpact, upward, type ImpactGraph } from "../../src/agent/impact/index.js";
import { spawnSync } from "node:child_process";

const ROOT = "/Users/ze/Downloads/deepseek harness";
const SYMBOLS = ["insideScratchFace", "staleScratchTrees", "runInSandbox", "appendRun"] as const;
const NOISE = /^(\.claude\/|\.worktrees\/|\.tmp\/|oh-src\/)/;
const GREP_EXCLUDES = ["--exclude-dir=node_modules", "--exclude-dir=.git", "--exclude-dir=.worktrees",
  "--exclude-dir=.claude", "--exclude-dir=.tmp", "--exclude-dir=oh-src"];
// 人工归类的真值豁免（09-30 探针「只取料不下结论」的结论固化，每条写明理由，改动须重核）：
// tests/head-cert-deps.test.ts:995 —— expect(src).toContain("staleScratchTrees(wtRows")：字符串字面量
// 内的形状断言，不是调用。grep 是文本层必抓；图是语法层不抽（正确）。留给豁免表，不改 grep 口径。
const EXEMPT_TRUTH: readonly string[] = [
  "tests/head-cert-deps.test.ts:995",
];

type Site = { file: string; line: number };

async function truthSites(sym: string, graph: ImpactGraph): Promise<Site[]> {
  const g = spawnSync("grep", ["-rnE", `\\b${sym}\\(`, "--include=*.ts", ...GREP_EXCLUDES, ROOT], { encoding: "utf8" });
  const defFiles = new Set((graph.defs.get(sym) ?? []).map((d) => d.file));
  const out: Site[] = [];
  for (const l of (g.stdout ?? "").split("\n").filter(Boolean)) {
    const rel = l.startsWith(ROOT + "/") ? l.slice(ROOT.length + 1) : l;
    if (NOISE.test(rel)) continue;
    const c1 = rel.indexOf(":");
    const c2 = rel.indexOf(":", c1 + 1);
    const file = rel.slice(0, c1);
    const line = Number(rel.slice(c1 + 1, c2));
    if (!Number.isFinite(line)) continue;
    const content = rel.slice(c2 + 1);
    if (/^\s*(export\s+)?(async\s+)?function\s/.test(content)) continue; // 定义行（同 09-30 口径）
    if (/^\s*import\s/.test(content)) continue; // import 行
    if (EXEMPT_TRUTH.includes(`${file}:${line}`)) continue; // 人工归类豁免（表见文件头注）
    if (defFiles.has(file)) continue; // 同文件调用：登记的图边界，不入真值
    out.push({ file, line });
  }
  return out;
}

function siteKey(s: Site): string {
  return `${s.file}:${s.line}`;
}

const t0 = performance.now();
const useIndex = process.env.IMPACT_PROBE_NO_INDEX !== "1";
const graph = await buildImpact({ workspace: ROOT, persistIndex: useIndex });
const buildMs = Math.round(performance.now() - t0);
console.log(`graph: files=${graph.files.length} candidates=${graph.candidates} cap=${graph.cap} ` +
  `partial=${graph.candidates > graph.files.length} parsed=${graph.parsed} fromTagsCache=${graph.fromTagsCache} ` +
  `fromIndex=${String(graph.fromIndex)} persistIndex=${String(useIndex)} buildMs=${buildMs}`);

let tp = 0, fp = 0, fn = 0;
const rows: string[] = [];
for (const sym of SYMBOLS) {
  const graphSites = upward(graph, sym).filter((s) => !NOISE.test(s.file));
  const truth = await truthSites(sym, graph);
  const gk = new Set(graphSites.map(siteKey));
  const tk = new Set(truth.map(siteKey));
  const hit = graphSites.filter((s) => tk.has(siteKey(s)));
  const onlyGraph = graphSites.filter((s) => !tk.has(siteKey(s)));
  const onlyTruth = truth.filter((s) => !gk.has(siteKey(s)));
  tp += hit.length; fp += onlyGraph.length; fn += onlyTruth.length;
  const p = hit.length / (hit.length + onlyGraph.length);
  const r = hit.length / (hit.length + onlyTruth.length);
  rows.push(`| ${sym} | ${graphSites.length} | ${truth.length} | ${hit.length} | ${onlyGraph.length} | ${onlyTruth.length} | ${Number.isFinite(p) ? p.toFixed(3) : "n/a"} | ${Number.isFinite(r) ? r.toFixed(3) : "n/a"} |`);
  if (onlyGraph.length > 0) console.log(`\n[${sym}] 图有真值无（fp 候选，人工核对）:`);
  for (const s of onlyGraph) console.log(`  图: ${siteKey(s)}`);
  if (onlyTruth.length > 0) console.log(`\n[${sym}] 真值有图无（fn 候选，人工核对）:`);
  for (const s of onlyTruth) console.log(`  真值: ${siteKey(s)}`);
}

const precision = tp / (tp + fp);
const recall = tp / (tp + fn);
console.log("\n| 符号 | 图站点 | 真值站点 | tp | fp | fn | precision | recall |");
console.log("|---|---|---|---|---|---|---|---|");
for (const r of rows) console.log(r);
console.log(`\nAGGREGATE precision=${precision.toFixed(3)} recall=${recall.toFixed(3)} (tp=${tp} fp=${fp} fn=${fn})`);
console.log(`GATE precision==1.000: ${precision === 1}; recall>=0.900: ${recall >= 0.9}`);
