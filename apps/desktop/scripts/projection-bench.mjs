// 事件流投影的实测基准（纯 Node，不依赖 Electron——这条面要能脱离真机量）。
// 量的是**交互热路径**：每收到一个事件，App 侧要把整条事件流重新投影一遍
// （projectStream / turnDelivery / usageSummary / changedFileCount / traceGoal 各自一遍）。
// ⇒ 长会话里每来一个事件都付一次 O(n)，全程 O(n²)。
//
// 用法：node scripts/projection-bench.mjs [输出 JSON 路径] [轮数]
// 退出码看预算：超了退 1（量过了 ≠ 没变）。
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const { projectStream } = await import("../src/renderer/projections.ts");
const { usageSummary } = await import("../src/renderer/projections.ts");
const { changedFileCount } = await import("../src/renderer/components/panes.ts");
const { traceGoal } = await import("../../../src/agent/goal-trace.ts");

const output = resolve(process.argv[2] ?? "projection-bench.json");
const turns = Number(process.argv[3] ?? 400);

// 事件形状照性能冒烟的夹具（apps/desktop/scripts/ui-gallery-preload.cjs 的历史段）。
function buildEvents(n) {
  const now = Date.now();
  const events = [];
  for (let i = 0; i < n; i++) {
    const base = now - (n - i) * 60000;
    events.push({ type: "user_message", content: `第 ${i + 1} 轮：检查模块 ${i}`, ts: base });
    events.push({ type: "tool_call", id: `history-${i}`, name: "read_file", args: { path: `src/module-${i}.ts` }, ts: base + 100 });
    events.push({ type: "tool_result", callId: `history-${i}`, ok: true, output: "export const value = true;", ts: base + 200 });
    events.push({
      type: "assistant_message",
      content: `## 模块 ${i} 的检查结果\n\n已检查 **接口与状态**，返回内容按事件留存。\n\n- 输入校验完整\n- 保留原有行为\n- 验证失败可恢复\n\n\`\`\`ts\nexport const value = ${i};\n\`\`\``,
      ts: base + 300,
    });
  }
  return events;
}

function timeIt(fn, repeats) {
  const samples = [];
  for (let i = 0; i < repeats; i++) {
    const t0 = performance.now();
    fn();
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  return { p50: samples[Math.floor(samples.length * 0.5)], max: samples.at(-1) };
}

const repeats = 9;
const scale = [];
for (const n of [25, 50, 100, 200, 400, 800]) {
  const events = buildEvents(n);
  const full = timeIt(() => {
    projectStream(events, false);
    usageSummary(events);
    changedFileCount(events);
    traceGoal(events);
  }, repeats);
  // 交互热路径：流**多了一个事件**时，整条流要重投影一遍。
  const grown = [...events, { type: "assistant_delta", callId: `live-${n}`, text: "正在写…", ts: Date.now() }];
  const incremental = timeIt(() => {
    projectStream(grown, true);
    usageSummary(grown);
    changedFileCount(grown);
    traceGoal(grown);
  }, repeats);
  scale.push({
    turns: n,
    events: events.length,
    fullProjectionMs: { p50: Number(full.p50.toFixed(3)), max: Number(full.max.toFixed(3)) },
    incrementalProjectionMs: { p50: Number(incremental.p50.toFixed(3)), max: Number(incremental.max.toFixed(3)) },
  });
  process.stderr.write(`[projection-bench] ${n} 轮（${events.length} 事件）全量 p50=${full.p50.toFixed(2)}ms 增量 p50=${incremental.p50.toFixed(2)}ms\n`);
}

// 预算面：帽取**现状上取整**（下面这条基线是本脚本首跑的读数）。
// 超了退 1 ⇒ 一次真实的膨胀不会因为"量过了"被读成"没变"。
const budgets = {
  incrementalAt400Ms: Number(process.env.CAIRN_PROJECTION_INCREMENTAL_400_BUDGET_MS ?? 40),
};
const at400 = scale.find((s) => s.turns === 400);
const overBudget = at400 === undefined ? ["缺 400 轮读数"] : at400.incrementalProjectionMs.p50 > budgets.incrementalAt400Ms
  ? [`400 轮增量投影 p50 ${at400.incrementalProjectionMs.p50}ms > 帽 ${budgets.incrementalAt400Ms}ms`]
  : [];

const report = { turns, repeats, budgets, scale, overBudget: overBudget.length > 0, overBudgetReasons: overBudget };
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ turns, at400, budgets, overBudget: report.overBudget, output }));
if (overBudget.length > 0) {
  console.error(`[projection-bench] 超预算：${overBudget.join("；")}`);
  process.exitCode = 1;
}
