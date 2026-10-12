// C-16 PlanCard（v2.9 紧凑态）：头行（标题+wait chip+详情▾）→ 目标行 → 动作行（含文件数/验证面）。
// 展开详情 = approach 段 / 文件清单（action 徽标）/ 验证面 chips / 后果行（拒绝 = 写禁维持、模型须修订）。
import { useState } from "react";
import type { PlanProposal } from "../../../../../src/events";

const ACTION_LABEL: Record<string, string> = { create: "新建", edit: "修改", delete: "删除" };

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
    <div className="card" data-exp={expanded ? "true" : "false"}>
      <div className="card-head">
        <span className="ico-wait" aria-hidden="true">
          <svg width="15" height="15" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><circle cx="7" cy="7" r="5.2"/><path d="M7 4.2V7l2 1.2"/></svg>
        </span>
        <h3>模型提交了方案</h3>
        <span className="chip wait">待批</span>
        <span className="spacer" />
        <button className="iconbtn sm" data-card-exp aria-label={expanded ? "收起详情" : "展开详情"} onClick={() => setExpanded(!expanded)}>
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ transform: expanded ? "rotate(180deg)" : undefined, transition: "transform var(--t-fast)" }}><path d="m3.5 5.5 3.5 3.5 3.5-3.5"/></svg>
        </button>
      </div>
      <div className="oneline" title={props.plan.goal}>{props.plan.goal}</div>
      {expanded && (
        <>
          {props.plan.approach && <div className="plan-approach">{props.plan.approach}</div>}
          <div className="file-list">
            {props.plan.files.map((f, i) => (
              <div className="file-item" key={i}>
                <span className={`chip ${f.action === "create" ? "ok" : f.action === "delete" ? "danger" : ""}`}>{ACTION_LABEL[f.action] ?? f.action}</span>
                <span className="path">{f.path}</span>
                {"summary" in f && typeof f.summary === "string" && <span className="sum">{f.summary}</span>}
              </div>
            ))}
          </div>
          <div className="verify-line">
            {verifyChips.length > 0
              ? verifyChips.map((v, i) => <span className="vchip" key={i}>{v}</span>)
              : <span>未声明验证面</span>}
          </div>
        </>
      )}
      <div className="card-actions">
        <button className="btn primary" onClick={() => props.onDecide(true, props.callId)}>批准方案</button>
        <button className="btn secondary" onClick={() => props.onDecide(false, props.callId)}>拒绝</button>
        <span className="spacer" />
        <span className="consequence">
          {String(props.plan.files.length)} 个文件{verifyChips.length > 0 ? ` · 验证面 ${String(verifyChips.length)} 项` : ""}
          {" · 批准解除写禁；拒绝 = 写禁维持、模型须修订重提"}
        </span>
      </div>
    </div>
  );
}
