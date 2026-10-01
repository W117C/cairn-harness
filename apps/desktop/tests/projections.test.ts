import { describe, expect, it } from "vitest";
import { deriveRunPhase, projectStream } from "../src/renderer/projections";
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
