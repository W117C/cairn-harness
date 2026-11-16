// 团队成员面板（ADR 0015 §四 第一件最小件的**界面**；设计规格 §5 的「成员区」第一刀）。
//
// 面子的三条纪律：
//  ① 名单**不是**本地状态的真源：每次都问主进程现算的投影（`teamRoster`），写完之后也用回包重画；
//  ② 写入口只有一条（`teamMemberSave`）：新增、改档、移除都走它；移除是**墓碑**，历史不删；
//  ③ 拒绝要看得见：被拒的补丁与被裁剪的档位都在页面上点名，不糊成一句「保存失败」。
import { useCallback, useEffect, useState } from "react";
import type { TeamMemberInput, TeamRosterPayload, TeamRoundPlanPayload } from "../../../../../../src/main/ipc-protocol";
/** 记忆作用域的三个线值（v61 的线格式）。渲染层不 import 核心模块——那会把 node 依赖拉进
 *  浏览器包（实测：构建会因 vscode-languageserver-protocol 的 `./node` 导出直接失败）。
 *  形状由 `TeamRosterPayload.members[].memoryScope` 的类型钉住。 */
const MEMORY_SCOPES = ["team", "member", "project"] as const;
const MEMORY_LABEL: Record<(typeof MEMORY_SCOPES)[number], string> = {
  team: STR.team.memoryScopeTeam,
  member: STR.team.memoryScopeMember,
  project: STR.team.memoryScopeProject,
};
/** 权限档只列**可选**的四档（guided 已并入 auto，2026-11-03 裁决）。
 *  2026-11-16（R3 修）：此前直接渲染 AGENT_PERMISSION_MODES 的裸枚举值——用户看到的是
 *  `read-only / guided / auto / full-access`，同一件事在权限页却是中文。 */
// 2026-11-16（合流）：档位名单一事实源是 permission-labels 的 MODE_LABEL（qoder 线把 STR.permissions
// 的档位副本收编走了）；团队面不再读 strings 旧副本，改读同一份词表，菜单/确认框/设置面/团队面四处同读。
const TIER_OPTIONS = [
  { id: "read-only", label: MODE_LABEL["read-only"].label },
  { id: "default", label: MODE_LABEL.default.label },
  { id: "auto", label: MODE_LABEL.auto.label },
  { id: "full-access", label: MODE_LABEL["full-access"].label },
] as const;
const tierLabel = (id: string): string =>
  TIER_OPTIONS.find((o) => o.id === id)?.label ?? (id === "guided" ? MODE_LABEL.guided.label : id);
import { SettingsRow, SettingsSection } from "../settings-ui";
import { STR } from "../../strings";
import { MODE_LABEL } from "../../permission-labels";

/** 新成员的 id：`m` + 36 进制时间戳。不拿名字当 id——名字可改，id 不能。 */
function newMemberId(): string {
  return `m${Date.now().toString(36)}`;
}

/** `initialRoster` / `initialPlan` 只给判卷用（SSR 不跑 effect，注入读数就能判渲染面）。 */
export function TeamSection(
  props: { initialRoster?: TeamRosterPayload; initialPlan?: TeamRoundPlanPayload; initialSegment?: number } = {},
): React.JSX.Element {
  const [roster, setRoster] = useState<TeamRosterPayload | null>(props.initialRoster ?? null);
  const [issue, setIssue] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [tier, setTier] = useState<string>("read-only");
  const [plan, setPlan] = useState<TeamRoundPlanPayload | null>(props.initialPlan ?? null);
  const [segment, setSegment] = useState<number | null>(props.initialSegment ?? null);
  // 密钥授权（v67）：成员 × 密钥 的允许/拒绝；默认拒，列表只读投影来自团队日志。
  const [grants, setGrants] = useState<{ memberId: string; secret: string; allow: boolean }[]>([]);
  const [requests, setRequests] = useState<{ memberId: string; secret: string; state: string }[]>([]);
  const [secretMember, setSecretMember] = useState("");
  const [secretName, setSecretName] = useState("");
  const [roundMode, setRoundMode] = useState<"chairFirst" | "turnOrder">("chairFirst");

  const load = useCallback(async (): Promise<void> => {
    try {
      setRoster(await window.agent.teamRoster());
      setIssue(null);
    } catch (error) {
      setIssue(error instanceof Error ? error.message : String(error));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const loadGrants = useCallback(async (): Promise<void> => {
    try {
      const result = await window.agent.teamSecretGrants();
      if (result.ok === true && result.grants !== undefined) setGrants(result.grants);
      if (result.ok === true && result.requests !== undefined) setRequests(result.requests);
    } catch { /* 读不到就不显示，不打扰 */ }
  }, []);
  useEffect(() => { void loadGrants(); }, [loadGrants]);

  const askSecret = async (): Promise<void> => {
    const member = secretMember === "" ? (roster?.members[0]?.id ?? "") : secretMember;
    const secret = secretName.trim();
    if (member === "" || secret === "") { setIssue(STR.team.secretNeed); return; }
    try {
      const result = await window.agent.teamSecretRequest(member, secret);
      if (result.ok !== true) { setIssue(result.error ?? STR.team.writeFailed); return; }
      setSecretName("");
      setIssue(null);
      await loadGrants();
    } catch (error) {
      setIssue(error instanceof Error ? error.message : String(error));
    }
  };

  const grant = async (allow: boolean): Promise<void> => {
    const member = secretMember === "" ? (roster?.members[0]?.id ?? "") : secretMember;
    const secret = secretName.trim();
    if (member === "" || secret === "") { setIssue(STR.team.secretNeed); return; }
    try {
      const result = await window.agent.teamSecretGrant(member, secret, allow);
      if (result.ok !== true) { setIssue(result.error ?? STR.team.writeFailed); return; }
      setSecretName("");
      setIssue(null);
      await loadGrants();
    } catch (error) {
      setIssue(error instanceof Error ? error.message : String(error));
    }
  };

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

  /** 发言权的调用点：把「谁这一轮说」交给主进程算（名单与秩序都不在渲染层实现）。 */
  const planRound = async (): Promise<void> => {
    setBusy(true);
    try {
      const result = await window.agent.teamRoundPlan({ mode: roundMode });
      if (result.ok !== true) { setIssue(result.error ?? STR.team.writeFailed); return; }
      if (result.plan !== undefined) setPlan(result.plan);
      setIssue(null);
    } catch (error) {
      setIssue(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  /** 段的写入点：给当前会话开新段（序数由日志算，渲染层不猜）。 */
  const openSegment = async (): Promise<void> => {
    setBusy(true);
    try {
      const result = await window.agent.sessionSegmentOpen();
      if (result.ok !== true) { setIssue(result.error ?? STR.team.writeFailed); return; }
      if (typeof result.segment === "number") setSegment(result.segment);
      setIssue(null);
    } catch (error) {
      setIssue(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const nameOf = (id: string): string => plan?.roster.find((r) => r.id === id)?.name ?? id;

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
            {TIER_OPTIONS.map((mode) => <option key={mode.id} value={mode.id}>{mode.label}</option>)}
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
        <SettingsRow
          key={m.id}
          label={m.name}
          desc={[m.role, m.model, m.thinking, m.id].filter((v): v is string => typeof v === "string" && v !== "").join(" · ")}
        >
          <div className="team-member">
            <select
              className="ss-select"
              aria-label={STR.team.tier}
              value={m.tier}
              disabled={busy}
              onChange={(e) => { void write({ id: m.id, tier: e.target.value }); }}
            >
              {TIER_OPTIONS.map((mode) => <option key={mode.id} value={mode.id}>{mode.label}</option>)}
            </select>
            <select
              className="ss-select"
              aria-label={STR.team.memoryScope}
              value={m.memoryScope ?? "team"}
              disabled={busy}
              onChange={(e) => { void write({ id: m.id, memoryScope: e.target.value }); }}
            >
              {MEMORY_SCOPES.map((scope) => <option key={scope} value={scope}>{MEMORY_LABEL[scope]}</option>)}
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

      <SettingsRow label={STR.team.roundTitle}>
        <div className="team-member">
          <select
            className="ss-select"
            aria-label={STR.team.roundMode}
            value={roundMode}
            onChange={(e) => { setRoundMode(e.target.value === "chairFirst" ? "chairFirst" : "turnOrder"); }}
          >
            <option value="chairFirst">{STR.team.roundChairFirst}</option>
            <option value="turnOrder">{STR.team.roundTurnOrder}</option>
          </select>
          <button type="button" className="mini-btn" disabled={busy} onClick={() => { void planRound(); }}>
            {STR.team.roundAction}
          </button>
        </div>
      </SettingsRow>

      {plan !== null && (
        <SettingsRow label={STR.team.roundPlan}>
          <span className="ss-static">
            {plan.paused
              ? STR.team.roundPaused
              : plan.batches.map((b) => `${String(b.order)}. ${b.speakers.map(nameOf).join("、")}`).join("　")}
          </span>
        </SettingsRow>
      )}

      <SettingsRow label={STR.team.segmentTitle}>
        <div className="team-member">
          <span className="ss-static">{segment === null ? "—" : String(segment)}</span>
          <button type="button" className="mini-btn" disabled={busy} onClick={() => { void openSegment(); }}>
            {STR.team.segmentAction}
          </button>
        </div>
      </SettingsRow>

      {roster?.insights !== undefined && (
        <SettingsRow label={STR.team.permissions}>
          <span className="ss-static">
            {`团队档 ${tierLabel(roster.insights.permissions.teamTier)}`}
            {roster.insights.permissions.clamped.length > 0
              ? ` · 裁剪 ${roster.insights.permissions.clamped.map((c) => `${nameOf(c.id)} ${tierLabel(c.requested)}→${tierLabel(c.applied)}`).join("；")}`
              : ` · 无裁剪`}
          </span>
        </SettingsRow>
      )}

      {roster?.insights !== undefined && (
        <SettingsRow label={STR.team.memory}>
          <span className="ss-static">
            {roster.insights.memory.scopes
              .map((s) => `${MEMORY_LABEL[s.scope as (typeof MEMORY_SCOPES)[number]] ?? s.scope} ${String(s.members.length)}`)
              .join(" · ")}
          </span>
        </SettingsRow>
      )}

      {roster?.insights !== undefined && (
        <SettingsRow label={STR.team.usage}>
          <span className="ss-static">
            {roster.insights.usage.totalEvents === 0
              ? STR.team.usageEmpty
              : roster.insights.usage.byOwner
                .map((u) => `${u.owner} ${String(u.inputTokens)}/${String(u.outputTokens)}`)
                .join("　")}
          </span>
        </SettingsRow>
      )}

      <SettingsRow label={STR.team.secretTitle}>
        <div className="team-member">
          <select
            className="ss-select"
            aria-label={STR.team.secretMember}
            value={secretMember}
            onChange={(e) => { setSecretMember(e.target.value); }}
          >
            <option value="">{STR.team.secretMemberDefault}</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <input
            className="ss-input"
            aria-label={STR.team.secretName}
            placeholder={STR.team.secretName}
            value={secretName}
            onChange={(e) => { setSecretName(e.target.value); }}
          />
          <button type="button" className="mini-btn" disabled={busy} onClick={() => { void grant(true); }}>
            {STR.team.secretAllow}
          </button>
          <button type="button" className="mini-btn" disabled={busy} onClick={() => { void grant(false); }}>
            {STR.team.secretDeny}
          </button>
          <button type="button" className="mini-btn" disabled={busy} onClick={() => { void askSecret(); }}>
            {STR.team.secretAsk}
          </button>
        </div>
      </SettingsRow>

      {requests.length > 0 && (
        <SettingsRow label={STR.team.secretRequests}>
          <span className="ss-static">
            {requests.map((r) => `${r.memberId} ${r.secret} ${r.state}`).join("；")}
          </span>
        </SettingsRow>
      )}

      {grants.length > 0 && (
        <SettingsRow label={STR.team.secretGrants}>
          <span className="ss-static">{grants.map((g) => `${g.memberId} ${g.secret} ${g.allow ? STR.team.secretAllow : STR.team.secretDeny}`).join("；")}</span>
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
