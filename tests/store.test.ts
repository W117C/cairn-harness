// F9（审查 P3）：renderer 核心正确性路径的单测——reducer/foldEvent（活流增量折叠与
// 全量重放折叠共用同一实现）、clarifySubmittedOf、planStatusesOf。
// H3-P2/H3-P3 的正确性此前只靠 panels-check CDP 间接覆盖，本文件补纯函数直测。
import { describe, expect, it } from "vitest";
import type { AgentEvent } from "../src/events";
import { clarifySubmittedOf, foldsIntoCurrentSession, planStatusesOf, reducer, type AppAction, type AppState } from "../src/renderer/store";

function initial(): AppState {
  return { events: [], asks: [], timeline: [], pos: new Map(), running: false, error: null };
}

function act(state: AppState, action: AppAction): AppState {
  return reducer(state, action);
}

describe("store reducer：delta 折叠（H3-P2 帧批量的语义基座）", () => {
  it("同 callId 的 assistant_delta 就地合并成一条 stream 项", () => {
    let s = initial();
    s = act(s, { type: "event", e: { type: "assistant_delta", callId: "c1", text: "你" } as AgentEvent });
    s = act(s, { type: "event", e: { type: "assistant_delta", callId: "c1", text: "好" } as AgentEvent });
    expect(s.timeline).toHaveLength(1);
    expect(s.timeline[0]).toEqual({ kind: "stream", callId: "c1", text: "你好" });
  });

  it("不同 callId 的 delta 各自成项；delta 永不进 events 数组", () => {
    let s = initial();
    s = act(s, { type: "event", e: { type: "assistant_delta", callId: "c1", text: "a" } as AgentEvent });
    s = act(s, { type: "event", e: { type: "assistant_delta", callId: "c2", text: "b" } as AgentEvent });
    expect(s.timeline).toHaveLength(2);
    expect(s.events).toHaveLength(0); // assistant_delta 只进 timeline 不进 events（eventCount 不受流式影响）
  });

  it("reset 全量折叠与逐事件增量折叠逐字一致（同一 foldEvent 的核心不变量）", () => {
    const events = [
      { type: "user_message", content: "目标" },
      { type: "assistant_delta", callId: "s1", text: "第一段" },
      { type: "assistant_delta", callId: "s1", text: "第二段" },
      { type: "tool_call", id: "t1", name: "read_file", args: { path: "a.ts" } },
      { type: "tool_result", callId: "t1", ok: true, output: "内容" },
      { type: "assistant_delta", callId: "s2", text: "结论" },
    ] as unknown as AgentEvent[];
    let live = initial();
    for (const e of events) live = act(live, { type: "event", e });
    const replayed = act(initial(), { type: "reset", events });
    expect(live.timeline).toEqual(replayed.timeline);
    expect(live.events).toEqual(replayed.events);
  });
});

describe("store reducer：ask / askDone / running", () => {
  const askPayload = { askId: "ask-1", tool: "run_shell", args: { command: "ls" } };

  it("ask 入 timeline + asks；askDone 按 askId 解析并标注 timeout", () => {
    let s = initial();
    s = act(s, { type: "ask", a: askPayload });
    expect(s.asks).toHaveLength(1);
    s = act(s, { type: "askDone", d: { askId: "ask-1", outcome: "rejected", reason: "timeout" } });
    const item = s.timeline.find((it) => it.kind === "ask");
    expect(item).toMatchObject({ resolved: "rejected", timedOut: true });
  });

  it("askDone 只影响匹配的 askId", () => {
    let s = initial();
    s = act(s, { type: "ask", a: { ...askPayload, askId: "ask-1" } });
    s = act(s, { type: "ask", a: { ...askPayload, askId: "ask-2" } });
    s = act(s, { type: "askDone", d: { askId: "ask-2", outcome: "approved", reason: "user" } });
    const items = s.timeline.filter((it) => it.kind === "ask");
    expect(items[0]).not.toHaveProperty("resolved");
    expect(items[1]).toMatchObject({ resolved: "approved" });
  });

  it("running 事件带 error 更新错误；不带 error 保留既有；clearError 清除", () => {
    let s = initial();
    s = act(s, { type: "running", running: true, error: "发送失败" });
    expect(s.error).toBe("发送失败");
    s = act(s, { type: "running", running: false });
    expect(s.error).toBe("发送失败"); // 不带 error = 保留
    s = act(s, { type: "clearError" });
    expect(s.error).toBeNull();
  });

  it("reset 保留 running（会话切换不打断运行态标记），error 清空", () => {
    let s = initial();
    s = act(s, { type: "running", running: true, error: "旧错误" });
    s = act(s, { type: "reset", events: [] });
    expect(s.running).toBe(true);
    expect(s.error).toBeNull();
    expect(s.timeline).toHaveLength(0);
  });
});

describe("store 派生投影：clarifySubmittedOf / planStatusesOf（H2 审查 G-1 回归面）", () => {
  it("clarify_requested 出现同 callId tool_result 即视为已提交", () => {
    const events = [
      { type: "clarify_requested", callId: "cl-1" },
      { type: "tool_result", callId: "cl-1", ok: true, output: "已回答" },
      { type: "clarify_requested", callId: "cl-2" }, // 未提交
    ] as unknown as AgentEvent[];
    const s = act(initial(), { type: "reset", events });
    const submitted = clarifySubmittedOf(s);
    expect(submitted.has("cl-1")).toBe(true);
    expect(submitted.has("cl-2")).toBe(false);
  });

  it("planStatusesOf 记录 plan 决议（approved/rejected 分型）", () => {
    const events = [
      { type: "plan_proposed", callId: "p1" },
      { type: "plan_approved", callId: "p1", approved: true },
      { type: "plan_proposed", callId: "p2" },
      { type: "plan_approved", callId: "p2", approved: false },
    ] as unknown as AgentEvent[];
    const s = act(initial(), { type: "reset", events });
    expect(planStatusesOf(s)).toEqual({ p1: "approved", p2: "rejected" });
  });
});
// 审查 S1-5（修复任务书 1.5）：F1 的会话归因守卫曾把 automation_triggered/completed 整条
// 吞掉（这两类必带 session_id，指向刚新建的定时会话，按定义不等于当前会话）——活流丢行、
// schedule 面板唯一刷新信号（eventCount）不再变化。守卫抽成纯函数后在此直测边界。
describe("活流会话归因守卫（S1-5 回归）", () => {
  it("定时事件跨会话放行；后台 run 事件仍按 session_id 归因过滤", () => {
    const ev = (type: string, extra: Record<string, unknown> = {}): AgentEvent =>
      ({ type, ts: "2026-09-14T00:00:00Z", ...extra } as unknown as AgentEvent);
    // 跨会话例外：定时三事件（session_id 指向新建的定时会话）
    expect(foldsIntoCurrentSession(ev("automation_triggered", { session_id: "auto-1" }), "main-1")).toBe(true);
    expect(foldsIntoCurrentSession(ev("automation_completed", { session_id: "auto-1" }), "main-1")).toBe(true);
    expect(foldsIntoCurrentSession(ev("automation_skipped", {}), "main-1")).toBe(true);
    // 仍须过滤：别的会话的 run 事件不得串进当前时间线（F1 原始目的）
    expect(foldsIntoCurrentSession(ev("assistant_message", { session_id: "other" }), "main-1")).toBe(false);
    expect(foldsIntoCurrentSession(ev("assistant_message", { session_id: "main-1" }), "main-1")).toBe(true);
    // 无标记（旧脚本路径）保持全收（行为兼容）
    expect(foldsIntoCurrentSession(ev("tool_result", { callId: "c1", ok: true, output: "x" }), "main-1")).toBe(true);
  });
});
