import type { AgentEvent } from "../../../../../src/main/ipc-protocol";
import { isMainSessionTerminalEvent, isWorkerSubflowEvent } from "./session";

/** 等待占位属于本次 run，而非上一轮历史；起点由发送入口/主进程给出，投影不读时钟。 */
export function waitingForModel(input: {
  events: readonly AgentEvent[];
  running: boolean;
  startedAt?: number;
  blocked?: boolean;
}): boolean {
  if (!input.running || input.blocked) return false;
  let from = 0;
  if (input.startedAt !== undefined) {
    const startedAt = input.startedAt;
    from = input.events.findIndex((e) => !isWorkerSubflowEvent(e) && e.ts !== undefined && e.ts >= startedAt);
    // run 已起跑、IPC 尚未送回首个事件：不能用上一轮回答/终态关闭这次等待。
    if (from === -1) return true;
  } else {
    for (let i = input.events.length - 1; i >= 0; i--) {
      const e = input.events[i]!;
      if (!isWorkerSubflowEvent(e) && e.type === "user_message" && e.origin?.kind !== "steering") { from = i; break; }
    }
  }
  let waiting = true;
  const pendingTools = new Set<string>();
  for (let i = from; i < input.events.length; i++) {
    const e = input.events[i]!;
    if (isWorkerSubflowEvent(e)) continue;
    if (isMainSessionTerminalEvent(e) || e.type === "error") return false;
    switch (e.type) {
      case "assistant_delta":
      case "thinking_delta":
      case "assistant_message": waiting = false; break;
      case "tool_call": pendingTools.add(e.id); waiting = false; break;
      case "tool_result":
        if (pendingTools.delete(e.callId) && pendingTools.size === 0) waiting = true;
        break;
      case "clarify_requested":
      case "plan_proposed": waiting = false; break;
      // usage 结束当前调用；工具收口后再到的 usage 不应吃掉下一次模型等待。
      default: break;
    }
  }
  return waiting && pendingTools.size === 0;
}
