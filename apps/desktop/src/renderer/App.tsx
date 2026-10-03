import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentEvent, AskPayload, ProjectRecord, ProviderInfo, RunResponse } from "../../../../src/main/ipc-protocol";
import { deriveRunPhase, pendingClarifyOf, pendingPlanOf, projectStream, usageAggregate } from "./projections";
import { Sidebar, type WorkspaceSession } from "./components/Sidebar";
import { Stream } from "./components/Stream";
import { Composer } from "./components/Composer";
import { ApprovalCard } from "./components/ApprovalCard";
import { ClarifyCard } from "./components/ClarifyCard";
import { PlanCard } from "./components/PlanCard";
import { ErrorStrip } from "./components/ErrorStrip";
import { ModelPicker } from "./components/ModelPicker";
import { TokenPanel } from "./components/TokenPanel";
import { SettingsPanel } from "./components/SettingsPanel";

declare global { interface Window { agent: import("../../../../src/main/ipc-protocol").AgentApi } }

export function App() {
  // M3-3：会话清单带归属工作区（host.listSessions 的 desktop 扩展字段，交叉类型收窄——同 aborted 先例）。
  const [sessions, setSessions] = useState<WorkspaceSession[]>([]);
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
  // M3-3 工作区面：注册清单（ProjectRecord.path 即工作区）＋新任务归属（null＝host 缺省，
  // 未显式切换）。切换纯渲染态：send 经 createSession(workspace) 显式带参，不动 host 装配。
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [registryNotice, setRegistryNotice] = useState<string | null>(null);
  const [activeWorkspace, setActiveWorkspace] = useState<string | null>(null);
  // M1 T3 deferred 收口（onOpen 竞态守卫）：openSession 前 snapshot 递增 seq，回调时
  // seq !== latest ⇒ 慢开的旧响应丢弃——快速切换两个会话不再错流（B 的迟到事件盖掉 A 的流）。
  const openSeq = useRef(0);
  // M3-4 失败反馈（M2 T5 deferred 收口）：统一错误条的单一事实源。run !ok 与 clarify/plan
  // 提交失败同面提示；× 清除（渲染处），切换会话也清（activate 内——错误贴会话，不串屏）。
  const [lastError, setLastError] = useState<string | null>(null);
  // M2 终审修复（spec §6.3 打断动作）→ M3-5 升级为真值驱动：置态有两条来源——
  // ① 点击打断时的本地上态（即时反馈：host cancel 的 round-trip 收束前先亮标签）；② run 收束响应的
  // aborted 真值（kernel-host 扩展字段）。收束后 aborted 为假且标记在场 ⇒ 清除——「点了打断但 run
  // 其实没被打断」的假标记就此收口，不再覆盖到下次 send。
  const [stoppedIds, setStoppedIds] = useState<ReadonlySet<string>>(new Set());
  // M4-2 设置面板开关：侧栏底部⚙入口开（spec §6.1 左下角「设置」入口）；弹出面挂在 shell 根，
  // 无遮罩层（颜色只用既有变量），× 关闭。
  const [settingsOpen, setSettingsOpen] = useState(false);

  // 会话清单刷新：挂载一次 ＋ 新建会话后（新会话即刻进侧栏、落到归属工作区组）。
  const refreshSessions = useCallback(() => {
    void (window.agent.listSessions() as Promise<WorkspaceSession[]>).then(setSessions);
  }, []);

  // M2 deferred 收口（M4-2）：providerInfo 此前只挂载拉一次 ⇒ settings.provider/model 变更后
  // 目录与缺省显示永久滞后。刷新口提出来：挂载一次 ＋ 设置面板每笔 setSettings 成功后重拉
  // （demo 选择协议闭环：settings.provider 改成 demo，选择器目录与缺省显示立刻真生效）。
  const refreshProviderInfo = useCallback(() => {
    return window.agent.getProviderInfo().then(setProviderInfo);
  }, []);

  useEffect(() => {
    refreshSessions();
    void refreshProviderInfo();
    // 注册清单（CX-01 三通道，M3-3 修复轮起 main 侧 wired 接线）：失败 fail-visible——侧栏提示行
    // ＋全部会话垫「其他」组，不静默吞（分组纯函数对空注册表的语义就是零丢失）。
    void window.agent.listProjects().then((registered) => {
      setProjects(registered);
      setRegistryNotice(null);
    }).catch((err: unknown) => {
      setRegistryNotice(`项目注册表不可用：${err instanceof Error ? err.message : String(err)}`);
    });
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
  }, [refreshSessions, refreshProviderInfo]);

  // activeId 的 ref/state 同点双写（ref 同步生效零竞态，state 驱动渲染）。
  // M3-4：切会话顺带清错误条——错误条画在当前会话条下方，跨会话残留会被误读成新会话的失败。
  const activate = useCallback((id: string | null) => {
    activeIdRef.current = id;
    setActiveId(id);
    setLastError(null);
  }, []);

  // 打开会话（守卫版）：seq 先递增，慢响应回来时 seq 已被更新 ⇒ 丢弃（M1 T3 deferred 收口）。
  const openSession = useCallback((id: string) => {
    activate(id);
    const seq = ++openSeq.current;
    void window.agent.openSession(id).then((r) => {
      if (seq !== openSeq.current) return; // 期间又点了别的会话：本响应过期，不覆盖现流
      setEvents(r.events);
    });
  }, [activate]);

  // 添加工作区（M3-3 最小表单 → addProject 桥）：AddProjectInput 只填 path——名称缺省取路径末段、
  // defaultLocation 缺省同 path（project-registry canonical 化并查重）。成功后刷新注册清单＋会话清单：
  // main 侧 addProject handler 已同步 host.addWorkspace(record.path)（新工作区并入 host 扫描面），
  // 新工作区的存量会话即刻可经 listSessions 出现。
  const addWorkspace = useCallback(async (path: string) => {
    await window.agent.addProject({ path });
    const registered = await window.agent.listProjects();
    setProjects(registered);
    setRegistryNotice(null);
    refreshSessions();
  }, [refreshSessions]);

  const send = useCallback(async (text: string) => {
    // M3-3：新任务落当前选中的工作区（未切换＝缺省参 → host activeWorkspace）。
    const isNew = activeId === null;
    const id = activeId ?? (await window.agent.createSession(activeWorkspace ?? undefined)).id;
    activate(id);
    if (isNew) refreshSessions();
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
      // M3-4 失败反馈：run !ok ⇒ 统一错误条。用户打断（aborted=true）不算失败——已停态有专门的
      // 「■ 已停止」标签，不再叠报错（kernel-host：当且仅当本会话 controller 被 abort 才带 aborted）。
      if (!res.ok && res.aborted !== true) setLastError(res.error ?? "本轮运行失败");
    }
    catch (err) {
      // run 的常规失败走 !ok 响应（handleAgentRun 顶层全捕获）；这里是 IPC 层意外 reject 的兜底
      // ——同面提示，不静默（否则 void send 的 rejection 无人接）。
      setLastError(`本轮运行失败：${err instanceof Error ? err.message : String(err)}`);
    }
    finally { runningSet.current.delete(id); setRunning(false); force((n) => n + 1); }
  }, [activeId, activeWorkspace, activate, refreshSessions]);

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
      {/* M3-3 分组侧栏：分组点击只切 activeWorkspace（新任务归属），不 openSession、不扰在跑会话；
          会话行点击走守卫版 openSession（seq 竞态守卫）。M4-2 外包一层 .sidebar-col：
          底部补「⚙ 设置」入口（brief 所指的占位此前未落，本笔按 spec 左下角入口补上）。 */}
      <div className="sidebar-col">
        <Sidebar
          sessions={sessions}
          workspaces={projects.map((p) => p.path)}
          activeId={activeId}
          activeWorkspace={activeWorkspace}
          running={runningSet.current}
          notice={registryNotice}
          onOpen={openSession}
          onSwitchWorkspace={setActiveWorkspace}
          onAddWorkspace={addWorkspace}
        />
        <button className="btn-ghost settings-entry" onClick={() => setSettingsOpen(true)}>⚙ 设置</button>
      </div>
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
        {/* M3-4 统一错误条：会话条下方，可关闭（× 清 lastError）；切会话即清（activate 内）。
            三个来源同面：run !ok（error 文案）、澄清提交失败、方案决议失败。 */}
        {lastError !== null && <ErrorStrip message={lastError} onDismiss={() => setLastError(null)} />}
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
                onSubmit={(callId, answers) => {
                  // M3-4：澄清提交失败（返回 false 或 reject）同面提示——fire-and-forget 不再静默
                  // （M2 T5 deferred 收口）。
                  void window.agent.submitClarify(callId, answers).then((ok) => {
                    if (!ok) setLastError("澄清提交失败");
                  }).catch((err: unknown) => {
                    setLastError(`澄清提交失败：${err instanceof Error ? err.message : String(err)}`);
                  });
                }}
              />
            ) : pendingPlan ? (
              <PlanCard
                key={pendingPlan.callId}
                callId={pendingPlan.callId}
                plan={pendingPlan.plan}
                onDecide={(approved, callId) => {
                  // M3-4：方案决议失败（返回 false 或 reject）同面提示（同上）。
                  void window.agent.decidePlan(approved, callId).then((ok) => {
                    if (!ok) setLastError("方案决议失败");
                  }).catch((err: unknown) => {
                    setLastError(`方案决议失败：${err instanceof Error ? err.message : String(err)}`);
                  });
                }}
              />
            ) : null}
          </div>
        )}
        <Composer onSend={(t) => void send(t)} disabled={running} />
      </div>
      {/* M4-2 设置面板：onSettingsSaved ⇒ 重拉 getProviderInfo（M2 deferred 刷新收口——
          settings.provider/model 变更成功后目录/缺省立即跟上）。 */}
      {settingsOpen && (
        <SettingsPanel
          onClose={() => setSettingsOpen(false)}
          onSettingsSaved={() => void refreshProviderInfo()}
        />
      )}
    </div>
  );
}
