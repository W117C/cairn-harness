import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentEvent, AskPayload, ProviderInfo, RunResponse, SessionInfoPayload } from "../../../../src/main/ipc-protocol";
import { deriveRunPhase, pendingClarifyOf, pendingPlanOf, projectStream, usageAggregate } from "./projections";
import { Sidebar } from "./components/Sidebar";
import { Stream } from "./components/Stream";
import { Composer } from "./components/Composer";
import { ApprovalCard } from "./components/ApprovalCard";
import { ClarifyCard } from "./components/ClarifyCard";
import { PlanCard } from "./components/PlanCard";
import { ModelPicker } from "./components/ModelPicker";
import { TokenPanel } from "./components/TokenPanel";

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
  // M2-4 模型选择：per-session 内存态（Map<sessionId, registryId|null>），M4 才落 settings。
  // null = 该会话显式选 demo；缺项 = 未选（run 不透传 model，走 main 侧 settings 缺省）。
  const selections = useRef(new Map<string, string | null>());
  const [providerInfo, setProviderInfo] = useState<ProviderInfo | null>(null);
  // M2 终审修复（spec §6.3 打断动作）→ M3-5 升级为真值驱动：置态有两条来源——
  // ① 点击打断时的本地上态（即时反馈：host cancel 的 round-trip 收束前先亮标签）；② run 收束响应的
  // aborted 真值（kernel-host 扩展字段）。收束后 aborted 为假且标记在场 ⇒ 清除——「点了打断但 run
  // 其实没被打断」的假标记就此收口，不再覆盖到下次 send。
  const [stoppedIds, setStoppedIds] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    void window.agent.listSessions().then(setSessions);
    void window.agent.getProviderInfo().then(setProviderInfo);
    const offEvent = window.agent.onEvent((e) => {
      // 事件分桶过滤：非活跃会话的事件只更新侧栏 running 集合，不进当前流
      //（agent:event 是全局通道，带 sessionId 的 run——含普通交互 run——事件恒带 session_id，按当前会话分流）。
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
    // 新任务开始即清除该会话的已停标记（上轮标记就此收口；本轮是否「已停止」由收束响应重新裁决）。
    setStoppedIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setRunning(true);
    try {
      // M2-4：selected 为该会话 registryId；null/未选 ⇒ 不传（?? undefined），走 settings 缺省＝demo。
      // 注：协议无「经 model 选 demo」的表达（RunRequest.model 只收稳定 registry id），
      // settings 缺省为真实 provider 时选 demo 仍走缺省——M4 选择态落 settings 后消除。
      // aborted 是 kernel-host 的 desktop 扩展字段（当且仅当本会话 controller 被 abort，刻意不进
      // ipc-protocol 的 RunResponse）⇒ 渲染层以交叉类型收窄取用。
      const res = (await window.agent.run({
        message: text, mode: "default", sessionId: id, model: selections.current.get(id) ?? undefined,
      })) as RunResponse & { aborted?: boolean };
      // M3-5 已停态真值校正：收束以响应为准——真打断 ⇒ 置标；没打断（含竞速：run 先收束 ⇒
      // host.cancel {ok:false}）而标记在场 ⇒ 清除，本地点击的假标记不残留。
      setStoppedIds((prev) => {
        const want = res.aborted === true;
        if (prev.has(id) === want) return prev;
        const next = new Set(prev);
        if (want) next.add(id); else next.delete(id);
        return next;
      });
    }
    finally { runningSet.current.delete(id); setRunning(false); force((n) => n + 1); }
  }, [activeId, activate]);

  // 澄清/方案门的未决投影提到渲染体：供 deriveRunPhase 四参判相位 + 真卡渲染（M2-5 三卡同位互斥）。
  const pendingClarify = pendingClarifyOf(events);
  const pendingPlan = pendingPlanOf(events);
  // carry-forward（M2-2 审查）：必须四参全接——缺省 false 会让 clarify/plan 相位静默点不亮。
  const phase = deriveRunPhase(events, ask !== null, pendingClarify !== null, pendingPlan !== null);
  // 已停态覆盖（终审 Recommendation 2 第一步）：该会话被打断且 run 已收束时，标签「■ 已停止」
  // 覆盖 deriveRunPhase 的「○ 就绪」——否则 cancel 后与正常完成不可分辨。其余相位逻辑不动。
  const stopped = activeId !== null && stoppedIds.has(activeId) && !running;
  const phaseLabel = stopped ? "■ 已停止"
    : phase === "ask" ? "● 等待审批"
    : phase === "clarify" ? "● 等待澄清"
    : phase === "plan" ? "● 等待方案"
    : phase === "thinking" ? "● 思考中"
    : phase === "tool" ? "● 执行工具"
    : "○ 就绪";
  // 选择器显示值：该会话显式选择优先；未选回落 settings 缺省（getProviderInfo 的当前 modelId，
  // demo 缺省即 null ⇒ 显示「演示」）——与 run 侧「未选不透传」的生效语义一致。
  const chosen = activeId !== null ? selections.current.get(activeId) : undefined;
  const pickerValue = chosen !== undefined ? chosen : (providerInfo?.modelId ?? null);
  const usage = usageAggregate(events);

  return (
    <div className="shell">
      <Sidebar sessions={sessions} activeId={activeId} running={runningSet.current} onOpen={(id) => {
        activate(id);
        void window.agent.openSession(id).then((r) => setEvents(r.events));
      }} />
      <div className="main">
        <div className="sessionbar">
          <span style={{ fontWeight: 600 }}>{activeId ?? "m0"}</span>
          {activeId !== null && (
            <ModelPicker
              infos={providerInfo ? [providerInfo] : []}
              value={pickerValue}
              disabled={running}
              onChange={(registryId) => { selections.current.set(activeId, registryId); force((n) => n + 1); }}
            />
          )}
          <span style={{ fontSize: 11, color: "var(--text-3)" }}>{phaseLabel}</span>
          {/* spec §6.3：打断动作，运行中可见。M3-5 接线会话级：runCancel(activeId) → kernel-host
              cancel(sessionId)（T2 per-session controller）——不再是无参失效窗口（host.cancel(undefined)
              恒 {ok:false,"会话不在运行"}）。本地点击置态仅为即时反馈，真值由 send 收束响应校正。
              不 confirm——误触代价是本轮 run 收束（fail-closed），不是数据损失。 */}
          {running && (
            <button
              className="btn-ghost"
              onClick={() => {
                if (activeId === null) return; // running ⇒ 恒有活跃会话；守卫只防未来接线破坏该不变量
                setStoppedIds((prev) => new Set(prev).add(activeId));
                void window.agent.runCancel(activeId);
              }}
            >打断</button>
          )}
          <TokenPanel inputTokens={usage.inputTokens} outputTokens={usage.outputTokens} />
        </div>
        <Stream rows={projectStream(events)} />
        {/* M2-5 三卡同位互斥（ask > clarify > plan，一个三元链）：审批走 onAsk 状态，
            澄清/方案走事件选择器；提交/决议后由事件收口（tool_result / plan_approved）自然消卡。 */}
        {(ask || pendingClarify || pendingPlan) && (
          <div style={{ padding: "0 16px" }}>
            {ask ? (
              <ApprovalCard ask={ask} onDecide={(approved, scope) => { void window.agent.decide(ask.askId, approved, scope); }} />
            ) : pendingClarify ? (
              <ClarifyCard
                key={pendingClarify.callId}
                callId={pendingClarify.callId}
                questions={pendingClarify.questions}
                onSubmit={(callId, answers) => { void window.agent.submitClarify(callId, answers); }}
              />
            ) : pendingPlan ? (
              <PlanCard
                key={pendingPlan.callId}
                callId={pendingPlan.callId}
                plan={pendingPlan.plan}
                onDecide={(approved, callId) => { void window.agent.decidePlan(approved, callId); }}
              />
            ) : null}
          </div>
        )}
        <Composer onSend={(t) => void send(t)} disabled={running} />
      </div>
    </div>
  );
}
