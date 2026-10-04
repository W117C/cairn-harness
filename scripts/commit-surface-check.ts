// 落库面与门面对账（#47 ＋ #49，第 339 页）。判据本体在 `scripts/lib/commit-surface.ts`（纯函数），
// 这里只做取料与出声。
//
// 跑法：
//   node --import tsx scripts/commit-surface-check.ts                 // 两面对账，只读
//   node --import tsx scripts/commit-surface-check.ts --landed=HEAD   // 额外问一句：这一笔落库的路径有几条不在 index 上
//   node --import tsx scripts/commit-surface-check.ts --sync=HEAD     // 显式同步「那一笔动过且 index 确认落后」的路径（只写自己那批）
//
// 缺省**只读**：同步要人明确说 `--sync=<rev>`，因为多会话共用一个 git 身份（author 分辨不出会话），
// 自动判断「哪些是我的」会替别人改暂存面。`--sync` 的作用域被两件事同时夹住：该笔 diff 动过的路径
// ∩ index 确认落后的路径——别人的 `stagedNew` 一条都不碰。
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { GATES } from "./gate-manifest.js";
import { classifyDrift, driftSummary, gateFaceDiff, landedGap, type DriftKind } from "./lib/commit-surface.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const flag = (name: string): string | null => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  if (hit === undefined) return null;
  const v = hit.slice(name.length + 3);
  return v === "" ? null : v;
};
for (const a of argv) {
  if (/^--(landed|sync)=[^\s]+$/u.test(a)) continue;
  console.error(`[commit-surface] 不认识参数：${a}（只认 --landed=<rev>／--sync=<rev>）`);
  process.exit(2);
}
const landedRev = flag("landed") ?? flag("sync");
const doSync = flag("sync") !== null;
const git = (args: string[]): string => execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

/** `-z` 不是风格：默认输出会把非 ASCII 路径转义成带引号的八进制串，于是中文证人目录整批不在集合里。 */
function parseZRecords(out: string, shaAt: number): Map<string, string> {
  const m = new Map<string, string>();
  for (const rec of out.split("\0")) {
    if (rec === "") continue;
    const tab = rec.indexOf("\t");
    if (tab < 0) continue;
    const meta = rec.slice(0, tab).split(" ");
    const path = rec.slice(tab + 1);
    const sha = meta[shaAt];
    if (path !== "" && typeof sha === "string" && sha !== "") m.set(path, sha);
  }
  return m;
}

const headEntries = parseZRecords(git(["ls-tree", "-r", "-z", "HEAD"]), 2);      // <mode> <type> <sha>\t<path>
const indexEntries = parseZRecords(git(["ls-files", "-s", "-z"]), 1);            // <mode> <sha> <stage>\t<path>
const report = classifyDrift(headEntries, indexEntries);
const driftTotal = report.counts.missingInIndex + report.counts.staleInIndex;
if (driftTotal !== report.cells.filter((c) => c.kind === "missingInIndex" || c.kind === "staleInIndex").length) {
  console.log("[commit-surface] ❌ 分母自证失败：四态相加与逐格数不上 ⇒ 上面的读数不可引用");
}
console.log(driftSummary(report) + `｜一致率 ${((report.counts.aligned / Math.max(1, report.cells.length)) * 100).toFixed(1)}%`);
for (const k of ["missingInIndex", "staleInIndex", "stagedNew"] as DriftKind[]) {
  const cs = report.cells.filter((c) => c.kind === k).slice(0, 12);
  if (cs.length === 0) continue;
  console.log(`  ${k}：${cs.map((c) => c.path).join("、")}${report.counts[k] > cs.length ? ` …（共 ${String(report.counts[k])} 条）` : ""}`);
}

let gap: string[] = [];
if (landedRev !== null) {
  const touched = git(["diff-tree", "--no-commit-id", "--name-only", "-r", "-z", landedRev]).split("\0").filter((s) => s !== "");
  if (touched.length === 0) console.log(`[commit-surface] ⚠️ --landed=${landedRev} 取到 0 条路径 ⇒ 这一格取不到，不当成"没滞后"`);
  gap = landedGap(touched, report);
  console.log(`[commit-surface] 那一笔（${landedRev}）动过 ${String(touched.length)} 条路径 ⇒ 其中 ${String(gap.length)} 条不在 index 上（＝下一次 plain commit 会把它们退掉）`);
  for (const p of gap.slice(0, 12)) console.log(`  ⚠️ ${p}`);
  if (doSync) {
    for (const p of gap) {
      const sha = headEntries.get(p);
      if (sha === undefined) continue;
      execFileSync("git", ["update-index", "--add", "--cacheinfo", `100644,${sha},${p}`], { cwd: ROOT });
    }
    console.log(`[commit-surface] 已同步 ${String(gap.length)} 条（只动那一笔的路径；别人的 stagedNew 一条不碰）`);
  } else if (gap.length > 0) {
    console.log("  修法：确认那笔确实是自己落的之后 --sync=<rev>（本尺缺省只读）");
  }
}

// 门面对账：`scripts/**` 里盘上与 HEAD 不一致的那些，哪些是**门本体**。
const dirtyScripts = git(["diff", "HEAD", "--name-only", "-z", "--", "scripts"]).split("\0").filter((s) => s !== "");
// HEAD 侧的 scripts 面（这道格的分母）：取不到就是空集 ⇒ 所有门都会落进 absentInHead，
// 而不是被默认为"HEAD 里都有"（本尺不许把取不到读成没漂）。
const headScripts = new Set(git(["ls-tree", "-r", "--name-only", "-z", "HEAD", "--", "scripts"]).split("\0").filter((s) => s !== ""));
const face = gateFaceDiff(dirtyScripts, GATES, headScripts);
console.log(`[commit-surface] 门面对账：scripts 面差异 ${String(dirtyScripts.length)} 支 ⇒ 门本体 ${String(face.gates.length)}（${face.gates.join("、") || "无"}）｜非门 ${String(face.other.length)}｜HEAD 里没这门 ${String(face.absentInHead.length)}（${face.absentInHead.join("、") || "无"}）`);
if (face.gates.length > 0) {
  console.log("  ⇒ 这些门的**打印面此刻不等于 HEAD 那把尺**：引它们的读数要写明取在哪棵树（第 337 页补实测：差一条规则而退码相同）");
}
if (face.absentInHead.length > 0) {
  console.log("  ⇒ 这几支在 HEAD 里**根本不存在**（多来自未入库的新暂存面）：它们不是「漂了」，是这道门还没入库——"
    + "在干净 HEAD 树里跑它们会直接 ERR_MODULE_NOT_FOUND，那既不是门的红也不是仓的缺陷，是我的取料面错了（第 345 页）。");
}
// 只读时不因别人在飞而红：门本体差异是**邻接会话的状态**，不是我的失败。要它阻断属裁决（#49 里写明）。
process.exit(0);
