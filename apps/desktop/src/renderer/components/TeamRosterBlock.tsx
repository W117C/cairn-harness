// 侧栏的「成员区」（设计规格 §5 的第一刀：成员区另开文件，不塞进 928 行的 Sidebar.tsx）。
//
// 这一刀只做**看得见**：成员名单与档位、空态、失败态。写入口仍在设置 › 团队（单一写通道）。
// 为什么不在这里直接加「增删改」：侧栏是导航面，写操作放进设置页才符合本仓「设置拥有写入」的分工；
// 侧栏给的是「队里有谁、什么档」，点进设置才改得动。
import { useCallback, useEffect, useState } from "react";
import type { TeamRosterPayload } from "../../../../../src/main/ipc-protocol";
import { modeLabelOf } from "../permission-labels";
import { STR } from "../strings";

export function TeamRosterBlock(props: { initialRoster?: TeamRosterPayload } = {}): React.JSX.Element {
  const [roster, setRoster] = useState<TeamRosterPayload | null>(props.initialRoster ?? null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    try {
      setRoster(await window.agent.teamRoster());
      setFailed(false);
    } catch {
      // 读不到就说读不到：不把「读失败」画成「没有人」。
      setFailed(true);
    }
  }, []);

  useEffect(() => { if (props.initialRoster === undefined) void load(); }, [load, props.initialRoster]);

  const members = roster?.members ?? [];
  return (
    <section className="side-team" aria-label={STR.team.title} data-team-block="true">
      <div className="side-team-head">
        <span className="side-team-title">{STR.team.title}</span>
        <span className="side-team-count">{roster === null ? STR.team.loading : String(members.length)}</span>
      </div>
      {failed && <div className="side-team-empty">{STR.team.readFailed}</div>}
      {!failed && roster !== null && members.length === 0 && (
        <div className="side-team-empty">{STR.team.emptyValue}</div>
      )}
      {!failed && members.map((m) => (
        <div className="side-team-row" key={m.id} title={`${m.name} · ${m.role} · ${modeLabelOf(m.tier)}`}>
          <span className="side-team-name">{m.name}</span>
          <span className="side-team-tier">{modeLabelOf(m.tier)}</span>
        </div>
      ))}
      <div className="side-team-hint">{STR.team.manageHint}</div>
    </section>
  );
}
