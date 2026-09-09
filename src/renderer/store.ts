// renderer 事件流状态（M1e）：活事件流订阅 + 会话重放共用一条增量折叠管线。
// 投影不变量（§3.1）：timeline/徽标/token 都是事件投影，无第二事实源；
// 折叠语义与 toTimeline 全量折叠逐字一致（活流 O(1) 摊还 + 重放全量折叠同一实现）。
import type { AgentEvent, ClarifyAnswerMap } from "../events";
import type { AskOutcomePayload, AskPayload } from "../main/ipc-protocol";
import { pendingApprovals, projectDiffCards, projectTokenUsage, type DiffCardProjection, type TokenProjection } from "./projections";

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
  | { type: "clearError" }
  | { type: "clarifySubmitted"; callId: string };

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
    case "clarifySubmitted": {
      // clarify 表单提交状态是 renderer 侧交互态（非事件），只影响表单卡显示
      return state;
    }
  }
}

// ---- 派生投影（面板 100% 事件流订阅投影）----

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
