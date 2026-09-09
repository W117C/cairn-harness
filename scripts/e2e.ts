// 闭环 e2e：mock provider 驱动 agent loop 修复 fixtures/todo-app。
// 自行断言：①事件流含 tool_call(write_file) 与 tool_result(run_shell)
//          ②靶子从 1 失败 → 0 失败  ③判卷文件 sha256 与冻结基线一致。
// 任一断言失败 → 退出码非 0。
import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runLoop } from "../src/agent/loop";
import { sha256MatchesFrozen } from "../src/frozen";
import { createEventLog, replay } from "../src/events";
import { createMockProvider } from "../src/providers/mock";
import { TOOLS } from "../src/tools";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const APP = join(ROOT, "fixtures", "todo-app");
const MOCK = join(ROOT, "fixtures", "mock");
const EVENT_LOG = join(ROOT, ".tmp", "e2e-log.jsonl"); // 运行产物，不进 git

let failures = 0;
function assert(cond: boolean, label: string): void {
  if (cond) {
    console.log(`  ✅ ${label}`);
  } else {
    failures++;
    console.error(`  ❌ ${label}`);
  }
}

async function frozenOk(): Promise<boolean> {
  const res = await sha256MatchesFrozen(ROOT);
  if (!res.ok) console.error(`  判卷文件被改动: ${res.broken}`);
  return res.ok;
}

async function runAppTests(): Promise<{ failed: number; passed: number; exitOk: boolean }> {
  const res = await TOOLS.run_shell.run({ command: "pnpm test" }, { workspace: APP });
  // vitest 摘要两种形态: "Tests  1 failed | 2 passed (3)" / "Tests  3 passed (3)"
  const summary = res.output.match(/^\s*Tests\s+([^\n(]*)/m)?.[1] ?? ""; // 行首锚定，避开 "Failed Tests 1" 横幅
  if (!summary) return { failed: -1, passed: -1, exitOk: res.ok };
  return {
    failed: Number(/(\d+)\s+failed/.exec(summary)?.[1] ?? 0),
    passed: Number(/(\d+)\s+passed/.exec(summary)?.[1] ?? 0),
    exitOk: res.ok,
  };
}

// ---- 前置：判卷文件必须与冻结基线一致（开工即校验）----
console.log("[e2e] 前置校验：判卷文件 sha256 与冻结基线一致");
assert(await frozenOk(), "fixtures/todo-app/tests/** 与 fixtures/mock/** sha256 = 冻结基线");

// ---- 准备：重置靶子到带 bug 状态，确认开工基线 1 failed ----
console.log("[e2e] 重置靶子 fixtures/todo-app（从 fixtures/mock/todo-bug.ts）");
await cp(join(MOCK, "todo-bug.ts"), join(APP, "src", "todo.ts"));
const before = await runAppTests();
console.log(`[e2e] 开工基线: ${before.failed} failed | ${before.passed} passed (exitOk=${before.exitOk})`);
assert(before.failed === 1 && !before.exitOk, "靶子开工状态 = 1 failed（pnpm test 退出码非 0）");

// ---- 闭环：事件流 → mock 模型 → 工具 → 事件流 ----
console.log("[e2e] 运行 agent loop（mock provider, auto 档, workspace=fixtures/todo-app）");
await mkdir(join(ROOT, ".tmp"), { recursive: true });
await rm(EVENT_LOG, { force: true }); // 每轮 e2e 从空日志开始
const events = createEventLog(EVENT_LOG);
const provider = createMockProvider(join(MOCK, "todo-fix.jsonl"));
await runLoop({
  provider,
  events,
  workspace: APP,
  mode: "auto",
  userMessage: "修复 fixtures/todo-app 中失败的测试",
});
const log = await replay(EVENT_LOG);
console.log(`[e2e] 事件流共 ${log.length} 条 → ${EVENT_LOG}`);

// ---- 断言①：事件流里出现 tool_call(write_file) 与 tool_result(run_shell) ----
console.log("[e2e] 断言① 事件流内容");
assert(
  log.some((e) => e.type === "tool_call" && e.name === "write_file"),
  "事件流含 tool_call(write_file)",
);
assert(
  log.some((e) => e.type === "tool_result" && log.some((c) => c.type === "tool_call" && c.id === e.callId && c.name === "run_shell")),
  "事件流含 tool_result(run_shell)",
);

// ---- 断言②：靶子 1 失败 → 0 失败 ----
console.log("[e2e] 断言② 修复效果");
const after = await runAppTests();
console.log(`[e2e] 修复后: ${after.failed} failed | ${after.passed} passed (exitOk=${after.exitOk})`);
assert(after.failed === 0 && after.passed >= 3 && after.exitOk, "靶子 1 失败 → 0 失败（3 passed，退出码 0）");

// ---- 断言③：判卷文件 sha256 仍与冻结基线逐字一致 ----
console.log("[e2e] 断言③ 判卷文件未被改动");
assert(await frozenOk(), "交付时 sha256 与开工冻结逐字一致");

if (failures > 0) {
  console.error(`[e2e] 失败: ${failures} 项断言未通过`);
  process.exitCode = 1;
} else {
  console.log("[e2e] 全部断言通过，闭环成立");
}