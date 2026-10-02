import type { PlanProposal } from "../../../../../src/events";
import { planFileLines } from "./cards";

/**
 * 方案卡（M2-5）：goal/files/approach/verify 全量呈现，批准/拒绝都带 callId 决议
 * （plan_proposed → tool_result 同 id 收口，卡片由选择器自然消失）。
 */
export function PlanCard(props: {
  callId: string;
  plan: PlanProposal;
  onDecide: (approved: boolean, callId: string) => void;
}) {
  const verify = props.plan.verify;
  return (
    <div className="card-approval card-plan" style={{ borderLeftColor: "var(--text-3)" }}>
      <div style={{ fontWeight: 600 }}>方案待批：{props.plan.goal}</div>
      {props.plan.approach && <div className="cmd" style={{ whiteSpace: "pre-wrap" }}>{props.plan.approach}</div>}
      <div className="cmd">
        {planFileLines(props.plan.files).map((line, i) => (
          <div key={i}>{line}</div>
        ))}
      </div>
      {verify && (verify.lint?.length || verify.test?.length) ? (
        <div className="cmd">
          {verify.lint?.length ? <div>验证 lint：{verify.lint.join(" && ")}</div> : null}
          {verify.test?.length ? <div>验证 test：{verify.test.join(" && ")}</div> : null}
        </div>
      ) : null}
      <div className="actions">
        <button className="btn-primary" onClick={() => props.onDecide(true, props.callId)}>批准</button>
        <button className="btn-ghost" onClick={() => props.onDecide(false, props.callId)}>拒绝</button>
      </div>
    </div>
  );
}
