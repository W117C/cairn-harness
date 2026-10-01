import type { AskPayload } from "../../../../../src/main/ipc-protocol";

export function ApprovalCard(props: { ask: AskPayload; onDecide: (approved: boolean, scope?: "once" | "session_kind" | "always") => void }) {
  return (
    <div className="card-approval">
      <div style={{ fontWeight: 600 }}>允许 {props.ask.tool}？{props.ask.risk ? ` · 风险：${props.ask.risk}` : ""}</div>
      <div className="cmd">{JSON.stringify(props.ask.args)}</div>
      <div className="actions">
        <button className="btn-primary" onClick={() => props.onDecide(true)}>允许</button>
        <button className="btn-ghost" onClick={() => props.onDecide(false)}>拒绝</button>
        <button className="btn-ghost" style={{ marginLeft: "auto" }} onClick={() => props.onDecide(true, "always")}>总是允许</button>
      </div>
    </div>
  );
}
