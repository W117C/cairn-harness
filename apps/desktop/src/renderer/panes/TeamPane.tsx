// 团队会话窗格（规格 §5 的第三刀：第 10 个窗格种类）。
//
// 这一刀的形状：**打开即自动算一轮的发言秩序**（不点按钮），因为「谁这一轮说」在组队场景里
// 是每次打开都想知道的事，不该让人多点一下。名单仍从主进程现读（团队事件日志投影），
// 窗格自己不留状态。
import { useCallback, useEffect, useState } from "react";
import type { TeamRosterPayload, TeamRoundPlanPayload } from "../../../../../src/main/ipc-protocol";
import { modeLabelOf } from "../permission-labels";
import { STR } from "../strings";
import "./team-pane.css";

export function TeamPane(props: {
  initialRoster?: TeamRosterPayload;
  initialPlan?: TeamRoundPlanPayload;
  /** 判卷用的缝：直接喂记忆面板读数（生产走 teamMemoryPanel）。 */
  initialMemory?: { rows: { scope: string; topics: number; memberId?: string }[]; total: { topics: number }; missingScopes: string[] };
  /** 判卷用的缝：直接喂一份共享流（生产走 teamGroupStream）。 */
  initialStream?: { items: { seq: number; kind: string; speaker: string; round: number | null; text: string }[]; dropped: number };
} = {}): React.JSX.Element {
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
  const [groupRound, setGroupRound] = useState<{ round: number; speakers: string[]; unknown: string[] } | null>(null);
  // v70：群聊共享流（只读投影，带轮与说话人）。
  const [memory, setMemory] = useState<{ rows: { scope: string; topics: number; memberId?: string }[]; total: { topics: number }; missingScopes: string[] } | null>(props.initialMemory ?? null);
  const [stream, setStream] = useState<{ items: { seq: number; kind: string; speaker: string; round: number | null; text: string }[]; dropped: number } | null>(props.initialStream ?? null);

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
  useEffect(() => { void loadMemory(); }, []);

  const members = roster?.members ?? [];

  const loadMemory = async (): Promise<void> => {
    if (props.initialMemory !== undefined) return;
    try {
      const result = await window.agent.teamMemoryPanel();
      if (result.ok === true && result.rows !== undefined && result.total !== undefined) {
        setMemory({ rows: result.rows, total: result.total, missingScopes: result.missingScopes ?? [] });
      }
    } catch { /* 读不到就不显示 */ }
  };

  const createGroup = async (): Promise<void> => {
    try {
      const result = await window.agent.teamGroupCreate(groupName.trim());
      if (result.ok !== true) { setIssue(result.error ?? STR.team.writeFailed); return; }
      setGroupCreated(String(result.sessionId ?? ""));
      setGroupName("");
      setIssue(null);
      // 建群即拉共享流（此前流区一直空白到第一次 nextRound 才有内容）。
      void loadStream(String(result.sessionId ?? ""));
    } catch (error) {
      setIssue(error instanceof Error ? error.message : String(error));
    }
  };

  const loadStream = async (sessionId: string): Promise<void> => {
    try {
      const result = await window.agent.teamGroupStream(sessionId, undefined, 20);
      if (result.ok === true && result.items !== undefined) {
        setStream({ items: result.items, dropped: result.dropped ?? 0 });
      }
    } catch { /* 读不到就不显示 */ }
  };

  const nextRound = async (start: boolean): Promise<void> => {
    if (groupCreated === null) { setIssue(STR.team.groupNeed); return; }
    try {
      const result = await window.agent.teamGroupNext(groupCreated, undefined, start);
      if (result.ok !== true) { setIssue(result.error ?? STR.team.writeFailed); return; }
      void loadStream(groupCreated);
      setGroupRound({
        round: Number(result.round ?? 0),
        speakers: result.speakers ?? [String(result.speaker ?? "")],
        unknown: result.unknownMentions ?? [],
      });
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
        {/* 打开即拉一次，之后无轮询（OrchestrationPane 有 2s 轮询）——去设置改档回来看到的是旧名单。
            手动刷新兜底；成员行/秩序在派活与建群后也会就地重拉。 */}
        <button type="button" className="mini-btn" aria-label="刷新团队读数" onClick={() => { void load(); if (groupCreated !== null) void loadStream(groupCreated); }}>刷新</button>
      </div>
      {issue !== null && <div className="team-pane-issue">{issue}</div>}
      <ul className="team-pane-list">
        {members.map((m) => (
          <li key={m.id} className="team-pane-row">
            <span className="team-pane-name">{m.name}</span>
            <span className="team-pane-role">{[m.role, m.model, m.thinking].filter((v) => typeof v === "string" && v !== "").join(" · ")}</span>
            <span className="team-pane-tier">{modeLabelOf(m.tier)}</span>
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
            ? <span className="team-pane-plan-value warn">{STR.team.roundPaused}</span>
            : (
              /* 发言秩序 = 波次 chip 行（此前整行拼接字符串，波次读不出来）；
                 每片保留「N. 名单」的既有文案锚（判卷逐字钉）。 */
              <span className="team-pane-plan-batches">
                {plan.batches.map((b) => (
                  <span key={b.order} className="team-pane-batch">{`${String(b.order)}. ${b.speakers.map(nameOf).join("、")}`}</span>
                ))}
              </span>
            )}
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
        {memory !== null && (
          <div className="team-pane-memory" data-memory="true">
            <span className="team-pane-memory-total">{`记忆：${String(memory.total.topics)} 个主题`}</span>
            {memory.rows.map((row) => (
              <span key={`${row.scope}-${row.memberId ?? ""}`} className="team-pane-memory-row">
                {`${row.scope}${row.memberId === undefined ? "" : ` ${row.memberId}`} · ${String(row.topics)}`}
              </span>
            ))}
            {memory.missingScopes.length > 0 && (
              <span className="team-pane-memory-missing">{`缺层：${memory.missingScopes.join("、")}`}</span>
            )}
          </div>
        )}

        {stream !== null && (
          <div className="team-pane-stream" data-stream="true">
            {/* 被裁剪要显名（本仓纪律）：dropped > 0 时点名；200 字截断处补省略号 + 全文进 title。 */}
            {stream.dropped > 0 && <div className="team-pane-stream-dropped" role="status">{`已省略较早的 ${String(stream.dropped)} 条`}</div>}
            {stream.items.map((item) => (
              <div key={item.seq} className={`team-pane-stream-row ${item.kind}`}>
                <span className="team-pane-stream-speaker">{`${item.round === null ? "—" : `第${String(item.round)}轮`} ${item.speaker}`}</span>
                <span
                  className="team-pane-stream-text"
                  title={item.text.length > 200 ? item.text : undefined}
                >{item.text.length > 200 ? `${item.text.slice(0, 200)}…` : item.text}</span>
              </div>
            ))}
          </div>
        )}

        {groupRound !== null && (
          <span className="ss-static">
            {`${STR.team.groupRound}${String(groupRound.round)} · ${groupRound.speakers.join("、")}`}
            {groupRound.unknown.length > 0 ? `（未识别：${groupRound.unknown.join("、")}）` : ""}
          </span>
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
