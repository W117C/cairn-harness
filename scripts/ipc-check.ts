// ipc:check —— 不经 UI，直接调用 main 进程暴露的同一函数 handleAgentRun（src/main/agent-runner）。
// 断言：①事件序列含 tool_call(write_file) 与 tool_result(run_shell)
//       ②fixtures/todo-app 从 1 失败 → 0 失败（3 passed，退出码 0）。
import { cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { handleAgentRun, initSandbox } from "../src/main/agent-runner";
import { sha256MatchesFrozen } from "../src/frozen";
import type { AgentEvent } from "../src/events";
import { run_shell } from "../src/tools/run_shell";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const APP = join(ROOT, "fixtures", "todo-app");

let failures = 0;
function assert(cond: boolean, label: string): void {
  if (cond) {
    console.log("  ✅ " + label);
  } else {
    failures++;
    console.error("  ❌ " + label);
  }
}

function countTests(output: string): { failed: number; passed: number } {
  // vitest 摘要两种形态: "Tests  1 failed | 2 passed (3)" / "Tests  3 passed (3)"
  const summary = output.match(/^\s*Tests\s+([^\n(]*)/m)?.[1] ?? "";
  return {
    failed: Number(/(\d+)\s+failed/.exec(summary)?.[1] ?? 0),
    passed: Number(/(\d+)\s+passed/.exec(summary)?.[1] ?? 0),
  };
}

const frozen = await sha256MatchesFrozen(ROOT);
assert(frozen.ok, "判卷文件 sha256 = 冻结基线" + (frozen.ok ? "" : "（被改：" + String(frozen.broken) + "）"));

console.log("[ipc:check] 重置靶子并确认开工基线 1 failed");
await cp(join(ROOT, "fixtures", "mock", "todo-bug.ts"), join(APP, "src", "todo.ts"));
const before = await run_shell.run({ command: "pnpm test" }, { workspace: APP });
const beforeCount = countTests(before.output);
console.log("[ipc:check] 基线: " + String(beforeCount.failed) + " failed | " + String(beforeCount.passed) + " passed");
assert(beforeCount.failed === 1 && !before.ok, "开工基线 = 1 failed（退出码非 0）");

console.log("[ipc:check] 自检沙箱 → 直调 main 同一入口 handleAgentRun（mode=auto，非交互）");
await initSandbox();
const collected: AgentEvent[] = [];
const res = await handleAgentRun(
  { message: "修复 fixtures/todo-app 中失败的测试", mode: "auto" },
  {
    workspace: APP,
    logPath: join(tmpdir(), "m0b-ipc-check-" + String(Date.now()) + ".jsonl"),
    onEvent: (e) => collected.push(e),
  },
);
assert(res.ok, "handleAgentRun 成功" + (res.ok ? "" : "（" + String(res.error) + "）"));
console.log("[ipc:check] 事件共 " + String(collected.length) + " 条");
for (const e of collected) {
  if (e.type === "tool_call") console.log("    tool_call " + e.name + " → " + JSON.stringify(e.args).slice(0, 80));
  if (e.type === "tool_result") console.log("    tool_result ok=" + String(e.ok) + " → " + e.output.slice(0, 80).replace(/\n/g, " | "));
}
assert(
  collected.some((e) => e.type === "tool_call" && e.name === "write_file"),
  "事件序列含 tool_call(write_file)",
);
assert(
  collected.some(
    (e) =>
      e.type === "tool_result" &&
      collected.some((c) => c.type === "tool_call" && c.id === e.callId && c.name === "run_shell"),
  ),
  "事件序列含 tool_result(run_shell)",
);

console.log("[ipc:check] 复核修复效果");
const after = await run_shell.run({ command: "pnpm test" }, { workspace: APP });
const afterCount = countTests(after.output);
console.log("[ipc:check] 修复后: " + String(afterCount.failed) + " failed | " + String(afterCount.passed) + " passed");
assert(afterCount.failed === 0 && afterCount.passed >= 3 && after.ok, "靶子 1 失败 → 0 失败（3 passed，退出码 0）");

if (failures > 0) {
  console.error("[ipc:check] 失败: " + String(failures) + " 项断言未通过");
  process.exitCode = 1;
} else {
  console.log("[ipc:check] 全部断言通过");
}
