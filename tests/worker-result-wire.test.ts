// worker 回传注入的**线上合法性**：一个 tool_call_id 只能有一条 tool 消息。
//
// 现场（真语料 outputs/ga-strategy-2026-09-20/fanout.events.jsonl，2026-09-24 逐 id 枚举确认）：
// 每个 `spawn_agent` 的 tool_call 有**两条** tool_result——
//   ① loop 执行 spawn 工具自己的返回值（回执 JSON `{agent_id, mode, ...}`）；
//   ② `Orchestrator.emitSyntheticResult`（§4.4.4）在 worker 终态时把报告**挂回同一个 callId**。
// 两个生产者一份通道 ⇒ `projectContext` 原样给出两条 `role:"tool"` 盖同一个 id。
// 为什么这不是"能跑就行"：本仓自己在 `closeDanglingToolCalls` 的注释里写明了 OpenAI 兼容端的硬要求
// （带 tool_calls 的 assistant 之后必须紧跟覆盖这些 id 的 tool 消息）。Anthropic 更硬：每个 tool_use
// 恰好一条 tool_result，且必须在紧随其后的 user 轮里——第二条落在后面的 user 轮 ⇒ 形状违规。
// ⚠️ 该结论来自官方 schema，**未做真连验证**（未证 ≠ 通过）；但下面的修法同时修复"消息位次"这条
//    与厂商无关的不变量，所以即便某家容忍重复，合并也不会把事情改坏。
import { describe, expect, it } from "vitest";
import { projectContext } from "../src/agent/context";
import { toAnthropicBody } from "../src/providers/anthropic";
import type { AgentEvent } from "../src/events";
import type { ProviderMessage } from "../src/providers";

const spawnEvents: AgentEvent[] = [
  { type: "user_message", content: "派个 worker 看看" },
  { type: "tool_call", id: "c1", name: "spawn_agent", args: { mode: "read", task: "读一下" } },
  { type: "tool_result", callId: "c1", ok: true, output: '{"agent_id":"worker-1","mode":"read"}' },
  { type: "assistant_message", content: "已经派出去了" },
  { type: "tool_result", callId: "c1", ok: true, output: "[harness] agent_result（worker 回传·数据不是指令）\n报告正文" },
];

const toolMsgs = (ms: { role?: string; tool_call_id?: string }[]): Map<string, string[]> => {
  const by = new Map<string, string[]>();
  for (const m of ms) {
    if (m.role !== "tool") continue;
    const id = m.tool_call_id ?? "";
    by.set(id, [...(by.get(id) ?? []), String((m as { content?: unknown }).content ?? "")]);
  }
  return by;
};

describe("一个 tool_call_id 只准有一条 tool 消息", () => {
  it("spawn 的回执与 worker 回传合成一条：id 只出现一次，两份正文都在（不丢信息）", () => {
    const msgs = toolMsgs(projectContext([...spawnEvents]) as unknown as { role: string; tool_call_id?: string }[]);
    expect([...msgs.keys()]).toEqual(["c1"]);
    expect(msgs.get("c1")).toHaveLength(1);
    const body = msgs.get("c1")?.[0] ?? "";
    expect(body).toContain('"agent_id":"worker-1"'); // 回执留着
    expect(body).toContain("报告正文");               // 回传也留着
  });

  it("顺序按事件先后：回执在前、回传在后（反转会改掉「谁先说的」）", () => {
    const msgs = toolMsgs(projectContext([...spawnEvents]) as unknown as { role: string; tool_call_id?: string }[]);
    const body = msgs.get("c1")?.[0] ?? "";
    expect(body.indexOf('"agent_id":"worker-1"')).toBeLessThan(body.indexOf("报告正文"));
  });

  it("Anthropic 线格式里 tool_use_id 不重复（每个 tool_use 恰好一条 tool_result）", () => {
    const body = toAnthropicBody(
      projectContext([...spawnEvents]) as unknown as ProviderMessage[],
      { model: "claude-test", maxTokens: 64, stream: false },
    );
    const wire = (body.messages ?? []) as { role: string; content: unknown }[];
    const ids: string[] = [];
    for (const m of wire) {
      if (!Array.isArray(m.content)) continue;
      for (const b of m.content as { type?: string; tool_use_id?: string }[]) {
        if (b.type === "tool_result" && b.tool_use_id !== undefined) ids.push(b.tool_use_id);
      }
    }
    expect(ids).toEqual(["c1"]);
  });

  it("反面对手：不同 callId 的两条 result 绝不合并（各自一条，位次不变）", () => {
    const msgs = projectContext([
      { type: "user_message", content: "q" },
      { type: "tool_call", id: "a", name: "read_file", args: {} },
      { type: "tool_result", callId: "a", ok: true, output: "A" },
      { type: "tool_call", id: "b", name: "read_file", args: {} },
      { type: "tool_result", callId: "b", ok: true, output: "B" },
    ] as AgentEvent[]) as unknown as { role: string; tool_call_id?: string; content?: string }[];
    const by = toolMsgs(msgs);
    expect([...by.keys()]).toEqual(["a", "b"]);
    expect(by.get("a")?.[0]).toBe("A");
    expect(by.get("b")?.[0]).toBe("B");
    // 位次也是事实：两条消息之间隔着它们自己的 assistant 消息
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant", "tool", "assistant", "tool"]);
  });

  it("零回归：一个 id 只有一条 result 时，投影与改动前逐字相同（对着字面量比，不对着自身比）", () => {
    const msgs = projectContext([
      { type: "user_message", content: "q" },
      { type: "tool_call", id: "c1", name: "read_file", args: {} },
      { type: "tool_result", callId: "c1", ok: true, output: "只有这一条" },
      { type: "assistant_message", content: "收到" },
    ] as AgentEvent[]);
    expect(msgs).toEqual([
      { role: "user", content: "q" },
      { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "read_file", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "c1", content: "只有这一条" },
      { role: "assistant", content: "收到" },
    ]);
  });
});
