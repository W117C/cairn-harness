import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentEvent, AskPayload, SessionInfoPayload } from "../../../../src/main/ipc-protocol";
import { deriveRunPhase, projectStream } from "./projections";
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
  const [, force] = useState(0);

  useEffect(() => {
    void window.agent.listSessions().then(setSessions);
    const offEvent = window.agent.onEvent((e) => {
      setEvents((prev) => [...prev, e]);
      const sid = (e as { session_id?: string }).session_id;
      if (sid) { runningSet.current.add(sid); force((n) => n + 1); }
    });
    const offAsk = window.agent.onAsk((p) => setAsk(p));
    const offDone = window.agent.onAskDone(() => setAsk(null));
    return () => { offEvent(); offAsk(); offDone(); };
  }, []);

  const send = useCallback(async (text: string) => {
    const id = activeId ?? (await window.agent.createSession()).id;
    setActiveId(id);
    setRunning(true);
    try { await window.agent.run({ message: text, mode: "default", sessionId: id }); }
    finally { runningSet.current.delete(id); setRunning(false); force((n) => n + 1); }
  }, [activeId]);

  const phase = deriveRunPhase(events, ask !== null);

  return (
    <div className="shell">
      <Sidebar sessions={sessions} activeId={activeId} running={runningSet.current} onOpen={(id) => {
        setActiveId(id);
        void window.agent.openSession(id).then((r) => setEvents(r.events));
      }} />
      <div className="main">
        <div className="sessionbar">
          <span style={{ fontWeight: 600 }}>{activeId ?? "m0"}</span>
          <span style={{ fontSize: 11, color: "var(--text-3)" }}>
            {phase === "ask" ? "● 等待审批" : phase === "thinking" ? "● 思考中" : phase === "tool" ? "● 执行工具" : "○ 就绪"}
          </span>
        </div>
        <Stream rows={projectStream(events)} />
        {ask && <div style={{ padding: "0 16px" }}><ApprovalCard ask={ask} onDecide={(approved, scope) => { void window.agent.decide(ask.askId, approved, scope); }} /></div>}
        <Composer onSend={(t) => void send(t)} disabled={running} />
      </div>
    </div>
  );
}
