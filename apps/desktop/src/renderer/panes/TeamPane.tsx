// 团队会话窗格（规格 §5 的第三刀：第 10 个窗格种类）。
//
// 这一刀的形状：**打开即自动算一轮的发言秩序**（不点按钮），因为「谁这一轮说」在组队场景里
// 是每次打开都想知道的事，不该让人多点一下。名单仍从主进程现读（团队事件日志投影），
// 窗格自己不留状态。
import { useCallback, useEffect, useState } from "react";
import type { TeamRosterPayload, TeamRoundPlanPayload } from "../../../../../src/main/ipc-protocol";
import { STR } from "../strings";
import "./team-pane.css";

export function TeamPane(props: { initialRoster?: TeamRosterPayload; initialPlan?: TeamRoundPlanPayload } = {}): React.JSX.Element {
  const [roster, setRoster] = useState<TeamRosterPayload | null>(props.initialRoster ?? null);
  const [plan, setPlan] = useState<TeamRoundPlanPayload | null>(props.initialPlan ?? null);
  const [issue, setIssue] = useState<string | null>(null);
  // 派活（v62）：目标成员 + 任务书 + 回执（新会话 id）。不自动开跑，面板只说「活已经放进去了」。
  const [dispatchTo, setDispatchTo] = useState<string | null>(null);
  const [dispatchTask, setDispatchTask] = useState("");
  const [dispatched, setDispatched] = useState<{ member: string; sessionId: string } | null>(null);
  // 群会话（v64）：建一条带 group=1 的会话；共享流是它自己的事件流。
  const [groupName, setGroupName] = useState("");
  const [groupCreated, setGroupCreated] = useState<string | null>(null);
  const [groupRound, setGroupRound] = useState<{ round: number; speaker: string } | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const next = await window.agent.teamRoster();
      setRoster(next);
      // 打开即算：发言权的自动调用点（不需要用户再点一次）。
      const result = await window.agent.teamRoundPlan({ mode: "chairFirst" });
      if (result.ok === true && result.plan !== undefined) setPlan(result.plan);
      setIssue(null);
    } catch (error) {
      setIssue(error instanceof Error ? error.message : String(error));
    }
  }, []);

  useEffect(() => { if (props.initialRoster === undefined) void load(); }, [load, props.initialRoster]);

  const members = roster?.members ?? [];

  const createGroup = async (): Promise<void> => {
    try {
      const result = await window.agent.teamGroupCreate(groupName.trim());
      if (result.ok !== true) { setIssue(result.error ?? STR.team.writeFailed); return; }
      setGroupCreated(String(result.sessionId ?? ""));
      setGroupName("");
      setIssue(null);
    } catch (error) {
      setIssue(error instanceof Error ? error.message : String(error));
    }
  };

  const nextRound = async (start: boolean): Promise<void> => {
    if (groupCreated === null) { setIssue(STR.team.groupNeed); return; }
    try {
      const result = await window.agent.teamGroupNext(groupCreated, undefined, start);
      if (result.ok !== true) { setIssue(result.error ?? STR.team.writeFailed); return; }
      setGroupRound({ round: Number(result.round ?? 0), speaker: String(result.speaker ?? "") });
      if (start && result.sessionId !== undefined) {
        setDispatched({ member: String(result.speaker ?? ""), sessionId: String(result.sessionId) });
      }
      setIssue(null);
    } catch (error) {
      setIssue(error instanceof Error ? error.message : String(error));
    }
  };

  const startMember = async (): Promise<void> => {
    if (dispatchTo === null) return;
    const task = dispatchTask.trim();
    if (task === "") { setIssue(STR.team.dispatchEmpty); return; }
    try {
      const result = await window.agent.teamMemberStart(dispatchTo, task);
      if (result.ok !== true) { setIssue(result.error ?? STR.team.writeFailed); return; }
      setDispatched({ member: dispatchTo, sessionId: String(result.sessionId ?? "") });
      setDispatchTask("");
      setIssue(null);
    } catch (error) {
      setIssue(error instanceof Error ? error.message : String(error));
    }
  };

  const dispatch = async (): Promise<void> => {
    if (dispatchTo === null) return;
    const task = dispatchTask.trim();
    if (task === "") { setIssue(STR.team.dispatchEmpty); return; }
    try {
      const result = await window.agent.teamMemberDispatch(dispatchTo, task);
      if (result.ok !== true) { setIssue(result.error ?? STR.team.writeFailed); return; }
      setDispatched({ member: dispatchTo, sessionId: String(result.sessionId ?? "") });
      setDispatchTask("");
      setIssue(null);
    } catch (error) {
      setIssue(error instanceof Error ? error.message : String(error));
    }
  };
  const nameOf = (id: string): string => plan?.roster.find((r) => r.id === id)?.name ?? id;

  return (
    <div className="team-pane" data-team-pane="true">
      <div className="team-pane-head">
        <span className="team-pane-title">{STR.team.title}</span>
        <span className="team-pane-count">{roster === null ? STR.team.loading : String(members.length)}</span>
      </div>
      {issue !== null && <div className="team-pane-issue">{issue}</div>}
      <ul className="team-pane-list">
        {members.map((m) => (
          <li key={m.id} className="team-pane-row">
            <span className="team-pane-name">{m.name}</span>
            <span className="team-pane-role">{[m.role, m.model, m.thinking].filter((v) => typeof v === "string" && v !== "").join(" · ")}</span>
            <span className="team-pane-tier">{m.tier}</span>
            <button
              type="button"
              className="mini-btn"
              aria-label={`${STR.team.dispatch} ${m.name}`}
              onClick={() => { setDispatchTo(m.id); }}
            >
              {dispatchTo === m.id ? STR.team.dispatchTarget : STR.team.dispatch}
            </button>
          </li>
        ))}
        {roster !== null && members.length === 0 && <li className="team-pane-empty">{STR.team.emptyValue}</li>}
      </ul>
      <div className="team-pane-plan">
        <span className="team-pane-plan-head">{STR.team.roundPlan}</span>
        {plan === null
          ? <span className="team-pane-plan-value">{STR.team.loading}</span>
          : plan.paused
            ? <span className="team-pane-plan-value">{STR.team.roundPaused}</span>
            : plan.batches.map((b) => `${String(b.order)}. ${b.speakers.map(nameOf).join("、")}`).join("　")}
      </div>
      <div className="team-pane-group">
        <input
          className="ss-input"
          aria-label={STR.team.groupName}
          placeholder={STR.team.groupName}
          value={groupName}
          onChange={(e) => { setGroupName(e.target.value); }}
        />
        <button type="button" className="mini-btn" onClick={() => { void createGroup(); }}>
          {STR.team.groupCreate}
        </button>
      </div>
      {groupCreated !== null && <div className="team-pane-hint">{`${STR.team.groupCreated}${groupCreated}`}</div>}
      <div className="team-pane-group">
        <button type="button" className="mini-btn" onClick={() => { void nextRound(false); }}>
          {STR.team.groupNext}
        </button>
        <button type="button" className="mini-btn" onClick={() => { void nextRound(true); }}>
          {STR.team.groupNextStart}
        </button>
        {groupRound !== null && (
          <span className="ss-static">{`${STR.team.groupRound}${String(groupRound.round)} · ${groupRound.speaker}`}</span>
        )}
      </div>

      <div className="team-pane-dispatch">
        <input
          className="ss-input"
          aria-label={STR.team.dispatchTask}
          placeholder={dispatchTo === null ? STR.team.dispatchPick : STR.team.dispatchTask}
          value={dispatchTask}
          onChange={(e) => { setDispatchTask(e.target.value); }}
        />
        <button type="button" className="mini-btn" disabled={dispatchTo === null} onClick={() => { void dispatch(); }}>
          {STR.team.dispatchSend}
        </button>
        <button type="button" className="mini-btn" disabled={dispatchTo === null} onClick={() => { void startMember(); }}>
          {STR.team.dispatchStart}
        </button>
      </div>
      {dispatched !== null && (
        <div className="team-pane-hint">{`${STR.team.dispatchDone}${dispatched.member} · ${dispatched.sessionId}`}</div>
      )}
      <div className="team-pane-hint">{STR.team.manageHint}</div>
    </div>
  );
}
