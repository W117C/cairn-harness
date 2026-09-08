// 工具门接线测试（任务 3）：default 档 ask → 批准才执行；拒绝不执行；沙箱不可用时写工具强制审批。
// runAgent 即 main 暴露的同一入口；AskGate 用即时决议的 stub 模拟 UI 点击。
import { cp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runAgent } from "../src/main/agent-runner";
import { AskGate } from "../src/main/ask-gate";
import type { AgentEvent } from "../src/events";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const APP = join(ROOT, "fixtures", "todo-app");
const BUG = join(ROOT, "fixtures", "mock", "todo-bug.ts");
const TARGET = join(APP, "src", "todo.ts");

async function resetTarget(): Promise<void> {
  await cp(BUG, TARGET);
}

// notify 一到就决议 —— 模拟用户点击批准/拒绝
function autoGate(answer: "approved" | "rejected", asked: string[] = []): AskGate {
  const gate = new AskGate({
    timeoutMs: 1000,
    notify: (req) => {
      asked.push(req.tool);
      gate.decide(req.askId, answer === "approved");
    },
  });
  return gate;
}

function resultsFor(events: AgentEvent[], name: string): Array<{ ok: boolean; output: string }> {
  return events
    .filter((e) => e.type === "tool_result")
    .filter((r) => {
      const call = events.find((c) => c.type === "tool_call" && c.id === r.callId);
      return call?.type === "tool_call" && call.name === name;
    })
    .map((r) => ({ ok: r.ok, output: r.output }));
}

describe("工具门接线（runAgent + AskGate）", () => {
  it(
    "default 档 + 批准 → write_file 与 run_shell 真实执行，靶子修复",
    { timeout: 120_000 },
    async () => {
      await resetTarget();
      const asked: string[] = [];
      const events = await runAgent({
        workspace: APP,
        message: "修复 fixtures/todo-app 中失败的测试",
        mode: "default",
        logPath: join(tmpdir(), "m0b-t-" + String(Date.now()) + "-approve.jsonl"),
        askGate: autoGate("approved", asked),
        sandbox: null,
      });
      expect(asked).toEqual(["write_file", "run_shell"]); // 两个副作用工具都被询问过
      const writes = resultsFor(events, "write_file");
      const shells = resultsFor(events, "run_shell");
      expect(writes[0]?.ok).toBe(true);
      expect(shells[0]?.ok).toBe(true);
      const fixed = await readFile(TARGET, "utf8");
      expect(fixed).toContain("filter((t) => t.done)"); // 修复真的落盘
      expect(shells[0]?.output).toContain("3 passed");
    },
  );

  it(
    "default 档 + 拒绝 → 工具不执行，靶子保持带 bug 状态",
    { timeout: 120_000 },
    async () => {
      await resetTarget();
      const asked: string[] = [];
      const events = await runAgent({
        workspace: APP,
        message: "修复 fixtures/todo-app 中失败的测试",
        mode: "default",
        logPath: join(tmpdir(), "m0b-t-" + String(Date.now()) + "-reject.jsonl"),
        askGate: autoGate("rejected", asked),
        sandbox: null,
      });
      expect(asked).toEqual(["write_file", "run_shell"]);
      const writes = resultsFor(events, "write_file");
      const shells = resultsFor(events, "run_shell");
      expect(writes[0]?.ok).toBe(false);
      expect(writes[0]?.output).toContain("[permission denied]");
      expect(writes[0]?.output).toContain("未获批准");
      expect(shells[0]?.ok).toBe(false);
      const buggy = await readFile(TARGET, "utf8");
      expect(buggy).toContain("return todos.length;"); // bug 原样保留，未被改写
    },
  );

  it(
    "沙箱不可用（降级）→ 写工具强制审批：auto 档无交互也按拒绝（fail-closed）",
    { timeout: 120_000 },
    async () => {
      await resetTarget();
      const events = await runAgent({
        workspace: APP,
        message: "修复 fixtures/todo-app 中失败的测试",
        mode: "auto", // 本应放行，但沙箱不可用 → 强制审批
        logPath: join(tmpdir(), "m0b-t-" + String(Date.now()) + "-degraded.jsonl"),
        askGate: undefined, // 无交互门 → fail-closed
        sandbox: { available: false, reason: "测试注入：沙箱不可用" },
      });
      const writes = resultsFor(events, "write_file");
      const shells = resultsFor(events, "run_shell");
      expect(writes[0]?.ok).toBe(false);
      expect(writes[0]?.output).toContain("[permission denied]");
      expect(shells[0]?.ok).toBe(false);
      const buggy = await readFile(TARGET, "utf8");
      expect(buggy).toContain("return todos.length;");
    },
  );
});
