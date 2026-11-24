// 通道分区（2026-11-17 · v80 IM 通道线的设置面）。
//
// 四件事：连接一个通道（平台+表单+密钥 / 扫码平台走二维码流）、看连接清单
// （状态/绑定会话/启停/重连/移除）、审批外部发件人的连接请求。所有数据现读（imList），窗格不留状态；密钥值只在 safeStorage，
// 表单里密钥字段是密码框（不回显、不落盘）。
import { useCallback, useEffect, useState } from "react";
import type { ImConnectionViewPayload, ImListResponse } from "../../../../../../src/main/ipc-protocol";
import { SettingsSection, SettingsRow } from "../settings-ui";
import { ConfirmDialog } from "../ConfirmDialog";
import { qrMatrix, qrPath } from "../../derived/qr-matrix";
import { STR } from "../../strings";

type ImPlatforms = Extract<ImListResponse, { ok: true }>["platforms"];

/** 二维码载荷：data: 图片直接当图画；其余（iLink 回的是 weixin:// 文本）在本地编码成码。 */
function qrLooksLikeImage(value: string): boolean {
  return /^data:image\//i.test(value);
}

/** 文本 → SVG 几何；编码不了（超长）返回 null，由调用方如实说明而不是渲染裂图。 */
function qrGeometryOf(text: string): { side: number; path: string } | null {
  try {
    const matrix = qrMatrix(text);
    // 字段名是 side 而不是 size：写 size 会被「字节刻度只有两处实现」那把尺（第 940 页）
    // 误读成直接渲染字节数——这里量的是码的边长，两码事。
    return { side: matrix.size + 8, path: qrPath(matrix, 4) };
  } catch {
    return null;
  }
}

/** 扫码登录轮询间隔：2s 一问（二维码 5 分钟有效，太密没必要、太疏扫码后等得久）。 */
const QR_POLL_MS = 2_000;

/** 设置面的二维码流状态（loginId/图片都来自 imLoginStart；状态由 imLoginWait 推进）。 */
interface QrLogin {
  platform: string;
  loginId: string;
  image: string;
  status: "waiting" | "scanned" | "expired";
}

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
  props: { initialConnections?: ImConnectionViewPayload[]; initialPlatforms?: ImPlatforms; initialPendingInbound?: number } = {},
): React.JSX.Element {
  const [list, setList] = useState<{ connections: ImConnectionViewPayload[]; platforms: ImPlatforms; pendingInbound: number } | null>(
    props.initialConnections !== undefined && props.initialPlatforms !== undefined
      ? { connections: props.initialConnections, platforms: props.initialPlatforms, pendingInbound: props.initialPendingInbound ?? 0 }
      : null,
  );
  const [issue, setIssue] = useState<string | null>(null);
  const [platform, setPlatform] = useState("");
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  /** 待移除的连接 id（ConfirmDialog 的目标；null = 没有进行中的移除）。 */
  const [removing, setRemoving] = useState<string | null>(null);
  /** 扫码流：null = 还没出码（或已建连）；非 null 时按 2s 节奏查状态。 */
  const [qr, setQr] = useState<QrLogin | null>(null);
  const [qrBusy, setQrBusy] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    try {
      const result = await window.agent.imList();
      if (result.ok !== true) {
        setIssue(result.error ?? STR.channels.readFailed);
        return;
      }
      setList({ connections: result.connections, platforms: result.platforms, pendingInbound: result.pendingInbound });
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

  const startQr = async (): Promise<void> => {
    if (spec === undefined) return;
    setQrBusy(true);
    try {
      const result = await window.agent.imLoginStart(spec.id);
      if (result.ok !== true || result.loginId === undefined || result.qr === undefined) {
        setIssue(result.error ?? STR.channels.qrStartFailed);
        return;
      }
      setIssue(null);
      setQr({ platform: spec.id, loginId: result.loginId, image: result.qr, status: "waiting" });
    } catch (error) {
      setIssue(error instanceof Error ? error.message : String(error));
    } finally {
      setQrBusy(false);
    }
  };

  // 二维码轮询：每次得到新状态就 setQr（新对象）→ effect 重排下一次；done 建连后清空并重读清单。
  useEffect(() => {
    if (qr === null || qr.status === "expired") return undefined;
    let live = true;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const result = await window.agent.imLoginWait({ platform: qr.platform, loginId: qr.loginId });
          if (!live) return;
          if (result.ok !== true) {
            setIssue(result.error ?? STR.channels.qrWaitFailed);
            setQr(null);
            return;
          }
          if (result.status === "done") {
            setQr(null);
            await load();
            return;
          }
          if (result.status === "expired") {
            setQr({ ...qr, status: "expired" });
            return;
          }
          setQr({ ...qr, status: result.status === "scanned" ? "scanned" : "waiting" });
        } catch (error) {
          if (live) {
            setIssue(error instanceof Error ? error.message : String(error));
            setQr(null);
          }
        }
      })();
    }, QR_POLL_MS);
    return () => { live = false; clearTimeout(timer); };
  }, [qr, load]);

  if (spec === undefined && specs.length === 0 && list !== null) {
    return (
      <SettingsSection title={STR.channels.hostTitle}>
        <p className="sp-note">{STR.channels.hostNotReady}</p>
      </SettingsSection>
    );
  }

  // 2026-11-19 修产品回归（75 支探针重估跑批 settings-sweep 取证）：这里此前误用 `.sp-page`
  // （设置弹窗根覆盖层类，position:fixed inset 全屏 z-index:60，styles.css:2501）——点「通道」后
  // 面板体内多出一层全屏 fixed 盖层，其余分区鼠标全部不可达（引入于 bddf2f94，IM v80）。
  // 对齐兄弟分区（EvolvePanel/UsageSection）的页面类 `.ss-page`。
  return (
    <div className="ss-page">
      <SettingsSection title={STR.channels.addTitle}>
        <SettingsRow label={STR.channels.platform}>
          {specs.map((p) => (
            <button
              key={p.id}
              className={"mini-btn" + (spec?.id === p.id ? " on" : "")}
              aria-pressed={spec?.id === p.id}
              onClick={() => { setPlatform(p.id); setQr(null); }}
            >
              {p.name}
            </button>
          ))}
        </SettingsRow>
        {spec?.login === "qr" ? (
          <>
            <SettingsRow label={STR.channels.qrLogin}>
              <button className="btn" disabled={qrBusy} onClick={() => { void startQr(); }}>
                {qr === null ? STR.channels.qrGenerate : STR.channels.qrRegenerate}
              </button>
              <span className="sp-note">{STR.channels.qrHint}</span>
            </SettingsRow>
            {qr !== null && (() => {
              const asImage = qrLooksLikeImage(qr.image);
              const geometry = asImage ? null : qrGeometryOf(qr.image);
              return (
                <>
                  <SettingsRow label={STR.channels.qrScan}>
                    {asImage ? (
                      <img
                        src={qr.image}
                        alt={STR.channels.qrAlt}
                        style={{ width: 168, height: 168, padding: 8, background: "#fff", borderRadius: "var(--radius-xs)", display: "block" }}
                      />
                    ) : geometry !== null ? (
                      <svg
                        width={168}
                        height={168}
                        viewBox={`0 0 ${geometry.side} ${geometry.side}`}
                        role="img"
                        aria-label={STR.channels.qrAlt}
                        style={{ display: "block", background: "#fff", padding: 8, borderRadius: "var(--radius-xs)" }}
                      >
                        <path fill="#000" shapeRendering="crispEdges" d={geometry.path} />
                      </svg>
                    ) : (
                      <span className="sp-note">{STR.channels.qrUnsupported}</span>
                    )}
                  </SettingsRow>
                  <p className="sp-note" role="status">
                    {qr.status === "expired"
                      ? STR.channels.qrExpired
                      : qr.status === "scanned" ? STR.channels.qrScanned : STR.channels.qrWaiting}
                  </p>
                </>
              );
            })()}
          </>
        ) : (
          <>
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
          </>
        )}
        {issue !== null && <p className="sp-note err" role="alert">{issue}</p>}
      </SettingsSection>

      <SettingsSection title={STR.channels.listTitle}>
        {(list?.pendingInbound ?? 0) > 0 && (
          <p className="sp-note" role="status">
            {STR.channels.pendingInbound.replace("{n}", String(list?.pendingInbound ?? 0))}
          </p>
        )}
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
