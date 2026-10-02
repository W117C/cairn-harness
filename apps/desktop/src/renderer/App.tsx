import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentEvent, AskPayload, SessionInfoPayload } from "../../../../src/main/ipc-protocol";
import { deriveRunPhase, pendingClarifyOf, pendingPlanOf, projectStream } from "./projections";
import { Sidebar } from "./components/Sidebar";
import { Stream } from "./components/Stream";
import { Composer } from "./components/Composer";
import { ApprovalCard } from "./components/ApprovalCard";

declare global { interface Window { agent: import("../../../../src/main/ipc-protocol").AgentApi } }

export function App() {
  const [sessions, setSessions] = useState<SessionInfoPayload[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [ask, setAsk] = useState<AskPayload | null>(null);
  const [running, setRunning] = useState(false);
  const runningSet = useRef(new Set<string>());
  // onEvent 闭包只建一次 ⇒ 用 ref 存当前活跃会话，避免读到过期 activeId（M1 T5 串屏收口）。
  const activeIdRef = useRef<string | null>(null);
  const [, force] = useState(0);

  useEffect(() => {
    void window.agent.listSessions().then(setSessions);
    const offEvent = window.agent.onEvent((e) => {
      // 事件分桶过滤：非活跃会话的事件只更新侧栏 running 集合，不进当前流
      //（agent:event 是全局通道，goal/定时 run 的事件带 session_id，按当前会话分流）。
      const sid = (e as { session_id?: string }).session_id;
      if (sid && sid !== activeIdRef.current) {
        runningSet.current.add(sid);
        force((n) => n + 1);
        return;
      }
      setEvents((prev) => [...prev, e]);
      if (sid) { runningSet.current.add(sid); force((n) => n + 1); }
    });
    const offAsk = window.agent.onAsk((p) => setAsk(p));
    const offDone = window.agent.onAskDone(() => setAsk(null));
    return () => { offEvent(); offAsk(); offDone(); };
  }, []);

  // activeId 的 ref/state 同点双写（ref 同步生效零竞态，state 驱动渲染）。
  const activate = useCallback((id: string | null) => {
    activeIdRef.current = id;
    setActiveId(id);
  }, []);

  const send = useCallback(async (text: string) => {
    const id = activeId ?? (await window.agent.createSession()).id;
    activate(id);
    setRunning(true);
    try { await window.agent.run({ message: text, mode: "default", sessionId: id }); }
    finally { runningSet.current.delete(id); setRunning(false); force((n) => n + 1); }
  }, [activeId, activate]);

  // 澄清/方案门的未决投影提到渲染体：供 deriveRunPhase 四参判相位 + 占位卡（M2-5 换真卡）。
  const pendingClarify = pendingClarifyOf(events);
  const pendingPlan = pendingPlanOf(events);
  // carry-forward（M2-2 审查）：必须四参全接——缺省 false 会让 clarify/plan 相位静默点不亮。
  const phase = deriveRunPhase(events, ask !== null, pendingClarify !== null, pendingPlan !== null);
  const phaseLabel = phase === "ask" ? "● 等待审批"
    : phase === "clarify" ? "● 等待澄清"
    : phase === "plan" ? "● 等待方案"
    : phase === "thinking" ? "● 思考中"
    : phase === "tool" ? "● 执行工具"
    : "○ 就绪";

  return (
    <div className="shell">
      <Sidebar sessions={sessions} activeId={activeId} running={runningSet.current} onOpen={(id) => {
        activate(id);
        void window.agent.openSession(id).then((r) => setEvents(r.events));
      }} />
      <div className="main">
        <div className="sessionbar">
          <span style={{ fontWeight: 600 }}>{activeId ?? "m0"}</span>
          <span style={{ fontSize: 11, color: "var(--text-3)" }}>{phaseLabel}</span>
        </div>
        <Stream rows={projectStream(events)} />
        {ask && <div style={{ padding: "0 16px" }}><ApprovalCard ask={ask} onDecide={(approved, scope) => { void window.agent.decide(ask.askId, approved, scope); }} /></div>}
        {/* 占位空态（M2-5 直接填真卡）：澄清表单卡 / 方案批准卡 */}
        {pendingClarify && (
          <div style={{ padding: "0 16px 0" }}>
            <div className="card-approval" style={{ borderLeftColor: "var(--text-3)" }}>
              澄清待答（{pendingClarify.questions.length} 问）——表单卡 M2-5 接入
            </div>
          </div>
        )}
        {pendingPlan && (
          <div style={{ padding: "0 16px 0" }}>
            <div className="card-approval" style={{ borderLeftColor: "var(--text-3)" }}>
              方案待批：{pendingPlan.plan.goal}——批准卡 M2-5 接入
            </div>
          </div>
        )}
        <Composer onSend={(t) => void send(t)} disabled={running} />
      </div>
    </div>
  );
}
