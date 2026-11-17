// 通道分区（2026-11-17 · v80 IM 通道线的设置面）。
//
// 三件事：连接一个通道（平台+表单+密钥）、看连接清单（状态/绑定会话/启停/重连/移除）、
// 审批外部发件人的连接请求。所有数据现读（imList），窗格不留状态；密钥值只在 safeStorage，
// 表单里密钥字段是密码框（不回显、不落盘）。
import { useCallback, useEffect, useState } from "react";
import type { ImConnectionViewPayload } from "../../../../../../src/main/ipc-protocol";
import { SettingsSection, SettingsRow } from "../settings-ui";
import { ConfirmDialog } from "../ConfirmDialog";
import { STR } from "../../strings";

type ImPlatforms = NonNullable<Awaited<ReturnType<typeof window.agent.imList>>["platforms"]>;

function statusLabelOf(status: ImConnectionViewPayload["status"]): string {
  const S = STR.channels;
  switch (status.state) {
    case "ready": return S.statusReady;
    case "connecting": return S.statusConnecting;
    case "retrying": return S.statusRetrying + (status.error === undefined ? "" : `：${status.error}`);
    case "error": return S.statusError + (status.error === undefined ? "" : `：${status.error}`);
    default: return S.statusOff;
  }
}

/** 判卷缝：直接注入清单（生产走 imList）。 */
export function ChannelsSection(
  props: { initialConnections?: ImConnectionViewPayload[]; initialPlatforms?: ImPlatforms } = {},
): React.JSX.Element {
  const [list, setList] = useState<{ connections: ImConnectionViewPayload[]; platforms: ImPlatforms } | null>(
    props.initialConnections !== undefined && props.initialPlatforms !== undefined
      ? { connections: props.initialConnections, platforms: props.initialPlatforms }
      : null,
  );
  const [issue, setIssue] = useState<string | null>(null);
  const [platform, setPlatform] = useState("");
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  /** 待移除的连接 id（ConfirmDialog 的目标；null = 没有进行中的移除）。 */
  const [removing, setRemoving] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const result = await window.agent.imList();
      if (result.ok !== true) {
        setIssue(result.error ?? STR.channels.readFailed);
        return;
      }
      setList({ connections: result.connections ?? [], platforms: result.platforms ?? [] });
      setIssue(null);
    } catch (error) {
      setIssue(error instanceof Error ? error.message : String(error));
    }
  }, []);

  useEffect(() => { if (props.initialConnections === undefined) void load(); }, [load, props.initialConnections]);

  const specs = list?.platforms ?? [];
  const spec = specs.find((p) => p.id === platform) ?? specs[0];

  const add = async (): Promise<void> => {
    if (spec === undefined) return;
    try {
      const result = await window.agent.imAdd({ platform: spec.id, fields: fieldValues });
      if (result.ok !== true) {
        setIssue(result.error ?? STR.channels.addFailed);
        return;
      }
      setFieldValues({});
      setIssue(null);
      await load();
    } catch (error) {
      setIssue(error instanceof Error ? error.message : String(error));
    }
  };

  const act = async (fn: () => Promise<{ ok: boolean; error?: string }>): Promise<void> => {
    const result = await fn();
    if (result.ok !== true) setIssue(result.error ?? STR.channels.writeFailed);
    await load();
  };

  if (spec === undefined && specs.length === 0 && list !== null) {
    return (
      <SettingsSection title={STR.channels.hostTitle}>
        <p className="sp-note">{STR.channels.hostNotReady}</p>
      </SettingsSection>
    );
  }

  return (
    <div className="sp-page">
      <SettingsSection title={STR.channels.addTitle}>
        <SettingsRow label={STR.channels.platform}>
          {specs.map((p) => (
            <button
              key={p.id}
              className={"mini-btn" + (spec?.id === p.id ? " on" : "")}
              aria-pressed={spec?.id === p.id}
              onClick={() => setPlatform(p.id)}
            >
              {p.name}
            </button>
          ))}
        </SettingsRow>
        {spec?.fields.map((f) => (
          <SettingsRow key={f.key} label={f.label}>
            <input
              type={f.secret === true ? "password" : "text"}
              value={fieldValues[f.key] ?? ""}
              placeholder={f.hint}
              onChange={(e) => setFieldValues({ ...fieldValues, [f.key]: e.target.value })}
            />
          </SettingsRow>
        ))}
        <SettingsRow label={STR.channels.fields}>
          <button className="btn" onClick={() => { void add(); }}>{STR.channels.add}</button>
          <span className="sp-note">{STR.channels.secretHint}</span>
        </SettingsRow>
        {issue !== null && <p className="sp-note err" role="alert">{issue}</p>}
      </SettingsSection>

      <SettingsSection title={STR.channels.listTitle}>
        {(list?.connections ?? []).length === 0
          ? <p className="sp-note">{STR.channels.empty}</p>
          : (list?.connections ?? []).map((c) => (
            <div key={c.id}>
              <SettingsRow
                label={<span>{c.account?.name ?? c.platform}<span className="sp-note"> {statusLabelOf(c.status)}</span></span>}
              >
                <button className="mini-btn" onClick={() => { void act(async () => await window.agent.imUpdate({ id: c.id, enabled: !c.enabled })); }}>
                  {c.enabled ? STR.channels.disable : STR.channels.enable}
                </button>
                <button className="mini-btn" onClick={() => { void act(async () => await window.agent.imRetry(c.id)); }}>{STR.channels.retry}</button>
                <button className="mini-btn" onClick={() => { setRemoving(c.id); }}>{STR.channels.remove}</button>
              </SettingsRow>
              {/* 绑定会话走行内说明（不占 desc 帽：会话绑定是行内读数，不是替布局说话的说明）。 */}
              <p className="sp-note">{c.sessionId === "" ? STR.channels.sessionEmpty : `${STR.channels.boundSession} ${c.sessionId}`}</p>
              {/* 已配对发件人 + 解除（imUnpair 的消费点；配对是外部账号白名单，不是聊天清单）。 */}
              {c.paired.length > 0 && (
                <p className="sp-note">
                  {STR.channels.paired}：
                  {c.paired.map((p) => (
                    <span key={p.id} className="cw-rotation-modes" style={{ marginRight: 8 }}>
                      {p.name}
                      <button className="mini-btn" onClick={() => { void act(async () => await window.agent.imUnpair(c.id, p.id)); }}>{STR.channels.unpair}</button>
                    </span>
                  ))}
                </p>
              )}
            </div>
          ))}
        {(list?.connections ?? []).some((c) => c.requests.length > 0) && (
          <SettingsRow label={STR.channels.requests}>
            <div className="cw-browser-list" style={{ minWidth: 260 }}>
              {(list?.connections ?? []).flatMap((c) => c.requests.map((r) => (
                <div key={c.id + ":" + r.id} className="cw-browser-row" style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ flex: 1 }}>{r.name}（{c.account?.name ?? c.platform}）</span>
                  <button className="mini-btn" onClick={() => { void act(async () => await window.agent.imPair(c.id, r.id, true)); }}>{STR.channels.allow}</button>
                  <button className="mini-btn" onClick={() => { void act(async () => await window.agent.imPair(c.id, r.id, false)); }}>{STR.channels.deny}</button>
                </div>
              )))}
            </div>
          </SettingsRow>
        )}
        {issue !== null && <p className="sp-note err" role="alert">{issue}</p>}
      </SettingsSection>

      {removing !== null && (
        <ConfirmDialog
          title={STR.channels.remove}
          note={STR.channels.removeConfirm}
          confirmLabel={STR.channels.remove}
          danger
          onConfirm={() => {
            const id = removing;
            setRemoving(null);
            if (id !== null) void act(async () => await window.agent.imRemove(id));
          }}
          onClose={() => setRemoving(null)}
        />
      )}
    </div>
  );
}
