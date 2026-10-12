// C-34 GoalPanel（v2，输入卡上方）：长任务目标面板——编辑 / 暂停·恢复 / 清除（setGoal 全语义，
// v2.16 的 pause/resume 已接）。目标态从主会话事件投影（goal_set/goal_paused/goal_resumed/goal_stopped），
// 与 core projectGoal 同一转移语义的轻量版（renderer 不 import core 运行时）。
import { useEffect, useRef, useState } from "react";
import type { AgentEvent } from "../../../../../src/main/ipc-protocol";

export interface GoalPanelView {
  objective: string;
  paused: boolean;
  stopped: boolean;
  /** goal_set 事件的 ts（时长 = now − ts，分钟粗粒度）。 */
  sinceTs?: number;
}

/** 轻投影：goal_set 定目标；paused/resumed 翻挂起位；stopped 终态。worker 事件不影响。 */
export function projectGoalPanel(events: readonly AgentEvent[]): GoalPanelView | null {
  let view: GoalPanelView | null = null;
  for (const e of events) {
    const cur: GoalPanelView | null = view;
    if (e.type === "goal_set") {
      const ts = (e as { ts?: number }).ts;
      const next: GoalPanelView = { objective: e.objective, paused: false, stopped: false, sinceTs: ts };
      view = next;
    } else if (e.type === "goal_paused" && cur !== null) {
      const next: GoalPanelView = { ...cur, paused: true };
      view = next;
    } else if (e.type === "goal_resumed" && cur !== null) {
      const next: GoalPanelView = { ...cur, paused: false };
      view = next;
    } else if (e.type === "goal_stopped" && cur !== null) {
      const next: GoalPanelView = { ...cur, stopped: true, paused: false };
      view = next;
    }
  }
  return view;
}

export function GoalPanel(props: {
  view: GoalPanelView;
  activeId: string;
  onError: (message: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(props.view.objective);
  const [busy, setBusy] = useState(false);
  const editRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (editing) editRef.current?.focus();
  }, [editing]);

  const call = (req: Record<string, unknown>, okMsg: string) => {
    setBusy(true);
    void window.agent.setGoal({ sessionId: props.activeId, ...req }).then((r) => {
      setBusy(false);
      if (!r.ok) props.onError(r.error ?? "目标操作失败");
      else props.onError(okMsg);
    }).catch((err: unknown) => {
      setBusy(false);
      props.onError(`目标操作失败：${err instanceof Error ? err.message : String(err)}`);
    });
  };

  const saveEdit = () => {
    const text = draft.trim();
    if (text === "" || text === props.view.objective) { setEditing(false); return; }
    call({ objective: text, maxTurns: 30 }, "目标已改设");
    setEditing(false);
  };

  const minutes = props.view.sinceTs !== undefined
    ? Math.max(0, Math.round((Date.now() - props.view.sinceTs) / 60_000))
    : null;

  return (
    <div className={"goal-panel show" + (props.view.paused ? " paused" : "")}>
      <span className="g-ico" aria-hidden="true">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="7" cy="7" r="5"/><circle cx="7" cy="7" r="1.8" fill="currentColor" stroke="none"/></svg>
      </span>
      <span className="g-label">{props.view.paused ? "已暂停" : "目标"}</span>
      {minutes !== null && <span className="g-time num">{minutes < 60 ? `${String(minutes)} 分` : `${String(Math.floor(minutes / 60))} 时 ${String(minutes % 60)} 分`}</span>}
      {editing ? (
        <input
          ref={editRef}
          className="g-edit"
          value={draft}
          aria-label="编辑目标"
          disabled={busy}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={saveEdit}
          onKeyDown={(e) => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") setEditing(false); }}
        />
      ) : (
        <span className="g-text" title={props.view.objective}>{props.view.objective}</span>
      )}
      {!props.view.stopped && !props.view.paused && (
        <button className="g-btn" title="编辑目标" aria-label="编辑目标" disabled={busy} onClick={() => { setDraft(props.view.objective); setEditing(true); }}>
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="m9.3 2.9 1.8 1.8-6 6-2.3.5.5-2.3z"/></svg>
        </button>
      )}
      {!props.view.stopped && (
        <button
          className="g-btn"
          title={props.view.paused ? "恢复目标（resume）" : "暂停目标（pause）"}
          aria-label={props.view.paused ? "恢复目标" : "暂停目标"}
          disabled={busy}
          onClick={() => props.view.paused ? call({ resume: true }, "目标已恢复") : call({ pause: true }, "目标已暂停（不再自动续跑）")}
        >
          {props.view.paused
            ? <svg width="12" height="12" viewBox="0 0 14 14" fill="currentColor"><path d="M4 2.5v9l7-4.5z"/></svg>
            : <svg width="12" height="12" viewBox="0 0 14 14" fill="currentColor"><rect x="3.6" y="2.8" width="2.4" height="8.4" rx="1"/><rect x="8" y="2.8" width="2.4" height="8.4" rx="1"/></svg>}
        </button>
      )}
      {!props.view.stopped && (
        <button
          className="g-btn danger"
          title="清除目标（clear · 不再自动续跑）"
          aria-label="清除目标"
          disabled={busy}
          onClick={() => { if (window.confirm("清除目标？清除后不再自动续跑（终态，不可恢复）。")) call({ clear: true }, "目标已清除"); }}
        >
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M2.8 4h8.4M5.6 4V2.8h2.8V4M3.8 4l.6 7.2h5.2L10.2 4"/></svg>
        </button>
      )}
      {props.view.stopped && <span className="g-time">已停止（终态）· 要继续请改设目标</span>}
    </div>
  );
}
