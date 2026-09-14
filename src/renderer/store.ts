// renderer 事件流状态（M1e）：活事件流订阅 + 会话重放共用一条增量折叠管线。
// 投影不变量（§3.1）：timeline/徽标/token 都是事件投影，无第二事实源；
// 折叠语义与 toTimeline 全量折叠逐字一致（活流 O(1) 摊还 + 重放全量折叠同一实现）。
import type { AgentEvent, ClarifyAnswerMap } from "../events";
import type { AskOutcomePayload, AskPayload } from "../main/ipc-protocol";
import { pendingApprovals, projectDiffCards, projectMemoryWrites, projectTokenUsage, type DiffCardProjection, type MemoryWriteProjection, type TokenProjection } from "./projections";

export type PlanStatuses = Record<string, "approved" | "rejected">;

export type TimelineItem =
  | { kind: "event"; e: AgentEvent }
  | { kind: "stream"; callId: string; text: string }
  | { kind: "ask"; a: AskPayload; resolved?: "approved" | "rejected"; timedOut?: boolean };

export interface AppState {
  events: AgentEvent[];
  asks: AskPayload[];
  timeline: TimelineItem[];
  /** callId → timeline 下标（delta 折叠定位）。 */
  pos: Map<string, number>;
  running: boolean;
  error: string | null;
}

export type AppAction =
  | { type: "reset"; events: AgentEvent[] } // 会话切换/重放：全量折叠
  | { type: "event"; e: AgentEvent }
  | { type: "ask"; a: AskPayload }
  | { type: "askDone"; d: AskOutcomePayload }
  | { type: "running"; running: boolean; error?: string | null }
  | { type: "clearError" };

/** 单事件折叠步：语义与全量 toTimeline 一致（同 callId delta 就地合并，其余追加）。 */
function foldEvent(state: AppState, e: AgentEvent): AppState {
  if (e.type === "assistant_delta") {
    const i = state.pos.get(e.callId);
    if (i !== undefined) {
      const cur = state.timeline[i];
      if (cur?.kind === "stream") {
        const timeline = state.timeline.slice();
        timeline[i] = { kind: "stream", callId: e.callId, text: cur.text + e.text };
        return { ...state, timeline };
      }
    }
    const pos = new Map(state.pos);
    pos.set(e.callId, state.timeline.length);
    return { ...state, timeline: [...state.timeline, { kind: "stream", callId: e.callId, text: e.text }], pos };
  }
  return { ...state, events: [...state.events, e], timeline: [...state.timeline, { kind: "event", e }] };
}

/** 活流事件是否折叠进当前会话时间线（F1 会话归因守卫；审查 S1-5 把边界抽成可测纯函数）。
 *  automation_* 一族按设计是跨会话事件：定时触发即新建会话，事件里的 session_id 指向那个
 *  新会话。按当前会话过滤会把整条吞掉——活流里永不出「⏰ 定时触发」行与完成 report 卡，
 *  而 emitTimeline 已把它写进当前会话 JSONL（重放时又看得到 => live≠replay）；且事件不进
 *  state.events => panelPayload.eventCount 不动 => schedule 面板唯一刷新触发失效。
 *  其余带 session_id 的事件仍按归因过滤（后台 run 不得串台）；无标记保持全收（行为兼容）。 */
const CROSS_SESSION_EVENT_TYPES: ReadonlySet<string> = new Set([
  "automation_triggered",
  "automation_skipped",
  "automation_completed",
]);

export function foldsIntoCurrentSession(e: AgentEvent, currentSessionId: string | null): boolean {
  if (CROSS_SESSION_EVENT_TYPES.has(e.type)) return true;
  const sid = (e as { session_id?: string }).session_id;
  return sid === undefined || sid === currentSessionId;
}

export function reducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "reset": {
      // 全量折叠（重放路径）：与活流增量折叠同一 foldEvent，保证逐字一致
      let s: AppState = { events: [], asks: [], timeline: [], pos: new Map(), running: state.running, error: null };
      for (const e of action.events) s = foldEvent(s, e);
      return s;
    }
    case "event": {
      const s = foldEvent(state, action.e);
      return s;
    }
    case "ask":
      return { ...state, asks: [...state.asks, action.a], timeline: [...state.timeline, { kind: "ask", a: action.a }] };
    case "askDone": {
      const timeline = state.timeline.map((it) =>
        it.kind === "ask" && it.a.askId === action.d.askId
          ? { ...it, resolved: action.d.outcome, timedOut: action.d.reason === "timeout" }
          : it,
      );
      return { ...state, timeline };
    }
    case "running":
      return { ...state, running: action.running, error: action.error !== undefined ? action.error : state.error };
    case "clearError":
      return { ...state, error: null };
  }
}

// ---- 派生投影（面板 100% 事件流订阅投影）----

// H2（审查 G-1）：clarify 已提交投影从事件流派生——clarify_requested 的 callId 出现
// 同 id tool_result（gate 事件与 tool_result 挂同一 id）即已结算。旧实现的 store 交互态
// 是无 dispatch 的死代码，表单提交后永不禁用、可反复提交。
export function clarifySubmittedOf(state: AppState): Set<string> {
  const requested = new Set<string>();
  for (const it of state.timeline) {
    if (it.kind === "event" && it.e.type === "clarify_requested") requested.add(it.e.callId);
  }
  const submitted = new Set<string>();
  if (requested.size === 0) return submitted;
  for (const it of state.timeline) {
    if (it.kind === "event" && it.e.type === "tool_result" && requested.has(it.e.callId)) submitted.add(it.e.callId);
  }
  return submitted;
}

export function planStatusesOf(state: AppState): PlanStatuses {
  const ps: PlanStatuses = {};
  for (const it of state.timeline) {
    if (it.kind === "event" && it.e.type === "plan_approved") {
      ps[it.e.callId] = it.e.approved ? "approved" : "rejected";
    }
  }
  return ps;
}

export function tokenProjectionOf(state: AppState): TokenProjection {
  return projectTokenUsage(state.events);
}

export function diffCardsOf(state: AppState): DiffCardProjection[] {
  return projectDiffCards(state.events);
}

export function pendingApprovalsOf(state: AppState) {
  return pendingApprovals(state.asks);
}

export function memoryWritesOf(state: AppState): MemoryWriteProjection[] {
  return projectMemoryWrites(state.events);
}
