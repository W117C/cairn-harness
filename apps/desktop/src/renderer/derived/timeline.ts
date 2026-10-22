// 派生层·时间线面（纯投影）：事件流 → 步骤序列 / 轮次时间线。
// I3 契约：只吃 AgentEvent[]，只吐值；不读时钟、不取随机、不做 IO、不留模块级可变态。
import type { AgentEvent } from "../../../../../src/main/ipc-protocol";
import { summarize } from "./stream";
import { isWorkerSubflowEvent } from "./session";
import type { StreamRow } from "./stream";

/** 步骤时间线（P3-2 检查器「时间线」Tab 的数据面）——事件日志 → 步骤序列。
 *  「只取在场字段，不编时间」：at 直接取事件 ts（缺席即不给），label 是在场文本的截断。
 *  落步口径：user_message → user 步；tool_call → tool 步（name + 摘要）；
 *  assistant 内容在真实 provider 是 delta-only（aggregate 终稿是 mock/demo 通道的产品）⇒
 *  **每个 callId 的首个 delta** 落一个 assistant 步（后续 delta 并入——与「回放到此步」的
 *  段落开头语义一致）；assistant_message 终稿是独立一笔事件，照落（demo 通道会同时有两者，
 *  这里如实两步——都是真实事件，不合并）。usage → 用量步（「模型调用说完了」的精确落定点）。
 *  worker 子流不进（与主流行同一过滤）；error 在对话行自呈现，时间线不为它立步。 */
export interface TimelineItem {
  /** 事件全序的 1-based 行号（assistant 行 eventId / DOM data-event-id 同口径）。 */
  eventId: number;
  kind: "user" | "tool" | "assistant" | "usage";
  label: string;
  /** 事件真值时间戳（毫秒）；缺席 = 旧日志没戳，不编。 */
  at?: number;
}

const TIMELINE_LABEL_MAX = 60;
const timelineLabel = (text: string): string => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= TIMELINE_LABEL_MAX ? flat : flat.slice(0, TIMELINE_LABEL_MAX) + "…";
};
const fmtTokens = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
};

export function timelineItems(events: readonly AgentEvent[]): TimelineItem[] {
  const out: TimelineItem[] = [];
  const seenDeltaCalls = new Set<string>(); // 已落步的 callId（其后续 delta 并入首步）
  for (let seq = 0; seq < events.length; seq++) {
    const e = events[seq]!;
    if (isWorkerSubflowEvent(e)) continue;
    const eventId = seq + 1;
    switch (e.type) {
      case "user_message":
        out.push({ eventId, kind: "user", label: timelineLabel(e.content), ...(e.ts !== undefined ? { at: e.ts } : {}) });
        break;
      case "assistant_delta":
        if (seenDeltaCalls.has(e.callId)) break;
        seenDeltaCalls.add(e.callId);
        out.push({ eventId, kind: "assistant", label: timelineLabel(e.text), ...(e.ts !== undefined ? { at: e.ts } : {}) });
        break;
      case "assistant_message":
        out.push({ eventId, kind: "assistant", label: timelineLabel(e.content), ...(e.ts !== undefined ? { at: e.ts } : {}) });
        break;
      case "tool_call":
        out.push({ eventId, kind: "tool", label: timelineLabel(`${e.name} ${summarize(e.args)}`), ...(e.ts !== undefined ? { at: e.ts } : {}) });
        break;
      case "usage":
        out.push({ eventId, kind: "usage", label: `输入 ${fmtTokens(e.inputTokens)} · 输出 ${fmtTokens(e.outputTokens)}`, ...(e.ts !== undefined ? { at: e.ts } : {}) });
        break;
      default:
        break; // clarify/plan/error 等：对话面有专卡/专行，时间线不为它们立步
    }
  }
  return out;
}

/** v2.12 轮次时间线（rail）的投影：每条 = 一轮（user 发问 + 模型回复），供 rail 线段与悬停
 *  信息面板取料。回复摘要 = 该轮第一条 assistant 行截断；无模型行回退 null（面板标注「结果：」缺）。 */
export function roundTimeline(
  rows: readonly StreamRow[],
): Array<{ round: number; userText: string; replySummary: string | null; ts?: number }> {
  const out: Array<{ round: number; userText: string; replySummary: string | null; ts?: number }> = [];
  let current: (typeof out)[number] | null = null;
  for (const r of rows) {
    if (r.kind === "user") {
      if (current !== null) out.push(current);
      current = { round: r.round, userText: r.text, replySummary: null, ...(r.ts !== undefined ? { ts: r.ts } : {}) };
    } else if (r.kind === "assistant" && current !== null && current.replySummary === null) {
      current.replySummary = r.text.slice(0, 120);
    }
  }
  if (current !== null) out.push(current);
  return out;
}
