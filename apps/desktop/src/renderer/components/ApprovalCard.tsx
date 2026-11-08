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
import { STR } from "../strings";

/** 风险中文化 + 分级：low/none 不出 chip（低风险的日常动作不摆警示），medium 起才说话。 */
const RISK_CHIP: Record<string, { label: string; cls: string } | undefined> = {
  medium: { label: STR.gate.riskMedium, cls: "chip risk" },
  high: { label: STR.gate.riskHigh, cls: "chip danger" },
  critical: { label: STR.gate.riskCritical, cls: "chip danger" },
};

/** 工具 → 头行图标（认不出的工具不硬凑图标，留给 ⚠/空位）。 */
function toolIcon(tool: string) {
  if (tool === "run_shell") return SquareTerminal;
  if (tool === "write_file" || tool === "edit_file" || tool === "apply_patch") return FileText;
  if (tool === "web_fetch") return Globe;
  if (tool === "remember") return BookOpen;
  if (tool === "attachment") return FileText;
  if (tool.startsWith("automation_")) return Timer;
  return undefined;
}

// 连拦降级（§2.2 双向断路器 · 2026-10-20）：核心早就在数「连续被拒 N 次」（autonomy.ts 的
// CRITICAL_DENIAL_LIMIT / downgradeSuggestion），但那一句只进 console.warn —— 界面上一次也没出现过，
// 等于断路器只断给日志看。这里把它摆到卡面上：明说是哪一档在连拦、建议降到哪一档，
// 且**只给按钮、不自动改档**（改档是用户的动作，静默改档比不提示更糟）。
export function ApprovalCard(props: {
  ask: AskPayload;
  onDecide: (approved: boolean, scope?: "once" | "session_kind" | "always") => void;
  /** 一键降档（缺省 = 只提示不给按钮；不摆按不动的按钮）。 */
  onDowngrade?: () => void;
}) {
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
  // 项目外附件是**本轮一次性**读取授权：不提供「本会话此类 / 总是允许」——
  // 那两个按钮的语义是持久 scope，而附件 grant 按设计不落盘、不跨 run。
  const oneShot = a.tool === "attachment";
  const chip = a.risk !== undefined ? RISK_CHIP[a.risk] : undefined;
  const dangerHead = a.risk === "high" || a.risk === "critical";
  const Icon = dangerHead ? AlertTriangle : toolIcon(a.tool);
  const isNet = a.riskReasons?.some((r) => r.includes(STR.gate.networkKeyword) || r.toLowerCase().includes("net")) ?? false;
  return (
    <div
      className="card"
      data-gate="approval"
      data-risk={a.risk ?? "none"}
      data-status="pending_approval"
      data-exp={expanded ? "true" : "false"}
      role="region"
      aria-label={STR.gate.approvalAria.replace("{tool}", a.tool)}
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
        <button className="iconbtn sm" data-card-exp aria-label={expanded ? STR.gate.collapse : STR.gate.expand} onClick={() => setExpanded(!expanded)}>
          <span style={{ display: "inline-flex", transform: expanded ? "rotate(180deg)" : undefined, transition: "transform var(--t-fast)" }}><ChevronDown size={12} /></span>
        </button>
      </div>
      <div className="card-evidence">
        {digest.subject !== undefined && <div className="ask-subject" title={digest.subject}>{digest.subject}</div>}
        {digest.body !== undefined && <div className="cmdline" title={digest.body}>{digest.body}</div>}
        {digest.subject === undefined && digest.body === undefined && (
          <div className="consequence">{a.reason ?? STR.gate.approvalRegion}</div>
        )}
      </div>
      {expanded && (
        <>
          {a.reason && <div className="why">{a.reason}</div>}
          {a.riskReasons && a.riskReasons.length > 0 && (
            <ul className="risk-list">{a.riskReasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
          )}
          {isNet && (
            <div className="note-net">
              <span aria-hidden="true"><Globe size={13} /></span>
              <span>{STR.gate.networkNote}</span>
            </div>
          )}
        </>
      )}
      {a.tierWarning !== undefined && (
        <div className="note-tier" role="status">
          <span>{a.tierWarning}</span>
          {props.onDowngrade !== undefined && (
            <button className="btn ghost" onClick={() => { props.onDowngrade?.(); }}>{STR.gate.downgrade}</button>
          )}
        </div>
      )}
      <div className="card-actions">
        {/* 动作次序（2026-10-31，R1）：拒绝 / 总是允许 / 允许一次（主钮最右）。
            与 open-claude-ui McpToolDecisionCard 的三阶决议同序；危险动作不摆在主位。 */}
        <button className="btn secondary" data-gate-reject onClick={() => props.onDecide(false)}>{STR.gate.reject}</button>
        {!oneShot && (!alwaysArmed ? (
          <button className="btn ghost" onClick={() => setAlwaysArmed(true)}>{STR.gate.alwaysAllow} <ChevronDown size={11} /></button>
        ) : (
          <>
            <button className="btn ghost" onClick={() => props.onDecide(true, "session_kind")}>{STR.gate.confirmSessionKind}</button>
            <button className="btn danger-text" onClick={() => props.onDecide(true, "always")}>{STR.gate.confirmAlways}</button>
            <button className="btn ghost" onClick={() => setAlwaysArmed(false)}>{STR.gate.cancel}</button>
          </>
        ))}
        {/* 2026-11-02：提示贴在次要动作后面，不再夹在 spacer 与主按钮之间把两枚动作挤开。 */}
        <span className="consequence">{STR.gate.escHint}</span>
        <span className="spacer" />
        <button className="btn primary" data-gate-accept onClick={() => props.onDecide(true)}>{STR.gate.approve}</button>
      </div>
    </div>
  );
}
