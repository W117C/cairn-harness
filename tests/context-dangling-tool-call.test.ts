// 半截会话续用时的孤儿 tool_call（真实现场量出来的）。
// 动因：全机唯一一条真·持久化会话（`~/Library/Application Support/m0-agent-loop/sessions/会话 2026-09-10 03:13.jsonl`）
// 逐字以 `{id:"c3",name:"run_shell",args:{command:"pnpm test"}}` 收尾——那次进程切在工具调用中途，
// 盘上没有它的 tool_result。而 `projectContext` 是"一条 tool_call 推一条 assistant.tool_calls、
// 一条 tool_result 推一条 role:tool"的逐事件投影（投影里 tool_call / tool_result 两个分支；坐标不写死行号——该文件是并发会话热点，写死即漂移磁铁）⇒
// 重开这条会话时送给模型的序列以"要调工具、但永远等不到结果"的 assistant 结尾。
// OpenAI 兼容端的硬要求正是「带 tool_calls 的 assistant 之后必须紧跟覆盖这些 id 的 tool 消息」，
// 不满足是 400 请求体错误——也就是说：**这条真会话现在续不了**。
// 本文件的判据不复制实现：直接按 provider 那条规则量投影结果。
import { describe, expect, it } from "vitest";
import type { AgentEvent } from "../src/events";
import { projectContext, type ContextMessage } from "../src/agent/context";

const user = (content: string): AgentEvent => ({ type: "user_message", content });
const assistant = (content: string): AgentEvent => ({ type: "assistant_message", content });
const call = (id: string, name = "run_shell", args: Record<string, unknown> = { command: "pnpm test" }): AgentEvent =>
  ({ type: "tool_call", id, name, args });
const result = (callId: string, ok = true): AgentEvent =>
  ({ type: "tool_result", callId, ok, output: ok ? "done" : "boom" });

/** provider 侧的合法性：每个带 tool_calls 的 assistant 之后，必须**紧邻**一批 tool 消息把它的 id 全覆盖。 */
function firstIllegal(msgs: ContextMessage[]): string | null {
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i];
    if (!m?.tool_calls || m.tool_calls.length === 0) continue;
    const need = new Set(m.tool_calls.map((c) => c.id));
    let j = i + 1;
    while (j < msgs.length && msgs[j]?.role === "tool") {
      const id = msgs[j]?.tool_call_id;
      if (id !== undefined) need.delete(id);
      j++;
    }
    if (need.size > 0) return `第 ${String(i)} 条 assistant 的 tool_calls 缺结果：${[...need].join(",")}`;
  }
  return null;
}

describe("半截会话的投影必须仍可发送（孤儿 tool_call 要合上）", () => {
  it("真实现场形状（末笔调用没有结果）⇒ 投影里不许留下未答的 tool_calls", () => {
    const msgs = projectContext([
      user("给待办应用加个开关"), assistant("先读文件"), call("c1", "read_file", { path: "src/todo.ts" }), result("c1"),
      assistant("修复完成，跑测试验证。"), call("c3"),
    ]);
    expect(firstIllegal(msgs)).toBeNull();
    const closed = msgs.filter((m) => m.role === "tool" && m.tool_call_id === "c3");
    expect(closed.length).toBe(1);
    expect(closed[0]?.content ?? "").toContain("没有收到结果");
  });

  it("反面对手：完整配对的会话 ⇒ 投影逐字不变（这条修的不许给正常历史加东西）", () => {
    const events = [user("t"), call("c1"), result("c1"), assistant("完成")];
    const before = JSON.stringify(projectContext(events));
    expect(firstIllegal(projectContext(events))).toBeNull();
    // 幂等 + 零注入：同一事件列表再投一次仍逐字相同，且没有多出任何 tool 消息
    expect(JSON.stringify(projectContext(events))).toBe(before);
    expect(projectContext(events).filter((m) => m.role === "tool").length).toBe(1);
  });

  it("中段就断（后面还有别的事件）⇒ 也要合上，不能只补尾巴那一格", () => {
    const msgs = projectContext([user("t"), call("c1"), user("换个说法"), call("c2"), result("c2")]);
    expect(firstIllegal(msgs)).toBeNull();
    expect(msgs.filter((m) => m.role === "tool" && m.tool_call_id === "c1").length).toBe(1);
  });

  it("多条未答调用各补一条（一次中断可能吞掉同轮并行的几笔）", () => {
    const msgs = projectContext([user("t"), call("a"), call("b"), assistant("算了")]);
    expect(firstIllegal(msgs)).toBeNull();
    for (const id of ["a", "b"]) {
      expect(msgs.some((m) => m.role === "tool" && m.tool_call_id === id), id).toBe(true);
    }
  });

  it("worker 子流的调用不进主流上下文 ⇒ 补位也不许为它造 tool 消息", () => {
    const withWorker = [user("t"), { ...call("w1"), agent_id: "agent-1" }];
    const msgs = projectContext(withWorker as AgentEvent[]);
    expect(msgs.some((m) => m.tool_call_id === "w1")).toBe(false);
  });
});
