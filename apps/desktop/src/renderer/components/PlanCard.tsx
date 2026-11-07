// C-16 PlanCard（v2.9 紧凑态）：头行（标题+wait chip+详情▾）→ 目标行 → 动作行（含文件数/验证面）。
// 展开详情 = approach 段 / 文件清单（action 徽标）/ 验证面 chips / 后果行（拒绝 = 写禁维持、模型须修订）。
import { useState } from "react";
import type { PlanProposal } from "../../../../../src/events";
import { planActionLabel } from "../derived/change-labels";
import { STR } from "../strings";

export function PlanCard(props: {
  callId: string;
  plan: PlanProposal;
  onDecide: (approved: boolean, callId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const verify = props.plan.verify;
  const verifyChips = [
    ...(verify?.lint?.length ?? 0) > 0 ? [`lint: ${verify?.lint?.join(" && ")}`] : [],
    ...(verify?.test?.length ?? 0) > 0 ? [`test: ${verify?.test?.join(" && ")}`] : [],
  ];
  return (
    <div className="card" data-gate="plan" data-exp={expanded ? "true" : "false"}>
      <div className="card-head">
        <span className="ico-wait" aria-hidden="true">
          <svg width="15" height="15" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><circle cx="7" cy="7" r="5.2"/><path d="M7 4.2V7l2 1.2"/></svg>
        </span>
        <h3>{STR.gate.planTitle}</h3>
        <span className="chip wait">{STR.gate.planChip}</span>
        <span className="spacer" />
        <button className="iconbtn sm" data-card-exp aria-label={expanded ? STR.gate.collapse : STR.gate.expand} onClick={() => setExpanded(!expanded)}>
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ transform: expanded ? "rotate(180deg)" : undefined, transition: "transform var(--t-fast)" }}><path d="m3.5 5.5 3.5 3.5 3.5-3.5"/></svg>
        </button>
      </div>
      <div className="card-evidence">
        <div className="oneline" title={props.plan.goal}>{props.plan.goal}</div>
        <div className="consequence">
          {STR.gate.planFiles.replace("{count}", String(props.plan.files.length))}
          {verifyChips.length > 0 ? STR.gate.planVerify.replace("{count}", String(verifyChips.length)) : ""}
        </div>
        {expanded && (
          <>
            {props.plan.approach && <div className="plan-approach">{props.plan.approach}</div>}
            <div className="file-list">
              {props.plan.files.map((f, i) => (
                <div className="file-item" key={i}>
                  <span className={`chip ${f.action === "create" ? "ok" : f.action === "delete" ? "danger" : ""}`}>{planActionLabel(f.action)}</span>
                  <span className="path">{f.path}</span>
                  {"summary" in f && typeof f.summary === "string" && <span className="sum">{f.summary}</span>}
                </div>
              ))}
            </div>
            <div className="verify-line">
              {verifyChips.length > 0
                ? verifyChips.map((v, i) => <span className="vchip" key={i}>{v}</span>)
                : <span>{STR.gate.planNoVerify}</span>}
            </div>
          </>
        )}
      </div>
      <div className="card-actions">
        {/* 2026-11-02：与审批卡同序——拒绝在前、主按钮钉最右（此前主钮在最左）。 */}
        <button className="btn secondary" data-gate-reject onClick={() => props.onDecide(false, props.callId)}>{STR.gate.reject}</button>
        <span className="spacer" />
        <span className="consequence">{STR.gate.planConsequence}</span>
        <button className="btn primary" data-gate-accept onClick={() => props.onDecide(true, props.callId)}>{STR.gate.planApprove}</button>
      </div>
    </div>
  );
}
