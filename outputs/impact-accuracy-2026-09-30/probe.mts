// 影响面精度只读探针（第 240 页取料）：对 4 个真值已知的符号跑 upward(谁调用我)，
// 与 word-boundary grep 的调用点真值并排出差异。不写任何仓库文件（impact 缓存写应用数据目录，本来就不进仓）。
// 真值口径：`\b<symbol>\(` 的 grep 命中行，剔除定义行与 import 行——剩余即「文本上像调用」的候选，
// 图查与真值的每一处差异都在输出里点名，人工归类（本探针只取料不下结论）。
import { buildImpact, upward } from "../../src/agent/impact/index.js";
import { spawnSync } from "node:child_process";

const ROOT = "/Users/ze/Downloads/deepseek harness";
const SYMBOLS = ["insideScratchFace", "staleScratchTrees", "runInSandbox", "appendRun"];

const graph = await buildImpact({ workspace: ROOT });
console.log(`graph: files=${graph.files.length} candidates=${graph.candidates} cap=${graph.cap} partial=${graph.candidates > graph.files.length}`);

for (const sym of SYMBOLS) {
  const sites = upward(graph, sym);
  const g = spawnSync("grep", [
    "-rnE", `\\b${sym}\\(`,
    "--include=*.ts", "--exclude-dir=node_modules", "--exclude-dir=.worktrees", "--exclude-dir=.git",
    ROOT,
  ], { encoding: "utf8" });
  const lines = (g.stdout ?? "").split("\n").filter(Boolean)
    .map((l) => l.replace(ROOT + "/", ""))
    .filter((l) => !/\/src\/agent\/impact\/index\.ts/.test(l) || !sym.startsWith("upward"));
  const truth = lines.filter((l) => !l.includes("export async function " + sym) && !l.includes("export function " + sym) && !l.includes("import "));
  console.log(`\n== ${sym} ==`);
  console.log(`graph upward (${sites.length}):`);
  for (const s of sites.slice(0, 12)) console.log(`  ${s.file}:${s.line} ${s.symbol}`);
  console.log(`grep 真值候选 (${truth.length}):`);
  for (const t of truth.slice(0, 12)) console.log(`  ${t.slice(0, 150)}`);
}
