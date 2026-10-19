// C-14 ApprovalCard（第十一遍重设计）：头行 = 工具图标 + 人话标题（describeAsk 单点给词）+
// 风险 chip（**只在中风险及以上才出**——低风险卡不再顶着黄色警示三角）——再加详情▾；
// 主体 = 在动什么（命令/路径/patch 走 mono；不再把 JSON.stringify 直接上屏，见 cards.ts describeAsk）。
// 展开详情 = 原因行 / 风险点列表 / 网络注记（AskPayload 字段全在，此前 UI 未收全的现在收齐）。
// 「总是允许」二次确认（2.5s 无响应回退）。键盘面（P3-1 Step 3）：⏎ = 允许一次——只在卡**本体**
// 聚焦时触发（按钮的原生 ⏎ 不抢、不双发）；**Esc 不做决议**保留（卡面明示口径 + 全局 Esc = 浮层
// 优先/停止——拒绝不挂 Esc，防误触与语义打架；计划「按钮集合一致」前提核证不成立，偏差登记 §9）。
import { useEffect, useState } from "react";
import type { AskPayload } from "../../../../../src/main/ipc-protocol";
import { AlertTriangle, BookOpen, ChevronDown, FileText, Globe, SquareTerminal, Timer } from "lucide-react";
import { describeAsk } from "./cards";

/** 风险中文化 + 分级：low/none 不出 chip（低风险的日常动作不摆警示），medium 起才说话。 */
const RISK_CHIP: Record<string, { label: string; cls: string } | undefined> = {
  medium: { label: "中风险", cls: "chip risk" },
  high: { label: "高风险", cls: "chip danger" },
  critical: { label: "极高风险", cls: "chip danger" },
};

/** 工具 → 头行图标（认不出的工具不硬凑图标，留给 ⚠/空位）。 */
function toolIcon(tool: string) {
  if (tool === "run_shell") return SquareTerminal;
  if (tool === "write_file" || tool === "edit_file" || tool === "apply_patch") return FileText;
  if (tool === "web_fetch") return Globe;
  if (tool === "remember") return BookOpen;
  if (tool.startsWith("automation_")) return Timer;
  return undefined;
}

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
  const digest = describeAsk(a);
  const chip = a.risk !== undefined ? RISK_CHIP[a.risk] : undefined;
  const dangerHead = a.risk === "high" || a.risk === "critical";
  const Icon = dangerHead ? AlertTriangle : toolIcon(a.tool);
  const isNet = a.riskReasons?.some((r) => r.includes("网络") || r.toLowerCase().includes("net")) ?? false;
  return (
    <div
      className="card"
      data-exp={expanded ? "true" : "false"}
      tabIndex={0}
      onKeyDown={(e) => {
        // ⏎ = 允许一次（P3-1 Step 3）：仅当焦点在卡本体（按钮自带原生 ⏎，不抢不双发）。
        if (e.key === "Enter" && e.target === e.currentTarget) props.onDecide(true);
      }}
    >
      <div className="card-head">
        <span className={`ico${dangerHead ? " danger" : ""}`} aria-hidden="true">
          {Icon !== undefined ? <Icon size={15} /> : null}
        </span>
        <h3>{digest.title}</h3>
        {chip !== undefined && <span className={chip.cls}>{chip.label}</span>}
        <span className="spacer" />
        <button className="iconbtn sm" data-card-exp aria-label={expanded ? "收起详情" : "展开详情"} onClick={() => setExpanded(!expanded)}>
          <span style={{ display: "inline-flex", transform: expanded ? "rotate(180deg)" : undefined, transition: "transform var(--t-fast)" }}><ChevronDown size={12} /></span>
        </button>
      </div>
      {digest.subject !== undefined && <div className="ask-subject" title={digest.subject}>{digest.subject}</div>}
      {digest.body !== undefined && <div className="cmdline" title={digest.body}>{digest.body}</div>}
      {expanded && (
        <>
          {a.reason && <div className="why">{a.reason}</div>}
          {a.riskReasons && a.riskReasons.length > 0 && (
            <ul className="risk-list">{a.riskReasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
          )}
          {isNet && (
            <div className="note-net">
              <span aria-hidden="true"><Globe size={13} /></span>
              <span>批准 = 本次命令放行网络出网（一次性，不记忆）</span>
            </div>
          )}
        </>
      )}
      <div className="card-actions">
        <button className="btn primary" onClick={() => props.onDecide(true)}>允许 · 本次</button>
        <button className="btn secondary" onClick={() => props.onDecide(false)}>拒绝</button>
        {!alwaysArmed ? (
          <button className="btn ghost" onClick={() => setAlwaysArmed(true)}>总是允许 <ChevronDown size={11} /></button>
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
