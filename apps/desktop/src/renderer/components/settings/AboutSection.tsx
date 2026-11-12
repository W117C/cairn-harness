// 关于与更新段（第 1071 页从 settings-sections.tsx 按区拆分）——版本 / 许可证 / 更新源 /
// 偏好备份 / 运行诊断 / 工程细节折叠区（术语收容所 DIAGNOSTICS_TEXT）。自助手 licenseDate /
// licenseLabel / licenseExpiryHint / DoctorResultView / DoctorState 随段走；monolith 重导出保旧 import 面。
import { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import type { LicenseState } from "../../../../../../src/main/license";
import type { BuildInfo } from "../../../../../../src/main/build-info";
import type { DoctorReport } from "../../../../../../src/main/doctor";
import type { AppSettings } from "../../../../../../src/main/ipc-protocol";
import { Field, SettingsSection, SettingsRow } from "../settings-ui";
import { ConfirmDialog } from "../ConfirmDialog";
import { doctorReportText, doctorRows, doctorTarget, doctorVerdictText, type DoctorKeyStatus, type DoctorRow } from "./doctor-view";
import { STR } from "../../strings";
import type { SectionId } from "../../app-controls";
import { isCompositionEnter } from "../../ime";

/** 「关于与更新」诊断信息折叠区文案（术语收容所）：工程词集中在这里供对照，
 *  正文一律说人话（总纲阶段 3-3「去掉界面中所有内部术语」的收容侧）。 */
export const DIAGNOSTICS_TEXT = STR.about.diagnostics;

/** 许可证状态 → 一行给人看的话（四态全显式；不把「没校验」说成「有效」）。 */
/** 只把 ISO 日期截到日：签发的 expires_at 常带 T00:00:00Z，原样显示又长又像调试串。 */
function licenseDate(iso: string): string {
  const m = /^\d{4}-\d{2}-\d{2}/.exec(iso);
  return m === null ? iso : m[0];
}

export function licenseLabel(state: LicenseState | null | undefined): string {
  if (state === null || state === undefined) return STR.about.licenseUnread;
  switch (state.state) {
    case "valid": return state.expiresAt === null ? STR.about.licenseValid.replace("{licensee}", state.licensee) : STR.about.licenseValidUntil.replace("{licensee}", state.licensee).replace("{date}", licenseDate(state.expiresAt));
    case "expired": return STR.about.licenseExpired.replace("{licensee}", state.licensee);
    case "invalid": return STR.about.licenseInvalidState.replace("{reason}", state.reason);
    case "inactive": return STR.about.licenseInactive;
  }
}

/** 到期摘要：30 天内才提醒；过期/当天/未来 N 天各一句。`now` 注入便于判卷不赌时钟。 */
export function licenseExpiryHint(state: LicenseState | null | undefined, now: number = Date.now()): string | null {
  if (state === null || state === undefined) return null;
  if (state.state === "expired") return STR.about.expiredOn.replace("{date}", licenseDate(state.expiresAt));
  if (state.state !== "valid" || state.expiresAt === null) return null;
  const at = Date.parse(state.expiresAt);
  if (Number.isNaN(at)) return null;
  const days = Math.ceil((at - now) / (24 * 60 * 60 * 1000));
  if (days < 0) return STR.about.expiredOn.replace("{date}", licenseDate(state.expiresAt));
  if (days === 0) return STR.about.expiresToday;
  if (days <= 30) return STR.about.expiresIn.replace("{days}", String(days));
  return null;
}

/** 诊断结果的行渲染：失败的、且应用里能改的项做成按钮，点了跳到对应设置分区；
 *  其余（Node / 工作区 / 设置文件 / 会话数据）保持只读行——不摆「点了没反应」的入口。 */
export function DoctorResultView(props: {
  rows: readonly DoctorRow[];
  onOpenSection?: (section: SectionId) => void;
}): React.JSX.Element {
  return (
    <>
      {props.rows.map((row) => {
        const target = row.ok ? undefined : doctorTarget(row.id);
        const body = (
          <>
            <span className="ss-doctor-mark" aria-hidden="true">{row.ok ? "✓" : "✗"}</span>
            <span className="ss-doctor-label">{row.label}</span>
            <span className="ss-doctor-detail">{row.detail}{row.hint !== undefined ? `（${row.hint}）` : ""}</span>
          </>
        );
        return target !== undefined && props.onOpenSection !== undefined ? (
          <button
            key={row.id}
            type="button"
            data-doctor-id={row.id}
            className={"ss-doctor-row ss-doctor-row-action " + (row.ok ? "ok" : "bad")}
            aria-label={STR.about.doctorRowActionAria.replace("{label}", row.label)}
            title={STR.about.doctorRowAction}
            onClick={() => { props.onOpenSection?.(target); }}
          >
            {body}
            <ChevronRight size={13} className="ss-doctor-go" aria-hidden="true" />
          </button>
        ) : (
          <div key={row.id} data-doctor-id={row.id} className={"ss-doctor-row " + (row.ok ? "ok" : "bad")}>
            {body}
          </div>
        );
      })}
    </>
  );
}

type DoctorState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "ready"; report: DoctorReport; keys: DoctorKeyStatus | null };

export function AboutSection(props: {
  version: string | null;
  updateMsg: string | null;
  onCheckUpdate: () => void;
  /** 更新源地址（settings.updateManifestUrl）；空 = 未配置。 */
  updateManifestUrl?: string;
  /** 单键直写更新源（不走 panelPatch 白名单）。 */
  onSaveManifest?: (url: string) => void;
  /** 工程细节（术语收容所）；缺省用 DIAGNOSTICS_TEXT。 */
  diagnostics?: string;
  /** 许可证状态（getState().license；缺省 undefined 显示「未读取」而不是「未激活」）。 */
  license?: LicenseState | null;
  /** 诊断失败项的落点：切到对应设置分区（缺省 = 不给按钮，保持只读）。 */
  onOpenSection?: (section: SectionId) => void;
  /** 导入许可证成功后回灌状态（缺省 = 只显示本次导入结果，不更新上方标签）。 */
  onLicenseChanged?: (state: LicenseState) => void;
  /** 导入偏好成功后回灌整份设置（缺省 = 只显示回执，不刷新面板）。 */
  onPreferencesImported?: (settings: AppSettings) => void;
  /** 包内 build-info.json；开发态/旧包为 null（版本行只显示版本号）。 */
  build?: BuildInfo | null;
}): React.JSX.Element {
  // v34「运行诊断」：按钮点下去才跑（会做一次沙箱自检，不在面板打开时偷偷跑）。
  const [doctor, setDoctor] = useState<DoctorState>({ status: "idle" });
  /** 「复制报告」的回执：null = 还没点过/已重新诊断；成功与失败都给一句，不静默。 */
  const [copyMsg, setCopyMsg] = useState<string | null>(null);
  /** 许可证导入的三态：idle / importing / 一句话回执。 */
  const [licenseBusy, setLicenseBusy] = useState(false);
  const [licenseMsg, setLicenseMsg] = useState<string | null>(null);
  /** 「导出诊断包」的忙碌/回执：文件落盘成功要给路径，取消不报错。 */
  const [exportBusy, setExportBusy] = useState(false);
  const [exportMsg, setExportMsg] = useState<string | null>(null);
  /** 偏好备份的忙碌/回执：导入会覆盖当前偏好，成功/失败都要有回执。 */
  const [prefBusy, setPrefBusy] = useState(false);
  const [prefMsg, setPrefMsg] = useState<string | null>(null);
  const exportPreferences = async (): Promise<void> => {
    setPrefBusy(true);
    setPrefMsg(null);
    try {
      const r = await window.agent.exportPreferences();
      if (r.canceled === true) { setPrefMsg(STR.about.canceledExport); return; }
      if (r.ok && r.path !== undefined) { setPrefMsg(STR.about.saved.replace("{path}", r.path)); return; }
      setPrefMsg(STR.about.exportFailed.replace("{reason}", r.error ?? STR.about.unknownReason));
    } catch (err) {
      setPrefMsg(STR.about.exportFailed.replace("{reason}", err instanceof Error ? err.message : String(err)));
    } finally {
      setPrefBusy(false);
    }
  };
  const [pendingImport, setPendingImport] = useState<{ patch: Record<string, unknown>; ignored: string[] } | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const importPreferences = async (): Promise<void> => {
    setPrefBusy(true);
    setPrefMsg(null);
    try {
      const r = await window.agent.importPreferences();
      if (r.canceled === true) { setPrefMsg(STR.about.canceledImport); return; }
      if (!r.ok || r.patch === undefined) { setPrefMsg(STR.about.importFailed.replace("{reason}", r.error ?? STR.about.invalidBackup)); return; }
      // 先预览、后应用：导入是覆盖写，不能让用户在没看见改了哪几项时就落盘。
      setPendingImport({ patch: r.patch as Record<string, unknown>, ignored: r.ignored ?? [] });
    } catch (err) {
      setPrefMsg(STR.about.importFailed.replace("{reason}", err instanceof Error ? err.message : String(err)));
    } finally {
      setPrefBusy(false);
    }
  };
  const applyPendingImport = async (): Promise<void> => {
    if (pendingImport === null) return;
    setPrefBusy(true);
    try {
      const next = await window.agent.setSettings(pendingImport.patch);
      props.onPreferencesImported?.(next);
      const count = Object.keys(pendingImport.patch).length;
      const ignored = pendingImport.ignored.length > 0 ? STR.about.ignoredSettings.replace("{count}", String(pendingImport.ignored.length)) : "";
      setPrefMsg(STR.about.importedCount.replace("{count}", String(count)).replace("{ignored}", ignored));
      setPendingImport(null);
    } catch (err) {
      setPrefMsg(STR.about.importFailed.replace("{reason}", err instanceof Error ? err.message : String(err)));
    } finally {
      setPrefBusy(false);
    }
  };
  const resetPreferences = async (): Promise<void> => {
    setPrefBusy(true);
    try {
      const next = await window.agent.resetPreferences();
      props.onPreferencesImported?.(next);
      setPrefMsg(STR.about.resetDone);
      setResetOpen(false);
    } catch (err) {
      setPrefMsg(STR.about.resetFailed.replace("{reason}", err instanceof Error ? err.message : String(err)));
    } finally {
      setPrefBusy(false);
    }
  };
  const exportDiagnostics = async (): Promise<void> => {
    if (doctor.status !== "ready") return;
    setExportBusy(true);
    setExportMsg(null);
    try {
      const text = doctorReportText({
        version: props.version,
        generatedAt: new Date().toISOString(),
        verdict: doctorVerdict,
        rows: doctorRowsView,
      });
      const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
      const r = await window.agent.exportDiagnostics(text, `Cairn-diagnostics-${stamp}.md`);
      if (r.canceled === true) { setExportMsg(STR.about.canceledExport); return; }
      if (r.ok && r.path !== undefined) { setExportMsg(STR.about.saved.replace("{path}", r.path)); return; }
      setExportMsg(STR.about.exportFailed.replace("{reason}", r.error ?? STR.about.unknownReason));
    } catch (err) {
      setExportMsg(STR.about.exportFailed.replace("{reason}", err instanceof Error ? err.message : String(err)));
    } finally {
      setExportBusy(false);
    }
  };
  const importLicense = async (): Promise<void> => {
    setLicenseBusy(true);
    setLicenseMsg(null);
    try {
      const r = await window.agent.importLicense();
      if ("canceled" in r && r.canceled === true) { setLicenseMsg(STR.about.canceledImport); return; }
      if (r.ok && r.state.state === "valid") {
        props.onLicenseChanged?.(r.state);
        setLicenseMsg(STR.about.licenseImported.replace("{licensee}", r.state.licensee));
        return;
      }
      if (r.ok && r.state.state === "expired") {
        props.onLicenseChanged?.(r.state);
        setLicenseMsg(STR.about.licenseImportedExpired.replace("{licensee}", r.state.licensee));
        return;
      }
      setLicenseMsg(STR.about.importFailed.replace("{reason}", r.error ?? STR.about.licenseInvalid));
    } catch (err) {
      setLicenseMsg(STR.about.importFailed.replace("{reason}", err instanceof Error ? err.message : String(err)));
    } finally {
      setLicenseBusy(false);
    }
  };
  const runDoctor = async () => {
    setCopyMsg(null);
    setDoctor({ status: "loading" });
    try {
      const [report, keys] = await Promise.all([
        window.agent.doctor(),
        window.agent.providerKeyStatus().catch(() => null),
      ]);
      if (!report.ok) { setDoctor({ status: "error", error: report.error }); return; }
      setDoctor({ status: "ready", report: report.report, keys });
    } catch (err) {
      setDoctor({ status: "error", error: err instanceof Error ? err.message : String(err) });
    }
  };
  // 第 1152 页：诊断行与总档只按 doctor 状态算一次；复制/导出提示等局部状态不重扫。
  const doctorRowsView = useMemo(() => doctor.status === "ready" ? doctorRows(doctor.report, doctor.keys) : [], [doctor]);
  const doctorVerdict = doctor.status === "ready" ? doctorVerdictText(doctor.report, doctorRowsView) : "";
  return (
    <SettingsSection title={STR.about.sectionTitle}>
      <SettingsRow label={STR.about.version}>
        {/* 2026-11-02 真机：版本 + 构建时间 + 签名 + 冒烟 + commit 全挤在一行，右侧被裁成「已过」。
            版本号单独一行，构建信息另起一行允许折行。 */}
        <div className="ss-inline ss-version">
          <span className="sp-tag">{props.version ?? "—"}</span>
          {props.build !== undefined && props.build !== null && (
            <span className="sp-dim ss-version-meta" role="status">
              {STR.about.buildMeta.replace("{date}", props.build.createdAt.slice(0, 10)).replace("{signature}", props.build.signature).replace("{smoke}", props.build.packagedSmoke === "passed" ? STR.about.smokePassed : STR.about.smokeFailed)}
              {props.build.sourceCommit !== undefined && <> · {props.build.sourceCommit.slice(0, 8)}{props.build.sourceDirty ? STR.about.dirtySuffix : ""}</>}
            </span>
          )}
        </div>
      </SettingsRow>
      <SettingsRow label={STR.about.license} desc={STR.about.licenseDesc}>
        <div className="ss-inline">
          <span className="sp-tag">{licenseLabel(props.license)}</span>
          {licenseExpiryHint(props.license) !== null && <span className="sp-dim" role="status">{licenseExpiryHint(props.license)}</span>}
          <button type="button" className="mini-btn ghost" disabled={licenseBusy} onClick={() => { void importLicense(); }}>
            {licenseBusy ? STR.about.licenseImporting : STR.about.licenseImport}
          </button>
          {licenseMsg !== null && <span className="sp-dim" role="status">{licenseMsg}</span>}
        </div>
      </SettingsRow>
      <SettingsRow label={STR.about.update}>
        {/* 2026-11-02：此前是 ghost 变体（透明底、无描边），读作一行文字而不是按钮。
            它是这个分区的主操作，回到默认描边按钮。 */}
        <button type="button" className="mini-btn" onClick={props.onCheckUpdate}>{STR.about.checkUpdate}</button>
        {props.updateMsg !== null && <span className="sp-dim">{props.updateMsg}</span>}
      </SettingsRow>
      {/* 更新源（2026-10-18 补）：此前这个字段只能改 settings.json，界面上是死胡同——
          「未配置更新源」永远消不掉，用户没有任何地方可以填。字段本身一直在 settings 里
          （settings.ts updateManifestUrl），缺的只是一个入口。 */}
      {props.onSaveManifest !== undefined && (
        <SettingsRow label={STR.update.manifestLabel} desc={STR.update.manifestDesc}>
          <div className="ss-inline">
            <Field width="full">
              <input
                aria-label={STR.update.manifestLabel}
                defaultValue={props.updateManifestUrl ?? ""}
                placeholder={STR.update.manifestPlaceholder}
                onKeyDown={(e) => { if (e.key === "Enter" && !isCompositionEnter(e, null)) { e.preventDefault(); e.currentTarget.blur(); } }}
                onBlur={(e) => {
                  const next = e.target.value.trim();
                  if (next !== (props.updateManifestUrl ?? "")) props.onSaveManifest?.(next);
                }}
              />
            </Field>
            {(props.updateManifestUrl ?? "") === "" && <span className="sp-dim">{STR.update.manifestEmpty}</span>}
          </div>
        </SettingsRow>
      )}
      <SettingsRow label={STR.about.preferences} desc={STR.about.preferencesDesc}>
        <div className="ss-inline">
          <button type="button" className="mini-btn" disabled={prefBusy} onClick={() => { void exportPreferences(); }}>
            {STR.about.exportPreferences}
          </button>
          <button type="button" className="mini-btn ghost" disabled={prefBusy} onClick={() => { void importPreferences(); }}>
            {STR.about.importPreferences}
          </button>
          <button type="button" className="mini-btn ghost" disabled={prefBusy} onClick={() => { setResetOpen(true); }}>
            {STR.about.resetPreferences}
          </button>
          {prefMsg !== null && <span className="sp-dim" role="status">{prefMsg}</span>}
        </div>
      </SettingsRow>
      <SettingsRow label={STR.about.doctor} desc={STR.about.doctorDesc}>
        <div className="ss-inline">
          <button type="button" className="mini-btn" disabled={doctor.status === "loading"} onClick={() => { void runDoctor(); }}>
            {doctor.status === "loading" ? STR.about.doctorRunning : STR.about.doctorRun}
          </button>
          <button
            type="button"
            className="mini-btn ghost"
            disabled={doctor.status !== "ready"}
            title={STR.about.copyReportTitle}
            onClick={() => {
              if (doctor.status !== "ready") return;
              if (typeof navigator === "undefined" || navigator.clipboard === undefined) {
                setCopyMsg(STR.about.copyClipboardUnavailable);
                return;
              }
              const text = doctorReportText({
                version: props.version,
                generatedAt: new Date().toISOString(),
                verdict: doctorVerdict,
                rows: doctorRowsView,
              });
              void navigator.clipboard.writeText(text).then(
                () => { setCopyMsg(STR.about.copyDone); },
                (err: unknown) => { setCopyMsg(STR.about.copyFailed.replace("{reason}", err instanceof Error ? err.message : String(err))); },
              );
            }}
          >
            {STR.about.copyReport}
          </button>
          <button
            type="button"
            className="mini-btn ghost"
            disabled={doctor.status !== "ready" || exportBusy}
            title={STR.about.exportDiagnosticsTitle}
            onClick={() => { void exportDiagnostics(); }}
          >
            {exportBusy ? STR.about.exportBusy : STR.about.exportDiagnostics}
          </button>
          {copyMsg !== null && <span className="sp-dim" role="status">{copyMsg}</span>}
          {exportMsg !== null && <span className="sp-dim" role="status">{exportMsg}</span>}
        </div>
      </SettingsRow>
      {doctor.status === "error" && (
        <div className="ss-note err" role="alert">{STR.about.diagnosisFailed.replace("{reason}", doctor.error)}</div>
      )}
      {doctor.status === "ready" && (
        <div className="ss-doctor" role="status" aria-label={STR.about.diagnosisResultAria}>
          <div className="ss-doctor-verdict">{doctorVerdict}</div>
          <DoctorResultView rows={doctorRowsView} onOpenSection={props.onOpenSection} />
        </div>
      )}
      <SettingsRow label={STR.about.details}>
        <details className="ss-diag">
          <summary>{STR.about.expand}</summary>
          <div className="ss-diag-body">{props.diagnostics ?? DIAGNOSTICS_TEXT}</div>
        </details>
      </SettingsRow>
      {pendingImport !== null && (
        <ConfirmDialog
          title={STR.about.importTitle}
          note={STR.about.importNote
            .replace("{count}", String(Object.keys(pendingImport.patch).length))
            .replace("{names}", Object.keys(pendingImport.patch).slice(0, 8).join("、"))
            .replace("{more}", Object.keys(pendingImport.patch).length > 8 ? STR.about.importMore : "")}
          confirmLabel={STR.about.importConfirm}
          onConfirm={() => { void applyPendingImport(); }}
          onClose={() => { setPendingImport(null); }}
        />
      )}
      {resetOpen && (
        <ConfirmDialog
          title={STR.about.resetTitle}
          note={STR.about.resetNote}
          confirmLabel={STR.about.resetConfirm}
          onConfirm={() => { void resetPreferences(); }}
          onClose={() => { setResetOpen(false); }}
        />
      )}
    </SettingsSection>
  );
}
