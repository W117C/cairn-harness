import { describe, expect, it } from "vitest";
import { deriveRunPhase, formatRevertNotice, pendingClarifyOf, pendingPlanOf, projectStream, relativeTime, roundTimeline, turnChanges, usageAggregate } from "../src/renderer/projections";
import type { AgentEvent } from "../../../src/main/ipc-protocol";

const ev = (partial: Record<string, unknown>) => partial as unknown as AgentEvent;

describe("projectStream", () => {
  it("user_message 与 assistant_message 成行，tool_call 成行", () => {
    // 勘误：ToolCallEvent 真身（src/events/index.ts）字段是 name（＋id），不是计划作者预期的 tool。
    const rows = projectStream([
      ev({ type: "user_message", content: "跑 bench" }),
      ev({ type: "tool_call", id: "t1", name: "run_shell", args: { command: "pnpm bench" } }),
      ev({ type: "assistant_message", content: "全绿" }),
    ]);
    expect(rows.map((r) => r.kind)).toEqual(["user", "tool", "assistant"]);
    expect(rows[1]!.kind === "tool" && rows[1]!.tool).toBe("run_shell");
    expect(rows[2]!.kind === "assistant" && rows[2]!.text).toBe("全绿");
    // v2 行形状补钉（任务书 Step 1）：未收口的 tool 行带 pending；M1 的行数/顺序/文本断言原样保留。
    expect(rows[1]).toMatchObject({ pending: true });
  });
  it("assistant_delta 聚合进当前 assistant 行（不逐 delta 成行）", () => {
    const rows = projectStream([
      ev({ type: "assistant_delta", callId: "c1", text: "你" }),
      ev({ type: "assistant_delta", callId: "c1", text: "好" }),
      ev({ type: "assistant_message", content: "你好" }),
    ]);
    expect(rows.filter((r) => r.kind === "assistant")).toHaveLength(1);
  });
});

describe("deriveRunPhase", () => {
  it("空流=idle；delta 流=thinking；tool 在前=tool；待批=ask", () => {
    expect(deriveRunPhase([], false)).toBe("idle");
    expect(deriveRunPhase([ev({ type: "assistant_delta", callId: "c", text: "x" })], false)).toBe("thinking");
    expect(deriveRunPhase([ev({ type: "tool_call", id: "t", name: "run_shell", args: {} })], false)).toBe("tool");
    expect(deriveRunPhase([], true)).toBe("ask");
  });
});

describe("投影 v2", () => {
  it("delta 流式：未结桶输出 live assistant 行，assistant_message 终稿取代", () => {
    const rows = projectStream([
      ev({ type: "assistant_delta", callId: "c1", text: "你" }),
      ev({ type: "assistant_delta", callId: "c1", text: "好" }),
    ]);
    expect(rows).toEqual([expect.objectContaining({ kind: "assistant", text: "你好", live: true })]);
    const done = projectStream([
      ev({ type: "assistant_delta", callId: "c1", text: "你" }),
      ev({ type: "assistant_message", content: "你好" }),
    ]);
    expect(done).toEqual([expect.objectContaining({ kind: "assistant", text: "你好", live: false })]);
  });
  it("思考正文挂到终稿行上再清（否则只在流式那几秒可见，等于没展示）", () => {
    // 变异锚点 desktop-thinking-not-carried-onto-final 打的就是这一格：
    // 把 carriedThinking 换成 undefined 功能照旧、信息没了，没有任何别的门会红。
    const rows = projectStream([
      ev({ type: "thinking_delta", callId: "c1", text: "让我想想" }),
      ev({ type: "assistant_delta", callId: "c1", text: "答案" }),
      ev({ type: "assistant_message", content: "答案" }),
    ]);
    expect(rows).toEqual([
      expect.objectContaining({ kind: "assistant", text: "答案", live: false, thinking: "让我想想" }),
    ]);
    // 反向格：没有思考事件时终稿行**不带** thinking 键（不许留一个空串字段）
    const plain = projectStream([
      ev({ type: "assistant_delta", callId: "c2", text: "答" }),
      ev({ type: "assistant_message", content: "答" }),
    ]);
    expect(plain[0]).not.toHaveProperty("thinking");
  });
  it("工具待定：tool_call 未决 pending，tool_result 按 callId 收口 ok", () => {
    const rows = projectStream([
      ev({ type: "tool_call", id: "t1", name: "run_shell", args: { command: "pnpm bench" } }),
    ]);
    expect(rows[0]).toMatchObject({ kind: "tool", tool: "run_shell", pending: true });
    const closed = projectStream([
      ev({ type: "tool_call", id: "t1", name: "run_shell", args: {} }),
      ev({ type: "tool_result", callId: "t1", ok: true, output: "done" }),
    ]);
    expect(closed[0]).toMatchObject({ kind: "tool", pending: false, ok: true });
  });
  it("时间戳：事件 ts 透传到行；无 ts 留空", () => {
    const rows = projectStream([ev({ type: "user_message", content: "hi", ts: 1727848800000 })]);
    expect(rows[0]).toMatchObject({ ts: 1727848800000 });
    expect(projectStream([ev({ type: "user_message", content: "hi" })])[0]!.ts).toBeUndefined();
  });
  it("live ts 消费面：混流各行 ts 独立透传，不互相污染（M2 终审 I-2 收口）", () => {
    // 同一 projectStream 输入混有带/不带 ts 的事件：带戳行透传自身 ts，无戳行保持 undefined
    // ——行与行互不污染。消费面（Stream 的 RowTime）对 undefined 不渲染时间戳列，属组件行为
    // 守卫（已有），此处钉纯函数透传面：App 拿到的行数据足以支撑「旧日志无时间戳列」。
    const rows = projectStream([
      ev({ type: "user_message", content: "带戳", ts: 1727848800000 }),
      ev({ type: "assistant_message", content: "无戳" }),
      ev({ type: "tool_call", id: "t1", name: "read_file", args: {}, ts: 1727848801000 }),
      ev({ type: "tool_result", callId: "t1", ok: true, output: "", ts: 1727848802000 }),
    ]);
    expect(rows.map((r) => r.ts)).toEqual([1727848800000, undefined, 1727848801000]);
  });
  it("pendingClarify/Plan：请求未决给出，tool_result/plan_approved 收口", () => {
    const c = { type: "clarify_requested", callId: "q1", questions: [{ question: "选哪个？" }] };
    expect(pendingClarifyOf([ev(c)])!.callId).toBe("q1");
    expect(pendingClarifyOf([ev(c), ev({ type: "tool_result", callId: "q1", ok: true, output: "" })])).toBeNull();
    const p = { type: "plan_proposed", callId: "p1", plan: { goal: "g", files: [] } };
    expect(pendingPlanOf([ev(p)])!.plan.goal).toBe("g");
    expect(pendingPlanOf([ev(p), ev({ type: "plan_approved", callId: "p1", approved: true })])).toBeNull();
  });
  it("phase 修正：tool_result 收尾不再是 tool；delta 晚于 result 是 thinking", () => {
    expect(deriveRunPhase([ev({ type: "tool_call", id: "t", name: "x", args: {} }), ev({ type: "tool_result", callId: "t", ok: true, output: "" })], false, false, false)).toBe("idle");
    expect(deriveRunPhase([ev({ type: "tool_result", callId: "t", ok: true, output: "" }), ev({ type: "assistant_delta", callId: "c", text: "x" })], false, false, false)).toBe("thinking");
    expect(deriveRunPhase([], false, true, false)).toBe("clarify");
    expect(deriveRunPhase([], true, true, false)).toBe("ask");
  });
  it("usageAggregate 与 relativeTime", () => {
    expect(usageAggregate([ev({ type: "usage", inputTokens: 10, outputTokens: 5 }), ev({ type: "usage", inputTokens: 1, outputTokens: 2 })]))
      .toEqual({ inputTokens: 11, outputTokens: 7, usageCount: 2, cacheReadTokens: 0, lastInputTokens: 1 });
    // 缓存读：缺席不冒充 0（没量到 ≠ 量到了 0）；lastInput = 末轮输入（算上下文水位用，不是累加值）
    expect(usageAggregate([
      ev({ type: "usage", inputTokens: 100, outputTokens: 5, cacheReadInputTokens: 90 }),
      ev({ type: "usage", inputTokens: 200, outputTokens: 5 }),
    ])).toEqual({ inputTokens: 300, outputTokens: 10, usageCount: 2, cacheReadTokens: 90, lastInputTokens: 200 });
    expect(usageAggregate([ev({ type: "usage" })]).lastInputTokens).toBe(0);
    expect(relativeTime(1_000_000, 1_000_000 - 30_000)).toBe("刚刚");
    expect(relativeTime(1_000_000, 1_000_000 - 5 * 60_000)).toBe("5 分钟前");
  });
});

describe("投影 v2 补钉（钉死条款里任务书用例未直接覆盖的面）", () => {
  it("error 事件成行：RunErrorEvent 勘定形状（失败原因在 message 字段）", () => {
    const rows = projectStream([ev({ type: "error", message: "额度耗尽", ts: 1727848800000 })]);
    expect(rows).toEqual([{ kind: "error", text: "额度耗尽", ts: 1727848800000, seq: 0 }]);
  });
  it("孤儿 tool_result（无匹配 callId）忽略不造假行；tool 行 ts 保持 call 侧戳", () => {
    const rows = projectStream([
      ev({ type: "tool_result", callId: "ghost", ok: true, output: "x" }),
      ev({ type: "tool_call", id: "t1", name: "read_file", args: { path: "a.ts" }, ts: 111 }),
      ev({ type: "tool_result", callId: "t1", ok: false, output: "nope", ts: 222 }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "tool", tool: "read_file", pending: false, ok: false, ts: 111 });
  });
  it("live 行归位到首 delta 的 seq；终稿到达后 live 行消失、终稿行按自身 seq 成行", () => {
    const rows = projectStream([
      ev({ type: "assistant_delta", callId: "c1", text: "a" }),
      ev({ type: "tool_call", id: "t1", name: "run_shell", args: {} }),
      ev({ type: "assistant_delta", callId: "c1", text: "b" }),
    ]);
    expect(rows.map((r) => r.seq)).toEqual([0, 1]);
    expect(rows[0]).toMatchObject({ kind: "assistant", text: "ab", live: true });
    expect(rows[1]).toMatchObject({ kind: "tool", pending: true });
    const done = projectStream([
      ev({ type: "assistant_delta", callId: "c1", text: "a" }),
      ev({ type: "tool_call", id: "t1", name: "run_shell", args: {} }),
      ev({ type: "assistant_message", content: "ab" }),
    ]);
    expect(done.map((r) => r.kind)).toEqual(["tool", "assistant"]);
    expect(done[1]).toMatchObject({ text: "ab", live: false });
  });
  it("phase 补钉：error 在尾=idle；delta 早于最后 tool_result 不判 thinking；pendingPlan", () => {
    expect(deriveRunPhase([ev({ type: "tool_call", id: "t", name: "x", args: {} }), ev({ type: "error", message: "e" })], false, false, false)).toBe("idle");
    expect(deriveRunPhase([ev({ type: "assistant_delta", callId: "c", text: "x" }), ev({ type: "tool_call", id: "t", name: "x", args: {} }), ev({ type: "tool_result", callId: "t", ok: true, output: "" })], false, false, false)).toBe("idle");
    expect(deriveRunPhase([ev({ type: "plan_proposed", callId: "p", plan: { goal: "g", files: [] } })], false, false, true)).toBe("plan");
  });
  it("relativeTime 小时/天/本地日期分界；usage 缺字段当 0（防御旧日志）", () => {
    const min = 60_000;
    const hour = 60 * min;
    const day = 24 * hour;
    expect(relativeTime(1_000_000, 1_000_000 - 2 * hour)).toBe("2 小时前");
    expect(relativeTime(1_000_000, 1_000_000 - 3 * day)).toBe("3 天前");
    const d = new Date(2020, 0, 2, 3, 4, 5); // 本地时区构造 ⇒ 期望串与时区无关
    expect(relativeTime(d.getTime() + 8 * day, d.getTime())).toBe("2020-01-02");
    expect(usageAggregate([ev({ type: "usage" })])).toEqual({ inputTokens: 0, outputTokens: 0, usageCount: 1, cacheReadTokens: 0, lastInputTokens: 0 });
  });
});

describe("M3-4 agent 子流过滤（任务书裁定：带 agent_id 不进主流/相位，agent_spawned 保留为父流行）", () => {
  const workerCall = { type: "tool_call", id: "w1", name: "run_shell", args: { command: "ls" }, agent_id: "a1" };
  const workerResult = { type: "tool_result", callId: "w1", ok: true, output: "", agent_id: "a1" };

  it("主流无 worker 子流行：带 agent_id 的 tool_call/tool_result 不成行；agent_message/status/result 不成行", () => {
    const rows = projectStream([
      ev({ type: "user_message", content: "派活" }),
      ev(workerCall),
      ev(workerResult),
      ev({ type: "agent_message", agent_id: "a1", kind: "progress", text: "进行中" }),
      ev({ type: "agent_status", agent_id: "a1", status: "running" }),
      ev({ type: "agent_result", agent_id: "a1", status: "done", summary: "完", artifacts: {}, usage: { inputTokens: 1, outputTokens: 1 }, tool_stats: {} }),
      ev({ type: "assistant_message", content: "完成" }),
    ]);
    expect(rows.map((r) => r.kind)).toEqual(["user", "assistant"]);
  });

  it("agent_spawned 保留为父流 tool 行（tool=spawn_agent，summary=task 截断 80）", () => {
    const rows = projectStream([
      ev({ type: "user_message", content: "派活" }),
      ev({ type: "agent_spawned", agent_id: "a1", parent_event_id: 1, mode: "read", task: "查".repeat(100) }),
    ]);
    expect(rows.map((r) => r.kind)).toEqual(["user", "tool"]);
    expect(rows[1]).toMatchObject({ kind: "tool", tool: "spawn_agent", summary: "查".repeat(80) });
  });

  it("相位不被 worker 收口：未决 worker tool_call 不亮 tool；worker result 不吃父 delta 的 thinking 判据；父 tool 不被 worker result 收口", () => {
    expect(deriveRunPhase([ev(workerCall)], false, false, false)).toBe("idle");
    // worker 事件晚于父 delta：worker result 先把 seenResults 占上 ⇒ 无过滤时 thinking 判据被吃掉
    expect(deriveRunPhase([ev({ type: "assistant_delta", callId: "c", text: "x" }), ev(workerCall), ev(workerResult)], false, false, false)).toBe("thinking");
    expect(deriveRunPhase([ev(workerCall), ev(workerResult), ev({ type: "assistant_delta", callId: "c", text: "x" })], false, false, false)).toBe("thinking");
    expect(deriveRunPhase([ev({ type: "tool_call", id: "t", name: "x", args: {} }), ev(workerResult)], false, false, false)).toBe("tool");
  });
});

describe("v2.16 桌面接线投影（赞/踩与文件回滚的行锚）", () => {
  const workerCall = { type: "tool_call", id: "w1", name: "run_shell", args: { command: "ls" }, agent_id: "a1" };

  it("user 行带 1-based 轮号（主会话 user_message 计数）——与 core planTurnRevert 的轮口径同一份；worker 事件不成轮", () => {
    const rows = projectStream([
      ev({ type: "user_message", content: "第一轮" }),
      ev(workerCall),
      ev({ type: "user_message", content: "第二轮" }),
      ev({ type: "user_message", content: "第三轮" }),
    ]);
    expect(rows.filter((r) => r.kind === "user").map((r) => (r.kind === "user" ? r.round : -1))).toEqual([1, 2, 3]);
  });

  it("assistant 行带 eventId（事件在会话 JSONL 的 1-based 行号，赞/踩的锚）；live 桶行同口径（锚首 delta 的行号）", () => {
    // live 桶行：无终稿时未结桶成 live 行，锚在首 delta 的事件行号
    const live = projectStream([
      ev({ type: "user_message", content: "问" }),               // seq 0
      ev({ type: "assistant_delta", callId: "c1", text: "答" }), // seq 1 → live 行 eventId 2
    ]);
    expect(live.filter((r) => r.kind === "assistant").map((r) => (r.kind === "assistant" ? r.eventId : 0))).toEqual([2]);
    // 终稿行：终稿到达清空全部未结桶（既有语义），终稿行锚自身的事件行号
    const final = projectStream([
      ev({ type: "user_message", content: "问" }),      // seq 0
      ev({ type: "assistant_message", content: "答" }), // seq 1 → 终稿行 eventId 2
    ]);
    expect(final.filter((r) => r.kind === "assistant").map((r) => (r.kind === "assistant" ? r.eventId : 0))).toEqual([2]);
  });

  it("formatRevertNotice：还原/删除计数恒在；manual/failed 有货才显并点名路径（看不见的降级等于没降级）", () => {
    expect(formatRevertNotice(2, { restored: ["a.ts", "b.ts"], deleted: ["new.txt"], manual: [], failed: [] }))
      .toBe("第 2 轮文件回滚：还原 2 个、删除 1 个");
    expect(formatRevertNotice(1, {
      restored: [],
      deleted: [],
      manual: [{ path: "late.ts", why: "本轮之后又被改过" }],
      failed: [{ path: "../x", error: "越界" }],
    })).toBe("第 1 轮文件回滚：还原 0 个、删除 0 个；需手动处理 1 个（late.ts）；失败 1 个（../x）");
  });

  it("roundTimeline（v2.12 rail 投影）：每轮一条（用户话 + 回复摘要首条 120 截断）；无模型行摘要为 null；单轮/空流为空", () => {
    const rows = projectStream([
      ev({ type: "user_message", content: "第一问" }),
      ev({ type: "assistant_message", content: "第一答".repeat(60) }),
      ev({ type: "user_message", content: "第二问" }),
    ]);
    const tl = roundTimeline(rows);
    expect(tl).toHaveLength(2);
    expect(tl[0]).toMatchObject({ round: 1, userText: "第一问" });
    expect(tl[0]!.replySummary).toBe("第一答".repeat(60).slice(0, 120));
    expect(tl[1]).toMatchObject({ round: 2, userText: "第二问", replySummary: null });
    expect(roundTimeline([])).toEqual([]);
    expect(roundTimeline(projectStream([ev({ type: "user_message", content: "单轮" })]))).toHaveLength(1);
  });

  it("turnChanges（C-32 投影）：写工具按轮聚合；change 缺席标 unknown；同文件去重；非写工具与 worker 写不计", () => {
    const events = [
      ev({ type: "user_message", content: "改一下" }),
      ev({ type: "tool_call", id: "c1", name: "edit_file", args: { path: "a.ts" } }),
      ev({ type: "tool_result", callId: "c1", ok: true, output: "", change: "modified", snapshotId: ".agent/snapshots/1--c1/a.ts" }),
      ev({ type: "tool_call", id: "c2", name: "write_file", args: { path: "a.ts" } }), // 同文件第二笔：去重
      ev({ type: "tool_result", callId: "c2", ok: true, output: "", change: "modified" }),
      ev({ type: "tool_call", id: "c3", name: "write_file", args: { path: "new.ts" } }),
      ev({ type: "tool_result", callId: "c3", ok: true, output: "" }), // change 缺席 ⇒ unknown
      ev({ type: "tool_call", id: "c4", name: "run_shell", args: { command: "ls" } }), // 非写工具
      ev({ type: "tool_result", callId: "c4", ok: true, output: "" }),
      ev({ type: "tool_call", id: "w1", name: "write_file", args: { path: "w.ts" }, agent_id: "ag-1" }), // worker 写不计
      ev({ type: "tool_result", callId: "w1", ok: true, output: "", change: "created", agent_id: "ag-1" }),
      ev({ type: "user_message", content: "再改" }),
      ev({ type: "user_message", content: "没写盘的一轮" }), // 空轮不落组
    ];
    const groups = turnChanges(events as unknown as AgentEvent[]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.round).toBe(1);
    expect(groups[0]!.files).toEqual([
      { path: "a.ts", change: "modified", snapshotId: ".agent/snapshots/1--c1/a.ts" },
      { path: "new.ts", change: "unknown" },
    ]);
    expect(turnChanges([])).toEqual([]);
  });
});
