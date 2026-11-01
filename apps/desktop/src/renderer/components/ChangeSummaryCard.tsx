// C-32 ChangeSummaryCard（v2 输出优先）：一轮交付摘要——固定四格回答「改了什么、验证了什么、
// 哪些未验证、下一步」，文件明细与验证原始证据可继续展开查看。
// 数据来自 turnDelivery 纯投影（change 缺席标 unknown，不猜 created/modified；验证只认
// 最后一次写盘之后的拍，worker 验证不替主会话销账）。
import { useState } from "react";
import { Check, ChevronDown, Download, ExternalLink, History } from "lucide-react";
import type { TurnDelivery } from "../projections";
import { changeLabel } from "../derived/change-labels";
import { VERIFICATION_NOT_REQUIRED, verificationLabel } from "../derived/verification-labels";

const statusLabel = (status: TurnDelivery["verification"]["status"]): string =>
  status === "not-required" ? VERIFICATION_NOT_REQUIRED : verificationLabel(status);

const STATUS_CHIP: Record<TurnDelivery["verification"]["status"], string> = {
  "not-required": "",
  absent: "wait",
  stale: "wait",
  verified: "ok",
  failed: "danger",
};

function verificationText(delivery: TurnDelivery): string {
  const v = delivery.verification;
  if (v.latest === null) {
    return v.status === "not-required" ? "本轮没有需要验证的文件改动" : "无验证记录";
  }
  const mode = v.latest.auto ? "自动验证" : "手动验证";
  const attempt = `第 ${String(v.latest.attempt)}/${String(v.latest.maxAttempts)} 次`;
  if (v.status === "failed") return `验证未通过 · ${mode} · ${attempt}`;
  if (v.status === "stale") return `有验证记录，但最后一次写盘之后没有重新验证 · ${mode} · ${attempt}`;
  if (v.status === "verified") return `已验证 · ${mode} · ${attempt}`;
  return "无验证记录";
}

function unverifiedText(delivery: TurnDelivery): string {
  if (delivery.unverifiedFiles.length === 0) {
    return delivery.verification.status === "verified" ? "无（当前改动有通过验证）" : "无";
  }
  const names = delivery.unverifiedFiles.slice(0, 3).join("、");
  const suffix = delivery.unverifiedFiles.length > 3 ? ` 等 ${String(delivery.unverifiedFiles.length)} 个` : "";
  return `${String(delivery.unverifiedFiles.length)} 个文件：${names}${suffix}`;
}

function clipOutput(output: string): string {
  const max = 4_000;
  return output.length > max ? output.slice(0, max) + "\n…（已截断，完整输出保留在会话事件里）" : output;
}

export function ChangeSummaryCard(props: {
  delivery: TurnDelivery;
  /** v6 交付卡动作行：打开预览 / 恢复上一版 / 导出项目。
   *  缺省不渲染（判卷面保持纯投影；动作只由 App 在有活动工作区时接上）。 */
  actions?: {
    onOpenPreview?: () => void;
    onRevert?: () => void;
    onExport?: () => void;
  };
  /** 默认收起（2026-10-18 业主截图：连续两轮的交付卡各占半屏，太碍事）。展开后才是四问清单。 */
  initialOpen?: boolean;
}) {
  const [open, setOpen] = useState(props.initialOpen === true);
  const [showAll, setShowAll] = useState(false);
  const d = props.delivery;
  const actions = props.actions;
  const visible = showAll ? d.files : d.files.slice(0, 4);
  const created = d.files.filter((f) => f.change === "created").length;
  const modified = d.files.filter((f) => f.change === "modified").length;
  // 「变更」= 投影拒绝判定新建还是修改的那部分（change 缺席，见文件头）。此前它只进总数、
  // 不进分解 ⇒ 全是 unknown 时副行是空的，而标题却断言「已编辑」——投影明确不猜的东西被界面猜了一遍。
  const unknown = d.files.length - created - modified;
  const parts = [
    { word: "新建", n: created, cls: "cf-add" },
    { word: "修改", n: modified, cls: "cf-del" },
    { word: "变更", n: unknown, cls: "cf-chg" },
  ].filter((p) => p.n > 0);
  // 只有一档时那个数已经在标题里了，副行再念一遍就是同一句话说两遍（业主口径：让布局说话）。
  const single = parts.length === 1 ? parts[0] : null;
  const changedText = d.files.length === 0 ? "无文件改动" : `${String(d.files.length)} 个文件`;
  return (
    <div className="changes-card" data-open={open ? "true" : "false"}>
      <button
        type="button"
        className="changes-head"
        aria-expanded={open}
        aria-label={open ? "收起改动详情" : "展开改动详情"}
        title={open ? "收起改动详情" : "展开改动详情"}
        onClick={() => { setOpen((v) => !v); }}
      >
        <span className="cf-ico" aria-hidden="true">
          <svg width="15" height="15" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"><path d="M1.8 4.4c0-.83.67-1.5 1.5-1.5h1.9l1.4 1.5h4.1c.83 0 1.5.67 1.5 1.5v3.7c0 .83-.67 1.5-1.5 1.5H3.3c-.83 0-1.5-.67-1.5-1.5Z"/></svg>
        </span>
        <span className="cf-heading">
          <span className="cf-t">{d.files.length === 0
            ? "本轮交付"
            : single !== null ? `${single.word} ${String(single.n)} 个文件` : `已编辑 ${String(d.files.length)} 个文件`}</span>
          <span className="cf-subtitle">
            {single === null && (
              <span className="cf-stats num">
                {parts.flatMap((p, i) => i === 0
                  ? [<span key={p.word} className={p.cls}>{`${p.word} ${String(p.n)}`}</span>]
                  : [
                    <span key={`sep-${p.word}`} className="cf-sep">·</span>,
                    <span key={p.word} className={p.cls}>{`${p.word} ${String(p.n)}`}</span>,
                  ])}
              </span>
            )}
            <span className="cf-round num">第 {String(d.round)} 轮</span>
          </span>
        </span>
        <span className={`chip ${STATUS_CHIP[d.verification.status]}`}>{statusLabel(d.verification.status)}</span>
        <span className={"changes-toggle" + (open ? " on" : "")} aria-hidden="true"><ChevronDown size={13} /></span>
      </button>
      {open && (
        <>
          <div className="delivery-list">
            <span className="dg-k">改了什么</span>
            <span className="dg-v">{changedText}</span>
            <span className="dg-k">验证了什么</span>
            <span className="dg-v">{verificationText(d)}</span>
            <span className="dg-k">哪些未验证</span>
            <span className="dg-v">{unverifiedText(d)}</span>
            <span className="dg-k">下一步</span>
            <span className="dg-v">{d.nextAction}</span>
          </div>
          {d.files.length > 0 && (
            <section className="changes-files" aria-label="改动文件">
              <div className="changes-files-head">
                <span>改动文件</span>
                <span className="changes-files-count num">{d.files.length}</span>
              </div>
              <div className="changes-list">
                {visible.map((f) => (
                  <div key={f.path} className="change-item" title={f.snapshotId !== undefined ? "覆盖前快照已保留（.agent/snapshots）" : undefined}>
                    <span className="ci-change" data-change={f.change}>{changeLabel(f.change)}</span>
                    <span className="ci-path" title={f.path}>{f.path}</span>
                    {f.snapshotId !== undefined && (
                      <span className="ci-stat" title={`快照：${f.snapshotId}`}>
                        <Check size={11} aria-hidden="true" />已存快照
                      </span>
                    )}
                  </div>
                ))}
                {d.files.length > 4 && !showAll && (
                  <button type="button" className="changes-more" onClick={() => setShowAll(true)}>
                    全部 {String(d.files.length)} 个文件 <ChevronDown size={11} aria-hidden="true" />
                  </button>
                )}
              </div>
            </section>
          )}
          {d.verification.latest !== null && (
            <details className="delivery-evidence">
              <summary>查看验证证据</summary>
              <div className="evidence-body">
                {d.verification.latest.results.length === 0 ? (
                  <div className="evidence-empty">这一拍没有命令明细。</div>
                ) : (
                  d.verification.latest.results.map((r, i) => (
                    <div key={`${r.command}-${String(i)}`} className="evidence-command">
                      <div className="evi-head">
                        <span className={`chip ${r.ok ? "ok" : "danger"}`}>{r.ok ? "通过" : "失败"}</span>
                        <code className="cmd">{r.command}</code>
                        {r.exitCode !== undefined && <span className="evi-meta">退出码 {r.exitCode === null ? "无" : String(r.exitCode)}</span>}
                        {r.cause !== undefined && <span className="evi-meta">{r.cause}</span>}
                      </div>
                      {r.output !== "" && <pre className="evidence-output">{clipOutput(r.output)}</pre>}
                    </div>
                  ))
                )}
              </div>
            </details>
          )}
          {actions !== undefined && (actions.onOpenPreview !== undefined || actions.onRevert !== undefined || actions.onExport !== undefined) && (
            <div className="delivery-actions">
              {actions.onOpenPreview !== undefined && (
                <button type="button" className="mini-btn primary delivery-action" onClick={actions.onOpenPreview}>
                  <ExternalLink size={12} aria-hidden="true" />打开预览
                </button>
              )}
              {actions.onRevert !== undefined && (
                <button
                  type="button"
                  className="mini-btn delivery-action delivery-action-danger"
                  title={`把第 ${String(d.round)} 轮改动过的文件还原成该轮之前的状态（新建文件会删除；之后又被改过的文件不动）`}
                  onClick={actions.onRevert}
                >
                  <History size={12} aria-hidden="true" />恢复上一版
                </button>
              )}
              {actions.onExport !== undefined && (
                <button type="button" className="mini-btn delivery-action" onClick={actions.onExport}>
                  <Download size={12} aria-hidden="true" />导出项目
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
