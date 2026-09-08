// 事件流：append-only JSONL，一事件一行。
import { appendFile, readFile } from "node:fs/promises";

export interface UserMessageEvent { type: "user_message"; content: string }
export interface AssistantMessageEvent { type: "assistant_message"; content: string }
export interface ToolCallEvent { type: "tool_call"; id: string; name: string; args: Record<string, unknown> }
export interface ToolResultEvent { type: "tool_result"; callId: string; ok: boolean; output: string }
export interface UsageEvent { type: "usage"; inputTokens: number; outputTokens: number }
export type AgentEvent =
  | UserMessageEvent
  | AssistantMessageEvent
  | ToolCallEvent
  | ToolResultEvent
  | UsageEvent;

const KNOWN_TYPES = new Set([
  "user_message",
  "assistant_message",
  "tool_call",
  "tool_result",
  "usage",
]);

export interface EventLog {
  /** 追加一个事件到日志末尾；只追加，永不改写已有内容。 */
  append(event: AgentEvent): Promise<void>;
}

/** 创建绑定到日志路径的事件流。 */
export function createEventLog(path: string): EventLog {
  return {
    async append(event) {
      if (!event || typeof event.type !== "string" || !KNOWN_TYPES.has(event.type)) {
        throw new Error(`未知事件类型: ${JSON.stringify((event as { type?: unknown })?.type)}`);
      }
      await appendFile(path, JSON.stringify(event) + "\n", "utf8");
    },
  };
}

/** 重放：按写入顺序读回全部事件。 */
export async function replay(path: string): Promise<AgentEvent[]> {
  const raw = await readFile(path, "utf8");
  const events: AgentEvent[] = [];
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue; // 容忍文件末尾空行
    events.push(JSON.parse(t) as AgentEvent);
  }
  return events;
}
