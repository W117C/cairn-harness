// 团队成员面板（ADR 0015 §四 第一件最小件的**界面**；设计规格 §5 的「成员区」第一刀）。
//
// 面子的三条纪律：
//  ① 名单**不是**本地状态的真源：每次都问主进程现算的投影（`teamRoster`），写完之后也用回包重画；
//  ② 写入口只有一条（`teamMemberSave`）：新增、改档、移除都走它；移除是**墓碑**，历史不删；
//  ③ 拒绝要看得见：被拒的补丁与被裁剪的档位都在页面上点名，不糊成一句「保存失败」。
import { useCallback, useEffect, useState } from "react";
import type { TeamMemberInput, TeamRosterPayload } from "../../../../../../src/main/ipc-protocol";
import { AGENT_PERMISSION_MODES } from "../../../../../../src/events/types";
import { SettingsRow, SettingsSection } from "../settings-ui";
import { STR } from "../../strings";

/** 新成员的 id：`m` + 36 进制时间戳。不拿名字当 id——名字可改，id 不能。 */
function newMemberId(): string {
  return `m${Date.now().toString(36)}`;
}

/** `initialRoster` 只给判卷用（SSR 不跑 effect，注入一份名单就能判渲染面）。 */
export function TeamSection(props: { initialRoster?: TeamRosterPayload } = {}): React.JSX.Element {
  const [roster, setRoster] = useState<TeamRosterPayload | null>(props.initialRoster ?? null);
  const [issue, setIssue] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [tier, setTier] = useState<string>("read-only");

  const load = useCallback(async (): Promise<void> => {
    try {
      setRoster(await window.agent.teamRoster());
      setIssue(null);
    } catch (error) {
      setIssue(error instanceof Error ? error.message : String(error));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const write = async (input: TeamMemberInput): Promise<void> => {
    setBusy(true);
    try {
      const result = await window.agent.teamMemberSave(input);
      if (result.ok !== true) { setIssue(result.error ?? STR.team.writeFailed); return; }
      if (result.roster !== undefined) setRoster(result.roster);
      setIssue(null);
    } catch (error) {
      setIssue(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const add = async (): Promise<void> => {
    const trimmedName = name.trim();
    if (trimmedName === "") { setIssue(STR.team.nameRequired); return; }
    await write({ id: newMemberId(), name: trimmedName, role: role.trim() === "" ? STR.team.roleDefault : role.trim(), tier });
    setName("");
    setRole("");
    setTier("read-only");
  };

  const members = roster?.members ?? [];

  return (
    <SettingsSection title={STR.team.title}>
      <SettingsRow label={STR.team.add} desc={STR.team.addDesc}>
        <div className="team-add">
          <input
            className="ss-input"
            aria-label={STR.team.name}
            placeholder={STR.team.name}
            value={name}
            onChange={(e) => { setName(e.target.value); }}
          />
          <input
            className="ss-input"
            aria-label={STR.team.role}
            placeholder={STR.team.role}
            value={role}
            onChange={(e) => { setRole(e.target.value); }}
          />
          <select
            className="ss-select"
            aria-label={STR.team.tier}
            value={tier}
            onChange={(e) => { setTier(e.target.value); }}
          >
            {AGENT_PERMISSION_MODES.map((mode) => <option key={mode} value={mode}>{mode}</option>)}
          </select>
          <button type="button" className="mini-btn" disabled={busy} onClick={() => { void add(); }}>
            {STR.team.addAction}
          </button>
        </div>
      </SettingsRow>

      {members.length === 0 && (
        <SettingsRow label={STR.team.list} desc={STR.team.empty}>
          <span className="ss-static">{roster === null ? STR.team.loading : STR.team.emptyValue}</span>
        </SettingsRow>
      )}

      {members.map((m) => (
        <SettingsRow key={m.id} label={m.name} desc={`${m.role} · ${m.id}`}>
          <div className="team-member">
            <select
              className="ss-select"
              aria-label={STR.team.tier}
              value={m.tier}
              disabled={busy}
              onChange={(e) => { void write({ id: m.id, tier: e.target.value }); }}
            >
              {AGENT_PERMISSION_MODES.map((mode) => <option key={mode} value={mode}>{mode}</option>)}
            </select>
            <button type="button" className="mini-btn" disabled={busy} onClick={() => { void write({ id: m.id, remove: true }); }}>
              {STR.team.remove}
            </button>
          </div>
        </SettingsRow>
      ))}

      {(roster?.clamped.length ?? 0) > 0 && (
        <SettingsRow label={STR.team.clamped}>
          <span className="ss-static">
            {roster!.clamped.map((c) => `${c.id} ${c.requested}→${c.applied}`).join("；")}
          </span>
        </SettingsRow>
      )}

      {(roster?.rejected.length ?? 0) > 0 && (
        <SettingsRow label={STR.team.rejected}>
          <span className="ss-static">
            {roster!.rejected.map((r) => `#${String(r.at)} ${r.error}`).join("；")}
          </span>
        </SettingsRow>
      )}

      <SettingsRow label={STR.team.records} desc={STR.team.recordsDesc}>
        <span className="ss-static">{roster === null ? "—" : String(roster.records)}</span>
      </SettingsRow>

      {issue !== null && (
        <SettingsRow label={STR.team.issue}>
          <span className="ss-static">{issue}</span>
        </SettingsRow>
      )}
    </SettingsSection>
  );
}

export { newMemberId };
