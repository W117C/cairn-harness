/** 挖历史日志：**本仓自己的判卷，红过几次、红的时候有谁在并行**。
 *
 * 为什么值得挖：探针只能给出 3 条臂的小样本；而 `outputs/` 下堆着上百次真实判卷的汇总行，
 * 里面同时记着「Test Files X failed | Y passed」与「并发判卷=起前 a 套／跑完 b 套」——
 * 这两样放在一起读，就是本格要的**假红率**：红的那些趟，有多少是**独占态也红**（真红），
 * 有多少是**撞窗态才红**（可疑的假红）。
 *
 * 口径（不许省）：
 *   · 只认 `head-cert` / 全量判卷那种**汇总行**（`Test Files … ｜ Tests … ｜ exit=…`），
 *     以及 vitest 原生的 `Test Files  N failed | M passed`。单文件反验脚本（`1 failed (1)`）**不算**：
 *     那些是**故意做出来的红**（反向验证），混进来会把率算脏。
 *   · 同一趟读数会在多份文件里重复（summary.txt 是 .log 的摘抄）⇒ 按「树 + 计数 + 退出码」去重。
 *   · 容量红签名 `Test timed out` / `Hook timed out` 单独数：它才是"跟负载有关"的直接证据。
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const OUT = join(ROOT, "outputs");

interface Hit {
  file: string;
  line: number;
  tree: string;
  failedFiles: number;
  failedTests: number;
  totalTests: number;
  exit: number | null;
  conc: string;
  text: string;
}

const SUMMARY_FULL = /Test Files\s+(?:(\d+)\s+failed\s+\|\s+)?(\d+)\s+passed\s+\((\d+)\)\s*｜\s*Tests\s+(?:(\d+)\s+failed\s+\|\s+)?(\d+)\s+passed(?:\s*\|\s*(\d+)\s+skipped)?\s*\((\d+)\)\s*｜\s*exit=(\d+)/u;
const SUMMARY_VITEST = /^\s*Test Files\s+(?:(\d+)\s+failed\s+\|\s+)?(\d+)\s+passed\s+\((\d+)\)\s*$/u;
const TREE_SHAPE = /TREE=([0-9a-f]{7,40})/u;
const CONC_SHAPE = /并发判卷=(起前\s*-?\d+\s*套／跑完\s*-?\d+\s*套[^｜\n]*)/u;
const TIMEOUT_SHAPE = /(?:Error: )?(?:Test|Hook) timed out in (\d+)ms/u;
/** 反向验证/单文件反验的形状：只有 1 个文件、总量很小 ⇒ 那是**故意做出来的红**，不是本格的分母。 */
const isReverseVerify = (totalFiles: number, totalTests: number): boolean => totalFiles <= 2 && totalTests < 100;

function walk(d: string, out: string[] = []): string[] {
  let ents: string[];
  try { ents = readdirSync(d); } catch { return out; }
  for (const e of ents) {
    const p = join(d, e);
    let st: ReturnType<typeof statSync>;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) { if (e !== "node_modules" && !e.startsWith(".")) walk(p, out); continue; }
    if (/\.(log|txt|md|jsonl)$/u.test(e)) out.push(p);
  }
  return out;
}

const files = walk(OUT);
const hits: Hit[] = [];
const timeouts: { file: string; line: number; ms: string; ctx: string }[] = [];
let scannedLines = 0;

for (const f of files) {
  let text: string;
  try { text = readFileSync(f, "utf8"); } catch { continue; }
  if (text.length > 4_000_000) continue; // 超大文件（判卷原始输出）跳过：汇总行不在那儿
  const lines = text.split("\n");
  scannedLines += lines.length;
  const rel = relative(ROOT, f);
  for (let i = 0; i < lines.length; i += 1) {
    const l = lines[i] ?? "";
    if (TIMEOUT_SHAPE.test(l)) {
      timeouts.push({ file: rel, line: i + 1, ms: TIMEOUT_SHAPE.exec(l)?.[1] ?? "?", ctx: l.trim().slice(0, 120) });
    }
    const mFull = SUMMARY_FULL.exec(l);
    const mVitest = mFull === null ? SUMMARY_VITEST.exec(l) : null;
    if (mFull === null && mVitest === null) continue;
    const failedFiles = Number((mFull ?? mVitest)?.[1] ?? 0);
    const totalFiles = Number((mFull ?? mVitest)?.[3] ?? 0);
    const failedTests = mFull === null ? -1 : Number(mFull[4] ?? 0);
    const totalTests = mFull === null ? -1 : Number(mFull[7] ?? 0);
    if (isReverseVerify(totalFiles, totalTests < 0 ? totalFiles * 1000 : totalTests)) continue;
    // 树与并发读数常在相邻行（head-cert 的汇总块是连着印的）⇒ 上下各找 40 行。
    const win = lines.slice(Math.max(0, i - 40), i + 5).join("\n");
    hits.push({
      file: rel, line: i + 1,
      tree: TREE_SHAPE.exec(win)?.[1] ?? "(这趟没印树)",
      failedFiles, failedTests, totalTests,
      exit: mFull === null ? null : Number(mFull[8]),
      conc: CONC_SHAPE.exec(win)?.[1] ?? "(这趟没印并发)",
      text: l.trim().slice(0, 110),
    });
  }
}

/** 去重：同一趟读数会在 .log 与 .summary.txt 里各印一次（树+计数+退出码相同即同一趟）。 */
const seen = new Set<string>();
const runs = hits.filter((h) => {
  const k = `${h.tree}|${String(h.failedFiles)}|${String(h.failedTests)}|${String(h.totalTests)}|${String(h.exit)}`;
  if (seen.has(k)) return false;
  seen.add(k);
  return true;
});

const reds = runs.filter((r) => r.failedTests > 0 || r.failedFiles > 0 || r.exit === 1);
const concOf = (r: Hit): "独占" | "撞窗" | "未印" => {
  const m = /起前\s*(\d+)\s*套／跑完\s*(\d+)\s*套/u.exec(r.conc);
  if (m === null) return "未印";
  return Math.max(Number(m[1]), Number(m[2])) > 0 ? "撞窗" : "独占";
};

console.log("# 历史判卷：红过几次、红的时候谁在并行\n");
console.log(`扫描 ${String(files.length)} 个文件 / ${String(scannedLines)} 行 ⇒ 汇总行 ${String(hits.length)} 条，去重后 **${String(runs.length)} 趟**\n`);
console.log(`| 分类 | 趟数 |`);
console.log(`|---|---:|`);
console.log(`| 绿 | ${String(runs.length - reds.length)} |`);
console.log(`| **红** | **${String(reds.length)}** |`);
console.log(`| 其中撞窗态 | ${String(reds.filter((r) => concOf(r) === "撞窗").length)} |`);
console.log(`| 其中独占态 | ${String(reds.filter((r) => concOf(r) === "独占").length)} |`);
console.log(`| 其中并发未印（判不了） | ${String(reds.filter((r) => concOf(r) === "未印").length)} |`);

const grid: Record<string, { total: number; red: number }> = {};
for (const r of runs) {
  const k = concOf(r);
  grid[k] = { total: (grid[k]?.total ?? 0) + 1, red: (grid[k]?.red ?? 0) + (reds.includes(r) ? 1 : 0) };
}
console.log(`\n| 并发状态 | 趟数 | 红 | 红率 |`);
console.log(`|---|---:|---:|---:|`);
for (const [k, v] of Object.entries(grid)) console.log(`| ${k} | ${String(v.total)} | ${String(v.red)} | ${((100 * v.red) / v.total).toFixed(1)}% |`);

console.log(`\n### 红的那些趟（逐条）\n`);
console.log(`| 树 | 失败文件 | 失败用例 | 退出码 | 并发状态 | 出处 |`);
console.log(`|---|---:|---:|---:|---|---|`);
for (const r of reds) console.log(`| ${r.tree.slice(0, 9)} | ${String(r.failedFiles)} | ${r.failedTests} | ${r.exit === null ? "?" : String(r.exit)} | ${r.conc.slice(0, 40)} | ${r.file}:${String(r.line)} |`);

console.log(`\n### 容量红签名（\`Test timed out\` / \`Hook timed out\`）共 ${String(timeouts.length)} 处\n`);
console.log(`| 出处 | 时限 | 上下文 |`);
console.log(`|---|---:|---|`);
for (const t of timeouts) console.log(`| ${t.file}:${String(t.line)} | ${t.ms}ms | ${t.ctx.replace(/\|/gu, "\\|").slice(0, 90)} |`);
