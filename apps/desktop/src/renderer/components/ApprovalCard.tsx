import { useState } from "react";
import type { AskPayload } from "../../../../../src/main/ipc-protocol";

/**
 * 审批卡（M1 ApprovalCard ＋ M2-5 scope 展开）：
 * 「总是允许」点击后就地展开两选沉淀权限规则——「本会话此类」= session_kind、「总是」= always，
 * 选定即 decide(askId, true, scope)；「取消」收回展开。允许/拒绝两键行为不变（scope 缺省 once）。
 */
export function ApprovalCard(props: { ask: AskPayload; onDecide: (approved: boolean, scope?: "once" | "session_kind" | "always") => void }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="card-approval">
      <div style={{ fontWeight: 600 }}>允许 {props.ask.tool}？{props.ask.risk ? ` · 风险：${props.ask.risk}` : ""}</div>
      <div className="cmd">{JSON.stringify(props.ask.args)}</div>
      <div className="actions">
        <button className="btn-primary" onClick={() => props.onDecide(true)}>允许</button>
        <button className="btn-ghost" onClick={() => props.onDecide(false)}>拒绝</button>
        {!expanded ? (
          <button className="btn-ghost" style={{ marginLeft: "auto" }} onClick={() => setExpanded(true)}>总是允许</button>
        ) : (
          <>
            <button className="btn-ghost" style={{ marginLeft: "auto" }} onClick={() => props.onDecide(true, "session_kind")}>本会话此类</button>
            <button className="btn-ghost" onClick={() => props.onDecide(true, "always")}>总是</button>
            <button className="btn-ghost" onClick={() => setExpanded(false)}>取消</button>
          </>
        )}
      </div>
    </div>
  );
}
