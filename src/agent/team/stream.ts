// 群聊共享流（对表「面板族」里缺的那一面：群会话的**共享流**怎么读）。
//
// 口径：
//  ① 共享流就是群会话自己的事件流——不另存一份（ADR 0005 单一面）；
//  ② 只读**有效**条目（`effectiveEntries` 抹掉被撤回/覆盖的），不把 meta 更新当消息；
//  ③ 每条带**轮的归属**：哪一轮说的、谁说的（worker 事件的 `agent_id` 反查成员，主轮记 "main"）；
//  ④ 长文本截断到 `LIMIT.text`（面板不搬整篇），但**不裁剪事件条数以外的东西**。
import type { AgentEvent } from "../../events";
import { effectiveEntries } from "../../events/projection";

export const DEFAULT_STREAM_LIMIT = 50;
export const STREAM_TEXT_LIMIT = 4000;

export interface StreamItem {
  /** 事件在会话里的序号（1-based，稳定可引用）。 */
  seq: number;
  /** user = 人说的；agent = 模型说的；other = 其它（工具结果等）。 */
  kind: "user" | "agent" | "other";
  /** 谁说的：`main` 或成员 id。 */
  speaker: string;
  /** 这一条落在第几轮（没有轮次标记时为 null）。 */
  round: number | null;
  text: string;
  at: number | null;
}

export interface StreamView {
  items: StreamItem[];
  /** 被截断掉的条数（>0 说明面板只看到最近 N 条）。 */
  dropped: number;
  /** 被文本上限截断的条数。 */
  truncated: number;
}

function speakerOf(event: AgentEvent): string {
  if (event.type === "user_message") return "user";
  const agentId = (event as { agent_id?: unknown }).agent_id;
  if (typeof agentId === "string" && agentId !== "") return agentId;
  return "main";
}

function textOf(event: AgentEvent): string | null {
  const candidate = (event as { content?: unknown; text?: unknown; detail?: unknown });
  for (const value of [candidate.content, candidate.text, candidate.detail]) {
    if (typeof value === "string") return value;
  }
  return null;
}

/**
 * 读共享流：轮的归属从**同一份事件流**里的 `round` 补丁算（行号对 kept 计数），
 * 不额外传参——调用方少一个能传错的东西。
 */
export function projectGroupStream(
  events: readonly AgentEvent[],
  opts: { limit?: number } = {},
): StreamView {
  const limit = opts.limit ?? DEFAULT_STREAM_LIMIT;
  const kept = effectiveEntries(events);
  // 轮标记：扫原始事件，用「到这条为止已经出现过的消息条数」当轮起点（不依赖事件 id）。
  const marks: { round: number; at: number }[] = [];
  let seen = 0;
  for (const raw of events) {
    const patch = (raw as { type?: string; patch?: Record<string, unknown> }).type === "session_meta_update"
      ? (raw as { patch?: Record<string, unknown> }).patch : undefined;
    const roundValue = patch?.["round"];
    if (typeof roundValue === "string" && /^[0-9]+$/.test(roundValue)) {
      marks.push({ round: Number(roundValue), at: seen });
      continue;
    }
    if (textOf(raw) !== null) seen += 1;
  }
  const rows: StreamItem[] = [];
  kept.forEach((entry, index) => {
    const event = entry.event;
    const text = textOf(event);
    if (text === null) return;
    const round = marks.length === 0
      ? null
      : ([...marks].reverse().find((r) => r.at <= index))?.round ?? null;
    rows.push({
      seq: index + 1,
      kind: event.type === "user_message" ? "user" : event.type === "assistant_message" ? "agent" : "other",
      speaker: speakerOf(event),
      round,
      text,
      at: typeof (event as unknown as { at?: unknown }).at === "number" ? (event as unknown as { at: number }).at : null,
    });
  });
  const sliced = limit > 0 && rows.length > limit ? rows.slice(-limit) : rows;
  let truncated = 0;
  const items = sliced.map((item) => {
    if (item.text.length <= STREAM_TEXT_LIMIT) return item;
    truncated += 1;
    return { ...item, text: item.text.slice(0, STREAM_TEXT_LIMIT) + "…" };
  });
  return { items, dropped: rows.length - sliced.length, truncated };
}
