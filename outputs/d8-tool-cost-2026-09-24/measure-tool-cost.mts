// D8（并发执行只读工具）的成本上限实测：白名单里那几个工具，一次调用到底花多少毫秒。
//
// 为什么要单独量这个：`replay:latency` 量到真语料有 **48 次「可折进同一拍」的只读调用**（触发面存在），
// 但触发面不等于收益——并发省的只有**工具自己的墙钟**，而一轮的成本主要是模型那一跳。
// 于是问题变成一个可测的数：白名单工具单次多少毫秒？
//
// 量的是**发货实现**（`TOOLS.<name>.run`，与 `scripts/tools-check.ts` 同一个入口），不是重新实现一遍。
// 工作区 = 本仓根目录（真实规模：有 node_modules、.git、几千个源文件），所以这也是"最坏情形"那一侧。
//
// 复跑：node --import tsx "outputs/d8-tool-cost-2026-09-24/measure-tool-cost.mts"
import { cwd } from "node:process";
import { TOOLS } from "../../src/tools";
import type { ToolContext } from "../../src/tools";

const ctx: ToolContext = { workspace: cwd() };
const REPEATS = 3;

// 每个用例都是"模型真会发的那种参数"，不是空目录里的最理想输入。
const CASES: { tool: keyof typeof TOOLS; args: Record<string, unknown>; label: string }[] = [
  { tool: "read_file", args: { path: "src/agent/orchestrator.ts" }, label: "读一个大源文件" },
  { tool: "grep", args: { pattern: "export function" }, label: "全仓 grep（命中很多）" },
  { tool: "grep", args: { pattern: "ZZZ_不可能出现的模式_QQQ" }, label: "全仓 grep（零命中=扫全树）" },
  { tool: "glob", args: { pattern: "**/*.ts" }, label: "glob 全仓 .ts" },
];

// `impact_query` **不在这张表里量**：它是运行期注入的（agent-runner 里
// `{ ...TOOLS, ...(impactTool ? { impact_query: impactTool } : {}) }`），裸 import 的 TOOLS 没有它。
// 它是白名单里唯一可能慢的一档（要建调用图），但真语料 282 次调用里 **0 次** impact_query
// ⇒ 对本次要答的问题（那 48 次可折叠调用的天花板）没有贡献。列为未测并写明原因，
// 而不是报一条看起来像产品缺陷的失败。
const NOT_MEASURED = "impact_query";

const ms = (t: [number, number]): number => (t[1] - t[0]) / 1e6;

async function timeOne(tool: keyof typeof TOOLS, args: Record<string, unknown>): Promise<{ ms: number; bytes: number; ok: boolean; why: string }> {
  const t0 = process.hrtime();
  try {
    const r = await TOOLS[tool].run(args, ctx);
    const out = String(r?.output ?? "");
    return { ms: ms(process.hrtime(t0)), bytes: out.length, ok: r?.ok !== false, why: r?.ok === false ? out.slice(0, 60) : "" };
  } catch (e) {
    return { ms: ms(process.hrtime(t0)), bytes: 0, ok: false, why: String(e instanceof Error ? e.message : e).slice(0, 60) };
  }
}

console.log("工作区：" + cwd());
const medians: { label: string; tool: string; median: number }[] = [];
console.log("工具".padEnd(14), "用例".padEnd(24), "n", "min ms", "median ms", "max ms", "输出字节", "ok");
for (const c of CASES) {
  const runs: { ms: number; bytes: number; ok: boolean; why: string }[] = [];
  for (let i = 0; i < REPEATS; i++) runs.push(await timeOne(c.tool, c.args));
  const sorted = runs.map((r) => r.ms).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  medians.push({ label: c.label, tool: String(c.tool), median });
  const last = runs[runs.length - 1]!;
  console.log(
    String(c.tool).padEnd(14), c.label.padEnd(24), String(REPEATS).padEnd(3),
    sorted[0]!.toFixed(1).padEnd(8), median.toFixed(1).padEnd(10),
    sorted[sorted.length - 1]!.toFixed(1).padEnd(7), String(last.bytes).padEnd(8),
    last.ok ? "yes" : "no · " + last.why,
  );
}

// D8 的**天花板**（不是预测）：真语料里可折叠的只读调用共 FOLDABLE 次（`replay:latency` 的读数）。
// 折叠一次的省时分不可能超过"那次调用本身的时长"，所以拿上面最慢的一档乘上去就是一个上界。
const FOLDABLE = 48;
const slowest = medians.reduce((a, b) => (b.median > a.median ? b : a), medians[0]!);
const ceilingMs = slowest.median * FOLDABLE;
console.log("");
console.log(
  "D8 天花板：可折叠只读调用 " + String(FOLDABLE) + " 次 × 最慢一档中位耗时 " +
    slowest.median.toFixed(1) + "ms（" + slowest.tool + " · " + slowest.label + "）" +
    " ⇒ **全部折叠也省不到 " + (ceilingMs / 1000).toFixed(2) + "s**。",
);
console.log(
  "对照：同一批轨迹的一轮模型往返是秒级（G-A fanout 三 rep 的总耗时/请求数见 outputs/ga-strategy-*/report.md），" +
    "所以上式即便取满也是**一轮都不到**的量。",
);
console.log("未测的一档：" + NOT_MEASURED + "（原因见文件内注释；真语料 0 次调用 ⇒ 不改上面这个天花板）");

