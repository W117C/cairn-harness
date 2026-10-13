import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentEvent, AskPayload, PermissionMode, ProjectRecord, ProviderInfo, RunAttachmentReference, RunResponse } from "../../../../src/main/ipc-protocol";
import { deriveRunPhase, formatRevertNotice, pendingClarifyOf, pendingPlanOf, projectStream, roundTimeline, turnDelivery, usageAggregate, countToolSteps } from "./projections";
import { askBelongsToSession, composerLocked, continueAfterRun, drainQueue, dropQueued, fromSessionQueueEntries, promoteQueued, takeQueued, toSessionQueueEntries, type QueuedSend } from "./send-queue";
import { Sidebar, type WorkspaceSession } from "./components/Sidebar";
import { TitleBar } from "./components/TitleBar";
import { Stream } from "./components/Stream";
import { TurnRail } from "./components/TurnRail";
import { NewProjectCard } from "./components/NewProjectCard";
import { Composer } from "./components/Composer";
import { SendQueueStrip } from "./components/SendQueueStrip";
import { ApprovalCard } from "./components/ApprovalCard";
import { ClarifyCard } from "./components/ClarifyCard";
import { PlanCard } from "./components/PlanCard";
import { ChangeSummaryCard } from "./components/ChangeSummaryCard";
import { AppPage, type PageId } from "./components/AppPage";
import { GoalPanel, projectGoalPanel } from "./components/GoalPanel";
import { ErrorStrip } from "./components/ErrorStrip";
import { RightPanel } from "./components/RightPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { useStickyScroll } from "./useStickyScroll";
import { Ic } from "./components/icons";

declare global { interface Window { agent: import("../../../../src/main/ipc-protocol").AgentApi } }

// SEMA §3.5/§12：构建期注入的期望协议版本（vite define 换字面量——产物零运行时 import src）。
declare const __IPC_PROTOCOL_VERSION__: number;

export function App() {
  // M3-3：会话清单带归属工作区（host.listSessions 的 desktop 扩展字段，交叉类型收窄——同 aborted 先例）。
  const [sessions, setSessions] = useState<WorkspaceSession[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  // 审批卡按会话键控（v2.18）：此前是单一 `ask` 态 ⇒ 渲染"最后到达的那张卡"，
  // 跨会话时会把别人的卡画在自己头上。卡自带 sessionId 之后（core 侧 v3 协议），这里按
  // Map<sessionId, 卡> 存，只显示**当前会话**那张。归属未知（老载荷/headless）落 "" 键，
  // 语义 = 不知道是谁的卡 ⇒ 照旧显示（不静默吞卡），但也因此不参与任何按会话的回答/锁定。
  const [ask, setAsk] = useState<AskPayload | null>(null);
  const askById = useRef(new Map<string, AskPayload>());
  const runningSet = useRef(new Set<string>());
  // v2.17 运行中可沟通：发送队列（按会话，渲染层内存态——沿用 V1 不落 settings 纪律）。
  const sendQueue = useRef(new Map<string, QueuedSend[]>());
  // sidecar 写入按会话串行：快速连点时后一笔必须等前一笔落盘，不能靠 IPC 到达顺序赌最后写入。
  const queueWrites = useRef(new Map<string, Promise<unknown>>());
  const queueSeq = useRef(0);
  // 思考档位（每会话一份；缺省 off = 不向发请求体里加思考参数）
  const thinkingBySession = useRef(new Map<string, string>());
  // onEvent 闭包只建一次 ⇒ 用 ref 存当前活跃会话，避免读到过期 activeId（M1 T5 串屏收口）。
  const activeIdRef = useRef<string | null>(null);
  const [, force] = useState(0);
  const setQueueLocal = useCallback((sid: string, list: QueuedSend[]) => {
    if (list.length === 0) sendQueue.current.delete(sid); else sendQueue.current.set(sid, list);
    force((n) => n + 1);
  }, []);
  // 打开会话时 sidecar 读回未完成前先锁输入，避免“先发新消息、后读回旧队列”互相覆盖。
  const [queueLoading, setQueueLoading] = useState(false);
  // M2-4 模型选择：per-session 内存态（Map<sessionId, registryId|null>），M4 才落 settings。
  const selections = useRef(new Map<string, string | null>());
  const [providerInfo, setProviderInfo] = useState<ProviderInfo | null>(null);
  // key 状态（stored ∪ env 在场）：ModelPicker 据此过滤内置模型（没配 key 的不显示，而非置灰）。
  const [providerKeys, setProviderKeys] = useState<{ available: boolean; stored: string[]; envActive: boolean; envProviders: string[] } | null>(null);
  // M3-3 工作区面：注册清单＋新任务归属（null＝host 缺省，未显式切换）。
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [registryNotice, setRegistryNotice] = useState<string | null>(null);
  const [activeWorkspace, setActiveWorkspace] = useState<string | null>(null);
  // v2.6 三栏：侧栏/右栏折叠（渲染态，V1 不落 settings）。
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(true);
  // M1 T3 deferred 收口（onOpen 竞态守卫）。
  const openSeq = useRef(0);
  // M3-4/M4-4 会话键控错误条。
  const [sessionErrors, setSessionErrors] = useState<ReadonlyMap<string, string>>(new Map());
  const setLastError = useCallback((message: string, sessionId?: string) => {
    setSessionErrors((prev) => new Map(prev).set(sessionId ?? activeIdRef.current ?? "", message));
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
  // ---- v2.16 桌面接线：赞/踩真提交 + 文件级回滚 ----
  const [feedback, setFeedback] = useState<ReadonlyMap<number, "up" | "down">>(new Map());
  useEffect(() => {
    if (activeId === null) { setFeedback(new Map()); return; }
    void window.agent.listFeedback(activeId).then((list) => {
      setFeedback(new Map(list.map((f) => [f.eventId, f.rating])));
    }).catch(() => setFeedback(new Map()));
  }, [activeId]);
  const handleFeedback = useCallback((eventId: number, rating: "up" | "down" | null) => {
    const sid = activeIdRef.current;
    if (sid === null) return;
    const prev = feedback;
    const next = new Map(prev);
    if (rating === null) next.delete(eventId); else next.set(eventId, rating);
    setFeedback(next);
    const rollback = (why: string) => { setFeedback(prev); setLastError(`反馈提交失败：${why}`, sid); };
    void window.agent.submitFeedback({ sessionId: sid, eventId, rating: rating ?? "none" }).then((r) => {
      if (!r.ok) rollback(r.error ?? "未知错误");
    }, (err: unknown) => {
      rollback(err instanceof Error ? err.message : String(err));
    });
  }, [feedback]);
  const handleRevertTurn = useCallback((round: number) => {
    const sid = activeIdRef.current;
    if (sid === null) return;
    const confirmed = window.confirm(
      `把第 ${String(round)} 轮改动过的文件还原成该轮之前的状态？\n` +
      "（本轮新建的文件会删除；本轮之后又被改过的文件不会动，会列进「需手动处理」）",
    );
    if (!confirmed) return;
    void window.agent.revertTurn(sid, round).then((r) => {
      if (!r.ok) { setLastError(r.error ?? "回滚失败", sid); return; }
      setLastNotice(formatRevertNotice(round, r), sid);
    }, (err: unknown) => {
      setLastError(`回滚失败：${err instanceof Error ? err.message : String(err)}`, sid);
    });
  }, []);
  const handleCopyText = useCallback((text: string) => {
    void navigator.clipboard.writeText(text).then(() => undefined, (err: unknown) => {
      setLastError(`复制失败：${err instanceof Error ? err.message : String(err)}`);
    });
  }, []);
  const [sessionNotices, setSessionNotices] = useState<ReadonlyMap<string, string>>(new Map());
  const setLastNotice = useCallback((message: string, sessionId?: string) => {
    setSessionNotices((prev) => new Map(prev).set(sessionId ?? activeIdRef.current ?? "", message));
  }, []);
  const clearLastNotice = useCallback(() => {
    setSessionNotices((prev) => {
      const key = activeIdRef.current ?? "";
      if (!prev.has(key)) return prev;
      const next = new Map(prev);
      next.delete(key);
      return next;
    });
  }, []);
  // M4-4：权限档从 settings 读；send 透传。
  const [mode, setMode] = useState<PermissionMode>("default");
  const [pendingSend, setPendingSend] = useState(false);
  // M3-5 已停态真值驱动。
  const [stoppedIds, setStoppedIds] = useState<ReadonlySet<string>>(new Set());
  // M4-2 设置面板（initialSection：空态「接入模型」引导直达 provider 分区）。
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<"general" | "provider" | "permissions" | "behavior" | "memory" | "about" | undefined>(undefined);
  // spec ③：运行读数（跑了多少秒）——runningActive 翻真时起点落 ref，秒表 interval 驱动。
  const [elapsedSec, setElapsedSec] = useState(0);
  const runStartRef = useRef<number | null>(null);
  // spec ③：粘底滚动 + 「回到底部」浮钮。
  const streamRef = useRef<HTMLDivElement | null>(null);
  const stick = useStickyScroll(streamRef);
  // v2.6 应用页（C-39…C-42，整页覆盖）。
  const [appPage, setAppPage] = useState<PageId | null>(null);
  // 载入设置（2026-10-06：首启引导屏已按用户要求删除 —— 打开即进主界面，
  // 需要工作区时走「新建项目」那条路，不再拿一屏向导拦在门口）。
  useEffect(() => {
    void window.agent.getSettings().then((s) => { setMode(s.mode); }).catch(() => undefined);
  }, []);

  // SEMA §3.5/§12：协议版本握手（失配/查询失败 fail-closed）。
  const [protocolMismatch, setProtocolMismatch] = useState<string | null>(null);
  useEffect(() => {
    void window.agent.protocolVersion().then(
      (live) => {
        if (live !== __IPC_PROTOCOL_VERSION__) {
          setProtocolMismatch(
            `IPC 协议版本失配：渲染层期望 ${__IPC_PROTOCOL_VERSION__}，主进程实况 ${live}——渲染层与主进程必须同源构建，请整包重启应用。`,
          );
        }
      },
      (err: unknown) => {
        setProtocolMismatch(`IPC 协议版本查询失败：${err instanceof Error ? err.message : String(err)}`);
      },
    );
  }, []);

  // 侧栏清单同步（事件驱动补刷 + refetching 闸）。
  const knownSessionIds = useRef<ReadonlySet<string>>(new Set());
  const refetching = useRef(false);
  const refreshSessions = useCallback(() => {
    return (window.agent.listSessions() as Promise<WorkspaceSession[]>).then(setSessions);
  }, []);
  useEffect(() => {
    knownSessionIds.current = new Set(sessions.map((s) => s.id));
  }, [sessions]);

  const refreshProviderInfo = useCallback(() => {
    return window.agent.getProviderInfo().then(setProviderInfo);
  }, []);

  const refreshProviderKeys = useCallback(() => {
    return window.agent.providerKeyStatus().then(setProviderKeys).catch(() => setProviderKeys(null));
  }, []);

  // 已配 key 的 provider 集合（stored ∪ env 在场）：ModelPicker 据此过滤内置模型。
  const configuredProviders = useMemo(
    () => (providerKeys === null ? undefined : new Set<string>([...providerKeys.stored, ...providerKeys.envProviders])),
    [providerKeys],
  );

  useEffect(() => {
    refreshSessions();
    void refreshProviderInfo();
    void refreshProviderKeys();
    void window.agent.listProjects().then((registered) => {
      setProjects(registered);
      setRegistryNotice(null);
    }).catch((err: unknown) => {
      setRegistryNotice(`项目注册表不可用：${err instanceof Error ? err.message : String(err)}`);
    });
    const offEvent = window.agent.onEvent((e) => {
      const sid = (e as { session_id?: string }).session_id;
      if (sid && !knownSessionIds.current.has(sid) && !refetching.current) {
        refetching.current = true;
        refreshSessions().finally(() => { refetching.current = false; });
      }
      // 2026-10-06 用户实测「输入框里点模型没反应」的真根因就在这里：
      // 原实现是**任何事件**都给会话盖上 running（禁用输入框与选择器），而只有渲染层自己发起
      // 发送的那条路会在结束时摘掉它 —— 于是任何"不是渲染层发起"的一轮（定时任务、goal 续跑、
      // 冒烟器直接调 agent.run）都会把禁用位永久卡住，用户点什么都没反应。
      // 现在的规则：
      //   · 活动会话：**不由事件置位**（置位只走发送那条路，摘位也只走它的 finally）；
      //   · 任何会话：收到**终态** agent_status（done/failed/cancelled）就摘位；
      //   · 非活动会话：事件仍会把它的行点亮成"运行中"（那是列表上的指示，不是输入框的闸）。
      const terminal =
        e.type === "agent_status" &&
        ((e as { status?: string }).status === "done" ||
          (e as { status?: string }).status === "failed" ||
          (e as { status?: string }).status === "cancelled");
      if (sid && terminal) {
        runningSet.current.delete(sid);
        force((n) => n + 1);
      }
      if (sid && sid !== activeIdRef.current) {
        // 后台会话仍在跑：只在非终态时点亮（终态刚在上面摘过，别又补上）
        if (!terminal) runningSet.current.add(sid);
        force((n) => n + 1);
        return;
      }
      setEvents((prev) => [...prev, e]);
    });
    const offAsk = window.agent.onAsk((p) => {
      const sid = p.sessionId ?? "";
      askById.current.set(sid, p);
      setAsk(p);
    });
    const offDone = window.agent.onAskDone(() => {
      askById.current.clear();
      setAsk(null);
    });
    return () => { offEvent(); offAsk(); offDone(); };
  }, [refreshSessions, refreshProviderInfo, refreshProviderKeys]);

  const activate = useCallback((id: string | null) => {
    activeIdRef.current = id;
    setActiveId(id);
  }, []);

  const openSession = useCallback((id: string) => {
    activate(id);
    const seq = ++openSeq.current;
    setQueueLoading(true);
    const opened = window.agent.openSession(id).then((r) => {
      if (seq !== openSeq.current) return;
      setEvents(r.events);
    }).catch((err: unknown) => {
      if (seq === openSeq.current) setLastError(`会话打开失败：${err instanceof Error ? err.message : String(err)}`, id);
    });
    const queued = window.agent.queueGet(id).then(({ items }) => {
      if (seq !== openSeq.current) return;
      setQueueLocal(id, fromSessionQueueEntries(items, () => ++queueSeq.current));
    }).catch((err: unknown) => {
      if (seq === openSeq.current) setLastError(`发送队列读取失败：${err instanceof Error ? err.message : String(err)}`, id);
    });
    void Promise.allSettled([opened, queued]).finally(() => {
      if (seq === openSeq.current) setQueueLoading(false);
    });
  }, [activate, setLastError, setQueueLocal]);

  const addWorkspace = useCallback(async (path: string): Promise<string> => {
    const record = await window.agent.addProject({ path });
    const registered = await window.agent.listProjects();
    setProjects(registered);
    setRegistryNotice(null);
    refreshSessions();
    return record.path;
  }, [refreshSessions]);

  const newSession = useCallback(() => {
    openSeq.current += 1;
    setQueueLoading(false);
    activate(null);
    setEvents([]);
  }, [activate]);

  // ---- v2.17 运行中可沟通：按会话发送队列 ----
  // 队列语义全在 send-queue.ts（本文件只存表与接线）；表是 Map<sessionId, 队列>，
  // 这样后台会话的排队不因切换会话而丢失，自动派发也只认原会话。
  const setQueueFor = useCallback((sid: string, list: QueuedSend[]) => {
    setQueueLocal(sid, list);
    const prev = queueWrites.current.get(sid) ?? Promise.resolve();
    const next = prev.catch(() => undefined).then(() => window.agent.queueSet(sid, toSessionQueueEntries(list)));
    queueWrites.current.set(sid, next);
    void next.then(
      (r) => { if (!r.ok) setLastError(`发送队列保存失败：${r.error ?? "未知错误"}`, sid); },
      (err: unknown) => setLastError(`发送队列保存失败：${err instanceof Error ? err.message : String(err)}`, sid),
    ).finally(() => {
      if (queueWrites.current.get(sid) === next) queueWrites.current.delete(sid);
    });
  }, [setLastError, setQueueLocal]);
  /** 本轮收束后出队：队首出表并返回；空队列 null（调用方停表）。 */
  const takeQueuedHead = useCallback((sid: string): QueuedSend | null => {
    const { head, rest } = takeQueued(sendQueue.current.get(sid) ?? []);
    if (head !== null) setQueueFor(sid, rest);
    return head;
  }, [setQueueFor]);

  /** 一条消息 → 一轮 run；收束后自动派队列下一条（顺序派发唯一实现在 send-queue.drainQueue）。
   *  不重入 send：send 要判 activeId，后台会话的续发必须显式钉住 sid。
   *  本轮失败（ok=false 或抛出）→ 停表：剩余队列留在表里，等用户处理；用户主动打断不算失败。 */
  const runOn = useCallback(async (sid: string, first: { text: string; attachments: RunAttachmentReference[] }) => {
    await drainQueue(first, async (msg) => {
      setStoppedIds((prev) => {
        if (!prev.has(sid)) return prev;
        const fresh = new Set(prev);
        fresh.delete(sid);
        return fresh;
      });
      runningSet.current.add(sid);
      runStartRef.current = Date.now();
      force((n) => n + 1);
      try {
        const thinking = thinkingBySession.current.get(sid);
        const res = (await window.agent.run({
          message: msg.text, mode, sessionId: sid, model: selections.current.get(sid) ?? undefined,
          ...(thinking !== undefined ? { thinking: thinking as "off" | "low" | "medium" | "high" } : {}),
          ...(msg.attachments.length > 0 ? { attachments: msg.attachments } : {}),
        })) as RunResponse & { aborted?: boolean };
        setStoppedIds((prev) => {
          const want = res.aborted === true;
          if (prev.has(sid) === want) return prev;
          const fresh = new Set(prev);
          if (want) fresh.add(sid); else fresh.delete(sid);
          return fresh;
        });
        const keepGoing = continueAfterRun(res);
        if (!keepGoing) setLastError(res.error ?? "本轮运行失败", sid);
        return keepGoing;
      }
      catch (err) {
        setLastError(`本轮运行失败：${err instanceof Error ? err.message : String(err)}`, sid);
        return false;
      }
      finally { runningSet.current.delete(sid); force((n) => n + 1); }
    }, () => takeQueuedHead(sid));
  }, [mode, setLastError, takeQueuedHead]);

  const send = useCallback(async (text: string, attachments: RunAttachmentReference[] = []) => {
    const sid = activeId;
    // 运行中发送 = 入队（收束后 runOn 的循环自动派下一条）。判据用 ref 不用渲染态：
    // 收束与点击在同一拍竞争时，runningSet 是唯一真值。
    if (sid !== null && runningSet.current.has(sid)) {
      setQueueFor(sid, [...(sendQueue.current.get(sid) ?? []), { id: ++queueSeq.current, text, attachments }]);
      return;
    }
    const isNew = sid === null;
    if (isNew) setPendingSend(true);
    let id: string | undefined;
    try {
      const newId = sid ?? (await window.agent.createSession(activeWorkspace ?? undefined)).id;
      id = newId;
      if (isNew) { activate(newId); refreshSessions(); }
      await runOn(newId, { text, attachments });
    }
    catch (err) {
      setLastError(`本轮运行失败：${err instanceof Error ? err.message : String(err)}`, id ?? "");
    }
    finally { setPendingSend(false); force((n) => n + 1); }
  }, [activeId, activeWorkspace, activate, refreshSessions, runOn, setQueueFor]);

  /** 重启恢复：不自动执行，用户显式点「继续发送」才把队首交给同一条 runOn/权限/沙箱链路。 */
  const resumeQueue = useCallback(() => {
    const sid = activeIdRef.current;
    if (sid === null || runningSet.current.has(sid)) return;
    const first = takeQueuedHead(sid);
    if (first === null) return;
    void runOn(sid, first).catch((err: unknown) => {
      setLastError(`恢复发送失败：${err instanceof Error ? err.message : String(err)}`, sid);
    });
  }, [runOn, setLastError, takeQueuedHead]);

  const lastError = sessionErrors.get(activeId ?? "") ?? null;
  const lastNotice = sessionNotices.get(activeId ?? "") ?? null;
  const runningActive = activeId !== null && runningSet.current.has(activeId);
  // 运行秒表：起点在 send() 里盖；这里只负责 interval 的开与关（终态由 runningActive 翻假收掉）。
  useEffect(() => {
    if (!runningActive) return;
    const t0 = runStartRef.current ?? Date.now();
    setElapsedSec(Math.floor((Date.now() - t0) / 1000));
    const id = setInterval(() => setElapsedSec(Math.floor((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(id);
  }, [runningActive]);
  const pendingClarify = pendingClarifyOf(events);
  const pendingPlan = pendingPlanOf(events);
  // 只认当前会话那张卡（判定唯一处在 send-queue.askBelongsToSession）。
  const askForActive = askBelongsToSession(ask, activeId) ? ask : null;
  const phase = deriveRunPhase(events, askForActive !== null, pendingClarify !== null, pendingPlan !== null);
  const stopped = activeId !== null && stoppedIds.has(activeId) && !runningActive;
  const phaseLabel = stopped ? "已停止"
    : phase === "ask" ? "等待审批"
    : phase === "clarify" ? "等待澄清"
    : phase === "plan" ? "等待方案"
    : phase === "thinking" ? "思考中"
    : phase === "tool" ? "执行工具"
    : "就绪";
  const chosen = activeId !== null ? selections.current.get(activeId) : undefined;
  const pickerValue = chosen !== undefined ? chosen : (providerInfo?.modelId ?? null);
  const usage = usageAggregate(events);
  // 状态条数据：步数（主会话 tool_call 计数）与所选模型窗口（上下文水位）。
  const steps = countToolSteps(events);
  const chosenCtx = (() => {
    const spec = providerInfo?.models.find((m) => m.id === pickerValue);
    return spec?.ctxWindow;
  })();
  // C-24：pill 填入 composer 的文案（key 变化触发注入）。
  const [injectedText, setInjectedText] = useState<string | undefined>(undefined);

  // SEMA §3.5/§12：协议失配 fatal 早退面。
  if (protocolMismatch !== null) {
    return (
      <div className="app">
        <div className="takeover" style={{ display: "flex" }}>
          <div className="onb-card">
            <h1>Cairn</h1>
            <div className="field-note">{protocolMismatch}</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app" data-sidebar={sidebarCollapsed ? "collapsed" : "expanded"} data-right={rightCollapsed ? "collapsed" : "expanded"}>
      <TitleBar
        title={activeId ?? "Cairn"}
        sidebarCollapsed={sidebarCollapsed}
        rightCollapsed={rightCollapsed}
        onToggleSidebar={() => setSidebarCollapsed((v) => !v)}
        onToggleRight={() => setRightCollapsed((v) => !v)}
      />
      <div className="shell">
        <Sidebar
          sessions={sessions}
          workspaces={projects.map((p) => p.path)}
          activeId={activeId}
          activeWorkspace={activeWorkspace}
          running={runningSet.current}
          notice={registryNotice}
          pendingPhase={phase}
          activePending={askForActive !== null || pendingClarify !== null || pendingPlan !== null}
          lastRoundFailed={lastError !== null}
          stopped={stopped}
          onOpen={openSession}
          onNewSession={newSession}
          onSwitchWorkspace={setActiveWorkspace}
          onAddWorkspace={(path) => addWorkspace(path).then(() => undefined)}
          onPickDirectory={() => window.agent.pickDirectory()}
          onOpenSettings={() => { setSettingsSection(undefined); setSettingsOpen(true); }}
          onOpenAbout={() => { setSettingsSection("about"); setSettingsOpen(true); }}
          onOpenPage={(page) => setAppPage(page)}
        />
        <main className="main">
          <>
              {activeId === null && events.length === 0 ? (
                /* C-24 EmptyState：接管主区（侧栏与 Composer 不受影响）；pill 填入不发送。 */
                <div className="takeover" style={{ display: "flex" }}>
                  <div className="empty-wrap">
                    <div className="mark" aria-hidden="true">
                      <svg width="42" height="42" viewBox="0 0 14 14" fill="currentColor"><path d="M7 1.6 8.3 5.7 12.4 7 8.3 8.3 7 12.4 5.7 8.3 1.6 7 5.7 5.7Z"/></svg>
                    </div>
                    <h1>今天要修点什么？</h1>
                    <div className="sub">描述任务，agent 在工作区里读代码、改代码、跑测试、交付结果。</div>
                    {providerKeys !== null && providerKeys.stored.length + providerKeys.envProviders.length === 0 && (
                      <button
                        className="setup-cta"
                        onClick={() => { setSettingsSection("provider"); setSettingsOpen(true); }}
                      >
                        <span className="cta-ico" aria-hidden="true"><Ic.key size={16} /></span>
                        <span>
                          <span className="cta-t">接入你的第一个模型</span>
                          <div className="cta-sub">粘贴任意一家的 API key（DeepSeek / OpenAI / Anthropic / GLM），30 秒接好。</div>
                        </span>
                      </button>
                    )}
                    <div className="pills">
                      {["跑一遍全量测试并把失败修到绿", "给 src/main/settings.ts 补上缺失的判卷", "把 README 的安装节改成三步以内"].map((p) => (
                        <button key={p} className="pill" onClick={() => setInjectedText(p)}>{p}</button>
                      ))}
                    </div>
                    <div className="next">⌘N 任何时候回到这个页面 · 右栏可开辅助对话</div>
                    <NewProjectCard
                      onCreated={(path) => {
                        setActiveWorkspace(path);
                        void window.agent
                          .listProjects()
                          .then((registered) => setProjects(registered))
                          .catch(() => undefined);
                        refreshSessions();
                      }}
                    />
                  </div>
                </div>
              ) : (
                <TurnRail
                  turns={roundTimeline(projectStream(events))}
                  onJump={(round) => {
                    const anchor = document.querySelector<HTMLElement>(`[data-round-anchor="${String(round)}"]`);
                    anchor?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }}
                  onRevert={handleRevertTurn}
                />
              )}
              <div className="zone-stream">
                {lastError !== null && <ErrorStrip message={lastError} onDismiss={clearLastError} />}
                {lastNotice !== null && (
                  <div className="notice-strip" role="status">
                    <span className="msg">{lastNotice}</span>
                    <button className="btn-ghost" aria-label="关闭提示" onClick={clearLastNotice}>×</button>
                  </div>
                )}
                <div className="stream" id="stream" ref={streamRef}>
                  <div className="reading" id="reading">
                    <Stream
                      rows={projectStream(events)}
                      actions={{ feedback, onFeedback: handleFeedback, onRevertTurn: handleRevertTurn, onCopyText: handleCopyText }}
                    />
                    {/* C-32 交付摘要卡：有文件改动或验证证据的轮各一张，流尾展示 */}
                    {turnDelivery(events).map((d) => <ChangeSummaryCard key={d.round} delivery={d} />)}
                  </div>
                </div>
                {/* spec ③：离开底部才出现（挂在 .zone-stream 下，不随内容滚走） */}
                {!stick.stuck && (
                  <button className="jump-latest show" onClick={() => stick.scrollToBottom("smooth")}>
                    <Ic.chevronDown size={12} />
                    <span>回到底部</span>
                  </button>
                )}
              </div>
              <div className="zone-gate">
                {askForActive ? (
                  <ApprovalCard
                    ask={askForActive}
                    onDecide={(approved, scope) => {
                      void window.agent.decide(askForActive.askId, approved, scope).then((ok) => {
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
                      void window.agent.decidePlan(approved, callId).then((ok) => {
                        if (!ok) setLastError("方案决议失败");
                      }).catch((err: unknown) => {
                        setLastError(`方案决议失败：${err instanceof Error ? err.message : String(err)}`);
                      });
                    }}
                  />
                ) : null}
              </div>
              <div className="zone-composer">
                {activeId !== null && (() => {
                  const goal = projectGoalPanel(events);
                  return goal !== null && !goal.stopped ? (
                    <GoalPanel view={goal} activeId={activeId} onError={(m) => setLastError(m)} />
                  ) : null;
                })()}
                {activeId !== null && (
                  <SendQueueStrip
                    items={sendQueue.current.get(activeId) ?? []}
                    running={runningActive}
                    onInterruptSend={(index) => {
                      // 「打断并发送」：先把它提到队首，再打断本轮——收束在轮界，runOn 随即先派它。
                      const sid = activeIdRef.current;
                      if (sid === null) return;
                      setQueueFor(sid, promoteQueued(sendQueue.current.get(sid) ?? [], index));
                      void window.agent.runCancel(sid);
                    }}
                    onRemove={(index) => {
                      const sid = activeIdRef.current;
                      if (sid === null) return;
                      setQueueFor(sid, dropQueued(sendQueue.current.get(sid) ?? [], index));
                    }}
                    {...(!runningActive && !queueLoading && !pendingSend && pendingClarify === null && pendingPlan === null
                      ? { onResume: resumeQueue }
                      : {})}
                  />
                )}
                <Composer
                  disabled={queueLoading || composerLocked({
                    creating: pendingSend && activeId === null,
                    gateActive: pendingClarify !== null || pendingPlan !== null,
                  })}
                  mode={mode}
                  running={runningActive}
                  stopped={stopped}
                  activeId={activeId}
                  providerInfo={providerInfo}
                  pickerValue={pickerValue}
                  usage={usage}
                  phaseLabel={phaseLabel}
                  phase={phase}
                  elapsedSec={elapsedSec}
                  steps={steps}
                  {...(chosenCtx !== undefined ? { ctxWindow: chosenCtx } : {})}
                  workspaceLabel={activeWorkspace ? activeWorkspace.slice(activeWorkspace.lastIndexOf("/") + 1) : null}
                  injectedText={injectedText}
                  onSend={(t, attachments) => void send(t, attachments)}
                  onCancel={() => { if (activeId !== null) void window.agent.runCancel(activeId); }}
                  onPickDirectory={() => window.agent.pickDirectory()}
                  configuredProviders={configuredProviders}
                  onModeChange={(m) => {
                    void window.agent.setSettings({ mode: m }).then(() => setMode(m)).catch((err: unknown) => {
                      setLastError(`权限档保存失败：${err instanceof Error ? err.message : String(err)}`);
                    });
                  }}
                  thinking={activeId === null ? undefined : thinkingBySession.current.get(activeId)}
                  onThinkingChange={(level) => {
                    if (activeId === null) return;
                    thinkingBySession.current.set(activeId, level);
                    force((n) => n + 1);
                  }}
                  onModelChange={(registryId) => {
                    // 2026-10-06 用户实测「列表出来了但点不动」的第一处根因在这里：
                    // 原实现是 `if (activeId === null) return;` —— **没有活动会话时点击被静默丢弃**。
                    // 而刚打开应用、还没建会话时正好是这个状态：菜单能开、点了没反应。
                    // 现在的规则：有会话就记成"本会话选择"，没有就只落全局缺省；
                    // 两种情况都**必须有可见后果**（触发条上的名字会跟着变）。
                    if (activeId !== null) {
                      selections.current.set(activeId, registryId);
                      force((n) => n + 1);
                    }
                    // provider 必须**一起写**：模型自带属于哪一家，而"provider=openai + 某自定义家的模型"
                    // 这种自相矛盾的组合会被解析层拒绝（用户实测就撞上了）。演示项则把 provider 拨回 demo。
                    const pickedSpec =
                      registryId === null ? undefined : providerInfo?.models.find((m) => m.id === registryId);
                    const nextProvider = registryId === null ? "demo" : pickedSpec?.provider;
                    void window.agent
                      .setSettings({
                        model: registryId ?? "",
                        ...(nextProvider !== undefined ? { provider: nextProvider } : {}),
                      })
                      .then(() => refreshProviderInfo())
                      .catch((err: unknown) => setLastError(`模型缺省保存失败：${err instanceof Error ? err.message : String(err)}`));
                  }}
                  onOpenSettings={() => setSettingsOpen(true)}
                  modelSessionOverride={activeId !== null && selections.current.has(activeId)}
                  onCompact={() => {
                    void window.agent.compact?.().then((r) => {
                      if (!r.ok) setLastError(r.error ?? "压缩失败");
                    }).catch((err: unknown) => {
                      setLastError(`压缩失败：${err instanceof Error ? err.message : String(err)}`);
                    });
                  }}
                />
              </div>
          </>
        </main>
      {/* C-30 右栏（多标签容器）：辅助对话标签真接线（sidechat 全通道）；浏览器标签待 WebContentsView 前置（§8 #2）。 */}
      <aside className="rightpanel" aria-label="右侧面板">
        <RightPanel
          parentSessionId={activeId}
          onError={(message) => setLastError(message)}
          onOpenParent={() => { if (activeId !== null) openSession(activeId); }}
        />
      </aside>
      </div>
      {settingsOpen && (
        <SettingsPanel
          onClose={() => setSettingsOpen(false)}
          {...(settingsSection !== undefined ? { initialSection: settingsSection } : {})}
          onSettingsSaved={() => {
            void refreshProviderInfo();
            void refreshProviderKeys();
            void window.agent.getSettings().then((s) => setMode(s.mode)).catch(() => undefined);
          }}
        />
      )}
      {appPage !== null && (
        <AppPage
          key={appPage}
          page={appPage}
          onClose={() => { setAppPage(null); refreshSessions(); }}
          onError={(m) => setLastError(m)}
        />
      )}
    </div>
  );
}
