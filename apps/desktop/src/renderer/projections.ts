// 投影纯函数（spec §3.4：UI 状态 = AgentEvent[] 的纯投影）。事件形状唯一事实源 =
// src/events/index.ts 的 AgentEvent 联合；本文件不做第二份类型，不改事件面。
import type { AgentEvent } from "../../../../src/main/ipc-protocol";

export type StreamRow =
  | { kind: "user"; text: string; seq: number }
  | { kind: "assistant"; text: string; seq: number }
  | { kind: "tool"; tool: string; summary: string; seq: number };

const summarize = (args: Record<string, unknown>): string => {
  const first = args.command ?? args.path ?? args.file ?? "";
  return typeof first === "string" && first ? first : JSON.stringify(args).slice(0, 80);
};

export function projectStream(events: readonly AgentEvent[]): StreamRow[] {
  const rows: StreamRow[] = [];
  for (let seq = 0; seq < events.length; seq++) {
    const e = events[seq]!;
    switch (e.type) {
      case "user_message": rows.push({ kind: "user", text: e.content, seq }); break;
      case "assistant_message": rows.push({ kind: "assistant", text: e.content, seq }); break;
      case "assistant_delta": break; // 聚合面：终稿由 assistant_message 成行（v0.1）
      // 勘误落地：ToolCallEvent 的工具名字段是 name（不是计划作者预期的 tool）；行面仍叫 tool。
      case "tool_call": rows.push({ kind: "tool", tool: e.name, summary: summarize(e.args), seq }); break;
      default: break; // 其余事件类型 M2 扩投影时逐型接管
    }
  }
  return rows;
}

export type RunPhase = "idle" | "thinking" | "tool" | "ask";

export function deriveRunPhase(events: readonly AgentEvent[], pendingAsk: boolean): RunPhase {
  if (pendingAsk) return "ask";
  for (let i = events.length - 1; i >= 0; i--) {
    const t = events[i]!.type;
    if (t === "assistant_delta") return "thinking";
    if (t.startsWith("tool")) return "tool";
  }
  return "idle";
}
