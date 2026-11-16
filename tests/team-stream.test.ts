// 群聊共享流判卷：只读有效条目、带轮与说话人、截断如实。
import { describe, expect, it } from "vitest";
import type { AgentEvent } from "../src/events";
import { projectGroupStream } from "../src/agent/team/stream";

const ev = (o: Record<string, unknown>) => o as unknown as AgentEvent;

describe("群聊共享流", () => {
  it("user / agent / 其它三类分开，说话人取 agent_id，缺省 main", () => {
    const out = projectGroupStream([
      ev({ type: "user_message", content: "开始" }),
      ev({ type: "assistant_message", content: "好", agent_id: "member:m1" }),
      ev({ type: "tool_result", detail: "ok" }),
    ]);
    expect(out.items.map((i) => [i.kind, i.speaker])).toEqual([
      ["user", "user"],
      ["agent", "member:m1"],
      ["other", "main"],
    ]);
    expect(out.items.map((i) => i.seq)).toEqual([1, 2, 3]);
  });

  it("meta 更新不算消息（共享流里没有补丁噪音）", () => {
    const out = projectGroupStream([
      ev({ type: "user_message", content: "hi" }),
      ev({ type: "session_meta_update", patch: { round: "1" } }),
    ]);
    expect(out.items).toHaveLength(1);
    expect(out.items[0]!.text).toBe("hi");
  });

  it("按 limit 只留最近 N 条，dropped 如实", () => {
    const many = Array.from({ length: 5 }, (_, i) => ev({ type: "user_message", content: `m${i}` }));
    const out = projectGroupStream(many, { limit: 2 });
    expect(out.items.map((i) => i.text)).toEqual(["m3", "m4"]);
    expect(out.dropped).toBe(3);
  });

  it("带轮：轮标记来自同一份事件流里的 round 补丁", () => {
    const out = projectGroupStream([
      ev({ type: "session_meta_update", patch: { round: "1" } }),
      ev({ type: "user_message", content: "第一轮" }),
      ev({ type: "assistant_message", content: "答一" }),
      ev({ type: "session_meta_update", patch: { round: "2" } }),
      ev({ type: "user_message", content: "第二轮" }),
      ev({ type: "assistant_message", content: "答二" }),
    ]);
    expect(out.items.map((i) => i.round)).toEqual([1, 1, 2, 2]);
  });

  it("超长文本截断并计数（不静默）", () => {
    const out = projectGroupStream([ev({ type: "assistant_message", content: "x".repeat(4100) })]);
    expect(out.truncated).toBe(1);
    expect(out.items[0]!.text.endsWith("…")).toBe(true);
  });
});
