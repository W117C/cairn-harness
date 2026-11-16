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
            <span className="team-pane-role">{m.role}</span>
            <span className="team-pane-tier">{m.tier}</span>
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
      <div className="team-pane-hint">{STR.team.manageHint}</div>
    </div>
  );
}
