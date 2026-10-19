// C-32 ChangeSummaryCard（v2 输出优先）：一轮交付摘要——固定四格回答「改了什么、验证了什么、
// 哪些未验证、下一步」，文件明细与验证原始证据可继续展开查看。
// 数据来自 turnDelivery 纯投影（change 缺席标 unknown，不猜 created/modified；验证只认
// 最后一次写盘之后的拍，worker 验证不替主会话销账）。
import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import type { TurnDelivery } from "../projections";

const CHANGE_LABEL: Record<"created" | "modified" | "unknown", string> = {
  created: "新建",
  modified: "修改",
  unknown: "变更",
};

const STATUS_LABEL: Record<TurnDelivery["verification"]["status"], string> = {
  "not-required": "无需验证",
  absent: "未验证",
  stale: "证据已过期",
  verified: "已验证",
  failed: "验证未过",
};

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
  const changedText = d.files.length === 0 ? "无文件改动" : `${String(d.files.length)} 个文件`;
  return (
    <div className="changes-card" data-open={open ? "true" : "false"}>
      <div className="changes-head">
        <span className="cf-ico" aria-hidden="true">
          <svg width="15" height="15" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"><path d="M1.8 4.4c0-.83.67-1.5 1.5-1.5h1.9l1.4 1.5h4.1c.83 0 1.5.67 1.5 1.5v3.7c0 .83-.67 1.5-1.5 1.5H3.3c-.83 0-1.5-.67-1.5-1.5Z"/></svg>
        </span>
        <span className="cf-t">{d.files.length === 0 ? "本轮交付" : `已编辑 ${String(d.files.length)} 个文件`}</span>
        <span className="cf-stats num">
          {created > 0 && <span className="cf-add">新建 {String(created)}</span>}
          {created > 0 && modified > 0 && <span className="cf-sep">·</span>}
          {modified > 0 && <span className="cf-del">修改 {String(modified)}</span>}
        </span>
        <span className={`chip ${STATUS_CHIP[d.verification.status]}`}>{STATUS_LABEL[d.verification.status]}</span>
        <span className="chip">第 {String(d.round)} 轮</span>
        <button
          type="button"
          className={"changes-toggle" + (open ? " on" : "")}
          aria-expanded={open}
          aria-label={open ? "收起改动详情" : "展开改动详情"}
          title={open ? "收起" : "展开详情"}
          onClick={() => { setOpen((v) => !v); }}
        ><ChevronDown size={13} /></button>
      </div>
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
      {actions !== undefined && (actions.onOpenPreview !== undefined || actions.onRevert !== undefined || actions.onExport !== undefined) && (
        <div className="delivery-actions">
          {actions.onOpenPreview !== undefined && (
            <button className="mini-btn" onClick={actions.onOpenPreview}>打开预览</button>
          )}
          {actions.onRevert !== undefined && (
            <button
              className="mini-btn"
              title={`把第 ${String(d.round)} 轮改动过的文件还原成该轮之前的状态（新建文件会删除；之后又被改过的文件不动）`}
              onClick={actions.onRevert}
            >
              恢复上一版
            </button>
          )}
          {actions.onExport !== undefined && (
            <button className="mini-btn" onClick={actions.onExport}>导出项目</button>
          )}
        </div>
      )}
      {d.files.length > 0 && (
        <div className="changes-list">
          {visible.map((f) => (
            <div key={f.path} className="change-item" title={f.snapshotId !== undefined ? "覆盖前快照已保留（.agent/snapshots）" : undefined}>
              <span className={`chip ${f.change === "created" ? "ok" : f.change === "unknown" ? "" : ""}`}>{CHANGE_LABEL[f.change]}</span>
              <span className="ci-path">{f.path}</span>
              {f.snapshotId !== undefined && (
                <span className="ci-stat" title={`快照：${f.snapshotId}`}>
                  快照<span style={{ display: "inline-flex", verticalAlign: "-1px" }}><Check size={10} /></span>
                </span>
              )}
            </div>
          ))}
          {d.files.length > 4 && !showAll && (
            <button className="changes-more" onClick={() => setShowAll(true)}>
              全部 {String(d.files.length)} 个文件 <span style={{ display: "inline-flex", verticalAlign: "-2px" }}><ChevronDown size={11} /></span>
            </button>
          )}
        </div>
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
      </>
      )}
    </div>
  );
}
