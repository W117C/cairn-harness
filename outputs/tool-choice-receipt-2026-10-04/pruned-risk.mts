// P1-b 的补法：**不造新 case，直接用仓内已归档的真实事件流**量化
// 「摘掉这 6 件工具的风险到底多大」。
//
// 为什么这是补法而不是又一轮 A/B（2026-10-04 12:20）：
//   · 「造一个能测出正确性差别的 case」这个前提**本身没被验过**。本仓现有三支
//     tool-choice case 的 expectTools 分别是 {edit_file,write_file,apply_patch}／
//     {edit_file,write_file,apply_patch}／{run_shell,...}，而 PRUNED_GROUPS 摘的是
//     spawn_agent／wait_for_agents／cancel_agents／refine_goal／remember／lsp
//     ——**没有一支 case 的正解落在被摘的那 6 件里**。⇒ 两臂必然都 score=1，
//     **饱和是 case 集的性质，不是 n 太小**。再加 n 也不会有信息。
//   · 那要真测「摘掉会不会误伤」，问的其实是：**真实跑批里，被摘的那 6 件到底被用到没有？**
//     这是**观测问题**，不是反事实问题 ⇒ 可以在已归档的真实事件流上离线算，
//     既不烧 token，也不受免费档 429 限制。
//
// 口径（每条都写着，因为这张表很容易被读成「摘工具是安全的」）：
//   · 「用到」= 该支流里出现过该 tool_call 事件。**不区分它在不在关键路径上**——
//     这正是本表**给不出**的东西，下面单列。
//   · 分母是**支流**（run），不是事件。同一支里调 3 次仍算 1 支。
//   · 这些流横跨 2026-09-20 ~ 10-02、多个评测面（loop-eval／eval-base-*/ga-strategy／
//     eval-chain／m10），**不是同一批任务**；跨面混池只用来估「频率量级」，
//     不用来估「某个 case 的正确率」。
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const PRUNED: Record<string, string[]> = {
  subagent: ["spawn_agent", "wait_for_agents", "cancel_agents"],
  goal: ["refine_goal"],
  memory: ["remember"],
  lsp: ["lsp"],
};
const PRUNED_SET = new Set(Object.values(PRUNED).flat());

const files = execSync(
  "find outputs -name '*.jsonl' -not -path '*tool-choice*' | sort",
  { encoding: "utf8", maxBuffer: 1 << 28 },
).trim().split("\n").filter(Boolean);

interface Row { file: string; fam: string; calls: string[]; nCalls: number; }
const rows: Row[] = [];
const perTool = new Map<string, number>();
const perFam = new Map<string, number>();
let totalRuns = 0, totalCalls = 0, runsUsingAny = 0;
const badFiles: string[] = [];

for (const f of files) {
  let calls: string[] = [];
  try {
    for (const line of readFileSync(f, "utf8").split("\n")) {
      if (!line.trim()) continue;
      let e: { type?: string; name?: string };
      try { e = JSON.parse(line); } catch { continue; }
      if (e.type === "tool_call" && typeof e.name === "string") calls.push(e.name);
    }
  } catch { badFiles.push(f); continue; }
  totalRuns++;
  totalCalls += calls.length;
  const prunedCalls = calls.filter((n) => PRUNED_SET.has(n));
  for (const n of prunedCalls) perTool.set(n, (perTool.get(n) ?? 0) + 1);
  for (const [fam, list] of Object.entries(PRUNED)) {
    const k = calls.filter((n) => list.includes(n)).length;
    if (k > 0) perFam.set(fam, (perFam.get(fam) ?? 0) + k);
  }
  if (prunedCalls.length > 0) runsUsingAny++;
  rows.push({ file: f, fam: "", calls: prunedCalls, nCalls: calls.length });
}

const pct = (a: number, b: number) => b === 0 ? "—" : ((a / b) * 100).toFixed(1) + "%";

console.log("=== 语料 ===");
console.log(`  真实事件流 ${String(files.length)} 支（读成功 ${String(totalRuns)}，解析失败 ${String(badFiles.length)}）`);
console.log(`  tool_call 事件共 ${String(totalCalls)} 次`);
console.log("");
console.log("=== 核心读数：被摘的那 6 件，真实跑批里到底用没用到 ===");
console.log(`  **用到过至少 1 件的支流 = ${String(runsUsingAny)}/${String(totalRuns)} = ${pct(runsUsingAny, totalRuns)}**`);
console.log(`  占全部 tool_call 的比例 = ${String(perTool.size === 0 ? 0 : [...perTool.values()].reduce((a, b) => a + b, 0))}/${String(totalCalls)} = ${pct([...perTool.values()].reduce((a, b) => a + b, 0), totalCalls)}`);
console.log("");
console.log("  按族（事件次数）：");
for (const [fam, k] of [...perFam.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`    ${fam.padEnd(9)} ${String(k).padStart(4)} 次　${pct(k, totalCalls)}`);
}
console.log("  按单件（事件次数）：");
for (const [t, k] of [...perTool.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`    ${t.padEnd(18)} ${String(k).padStart(4)} 次　${pct(k, totalCalls)}`);
}
console.log("");
console.log("  用到过它们的支流（逐支点名，不抽样）：");
for (const r of rows.filter((x) => x.calls.length > 0)) {
  const cnt = new Map<string, number>();
  for (const c of r.calls) cnt.set(c, (cnt.get(c) ?? 0) + 1);
  console.log(`    ${r.file.replace("outputs/", "")}｜该支共 ${String(r.nCalls)} 次调用｜摘掉的用 ${[...cnt.entries()].map(([k, v]) => k + "×" + v).join(" ")}`);
}
if (rows.filter((x) => x.calls.length > 0).length === 0) {
  console.log("    （无）");
}
console.log("");
console.log("=== 这张表**给不出**的东西（别拿它当「摘工具是安全的」判据）===");
console.log("  · **是否在关键路径上**：本表只数「出现过」，不判「去掉它这活就做不成」。");
console.log("    一个 run 调了 lsp 之后又用 grep 完成了 ⇒ 本表算它「用到」，实际是可绕开的。");
console.log("    要判关键路径，得回放该支去掉该件后是否仍 score=1 ⇒ 那是反事实，要重跑。");
console.log("  · **跨面混池**：这些流来自 loop-eval／eval-base-*／ga-strategy／eval-chain 等不同任务集，");
console.log("    分母不是「本仓真实使用」——本仓真实会话只有 1 个（见 P0-a 那一节）。");
console.log("    ⇒ 上面那个百分比是**上界性质的存在性证据**，不是频率的代表性估计。");
console.log("  · **端点/模型漂移**：这些流跨 2026-09-20 ~ 10-02，端点换过。");