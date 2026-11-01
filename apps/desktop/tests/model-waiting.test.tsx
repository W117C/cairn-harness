import { describe, expect, it } from "vitest";
import type { AgentEvent } from "../../../src/main/ipc-protocol";
import { waitingForModel } from "../src/renderer/derived/model-waiting";

const user = { type: "user_message", content: "检查项目", ts: 101 } satisfies AgentEvent;
const delta = { type: "assistant_delta", callId: "c1", text: "正在检查", ts: 102 } satisfies AgentEvent;
const usage = { type: "usage", inputTokens: 3, outputTokens: 2, ts: 103 } satisfies AgentEvent;
const call = { type: "tool_call", id: "t1", name: "read_file", args: { path: "README.md" }, ts: 104 } satisfies AgentEvent;
const result = { type: "tool_result", callId: "t1", ok: true, output: "fixture", ts: 105 } satisfies AgentEvent;

describe("发送与模型输出之间的等待状态", () => {
  it("run 已开始但 user_message 尚未到达时，不把上一轮回答或错误当成本轮输出", () => {
    const history: AgentEvent[] = [
      { type: "user_message", content: "上一轮", ts: 10 },
      { type: "assistant_message", content: "已完成", ts: 20 },
      { type: "error", message: "上一轮错误", ts: 30 },
    ];
    expect(waitingForModel({ events: history, running: true, startedAt: 100 })).toBe(true);
    expect(waitingForModel({ events: [], running: true, startedAt: 100 })).toBe(true);
  });

  it.each([
    { name: "用户消息已到达", events: [user], want: true },
    { name: "首个正文增量交给助手行", events: [user, delta], want: false },
    { name: "首个思考增量交给助手行", events: [user, { type: "thinking_delta", callId: "c1", text: "先看结构", ts: 102 }], want: false },
    { name: "模型说完后的 usage 不再补等待行", events: [user, delta, usage], want: false },
    { name: "工具运行时由工具行表示执行", events: [user, delta, usage, call], want: false },
    { name: "工具完成后等待下一段模型", events: [user, delta, usage, call, result], want: true },
    { name: "工具后的 usage 不吃掉下一段等待", events: [user, call, result, { ...usage, ts: 106 }], want: true },
    { name: "下一段增量接替等待行", events: [user, call, result, { ...delta, callId: "c2", ts: 106 }], want: false },
    { name: "最终回答接替等待行", events: [user, { type: "assistant_message", content: "已完成", ts: 106 }], want: false },
    { name: "错误立即结束等待", events: [user, { type: "error", message: "请求失败", ts: 106 }], want: false },
  ] satisfies Array<{ name: string; events: AgentEvent[]; want: boolean }>)(("$name"), ({ events, want }) => {
    expect(waitingForModel({ events, running: true, startedAt: 100 })).toBe(want);
  });

  it.each(["done", "failed", "cancelled"] as const)("主会话 %s 立即结束等待", (status) => {
    expect(waitingForModel({ events: [user, { type: "agent_status", status, ts: 106 } as AgentEvent], running: true, startedAt: 100 })).toBe(false);
  });

  it("停止、切到空闲会话与等待用户审批时都不显示模型等待", () => {
    expect(waitingForModel({ events: [user], running: false, startedAt: 100 })).toBe(false);
    expect(waitingForModel({ events: [user], running: true, startedAt: 100, blocked: true })).toBe(false);
  });

  it("worker 的输出、工具与终态不接管主模型的等待", () => {
    const events: AgentEvent[] = [user,
      { ...delta, agent_id: "worker" } as AgentEvent, { ...call, agent_id: "worker" } as AgentEvent,
      { type: "agent_status", agent_id: "worker", status: "done", ts: 106 },
    ];
    expect(waitingForModel({ events, running: true, startedAt: 100 })).toBe(true);
  });

  it("并行工具必须全部收口才进入下一段模型等待", () => {
    const second: AgentEvent = { ...call, id: "t2", ts: 105 };
    expect(waitingForModel({ events: [user, call, second, result], running: true, startedAt: 100 })).toBe(false);
    expect(waitingForModel({ events: [user, call, second, result, { ...result, callId: "t2", ts: 106 }], running: true, startedAt: 100 })).toBe(true);
  });
});
