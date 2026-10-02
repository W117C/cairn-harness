// 投影纯函数（spec §3.4：UI 状态 = AgentEvent[] 的纯投影）。事件形状唯一事实源 =
// src/events/index.ts 的 AgentEvent 联合；本文件不做第二份类型，不改事件面。
import type { AgentEvent } from "../../../../src/main/ipc-protocol";
// ClarifyQuestion / PlanProposal 只在 src/events 顶层导出（ipc-protocol 未转发这两型），
// type-only 直达事实源，不在此复制第二份形状。
import type { ClarifyQuestion, PlanProposal } from "../../../../src/events";

// v2 行面：ts 为事件真值时间戳（毫秒）的透传——新事件恒有值（core 落盘统一盖戳、live=盘），
// openSession 读旧日志时 undefined ⇒ 行上留空，不造假。
export type StreamRow =
  | { kind: "user"; text: string; ts?: number; seq: number }
  | { kind: "assistant"; text: string; live?: boolean; ts?: number; seq: number } // live=true = delta 流式中尚未被终稿取代的未结桶行
  | { kind: "tool"; tool: string; summary: string; pending?: boolean; ok?: boolean; ts?: number; seq: number }
  | { kind: "error"; text: string; ts?: number; seq: number };

type ToolRow = Extract<StreamRow, { kind: "tool" }>;

const summarize = (args: Record<string, unknown>): string => {
  const first = args.command ?? args.path ?? args.file ?? "";
  return typeof first === "string" && first ? first : JSON.stringify(args).slice(0, 80);
};

export function projectStream(events: readonly AgentEvent[]): StreamRow[] {
  const rows: StreamRow[] = [];
  // delta 分桶（语义钉死）：callId → 累计文本 ＋ 首 delta 的 seq/ts（live 行落在流式开始的位置，
  // 时间取首 delta——行的时间戳口径与其在流里的位置一致）。桶被 assistant_message 终稿取代后即清除。
  const buckets = new Map<string, { text: string; seq: number; ts?: number }>();
  // tool_call id → 行对象：tool_result 按 callId 收口（就地改写 pending/ok，行保持 call 侧 ts）；
  // 无匹配调用的 tool_result 忽略，不造假行。
  const toolRows = new Map<string, ToolRow>();
  for (let seq = 0; seq < events.length; seq++) {
    const e = events[seq]!;
    switch (e.type) {
      case "user_message": rows.push({ kind: "user", text: e.content, ts: e.ts, seq }); break;
      case "assistant_message":
        // 终稿到达：AssistantMessageEvent 无 callId，无法按桶匹配 ⇒ 全部未结桶被终稿行取代
        //（live=false），此后不再输出这些桶的 live 行。
        buckets.clear();
        rows.push({ kind: "assistant", text: e.content, live: false, ts: e.ts, seq });
        break;
      case "assistant_delta": {
        const bucket = buckets.get(e.callId);
        if (bucket === undefined) buckets.set(e.callId, { text: e.text, seq, ts: e.ts });
        else bucket.text += e.text;
        break;
      }
      // 勘误落地：ToolCallEvent 的工具名字段是 name（不是计划作者预期的 tool）；行面仍叫 tool。
      case "tool_call": {
        const row: ToolRow = { kind: "tool", tool: e.name, summary: summarize(e.args), pending: true, ts: e.ts, seq };
        toolRows.set(e.id, row);
        rows.push(row);
        break;
      }
      case "tool_result": {
        const row = toolRows.get(e.callId);
        if (row) { row.pending = false; row.ok = e.ok; }
        break;
      }
      // RunErrorEvent 勘定（src/events/index.ts）：失败原因原文在 message（渲染侧负责转义）。
      case "error": rows.push({ kind: "error", text: e.message, ts: e.ts, seq }); break;
      default: break; // 其余事件类型不成行：clarify/plan 走卡片选择器（pendingClarifyOf/pendingPlanOf）
    }
  }
  // 未结桶 ⇒ live=true 的 assistant 行（text=该桶累计），按首 delta 的 seq 归位后与既有行并序。
  for (const bucket of buckets.values()) {
    rows.push({ kind: "assistant", text: bucket.text, live: true, ts: bucket.ts, seq: bucket.seq });
  }
  return rows.sort((a, b) => a.seq - b.seq);
}

export type RunPhase = "idle" | "thinking" | "tool" | "ask" | "clarify" | "plan";

/**
 * 尾扫判据（v2 语义钉死）：pending 三参任一 true ⇒ 对应门相位，ask 优先级最高；
 * 否则从尾向头扫——未决 tool_call（其后无同 id 的 tool_result）⇒ "tool"；
 * 晚于最后 tool_result 的 assistant_delta ⇒ "thinking"（扫描途中已见 result 的 delta 一律跳过，
 * 那些是「早于最后 tool_result」的 delta，判据不成立）；error 在尾部 ⇒ "idle"（error 行自呈现，不再判忙）。
 * pendingClarify/pendingPlan 带缺省 false：M1 的两参调用式（App.tsx 与 M1 存量用例）保持可编译，
 * 任务书 Interfaces 的四参调用式逐字可用。
 */
export function deriveRunPhase(
  events: readonly AgentEvent[],
  pendingAsk: boolean,
  pendingClarify: boolean = false,
  pendingPlan: boolean = false,
): RunPhase {
  if (pendingAsk) return "ask";
  if (pendingClarify) return "clarify";
  if (pendingPlan) return "plan";
  const seenResults = new Set<string>(); // 尾扫途中已见的 result callId（都晚于当前扫描位）
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.type === "tool_result") { seenResults.add(e.callId); continue; }
    if (e.type === "tool_call" && !seenResults.has(e.id)) return "tool";
    if (e.type === "assistant_delta" && seenResults.size === 0) return "thinking";
    if (e.type === "error") return "idle";
  }
  return "idle";
}

/** 最后一个 clarify_requested，且其后无同 callId 的 tool_result（澄清门的答复按原工具 id 挂回）。
 *  只看最后一个请求：其后已收口 ⇒ null（更早的未决请求不追溯，与门的串行语义一致）。 */
export function pendingClarifyOf(events: readonly AgentEvent[]): { callId: string; questions: ClarifyQuestion[] } | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.type !== "clarify_requested") continue;
    const closed = events.slice(i + 1).some((r) => r.type === "tool_result" && r.callId === e.callId);
    return closed ? null : { callId: e.callId, questions: e.questions };
  }
  return null;
}

/** 最后一个 plan_proposed，且其后无同 callId 的 plan_approved（批准与拒绝都算决议收口）。 */
export function pendingPlanOf(events: readonly AgentEvent[]): { callId: string; plan: PlanProposal } | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.type !== "plan_proposed") continue;
    const closed = events.slice(i + 1).some((r) => r.type === "plan_approved" && r.callId === e.callId);
    return closed ? null : { callId: e.callId, plan: e.plan };
  }
  return null;
}

/** 累加全部 usage 事件；缺字段当 0（UsageEvent 字段必在，防御旧日志），并给消费方事件计数。 */
export function usageAggregate(events: readonly AgentEvent[]): { inputTokens: number; outputTokens: number; usageCount: number } {
  let inputTokens = 0;
  let outputTokens = 0;
  let usageCount = 0;
  for (const e of events) {
    if (e.type !== "usage") continue;
    usageCount += 1;
    inputTokens += typeof e.inputTokens === "number" ? e.inputTokens : 0;
    outputTokens += typeof e.outputTokens === "number" ? e.outputTokens : 0;
  }
  return { inputTokens, outputTokens, usageCount };
}

/** 相对时间（语义钉死分界）：<60s "刚刚"；<60m "N 分钟前"；<24h "N 小时前"；<7d "N 天前"；
 *  否则本地日期 YYYY-MM-DD。未来时间戳（diff 为负）落入第一档显 "刚刚"，不显负数。 */
export function relativeTime(nowMs: number, tsMs: number): string {
  const diff = nowMs - tsMs;
  if (diff < 60_000) return "刚刚";
  if (diff < 60 * 60_000) return `${String(Math.floor(diff / 60_000))} 分钟前`;
  if (diff < 24 * 60 * 60_000) return `${String(Math.floor(diff / 3_600_000))} 小时前`;
  if (diff < 7 * 24 * 60 * 60_000) return `${String(Math.floor(diff / 86_400_000))} 天前`;
  const d = new Date(tsMs);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${String(d.getFullYear())}-${mm}-${dd}`;
}
