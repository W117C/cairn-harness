import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentEvent, AskPayload, PermissionMode, ProjectRecord, ProviderInfo, RunResponse } from "../../../../src/main/ipc-protocol";
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
import { Onboarding, needsOnboarding } from "./components/Onboarding";

declare global { interface Window { agent: import("../../../../src/main/ipc-protocol").AgentApi } }

export function App() {
  // M3-3：会话清单带归属工作区（host.listSessions 的 desktop 扩展字段，交叉类型收窄——同 aborted 先例）。
  const [sessions, setSessions] = useState<WorkspaceSession[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [ask, setAsk] = useState<AskPayload | null>(null);
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
  // M3-4 失败反馈（M2 T5 deferred 收口）→ M4-4 会话键控（M3 T4 deferred 收口）：错误条单一
  // 事实源从全局单值改为 Map<sessionId, message>——错误贴会话，切会话各看各的（activate 不再
  // 整条清除），点 × 只清当前会话（渲染处）。无活跃会话（新任务 createSession 拒绝）落 ""
  // 哨兵键，仅在主区未选会话时显示。写入面收在稳定回调：键取 activeIdRef 当前值（ref 同步
  // 生效，send/三卡回调里不读过期 state）。
  const [sessionErrors, setSessionErrors] = useState<ReadonlyMap<string, string>>(new Map());
  const setLastError = useCallback((message: string) => {
    setSessionErrors((prev) => new Map(prev).set(activeIdRef.current ?? "", message));
  }, []);
  const clearLastError = useCallback(() => {
    setSessionErrors((prev) => {
      const key = activeIdRef.current ?? "";
      if (!prev.has(key)) return prev;
      const next = new Map(prev);
      next.delete(key);
      return next;
    });
  }, []);
  // M4-4（M2-T2 遗留收口）：权限档从 settings 读——挂载经 getSettings 载入、设置面板保存成功
  // 后经 onSettingsSaved 同步刷新；send 透传该值（此前硬编码 "default"，面板写了 mode 但派活
  // 不生效）。档位集合唯一事实源 src/permissions/modes：read-only/default/guided/auto——
  // **无 "plan" 档**（plan 门语义由 planRequiredByDefault/plan 门独立承载），RunRequest.mode
  // 即 PermissionMode，如实透传即可。
  const [mode, setMode] = useState<PermissionMode>("default");
  // M2 终审修复（spec §6.3 打断动作）→ M3-5 升级为真值驱动：置态有两条来源——
  // ① 点击打断时的本地上态（即时反馈：host cancel 的 round-trip 收束前先亮标签）；② run 收束响应的
  // aborted 真值（kernel-host 扩展字段）。收束后 aborted 为假且标记在场 ⇒ 清除——「点了打断但 run
  // 其实没被打断」的假标记就此收口，不再覆盖到下次 send。
  const [stoppedIds, setStoppedIds] = useState<ReadonlySet<string>>(new Set());
  // M4-2 设置面板开关：侧栏底部⚙入口开（spec §6.1 左下角「设置」入口）；弹出面挂在 shell 根，
  // 无遮罩层（颜色只用既有变量），× 关闭。
  const [settingsOpen, setSettingsOpen] = useState(false);
  // M4-3 首启门（三态）：null = getSettings 在途——主区先不渲染（composer 是派活面，
  // 「不知道是否首启」的窗口里不给）；true/false 落定后按 needsOnboarding 裁决首启面/主区。
  const [onboarded, setOnboarded] = useState<boolean | null>(null);
  // 载入失败 fail-open（按已引导处理）：首启面不是安全门——桥坏了把用户锁在向导里更糟
  // （完成动作也要走同一座桥），demo 主区至少可见可诊断（报告已记录该取舍）。
  useEffect(() => {
    // M4-4：settings.mode 随同载入（onboarding 流程既有 getSettings 消费点顺带搭上）；
    // 载入失败 fail-open 同 onboarded——mode 保持缺省 "default"。
    void window.agent.getSettings().then((s) => { setOnboarded(s.onboarded); setMode(s.mode); }).catch(() => setOnboarded(true));
  }, []);

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
  // M4-4：错误条已会话键控（Map）——切会话改显「该会话自己的错误」，不再整条清除；
  // M3-4 当初「切会话清错误」防串屏的语义由键控本身达成。
  const activate = useCallback((id: string | null) => {
    activeIdRef.current = id;
    setActiveId(id);
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
  // 新工作区的存量会话即刻可经 listSessions 出现。M4-3：返回 canonical 路径——首启面向导据此选中
  // （registry 会 realpath 化，选中必须用返回值，不能用输入原文；侧栏表单忽略返回值不受影响）。
  const addWorkspace = useCallback(async (path: string): Promise<string> => {
    const record = await window.agent.addProject({ path });
    const registered = await window.agent.listProjects();
    setProjects(registered);
    setRegistryNotice(null);
    refreshSessions();
    return record.path;
  }, [refreshSessions]);

  // M4-3 完成：Onboarding 已把 onboarded:true 落盘成功（完成动作只此一键，见 onboardingCompletePatch）
  // 后回调到这里——退出首启面；若首启配了真实 provider，顺带重拉 getProviderInfo（同 T2 收口，
  // 目录/缺省显示立即跟上）。
  const finishOnboarding = useCallback(() => {
    setOnboarded(true);
    void refreshProviderInfo();
  }, [refreshProviderInfo]);

  const send = useCallback(async (text: string) => {
    // M3-3：新任务落当前选中的工作区（未切换＝缺省参 → host activeWorkspace）。
    const isNew = activeId === null;
    let id: string | undefined;
    try {
      // M4-4（M3 修复波照亮项收口）：createSession await 挪进 try——工作区白名单拒绝等
      // IPC reject 同面进错误条，不再静默漏出 void send 的 rejection。
      const sid = activeId ?? (await window.agent.createSession(activeWorkspace ?? undefined)).id;
      id = sid;
      activate(sid);
      if (isNew) refreshSessions();
      // 新任务开始即清除该会话的已停标记（上轮标记就此收口；本轮是否「已停止」由收束响应重新裁决）。
      setStoppedIds((prev) => {
        if (!prev.has(sid)) return prev;
        const next = new Set(prev);
        next.delete(sid);
        return next;
      });
      // M4-4 per-session running（M2-T5 边角收口）：runningSet 是唯一真值——本会话起跑即刻入集
      // （force 触发重渲，沿用既有模式），composer/打断按钮按 activeId 的运行态禁用，首个事件
      // 到来前就有正确禁用面；收束在 finally 出集。
      runningSet.current.add(sid);
      force((n) => n + 1);
      // M2-4：selected 为该会话 registryId；null/未选 ⇒ 不传（?? undefined），走 settings 缺省＝demo。
      // 注：协议无「经 model 选 demo」的表达（RunRequest.model 只收稳定 registry id），
      // settings 缺省为真实 provider 时选 demo 仍走缺省——M4 选择态落 settings 后消除。
      // M4-4（M2-T2 遗留收口）：mode 不再硬编码 "default"——透传 settings.mode（挂载经
      // getSettings 载入、面板保存后刷新；档位唯一事实源 src/permissions/modes，无 "plan" 档）。
      // aborted 是 kernel-host 的 desktop 扩展字段（当且仅当本会话 controller 被 abort，刻意不进
      // ipc-protocol 的 RunResponse）⇒ 渲染层以交叉类型收窄取用。
      const res = (await window.agent.run({
        message: text, mode, sessionId: sid, model: selections.current.get(sid) ?? undefined,
      })) as RunResponse & { aborted?: boolean };
      // M3-5 已停态真值校正：收束以响应为准——真打断 ⇒ 置标；没打断（含竞速：run 先收束 ⇒
      // host.cancel {ok:false}）而标记在场 ⇒ 清除，本地点击的假标记不残留。
      setStoppedIds((prev) => {
        const want = res.aborted === true;
        if (prev.has(sid) === want) return prev;
        const next = new Set(prev);
        if (want) next.add(sid); else next.delete(sid);
        return next;
      });
      // M3-4 失败反馈：run !ok ⇒ 统一错误条（M4-4 起按会话键控）。用户打断（aborted=true）不算
      // 失败——已停态有专门的「■ 已停止」标签，不再叠报错（kernel-host：当且仅当本会话
      // controller 被 abort 才带 aborted）。
      if (!res.ok && res.aborted !== true) setLastError(res.error ?? "本轮运行失败");
    }
    catch (err) {
      // run 的常规失败走 !ok 响应（handleAgentRun 顶层全捕获）；这里是 IPC 层意外 reject 的兜底
      // ——同面提示，不静默（否则 void send 的 rejection 无人接）。M4-4：createSession 拒绝也落此
      // （此时无活跃会话，错误条落 "" 哨兵键）。
      setLastError(`本轮运行失败：${err instanceof Error ? err.message : String(err)}`);
    }
    finally { if (id !== undefined) runningSet.current.delete(id); force((n) => n + 1); }
  }, [activeId, activeWorkspace, activate, refreshSessions, mode]);

  // M4-4 派生值（原全局 running 布尔的替代）：当前会话的错误条消息按 activeId 键取（无活跃
  // 会话落 "" 哨兵键）；runningActive 为活跃会话的运行态——runningSet（全量）has(activeId)，
  // ref 变更靠 send/onEvent 的 force 触发重渲（沿用既有模式）。切到在跑会话即显打断按钮、
  // composer 即刻禁用；切到空闲会话不再误显「打断」（M2-T5 边角）。
  const lastError = sessionErrors.get(activeId ?? "") ?? null;
  const runningActive = activeId !== null && runningSet.current.has(activeId);
  // 澄清/方案门的未决投影提到渲染体：供 deriveRunPhase 四参判相位 + 真卡渲染（M2-5 三卡同位互斥）。
  const pendingClarify = pendingClarifyOf(events);
  const pendingPlan = pendingPlanOf(events);
  // carry-forward（M2-2 审查）：必须四参全接——缺省 false 会让 clarify/plan 相位静默点不亮。
  const phase = deriveRunPhase(events, ask !== null, pendingClarify !== null, pendingPlan !== null);
  // 已停态覆盖（终审 Recommendation 2 第一步）：该会话被打断且 run 已收束时，标签「■ 已停止」
  // 覆盖 deriveRunPhase 的「○ 就绪」——否则 cancel 后与正常完成不可分辨。其余相位逻辑不动。
  // M4-4：运行态按会话判（runningActive）——别的会话在跑不再压住本会话的已停止标签。
  const stopped = activeId !== null && stoppedIds.has(activeId) && !runningActive;
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
          底部补「⚙ 设置」入口（brief 所指的占位此前未落，本笔按 spec 左下角入口补上）。
          M4-3：addWorkspace 现返回 canonical 路径（首启向导选中用）；侧栏表单签名不动，经适配
          丢弃返回值——Sidebar 的 onAddWorkspace 仍收 Promise<void>。 */}
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
          onAddWorkspace={(path) => addWorkspace(path).then(() => undefined)}
        />
        <button className="btn-ghost settings-entry" onClick={() => setSettingsOpen(true)}>⚙ 设置</button>
      </div>
      <div className="main">
        {/* M4-3 首启门（三态）：设置在途（null）只出安静载入面；needsOnboarding 真 ⇒ 两步首启
            覆盖主区（composer 是派活面——未配置/未知配置都不给派活窗口）；false ⇒ 正常主区。 */}
        {onboarded === null ? (
          <div className="onboarding">
            <div className="onboarding-card">
              <h2>Cairn</h2>
              <div className="settings-hint">正在载入设置…</div>
            </div>
          </div>
        ) : needsOnboarding({ onboarded }) ? (
          <Onboarding
            projects={projects}
            onAddWorkspace={addWorkspace}
            onSelectWorkspace={setActiveWorkspace}
            onComplete={finishOnboarding}
          />
        ) : (
          <>
            <div className="sessionbar">
              <span style={{ fontWeight: 600 }}>{activeId ?? "m0"}</span>
              {activeId !== null && (
                <ModelPicker
                  infos={providerInfo ? [providerInfo] : []}
                  value={pickerValue}
                  disabled={runningActive}
                  onChange={(registryId) => { selections.current.set(activeId, registryId); force((n) => n + 1); }}
                />
              )}
              <span style={{ fontSize: 11, color: "var(--text-3)" }}>{phaseLabel}</span>
              {/* spec §6.3：打断动作，运行中可见。M3-5 接线会话级：runCancel(activeId) → kernel-host
                  cancel(sessionId)（T2 per-session controller）——不再是无参失效窗口（host.cancel(undefined)
                  恒 {ok:false,"会话不在运行"}）。M4-4：可见性按活跃会话的运行态（runningActive）判——
                  别的会话在跑不再让空闲会话误显打断（M2-T5 边角收口）。本地点击置态仅为即时反馈，
                  真值由 send 收束响应校正。不 confirm——误触代价是本轮 run 收束（fail-closed），
                  不是数据损失。 */}
              {runningActive && (
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
            {/* M3-4 统一错误条 → M4-4 会话键控（M3 T4 deferred 收口）：显示当前会话（activeId 键）
                的错误，点 × 只清当前会话；切会话各看各的。四个来源同面：run !ok（error 文案）、
                审批/澄清/方案提交失败、createSession 拒绝（M4-4 起全数入条）。 */}
            {lastError !== null && <ErrorStrip message={lastError} onDismiss={clearLastError} />}
            <Stream rows={projectStream(events)} />
            {/* M2-5 三卡同位互斥（ask > clarify > plan，一个三元链）：审批走 onAsk 状态，
                澄清/方案走事件选择器；提交/决议后由事件收口（tool_result / plan_approved）自然消卡。 */}
            {(ask || pendingClarify || pendingPlan) && (
              <div style={{ padding: "0 16px" }}>
                {ask ? (
                  <ApprovalCard
                    ask={ask}
                    onDecide={(approved, scope) => {
                      // M4-4：审批决议失败（返回 false 或 reject）同面提示——三卡失败反馈就此齐
                      // （M2 T4 / M3 终审 M-4 收口，手法同 clarify/plan）。
                      void window.agent.decide(ask.askId, approved, scope).then((ok) => {
                        if (!ok) setLastError("审批提交失败");
                      }).catch((err: unknown) => {
                        setLastError(`审批提交失败：${err instanceof Error ? err.message : String(err)}`);
                      });
                    }}
                  />
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
            <Composer onSend={(t) => void send(t)} disabled={runningActive} />
          </>
        )}
      </div>
      {/* M4-2 设置面板：onSettingsSaved ⇒ 重拉 getProviderInfo（M2 deferred 刷新收口——
          settings.provider/model 变更成功后目录/缺省立即跟上）。M4-4：面板可改 mode ⇒
          同一事件点顺带重拉 settings.mode，send 透传即刻跟上（不再等重启）。 */}
      {settingsOpen && (
        <SettingsPanel
          onClose={() => setSettingsOpen(false)}
          onSettingsSaved={() => {
            void refreshProviderInfo();
            void window.agent.getSettings().then((s) => setMode(s.mode)).catch(() => undefined);
          }}
        />
      )}
    </div>
  );
}
