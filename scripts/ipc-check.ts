// ipc:check —— 不经 UI，直接调用 main 进程暴露的同一函数 handleAgentRun（src/main/agent-runner）。
//
// 两条分支（分支选择在输出里显式打印，fail-visible）：
//   A. 沙箱可用：原断言 —— ①事件序列含 tool_call(write_file) 与 tool_result(run_shell)
//      ②fixtures/todo-app 从 1 失败 → 0 失败（3 passed，退出码 0）。
//   B. 沙箱不可用（M2g §2.1 红线）：断言的是**降级链正确**而非靶子被修好：
//      sandboxRisk 判写工具 high → auto 档送审 → 非交互 fail-closed 拒绝 → 靶子**不被改动**（仍 1 failed）。
//      重放等价与判卷 sha256 两条与环境无关的断言两支都跑。
//
// 判据健壮化（M2g §1.4-2）：摘要正则前先剥离 ANSI 转义序列，不依赖调用者 TERM。
import { cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { handleAgentRun, initSandbox } from "../src/main/agent-runner";
import { sha256MatchesFrozen } from "../src/frozen";
import { replay, type AgentEvent } from "../src/events";
import { run_shell } from "../src/tools/run_shell";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const APP = join(ROOT, "fixtures", "todo-app");

let failures = 0;
function assert(cond: boolean, label: string, detail = ""): void {
  if (cond) {
    console.log("  ✅ " + label + (detail ? "（" + detail + "）" : ""));
  } else {
    failures++;
    console.error("  ❌ " + label + (detail ? "（" + detail + "）" : ""));
  }
}

/** ANSI 剥离：判据不依赖调用者 TERM（§1.4-2）。 */
export function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

function countTests(output: string): { failed: number; passed: number } {
  const clean = stripAnsi(output);
  // vitest 摘要两种形态: "Tests  1 failed | 2 passed (3)" / "Tests  3 passed (3)"
  const summary = clean.match(/^\s*Tests\s+([^\n(]*)/m)?.[1] ?? "";
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
const sandbox = await (await import("../src/main/sandbox")).checkSandbox();
const degraded = !sandbox.available;
console.log(
  "[ipc:check] 沙箱自检：available=" + String(sandbox.available) + (sandbox.reason ? "（" + sandbox.reason.slice(0, 70) + "）" : "") +
    " → 本轮走 " + (degraded ? "**降级分支 B**（断言降级链正确，非靶子修复）" : "**分支 A**（断言靶子被修好）"),
);

const collected: AgentEvent[] = [];
const logPath = join(tmpdir(), "m0b-ipc-check-" + String(Date.now()) + ".jsonl");
const res = await handleAgentRun(
  { message: "修复 fixtures/todo-app 中失败的测试", mode: "auto" },
  {
    workspace: APP,
    logPath,
    onEvent: (e) => collected.push(e),
  },
);
assert(res.ok, "handleAgentRun 成功" + (res.ok ? "" : "（" + String(res.error) + "）"));
console.log("[ipc:check] 事件共 " + String(collected.length) + " 条");
for (const e of collected) {
  if (e.type === "tool_call") console.log("    tool_call " + e.name + " → " + JSON.stringify(e.args).slice(0, 80));
  if (e.type === "tool_result") console.log("    tool_result ok=" + String(e.ok) + " → " + e.output.slice(0, 80).replace(/\n/g, " | "));
}

// M1a 重放验收（与环境无关，两支都跑）：丢弃内存态 → 只从 JSONL 重放 → 事件数与内容与跑前一致。
console.log("[ipc:check] 丢弃内存态 → 从 JSONL 重放比对（" + logPath + "）");
const fromDisk = await replay(logPath);
assert(
  fromDisk.length === collected.length &&
    JSON.stringify(fromDisk) === JSON.stringify(collected),
  "重放等价：事件数与内容与跑前一致（" + String(fromDisk.length) + " 条）",
);

const writeCall = collected.find((e) => e.type === "tool_call" && e.name === "write_file");
const writeResult = writeCall
  ? collected.find((e) => e.type === "tool_result" && e.callId === (writeCall as { id: string }).id)
  : undefined;

if (!degraded) {
  // ---------------- 分支 A：沙箱可用（原断言） ----------------
  assert(writeCall !== undefined, "事件序列含 tool_call(write_file)");
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
} else {
  // ---------------- 分支 B：沙箱不可用 → 断言降级链正确（§2.1 红线） ----------------
  // 链：写工具被送审 → 非交互 fail-closed 拒绝 → 靶子零改动（仍 1 failed）。
  assert(writeCall !== undefined, "B1 事件序列仍含 tool_call(write_file)（模型照常请求写）");
  const out = writeResult && writeResult.type === "tool_result" ? writeResult.output : "";
  assert(
    writeResult !== undefined && writeResult.type === "tool_result" && !writeResult.ok,
    "B2 写工具被门拒绝（tool_result ok=false）",
  );
  assert(
    out.includes("[permission denied]") && out.includes("未获批准"),
    "B3 拒绝原因 = 非交互 fail-closed（未获批准）",
    out.slice(0, 90).replace(/\n/g, " | "),
  );
  console.log("[ipc:check] 复核降级效果：靶子必须零改动");
  const after = await run_shell.run({ command: "pnpm test" }, { workspace: APP });
  const afterCount = countTests(after.output);
  console.log("[ipc:check] 降级后: " + String(afterCount.failed) + " failed | " + String(afterCount.passed) + " passed");
  assert(afterCount.failed === 1, "B4 靶子零改动（仍 1 failed，未授权写入未发生）", String(afterCount.failed) + " failed");
}

if (failures > 0) {
  console.error("[ipc:check] 失败: " + String(failures) + " 项断言未通过");
  process.exitCode = 1;
} else {
  console.log("[ipc:check] 全部断言通过（分支 " + (degraded ? "B 降级链" : "A 靶子修复") + "）");
}
