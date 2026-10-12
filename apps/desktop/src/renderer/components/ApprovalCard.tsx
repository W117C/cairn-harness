// C-14 ApprovalCard（v2.9 紧凑态）：头行（⚠+标题+工具 chip+风险 chip+详情▾）→ 命令行 → 动作行。
// 展开详情 = 原因行 / 风险点列表 / 网络注记（AskPayload 字段全在，此前 UI 未收全的现在收齐）。
// 「总是允许」二次确认（2.5s 无响应回退）；Esc 不做决议（键盘面在 App 层）。
import { useEffect, useState } from "react";
import type { AskPayload } from "../../../../../src/main/ipc-protocol";
import { Ic } from "./icons";

const RISK_CHIP: Record<string, string> = { none: "", low: "", medium: "risk", high: "danger", critical: "danger" };

export function ApprovalCard(props: { ask: AskPayload; onDecide: (approved: boolean, scope?: "once" | "session_kind" | "always") => void }) {
  const [expanded, setExpanded] = useState(false);
  const [alwaysArmed, setAlwaysArmed] = useState(false);
  // 二次确认 2.5s 回退（持久提权值得一次确认）。
  useEffect(() => {
    if (!alwaysArmed) return;
    const t = setTimeout(() => setAlwaysArmed(false), 2500);
    return () => clearTimeout(t);
  }, [alwaysArmed]);
  const a = props.ask;
  const cmd = typeof a.args.command === "string" ? a.args.command : JSON.stringify(a.args);
  const isNet = a.riskReasons?.some((r) => r.includes("网络") || r.toLowerCase().includes("net")) ?? false;
  return (
    <div className="card" data-exp={expanded ? "true" : "false"}>
      <div className="card-head">
        <span className={a.risk === "high" || a.risk === "critical" ? "ico-risk" : "ico-wait"} aria-hidden="true">
          <Ic.alert size={15} />
        </span>
        <h3>需要你批准</h3>
        <span className="chip">{a.tool}</span>
        {a.risk !== undefined && a.risk !== "none" && <span className={`chip ${RISK_CHIP[a.risk] ?? ""}`}>{a.risk}</span>}
        <span className="spacer" />
        <button className="iconbtn sm" data-card-exp aria-label={expanded ? "收起详情" : "展开详情"} onClick={() => setExpanded(!expanded)}>
          <span style={{ display: "inline-flex", transform: expanded ? "rotate(180deg)" : undefined, transition: "transform var(--t-fast)" }}><Ic.chevronDown size={12} /></span>
        </button>
      </div>
      <div className="cmdline" title={cmd}>{cmd}</div>
      {expanded && (
        <>
          {a.reason && <div className="why">{a.reason}</div>}
          {a.riskReasons && a.riskReasons.length > 0 && (
            <ul className="risk-list">{a.riskReasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
          )}
          {isNet && (
            <div className="note-net">
              <span aria-hidden="true"><Ic.globe size={13} /></span>
              <span>批准 = 本次命令放行网络出网（一次性，不记忆）</span>
            </div>
          )}
        </>
      )}
      <div className="card-actions">
        <button className="btn primary" onClick={() => props.onDecide(true)}>允许 · 本次</button>
        <button className="btn secondary" onClick={() => props.onDecide(false)}>拒绝</button>
        {!alwaysArmed ? (
          <button className="btn ghost" onClick={() => setAlwaysArmed(true)}>总是允许 <Ic.chevronDown size={11} /></button>
        ) : (
          <>
            <button className="btn ghost" onClick={() => props.onDecide(true, "session_kind")}>确认 · 本会话此类</button>
            <button className="btn danger-text" onClick={() => props.onDecide(true, "always")}>确认 · 总是</button>
            <button className="btn ghost" onClick={() => setAlwaysArmed(false)}>取消</button>
          </>
        )}
        <span className="spacer" />
        <span className="consequence">Esc 不做决议</span>
      </div>
    </div>
  );
}
