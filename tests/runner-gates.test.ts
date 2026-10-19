// 三门 IPC 级接线（任务 1 验收的 card_action 路径）：clarify 表单提交 / plan 批准
// 走 agent-runner 暴露的真实处理函数（handleClarifySubmit / handlePlanDecide），与 turn 解耦。
import { cp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { acquireAppFixtureLock } from "./app-fixture-lock";
import {
  handleClarifySubmit,
  handlePlanDecide,
  runAgent,
} from "../src/main/agent-runner";
import { resetPlanState } from "../src/permissions";
import type { AgentEvent, ClarifyAnswerMap } from "../src/events";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const APP = join(ROOT, "fixtures", "todo-app");
const BUG = join(ROOT, "fixtures", "mock", "todo-bug.ts");
const TARGET = join(APP, "src", "todo.ts");

const ANSWERS: ClarifyAnswerMap = {
  "开关加在哪里？": "addTodo 增加默认完成参数",
  "开关的默认行为？": "默认未完成（done=false）",
};

afterEach(() => {
  resetPlanState();
  delete process.env.M1B_GATE_FLOW;
});

// 共享靶子 fixtures/todo-app 的写入方：与 gated-tools / replay-faces 互斥（见 tests/app-fixture-lock.ts）。
let releaseAppFixture: (() => Promise<void>) | undefined;
beforeAll(async () => { releaseAppFixture = await acquireAppFixtureLock(); }, 360_000);
afterAll(async () => { await releaseAppFixture?.(); });

describe("三门 IPC 接线（runAgent + card_action 处理函数）", () => {
  it(
    "clarify_requested → handleClarifySubmit → tool_result 与提交值逐字一致且挂回原 tool_use id；plan 批准后写放行",
    { timeout: 120_000 },
    async () => {
      await cp(BUG, TARGET); // 重置靶子到 1 failed
      process.env.M1B_GATE_FLOW = "1";
      const logPath = join(tmpdir(), `m1b-runner-${String(Date.now())}.jsonl`);
      const seen: AgentEvent[] = [];
      const events = await runAgent({
        workspace: APP,
        message: "给待办应用加个开关",
        mode: "auto",
        logPath,
        // S3 信任闸：本用例跑的是仓内 fixture（APP），自行断言可信；产品路径缺省即拒绝。
        trustedRepo: true,
        onEvent: (e) => {
          seen.push(e);
          // 驱动方 = UI 卡片动作：看到事件即经 IPC 处理函数回传（queueMicrotask 解耦）
          if (e.type === "clarify_requested") {
            queueMicrotask(() => {
              expect(handleClarifySubmit(e.callId, ANSWERS)).toBe(true);
            });
          }
          if (e.type === "plan_proposed") {
            queueMicrotask(() => {
              void handlePlanDecide(true, e.callId);
            });
          }
        },
        sandbox: null,
      });
      const call = events.find((e): e is Extract<AgentEvent, { type: "tool_call" }> => e.type === "tool_call" && e.name === "clarify");
      expect(call).toBeDefined();
      const clarifyResult = events.find(
        (e): e is Extract<AgentEvent, { type: "tool_result" }> => e.type === "tool_result" && call !== undefined && e.callId === call.id,
      );
      expect(clarifyResult?.type === "tool_result" && clarifyResult.ok).toBe(true);
      if (clarifyResult?.type === "tool_result") {
        expect(clarifyResult.output).toBe(JSON.stringify(ANSWERS)); // 逐字一致
      }
      expect(seen.some((e) => e.type === "plan_approved" && e.approved)).toBe(true); // 决议事件落日志并推送 UI
      const write = events.find((e): e is Extract<AgentEvent, { type: "tool_call" }> => e.type === "tool_call" && e.name === "write_file");
      expect(write).toBeDefined();
      const writeResult = events.find(
        (e): e is Extract<AgentEvent, { type: "tool_result" }> => e.type === "tool_result" && write !== undefined && e.callId === write.id,
      );
      expect(writeResult?.type === "tool_result" && writeResult.ok).toBe(true); // 批准后写放行
      expect(events.some((e) => e.type === "verify_result" && e.ok)).toBe(true); // verify 通过
      await rm(logPath, { force: true });
    },
  );
});
