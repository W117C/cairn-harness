import { useAppCommands } from "./app-commands";
import { useConversationNavigation } from "./conversation-navigation";
import { useEmptySurfaceEffects } from "./empty-surface";
import { useProjectActions } from "./projects";
import { useRunQueue } from "./run-queue";
import { useRunReadings } from "./run-readings";
import { inheritedDisplayIndexes, mergeViewEvents, refsByDisplayIndex } from "../derived/event-reference";
import { runKey } from "./session-identity";
import type { SessionRef, SessionView } from "../../../../../src/events";
import { useSessionSubscription } from "./session-subscription";
import { composerThinking, thinkingChangeTarget } from "./thinking-selection";
import type { ThinkingEffort } from "../../../../../src/providers/capabilities";
// App 根（Claude 蓝本 v1 重建）：外壳（TitleBar + Sidebar + Main）+ 覆盖层（设置页）。
// 状态编排/事件驱动/运行链全部沿用既有实现（逻辑资产原样搬运）：
//   · 会话清单同步、竞态守卫（openSeq）、运行集（runningSet）、按会话错误/提示条
//   · 运行链：send → runOn（drainQueue FIFO）→ 收束续派；v2.17 运行中可沟通（回车入队）
//   · 审批/澄清/计划三卡（GateSlot ≤1）、反馈/回滚/复制、主题、协议握手。
// 本文件只换外壳与布局（蓝本 §3.1 应用外壳）；业务语义不动。
import { useCallback,useEffect,useLayoutEffect,useMemo,useRef,useState } from "react";
import type { AgentEvent,AskPayload,PermissionMode,ProjectDiagnosis,ProjectRecord,ProviderInfo,SuggestNextResult } from "../../../../../src/main/ipc-protocol";
import type { OnboardingGroup } from "../../../../../src/main/onboarding-groups";
import type { StreamActions } from "../stream-actions";
// 预览状态是**类型**导入（值面留在主进程：project-preview 拖 node:http/child_process，
// 渲染层只消费推送快照；文案在渲染层按 status 组合）。
import { traceGoal } from "../../../../../src/agent/goal-trace";
import type { PaletteAction,SectionId } from "../app-controls";
import { type FindBarHandle } from "../app-controls";
import { readDismissedGoals } from "../goal-dismiss";
import { decideLastSessionRestore,parseLastSession,serializeLastSession,type LastSessionRef } from "../last-session";
import { changedFileCount } from "../changed-files";
import { MODE_LABEL } from "../permission-labels";
import { countRunSteps,countToolSteps,deliveryTrail,formatRevertNotice,mergeSessionSnapshot,projectStream,turnDelivery,usageAggregate,usageSummary } from "../projections";
import { type QuickStartInput } from "../quick-starts";
import { composerLockReason,fromSessionQueueEntries,type QueuedSend } from "../send-queue";
import type { WorkspaceSession } from "../sessions-view";
import { findSessionByRef } from "../sessions-view";
import type { SlashSkill } from "../slash";
import { turnSummaries } from "../stream-model";
import { STR } from "../strings";
import { buildSuggestContext } from "../suggest";
import { type ThemePref } from "../theme";
import { toast } from "../toast";
import { transcriptFileName,transcriptMarkdown } from "../transcript";
import type { UsageAllState } from "../usage-state";
import { useMessageAnnotations } from "../useMessageAnnotations";
import { usePopoverDismiss } from "../usePopoverDismiss";
import { useStickyScroll } from "../useStickyScroll";
import { relInWorkspace } from "../workspace-rel";
import { useChrome } from "./chrome";
import { useComposerDrafts } from "./drafts";
import { useMessageActions } from "./message-actions";
import { useSessionOps } from "./sessions";


declare global { interface Window { agent: import("../../../../../src/main/ipc-protocol").AgentApi } }

// SEMA §3.5/§12：构建期注入的期望协议版本（vite define 换字面量——产物零运行时 import src）。
declare const __IPC_PROTOCOL_VERSION__: number;


/** 文本编辑面（输入框/文本域/可编辑元素）：⌘↑/⌘↓ 在这些地方是文本编辑语义，全局快捷键让路（不劫持）。
 *  2026-10-20 搬进 `command-gate.ts`：它同时管着**菜单路径**要不要让给文本编辑——
 *  两处各写一份判法就会漂（keydown 让了、菜单没让 = 同一个键两种行为）。 */

/** P2-1 空屏建议面（App 装配数据 → quick-starts 纯函数出题；缓存单位=项目路径）。 */
interface EmptySurface {
  quickStarts: string[];
  branch: string | null;
}

export function useWorkbenchModel() {
  // 会话清单带归属工作区（host.listSessions 的 desktop 扩展字段，交叉类型收窄——同 aborted 先例）。
  const [sessions, setSessions] = useState<WorkspaceSession[]>([]);
  // 会话清单是否已从盘上读过一轮（空屏建议要等它——「继续上次」的原料是最近标题，抢跑会漏）。
  const [sessionsLoaded, setSessionsLoaded] = useState(false);
  // 清单读取失败（2026-10-18）：此前失败只会让 sessionsLoaded 永远停在 false，
  // 侧栏分不出「还没有任务」与「没读到」；现在失败可见并可重试（空 ≠ 失败）。
  const [sessionsLoadError, setSessionsLoadError] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  // 来源视图（指针分叉）：openSession 回包里的 SessionView；没分叉的会话为 null（渲染走原路径）。
  const [sessionView, setSessionView] = useState<SessionView | null>(null);
  const eventsRef = useRef(events);
  useLayoutEffect(() => { eventsRef.current = events; }, [events]);
  // 审批卡按会话键控：卡自带 sessionId 之后（core 侧 v3 协议），按 Map<sessionId, 卡> 存，
  // 只显示**当前会话**那张；归属未知（老载荷/headless）落 "" 键，照旧显示但不参与按会话回答。
  // 必须是 state（不只是 ref）：并发会话各停一张卡时，切到 A 要能把 A 那张重新画出来；
  // 单一 ask 态会让后到的卡永久覆盖先到的卡。
  const [askBySid, setAskBySid] = useState<ReadonlyMap<string, AskPayload>>(new Map());
  const askById = useRef(new Map<string, AskPayload>());
  const runningSet = useRef(new Set<string>());
  /** 真派活代号（第十三遍）：runOn 的 drain 回调每真发一轮 +1。给「打断/停止」的陈旧旗自愈
   *  做同拍竞态守卫——点击瞬间若收束链已先派出下一轮（代号已动），那是真在跑，不许摘旗。 */
  const runGen = useRef(new Map<string, number>());
  // v2.17 运行中可沟通：发送队列（按会话，渲染层内存态——沿用 V1 不落 settings 纪律）。
  const sendQueue = useRef(new Map<string, QueuedSend[]>());
  // sidecar 写入按会话串行：快速连点时后一笔必须等前一笔落盘，不能靠 IPC 到达顺序赌最后写入。
  const queueWrites = useRef(new Map<string, Promise<unknown>>());
  const queueSeq = useRef(0);
  // 思考档位（每会话一份；缺省 off = 不向发请求体里加思考参数）
  const thinkingBySession = useRef(new Map<string, string>());
  // 空屏上的选择（下一条新会话的起点）：旧实现 onThinkingChange 在 activeId === null 时直接 return
  // ⇒ 芯片能拨、数据不动——用户以为「这轮用强思考」，第一条消息实际按 off 发。见 thinking-selection.ts。
  const [pendingThinking, setPendingThinking] = useState<ThinkingEffort>("off");
  // onEvent 闭包只建一次 ⇒ 用 ref 存当前活跃会话，避免读到过期 activeId。
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
  // v12 导入诊断（ADR 0004 §4）：最近一次导入/克隆的目录先给三态诊断卡——只提示不阻断，
  // 卡上带项目名（诊断结论自身不带名字，防止与当前激活项目混淆）；点「知道了」才收。
  const [importDiagnosis, setImportDiagnosis] = useState<{ name: string; diagnosis: ProjectDiagnosis } | null>(null);
  // P1 侧栏诚实状态面（只取本进程可见态；会话终态不落盘，重启归零如实）：
  //   waitingCounts：ask 的 sessionId 计数（onAsk 加、onAskDone 凭 askId 反查减）；
  //   outcomes：agent_status 终态记账（done ⇒ ok；failed ⇒ failed；cancelled ⇒ 清位不冒充完成）。
  const waitingByAsk = useRef(new Map<string, string>());
  const waitingCounts = useRef(new Map<string, number>());
  const outcomes = useRef(new Map<string, "ok" | "failed">());
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [dragOverApp, setDragOverApp] = useState(false);
  // 空屏（对话未开：无会话且零事件）——建议装配 / 首启副标题 / 居中枢位布局都以此为准。
  const showEmpty = activeId === null && events.length === 0;
  // P2-1 空屏面：首启标记（settings.onboarded）/ 建议与分支数据（按项目路径缓存）/ 项目 chip 弹层。
  const [onboarded, setOnboarded] = useState<boolean | null>(null);
  // 首启「设置检查」的七组覆盖面：**主进程给的副本**（唯一事实源 src/main/onboarding-groups.ts）。
  // 渲染层不抄那份清单——抄一份就多一份会各自漂的决策点。取不到 = 空数组 = 整块不渲染。
  const [onboarding, setOnboarding] = useState<readonly OnboardingGroup[]>([]);
  const [emptyData, setEmptyData] = useState<EmptySurface | null>(null);
  const emptyCache = useRef(new Map<string, EmptySurface>());
  const [chipOpen, setChipOpen] = useState(false);
  const [chipQuery, setChipQuery] = useState("");
  const [chipRecent, setChipRecent] = useState<ProjectRecord[] | null>(null);
  const chipRef = useRef<HTMLDivElement | null>(null);
  const closeChip = useCallback(() => { setChipOpen(false); }, []);
  usePopoverDismiss(chipOpen, closeChip, chipRef);
  // 输入区下沉（FLIP）：空屏期间记录输入区位置；转对话态时从旧位补 200ms 动画（reduced-motion 直落）。
  const composerZoneRef = useRef<HTMLDivElement | null>(null);
  const prevEmptyRect = useRef<DOMRect | null>(null);
  // v6 项目预览：模板目录（下拉数据面）、当前工作区的预览快照（推送面）。
  const [templates, setTemplates] = useState<{ id: string; name: string; description: string; runKind: "static" | "vite" }[]>([]);
  // 推送回调闭包只建一次 ⇒ 用 ref 存当前工作区，避免读到过期值（同 activeIdRef 的纪律）。
  const activeWorkspaceRef = useRef<string | null>(null);
  // P1-4「最近打开」：projects/sessions 的渲染镜像（callback 在事件时刻读最新值，不吃陈旧闭包）。
  const projectsRef = useRef<ProjectRecord[]>([]);
  projectsRef.current = projects;
  const sessionsRef = useRef<WorkspaceSession[]>([]);
  sessionsRef.current = sessions;
  // M1 T3 deferred 收口（onOpen 竞态守卫）。
  const openSeq = useRef(0);
  /** 打开会话期间到达的 live 事件先落这里，读盘快照回来后再合并（见 mergeSessionSnapshot）。 */
  const openPending = useRef<{ id: string; events: AgentEvent[] } | null>(null);
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
  const { feedback, feedbackBusy, onFeedback: handleFeedback, pinnedEventIds, pinBusy, annotationPending, onPin: handlePin } = useMessageAnnotations(activeId, setLastError);
  const doRevertTurn = useCallback((round: number) => {
    const sid = activeIdRef.current;
    if (sid === null) return;
    void window.agent.revertTurn(sid, round).then((r) => {
      if (!r.ok) { setLastError(r.error ?? "回滚失败", sid); return; }
      setLastNotice(formatRevertNotice(round, r), sid);
    }, (err: unknown) => {
      setLastError(`回滚失败：${err instanceof Error ? err.message : String(err)}`, sid);
    });
  }, [setLastError]);
  /** 回滚前先过产品自绘确认卡（2026-10-17：原生 window.confirm 换掉——系统弹窗与界面语言不一致）。 */
  const handleRevertTurn = useCallback((round: number) => { setRevertConfirm(round); }, []);
  /** 打开用户消息附件（2026-10-18）：只接受当前工作区内的路径；外部引用一律明说打不开，
   *  不让 workspacePathAction 在 main 侧静默拒绝成一个没人看见的 no-op。 */
  const openAttachment = useCallback((path: string): void => {
    const rel = relInWorkspace(activeWorkspace, path);
    if (rel === null) {
      toast.error("该附件不在当前工作区内，无法从界面打开");
      return;
    }
    void window.agent.workspacePathAction(rel, "open").then((r) => {
      if (!r.ok) toast.error(r.error ?? "打开失败");
    }, (err: unknown) => {
      toast.error(`打开失败：${err instanceof Error ? err.message : String(err)}`);
    });
  }, [activeWorkspace, toast]);
  const handleCopyText = useCallback((text: string): Promise<boolean> => {
    // 复制给回执（2026-10-17）：此前静默写入剪贴板，按了没反应 → 看不出成功与否。
    // 2026-10-18：回报 boolean，代码块的「已复制」按钮只在真的写进剪贴板后才亮，不再乐观撒谎。
    return navigator.clipboard.writeText(text).then(() => {
      toast.success(STR.toast.copied);
      return true;
    }, (err: unknown) => {
      setLastError(`复制失败：${err instanceof Error ? err.message : String(err)}`);
      return false;
    });
  }, [setLastError]);
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

  // 输入与草稿簇（Phase 2 · 批 2.3）：填入信号 / 草稿搬家 / 附件注入 / 元素选择 / 菜单信号。
  const {
    injectedText, injectedTextSeq, injectText, setInjectedText, setInjectedTextSeq,
    draftRemap, draftRemapSeq, setDraftRemap,
    draftRestore, draftRestoreSeq, setDraftRestore,
    draftIds, noteDraft,
    editCtx, editCtxRef, setEditCtx,
    injectedAttachment, attachFromPane,
    pickSignal, setPickSignal,
    injectedAppend, handlePickResult,
    composerMenuSignal, openComposerMenu,
  } = useComposerDrafts({ setLastError, setLastNotice });

  // 外观与布局簇（Phase 2 · 批 2.3）：侧栏 / 插件侧栏 / 主题与字号 / 视图三档 / 专注模式 /
  // 检查器 / 窗格集 / v6 预览。
  const {
    sidebarCollapsed, setSidebarCollapsed, sidebarWidth, sidebarWidthRef, persistSidebarWidth, startSidebarDrag, toggleSidebar,
    pluginSidebarOpen, pluginSidebarWidth, setPluginSidebarWidthPersist, togglePluginSidebar, closePluginSidebar,
    themePref, setThemePref, changeTheme, textSize, setTextSize, uiSize, setUiSize,
    viewMode, setViewMode, viewToast, setViewToast, viewRef, viewToastTimer,
    focusMode, focusModeRef, focusRestoreRef, exitFocusRef, toggleFocusMode,
    inspectorCollapsed, setInspectorCollapsed, inspectorDefault, inspectorRef, inspectorColRef,
    mainGroupRef, inspectorSaveTimer, revealInspector, revealInspectorRef, toggleInspector,
    paneTabs, setPaneTabs, notePaneOpened, togglePane, closePane, closeLastPane, openPane, requestPickElement,
    preview, openPreview, exportActiveProject,
  } = useChrome({ setLastError, setLastNotice, setPickSignal, activeId, activeWorkspace, activeWorkspaceRef });

  // 导出回执与预览同住 chrome 簇（preview-order 判卷按两个源码锚点切片，那一对锚点必须同住一个文件，
  // 故一并搬过去——**注释里不写源码字面量**：判卷用 indexOf 找锚点，注释里写了会被先命中）。

  // 插件命令行「填入」到 Composer（不直接发送）：只动输入框那一格。
  const fillPluginCommand = useCallback((invoke: string): void => {
    setInjectedText(`/${invoke.replace(/^\/+/, "")} `);
    setInjectedTextSeq((seq) => seq + 1);
  }, []);
  // M4-4：权限档从 settings 读；send 透传。
  const [mode, setMode] = useState<PermissionMode>("default");
  // 排队消息在**派发那一刻**读档位：drainQueue 持有起跑时的 run 闭包，若闭包直接捕获 mode，
  // 用户在运行中切档后排队消息仍按旧档执行（与「下一条消息起生效」的文案相反）。
  const modeRef = useRef(mode);
  modeRef.current = mode;
  // Plan 模式（v23）：settings.planRequiredByDefault 是默认；Composer 的「方案」开关按轮覆盖。
  // override=null ⇒ RunRequest 不带字段，主进程继续按设置默认判；显式 true/false ⇒ 覆盖。
  const [planDefault, setPlanDefault] = useState(false);
  const [planOverride, setPlanOverride] = useState<boolean | null>(null);
  const planRequired = planOverride ?? planDefault;
  const planOverrideRef = useRef<boolean | null>(null);
  planOverrideRef.current = planOverride;
  const changePlanRequired = useCallback((next: boolean): void => {
    setPlanOverride(next);
    setLastNotice(next ? STR.composer.planOnNotice : STR.composer.planOffNotice);
  }, [setLastNotice]);
  // P3-3 命令面板（⌘K / 侧栏搜索钮）。
  const [paletteOpen, setPaletteOpen] = useState(false);
  // 会话日志查看器（批 132）：错误条 / 命令面板共用；只存 id，标题在渲染时从 sessions 派生。
  const [logTarget, setLogTarget] = useState<string | null>(null);
  // §3.6/§7.3.3：Ctrl+Tab 会话循环开关（设置页可关；缺省开）。
  const [ctrlTabCycle, setCtrlTabCycle] = useState(true);
  const [pendingSend, setPendingSend] = useState(false);
  // M3-5 已停态真值驱动。
  const [stoppedIds, setStoppedIds] = useState<ReadonlySet<string>>(new Set());
  // 设置页（initialSection：直达分区）。
  const [settingsOpen, setSettingsOpen] = useState(false);
  // 用量统计「全部会话」账本（批 131）：懒加载——只有用户切到全部口径才向主进程要；
  // 主进程按路径+size+mtime 缓存，重复打开只重读变过的会话。seq 守卫防旧响应盖新响应。
  const [usageAll, setUsageAll] = useState<UsageAllState>({ status: "idle" });
  const usageAllSeq = useRef(0);
  const loadUsageAll = useCallback(() => {
    const seq = ++usageAllSeq.current;
    // 已有数字时保留旧读数（刷新不闪空）；首次/失败后才显示统计中。
    setUsageAll((prev) => (prev.status === "ready" ? prev : { status: "loading" }));
    void Promise.resolve().then(() => window.agent.usageLedger()).then(
      (r) => {
        if (seq !== usageAllSeq.current) return;
        setUsageAll(r.ok ? { status: "ready", data: r } : { status: "error", error: r.error });
      },
      (e: unknown) => {
        if (seq !== usageAllSeq.current) return;
        setUsageAll({ status: "error", error: e instanceof Error ? e.message : String(e) });
      },
    );
  }, []);
  const [settingsSection, setSettingsSection] = useState<SectionId | undefined>(undefined);
  // 长对话导航（v7.2）：对话目录 + 轮折叠 + ⌘↑/⌘↓。折叠按会话记忆（渲染态，不落 settings）。
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [outlineCurrent, setOutlineCurrent] = useState<number | null>(null);
  const [flashRound, setFlashRound] = useState<number | null>(null);
  const [foldedRounds, setFoldedRounds] = useState<ReadonlySet<number>>(new Set<number>());
  // 已停止目标的本地隐藏（2026-10-18）：核心 clear 对已停目标幂等、不落新事件，
  // 只有“隐藏”能让芯片从会话条上消失；新 goal_set（at 变化）会重新显示。
  // 按会话记录被隐藏的已停目标（2026-10-18：单个 number 会跨会话误伤——A 的 at 与 B 的 at
  // 是两条事件流里的下标，数字相等不代表同一个目标）。
  const [dismissedGoals, setDismissedGoals] = useState<Map<string, number>>(() => readDismissedGoals());
  // 交付轨迹默认只留最新一张卡（2026-10-18 第二轮业主截图：收起后仍有二十多张单行卡铺满流尾）。
  // 早期交付收进一行入口；展开状态按会话记，切走再回来不会又铺开。
  const [deliveryExpandedFor, setDeliveryExpandedFor] = useState<string | null>(null);
  const foldedBySession = useRef(new Map<string, ReadonlySet<number>>());
  // ⌘/ 速查表（§3.6「查看全部」）与归档必问闸（§3.3）、会话条重命名草稿（§2.1）。
  const [cheatOpen, setCheatOpen] = useState(false);
  const [archiveConfirm, setArchiveConfirm] = useState<WorkspaceSession | null>(null);
  // §6.3 删除会话的不可撤销闸（后果前置 + 明示不可撤销；确认卡在流尾）。
  const [deleteConfirm, setDeleteConfirm] = useState<WorkspaceSession | null>(null);
  // §3.7 · G4 丢弃隔离工作区闸：未提交改动会一并消失，必问。
  const [wtDiscard, setWtDiscard] = useState<WorkspaceSession | null>(null);
  // 2026-10-17：回滚轮次 / 移除项目改走产品自绘确认卡（原生 confirm 与界面语言不一致）。
  const [revertConfirm, setRevertConfirm] = useState<number | null>(null);
  const [projectRemoveConfirm, setProjectRemoveConfirm] = useState<ProjectRecord | null>(null);
  // 改名**绑定到发起时那条会话**（2026-10-20 独立评审追出，MEDIUM）：
  // 旧形状只存"正在编辑的文本"，提交时用**当前**的 activeId ⇒
  // 改 A 的名 → 按 ⌘⇧] 切到 B（输入框还挂着、还聚焦着、显示的还是 A 的标题）→ 按 Enter
  // ⇒ **把 B 改名成 A 的标题**（数据损坏）。现在状态里带着 id ⇒ 提交时用绑定的那个。
  const [barRenaming, setBarRenaming] = useState<{ id: string; text: string } | null>(null);
  // 运行读数（跑了多少秒）——runningActive 翻真时起点落 ref，秒表 interval 驱动。
  const [elapsedSec, setElapsedSec] = useState(0);
  // 起点按**会话**存（与 runGen 同一形状）：旧实现是**一个** ref，谁起跑就盖谁——
  // A 起跑 → 切 B → B 起跑 → 切回 A（A 还在跑）⇒ 秒表读的是 B 的起点，A 的真实耗时被读成别的值。
  // 秒表是"这一轮跑了多久"的用户可见读数，读错比不读更坏（用户以为任务刚开始）。
  const runStartBySession = useRef(new Map<string, number>());
  // 本轮最后一次正文增量的到桌时间（按会话）：用来区分「还在生成」与「正文已停、run 在收尾」。
  const lastDeltaAt = useRef(new Map<string, number>());
  // 粘底滚动 + 「回到底部」浮钮。
  const [streamEl, setStreamEl] = useState<HTMLDivElement | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [skills, setSkills] = useState<readonly SlashSkill[]>([]);
  const findRef = useRef<FindBarHandle | null>(null);
  const stick = useStickyScroll(streamEl);
  // 载入设置：打开即进主界面（不拿向导拦在门口）。
  useEffect(() => {
    void window.agent.getSettings().then((s) => {
      setMode(s.mode);
      setThemePref(s.theme);
      setCtrlTabCycle(s.ctrlTabCycle);
      setTextSize(s.textSize);
      setUiSize(s.uiSize);
      setOnboarded(s.onboarded);
      setPlanDefault(s.planRequiredByDefault === true);
    }).catch(() => undefined);
  }, []);
  // v6 模板目录：入口下拉的数据面（拉不到 = 空表，入口禁用而不是摆一个点不动的按钮）。
  useEffect(() => {
    void window.agent.projectTemplates().then(
      (list) => { setTemplates(list.map((t) => ({ ...t, runKind: t.runKind as "static" | "vite" }))); },
      () => { setTemplates([]); },
    );
  }, []);
  // 首启设置检查：只在**还没 onboarded** 时取那七组（已 onboarded 的用户不必看这张清单）。
  // 取不到 ⇒ 空数组 ⇒ 整块不渲染（不摆一个空壳，那比不摆更让人以为坏了）。
  useEffect(() => {
    if (onboarded !== false) return;
    let alive = true;
    void window.agent.getOnboarding().then(
      (groups) => { if (alive) setOnboarding(groups); },
      () => { if (alive) setOnboarding([]); },
    );
    return () => { alive = false; };
  }, [onboarded]);
  // 快捷键统一收口在下方 hotkeysRef 段（蓝本 §3.6 全表；此处不再各自挂监听）。

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
    return (window.agent.listSessions() as Promise<WorkspaceSession[]>).then((list) => {
      setSessions(list);
      setSessionsLoadError(false);
      setSessionsLoaded(true);
    }, () => {
      // fail-visible：不把一次 IPC 失败读成「没有会话」。注意**不能**把 sessionsLoaded 置真——
      // 它同时是「启动恢复上次会话」的闸；失败时当空清单放行会顺手清掉 cairn.lastSession.v1。
      // 侧栏的骨架由 loading={!sessionsLoaded && !sessionsLoadError} 收口。
      setSessionsLoadError(true);
    });
  }, []);
  const retrySessions = useCallback(() => {
    setSessionsLoaded(false);
    setSessionsLoadError(false);
    void refreshSessions();
  }, [refreshSessions]);

  // 斜杠菜单技能清单（2026-10-18）：工作区一变、或设置页关闭时刷新（信任决议就发生在设置里，
  // 不刷新的话菜单会一直标「待批准」）。设置打开期间不重复扫（省一次目录发现）。
  useEffect(() => {
    if (settingsOpen) return;
    let alive = true;
    void window.agent.listSkills(activeWorkspace ?? "").then((r) => {
      if (alive) setSkills([...r.skills, ...r.commands]);
    }).catch(() => {
      if (alive) setSkills([]);
    });
    return () => { alive = false; };
  }, [activeWorkspace, settingsOpen]);

  // 查找面板只对「当前这棵流」有意义：切会话/回主页即收起（不跨会话残留匹配）。
  useEffect(() => { setFindOpen(false); }, [activeId, showEmpty]);

  // 工作区上下文上报（2026-10-17）：主进程侧的 diff / 文件窗格 / 回滚 / 快照还原 / 路径动作
  // 优先用「当前活动项目」，不再只认「最近一次 run 的工作区」——冷启动没跑过 run 时，
  // 打开旧会话看改动会报「没有已知的工作区」，切项目后还可能拿上一个项目的根去解析路径。
  // 选择被拒（项目已从注册表移除等）⇒ 主进程仍停在上一个项目；留着就是跨项目读，
  // 显式清空并把原因说出来（fail closed，不静默沿用旧根）。
  const applyWorkspaceContext = useCallback((workspace: string | null): void => {
    void window.agent.setWorkspaceContext(workspace ?? "").then((r) => {
      if (r.ok) return;
      void window.agent.setWorkspaceContext("");
      toast.error(r.error ?? "工作区不可用，已清空窗口上下文");
    });
  }, []);
  useEffect(() => {
    applyWorkspaceContext(activeWorkspace);
  }, [activeWorkspace, applyWorkspaceContext]);
  useEffect(() => {
    knownSessionIds.current = new Set(sessions.map((s) => s.id));
  }, [sessions]);

  useEmptySurfaceEffects({ showEmpty, activeWorkspace, setEmptyData, emptyCache, sessionsLoaded, sessionsRef, composerZoneRef, prevEmptyRect });

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

  useSessionSubscription({ refreshSessions, refreshProviderInfo, refreshProviderKeys, setProjects, setRegistryNotice, knownSessionIds, refetching, openPending, activeIdRef, activeWorkspaceRef, lastDeltaAt, runningSet, outcomes, force, setEvents, sendQueue, setLastNotice, askById, setAskBySid, waitingByAsk, waitingCounts });

    const activate = useCallback((id: string | null) => {
    activeIdRef.current = id;
    setActiveId(id);
  }, []);



  /** 「最近打开」（P1-4）：归属为已注册项目才上报；纯副作用，失败吞掉只留 console.warn，
   *  绝不因它挡住打开/新建的主路径。 */
  const touchWorkspace = useCallback((path: string | null): void => {
    if (path === null) return;
    const project = projectsRef.current.find((p) => p.path === path);
    if (project === undefined) return;
    void window.agent.touchProject(project.id).catch((err: unknown) => {
      console.warn("最近打开上报失败（不影响主路径）", err);
    });
  }, []);

  // P2-1 空屏项目 chip：开弹层时拉「最近打开」清单（含已移除）；失败 = 空表不摆假数据。
  const openChipPopover = useCallback((): void => {
    setChipOpen((v) => {
      const next = !v;
      if (next) {
        setChipQuery("");
        setChipRecent(null);
        void window.agent.listProjects({ includeRemoved: true, recentFirst: true }).then(
          (all) => { setChipRecent(all.slice(0, 8)); },
          () => { setChipRecent([]); },
        );
      }
      return next;
    });
  }, []);

  // P2-2「引用最近文件」：本会话已引用文件历史（内存级——重启即忘；目录不算；最近在前、去重、上限 8）。
  const recentRefsBySession = useRef(new Map<string, string[]>());
  const noteRecentRef = useCallback((path: string): void => {
    const sid = activeIdRef.current;
    if (sid === null) return;
    const prev = recentRefsBySession.current.get(sid) ?? [];
    recentRefsBySession.current.set(sid, [path, ...prev.filter((p) => p !== path)].slice(0, 8));
    force((n) => n + 1); // Composer 经 props 消费 ⇒ 需要一次渲染把新清单递下去
  }, []);

  const openSession = useCallback((id: string, workspace?: string) => {
    activate(id);
    // 显式 workspace 优先（跨项目同名 id）：不给才按 id 查；两个都对上才认，绝不退回同名 id。
    const sessionWs = workspace ?? findSessionByRef(sessionsRef.current, id)?.workspace ?? null;
    // 打开会话 = 用它归属的项目（最近打开序的数据面；归属未知则跳过）。
    touchWorkspace(sessionWs);
    // 工作区上下文跟着「正在看的会话」走（2026-10-17）：从侧栏直接打开旧会话时 activeWorkspace
    // 可能仍是 null（没有选项目），此前 diff/文件窗格会因「没有已知的工作区」整块不可用。
    // 2026-10-18：**渲染层状态也要跟**——此前只通知了主进程，activeWorkspace 仍停在旧项目：
    // 空屏项目 chip、预览、斜杠技能清单都会读错工作区。会话归属已知即以它为准。
    if (sessionWs !== null) setActiveWorkspace(sessionWs);
    void applyWorkspaceContext(sessionWs);
    const seq = ++openSeq.current;
    // 立刻清掉上一会话的转录/门卡数据面：此前要等 openSession 回包才整体替换，窗口内
    // B 的标题下仍挂着 A 的转录、A 的澄清/方案门与行内「重试/还原」——用户可操作且会发错会话。
    // 读盘期间到达的 B 增量进 openPending，回包时合并（不丢流式文本）。
    const pending = { id, events: [] as AgentEvent[] };
    openPending.current = pending;
    setEvents([]);
    setSessionView(null);
    setQueueLoading(true);
    // 开会对账（desktop 扩展字段，交叉类型收窄——同 listSessions 的 workspace、run 的 aborted
    // 先例，不动 ipc-protocol）：main 侧运行实况。换渲染层实例（HMR/重载）后陈旧的「运行中」
    // 标记没有主人（收束时旧实例的 finally 已随实例销毁），打开即用 main 真值收敛：在跑补上、
    // 已收束摘掉。收束补发终态是正路，这条是每次开会话自愈一次的兜底，两者互不依赖。
    const opened = (window.agent.openSession(id, sessionWs ?? undefined) as Promise<{ events: AgentEvent[]; view?: SessionView; session?: SessionRef; running?: boolean; startedAt?: number }>).then((r) => {
      if (seq !== openSeq.current) return;
      if (openPending.current === pending) openPending.current = null;
      setSessionView(r.view ?? null);
      setEvents(mergeSessionSnapshot(r.events, pending.events));
      if (typeof r.running === "boolean") {
        const runId = runKey(r.session?.workspace ?? sessionWs ?? activeWorkspace, id);
        const was = runningSet.current.has(runId);
        if (r.running) runningSet.current.add(runId); else runningSet.current.delete(runId);
        if (was !== r.running) force((n) => n + 1);
      }
      // 换渲染层实例后接管一场**在跑**的 run：秒表起点本机没有（起点在 send() 里盖，
      // 那个 send 属于旧实例）⇒ 用 main 报的真起点补上（2026-10-20 独立评审追出，LOW-MEDIUM：
      // 旧形状此处什么都没有 ⇒ 秒表恒读 "0s"，而 `setElapsedSec(0)` 是同值更新 ⇒ React 不重渲染
      // ⇒ 那个 0 永远冻在那儿，用户以为任务刚开始）。
      if (r.running === true && !runStartBySession.current.has(id)) {
        runStartBySession.current.set(id, r.startedAt ?? Date.now());
      }
    }).catch((err: unknown) => {
      if (openPending.current === pending) openPending.current = null;
      if (seq === openSeq.current) setLastError(`会话打开失败：${err instanceof Error ? err.message : String(err)}`, id);
    });
    const queued = window.agent.queueGet(id, sessionWs ?? undefined).then(({ items }) => {
      if (seq !== openSeq.current) return;
      setQueueLocal(runKey(sessionWs ?? activeWorkspace, id), fromSessionQueueEntries(items, () => ++queueSeq.current));
    }).catch((err: unknown) => {
      if (seq === openSeq.current) setLastError(`发送队列读取失败：${err instanceof Error ? err.message : String(err)}`, id);
    });
    void Promise.allSettled([opened, queued]).finally(() => {
      if (seq === openSeq.current) setQueueLoading(false);
    });
  }, [activate, setLastError, setQueueLocal, touchWorkspace]);

  // 完成通知点击（v21）：主进程已把窗口拉到前台，这里只负责打开目标会话。
  // 同会话不重载（避免把正在看的流重置）；workspace 只接受字符串，跨项目同名 id 由 main 带上。
  const openSessionRef = useRef(openSession);
  openSessionRef.current = openSession;
  useEffect(() => {
    return window.agent.onNotificationOpen((payload) => {
      const target = payload as { sessionId?: unknown; workspace?: unknown } | null;
      if (target === null || typeof target !== "object") return;
      if (typeof target.sessionId !== "string" || target.sessionId.trim() === "") return;
      if (activeIdRef.current === target.sessionId) return;
      openSessionRef.current(
        target.sessionId,
        typeof target.workspace === "string" ? target.workspace : undefined,
      );
    });
  }, []);

  // 会话操作簇（Phase 2 · 批 2.3）：会话级动作 / 会话循环 / 关会话回主页 / 回主页。
  const {
    newSession, newSessionRef, cycleSession, cycleSessionOrToast, closeSessionToHome,
    renameSessionById, pinSessionById, forkSessionFromMenu, openSessionInCli, sessionWorktreeOp,
    doArchiveSession, requestArchiveSession, requestDeleteSession, doDeleteSession,
  } = useSessionOps({
    activeId, activeIdRef, sessions, refreshSessions, activate, openSession,
    setLastError, setLastNotice, setDraftRemap, draftRemapSeq, setEvents, setQueueLoading,
    openSeq, activeWorkspaceRef, touchWorkspace, runningSet, setArchiveConfirm, setDeleteConfirm,
  });
  // 消息级动作簇（Phase 2 · 批 2.3）：分叉 / 撤回（编辑并重发）/ 朗读 / 压缩 / 目标动作 / 快照还原。
  // 撤回（编辑）前停生成：cancelRunHeal 声明在后，经 ref 晚绑（revealInspectorRef 同款）。
  const cancelRunHealRef = useRef<((sid: string) => void) | null>(null);
  const {
    speakingEventId, setSpeakingEventId, handleBranch, compactNow, goalAct,
    handleEditUser, handleRestoreSnapshot, handleSpeak,
  } = useMessageActions({
    activeIdRef, eventsRef, sessions, activeWorkspaceRef, refreshSessions, openSession, cancelRunHealRef,
    injectText, setEditCtx, setLastError, setEvents,
  });

  // 重启回到上次的会话（2026-10-18）：桌面应用每次启动都落回空屏，等于把上下文丢了。
  // 规则：只记“最后一次真正打开过的会话”；用户主动按 ⌘N 回主页 = 清掉记录 ⇒ 重启也回主页。
  // 跨工作区**可以**恢复：桌面 listSessions 逐根扫描全部已注册工作区并带 workspace 字段，
  // 判据在 ./last-session（跨区不是拒绝条件；找不到才清键落主页）。
  const bootLastRef = useRef<LastSessionRef | null>((() => {
    try { return parseLastSession(window.localStorage.getItem("cairn.lastSession.v1")); } catch { return null; }
  })());
  const bootRestored = useRef(false);
  useEffect(() => {
    if (bootRestored.current || !sessionsLoaded) return;
    bootRestored.current = true;
    const decision = decideLastSessionRestore({
      last: bootLastRef.current,
      sessions,
      activeId,
    });
    if (decision.kind === "skip") return; // 用户抢在恢复前自己开了会话
    if (decision.kind === "restore") { openSession(decision.id, decision.workspace ?? undefined); return; }
    if (decision.kind === "keep") return; // 暂不可见/歧义：保留 key，下次启动再试
    try { window.localStorage.removeItem("cairn.lastSession.v1"); } catch { /* 存不下则忽略 */ }
  }, [sessionsLoaded, sessions, activeId, openSession]);
  useEffect(() => {
    if (!bootRestored.current) return;
    try {
      // 启动/恢复中 activeId 为空：不许在这里删 key（那会把「暂不可见」变成永久丢失）。
      // 用户主动回主页（⌘N / newSession）在 newSession 里显式清。
      if (activeId === null) return;
      // 会话 id 是分钟级时间戳，会跨项目撞名 ⇒ key 必须带 workspace，恢复时才不会开错转录。
      // 新会话可能还没进 sessions 清单：退回当前活动工作区（它就是这条会话的归属根）。
      const sessionWs = findSessionByRef(sessionsRef.current, activeId, activeWorkspace ?? undefined)?.workspace
        ?? activeWorkspace;
      window.localStorage.setItem(
        "cairn.lastSession.v1",
        serializeLastSession({ id: activeId, workspace: sessionWs ?? null }),
      );
    } catch { /* 存不下则本会话内生效 */ }
  }, [activeId, activeWorkspace, sessionsLoaded, sessions]);


  // ---- P1 项目管理接线（brief 第二节；失败面 throw 给调用组件 fail-visible，成功面带 Toast）----
  const { handleAddProject, handleCloneProject, handleUpdateProject, doRemoveProject, handleRemoveProject, handleRevealProject, handleCreateFromDialog } = useProjectActions({ setProjects, setRegistryNotice, setImportDiagnosis, setLastError, refreshSessions, setActiveWorkspace, activeWorkspaceRef, setProjectRemoveConfirm, newSessionRef });

    /** ⌘K 命令面板（P3-3）：真开（旧位只给 comingSoon 提示——面板已落地，替换掉）。 */
  const handleOpenPalette = useCallback((): void => {
    setPaletteOpen(true);
  }, []);

  /** 键盘浮层关闭后把光标交回输入框（2026-10-20 真机实测）：⌘K / ⌘F 打开再 Esc，焦点落到 BODY，
   *  用户要继续打字得先点一下输入框。浮层关闭的语义是「回到刚才的写作」，不是「离开输入」。
   *  rAF 等浮层卸载完再 focus：卸载中的焦点陷阱会把同一帧里的 focus 抢走。 */
  const focusComposer = useCallback((): void => {
    requestAnimationFrame(() => {
      document.querySelector<HTMLTextAreaElement>(".composer-card textarea")?.focus();
    });
  }, []);

  /** 关闭查找条（Esc / 面板 × / 菜单）统一出口：关掉并把焦点交回输入框。 */
  const closeFind = useCallback((): void => {
    setFindOpen(false);
    focusComposer();
  }, [focusComposer]);

  /** 关闭速查表统一出口（同 closeFind：键盘浮层关闭不丢焦点）。 */
  const closeCheat = useCallback((): void => {
    setCheatOpen(false);
    focusComposer();
  }, [focusComposer]);

  /** ⌘/ 开合速查表：关闭那一支回焦输入框。 */
  const toggleCheat = useCallback((): void => {
    if (cheatOpen) closeCheat();
    else setCheatOpen(true);
  }, [cheatOpen, closeCheat]);

  /** 「打开文件夹」（P3-3 ⌘O / 命令面板）：系统选择器 → 登记（与拖放同一个 handleAddProject）。 */
  const pickAndAddProject = useCallback(async (): Promise<void> => {
    try {
      const path = await window.agent.pickDirectory();
      if (path === null) return;
      await handleAddProject(path);
    } catch (err: unknown) {
      toast.error(`添加项目失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }, [handleAddProject]);





  /** 复制整段对话（2026-10-18，命令面板）：用户/助手正文成 Markdown 进剪贴板，toast 回执。
   *  标题不从 sessionTitle 取（它在本回调之后才声明，TDZ）——直接由 sessions + activeId 派生。 */
  const copyTranscript = useCallback((): void => {
    if (activeId === null) { toast.error("先打开一个会话再复制"); return; }
    const title = findSessionByRef(sessions, activeId, activeWorkspace ?? undefined)?.title ?? activeId;
    const text = transcriptMarkdown(events, title);
    void navigator.clipboard.writeText(text).then(
      () => { toast.success("已复制整段对话"); },
      (err: unknown) => { toast.error(`复制失败：${err instanceof Error ? err.message : String(err)}`); },
    );
  }, [activeId, activeWorkspace, events, sessions]);

  /** 导出整段对话为 .md（2026-10-18）：原生保存面板在 main；取消 = 合法结果，不报错误。 */
  const exportTranscriptFile = useCallback((): void => {
    if (activeId === null) { toast.error("先打开一个会话再导出"); return; }
    const title = findSessionByRef(sessions, activeId, activeWorkspace ?? undefined)?.title ?? activeId;
    void window.agent.exportTranscript(transcriptMarkdown(events, title), transcriptFileName(title)).then((r) => {
      if (r.ok) { toast.success(`已导出：${r.path ?? ""}`); return; }
      if (r.canceled === true) { toast("已取消导出"); return; }
      toast.error(`导出失败：${r.error ?? "未知原因"}`);
    }).catch((err: unknown) => {
      toast.error(`导出失败：${err instanceof Error ? err.message : String(err)}`);
    });
  }, [activeId, activeWorkspace, events, sessions]);

  /** 命令面板操作分发（P3-3）：动作全部复用既有能力（不另起炉灶）；新会话经 ref（TDZ 口径同 dialog）。 */
  const handlePaletteAction = useCallback((action: PaletteAction): void => {
    switch (action) {
      case "new-session":
        newSessionRef.current?.();
        break;
      case "open-folder":
        void pickAndAddProject();
        break;
      case "new-project":
        setNewProjectOpen(true);
        break;
      case "toggle-theme": {
        // 明暗互切（system 视同「非暗即明」的下一态；跟随系统仍在设置里选）。
        const next: ThemePref = themePref === "light" ? "dark" : "light";
        void window.agent.setSettings({ theme: next }).then(() => {
          setThemePref(next);
        }).catch((err: unknown) => {
          toast.error(`主题切换失败：${err instanceof Error ? err.message : String(err)}`);
        });
        break;
      }      case "cycle-perm": {
        const order: PermissionMode[] = ["read-only", "default", "guided", "auto"];
        const next = order[(order.indexOf(mode) + 1) % order.length] ?? "default";
        const runningHere = activeId !== null && runningSet.current.has(runKey(activeWorkspace, activeId)); // runningActive 的同一读法（TDZ 口径在其定义之前不可引用）
        void window.agent.setSettings({ mode: next }).then(() => {
          setMode(next);
          const info = MODE_LABEL[next];
          setLastNotice(`权限档已切到「${info.label}」（${info.desc}）${runningHere ? "——本轮仍在原档下跑，下一条消息起生效" : ""}`);
        }).catch((err: unknown) => {
          setLastError(`权限档保存失败：${err instanceof Error ? err.message : String(err)}`);
        });
        break;
      }
      case "toggle-inspector":
        toggleInspector();
        break;
      case "toggle-sidebar":
        // ⌘B 的等价入口（2026-10-18 补）：命令面板此前有「开合检查器」却没有「开合侧栏」，
        // 同一个 ⌘B、⌘⌥B、⌘⌥I 家族只进来一半。键盘用户不记得 ⌘B 时，面板里也该能点到。
        toggleSidebar();
        break;
      case "copy-transcript":
        copyTranscript();
        break;
      case "export-transcript":
        exportTranscriptFile();
        break;
      case "find-in-session":
        if (activeId === null) { toast.error("先打开一个会话再查找"); return; }
        setFindOpen(true);
        findRef.current?.focus();
        break;
      case "compact":
        compactNow();
        break;
      case "view-log":
        if (activeId === null) { toast.error("先打开一个会话再查看日志"); return; }
        setLogTarget(activeId);
        break;
    }
  }, [pickAndAddProject, themePref, mode, activeId, setLastError, toggleInspector, copyTranscript, exportTranscriptFile]);

  // ---- v2.17 运行中可沟通：按会话发送队列 ----
  // 队列语义全在 send-queue.ts（本文件只存表与接线）；表是 Map<sessionId, 队列>，
  // 这样后台会话的排队不因切换会话而丢失，自动派发也只认原会话。
  const { setQueueFor, send, sendWithGoal, handleRetryLast, resumeQueue, cancelRunHeal } = useRunQueue({ setQueueLocal, queueWrites, setLastError, sendQueue, setStoppedIds, runningSet, lastDeltaAt, runGen, runStartBySession, force, thinkingBySession, pendingThinking, modeRef, planRequiredRef: planOverrideRef, selections, activeId, editCtxRef, setEditCtx, askById, setLastNotice, queueSeq, setPendingSend, activeWorkspace, setActiveWorkspace, activate, refreshSessions, setDraftRestore, draftRestoreSeq, compactNow, activeIdRef, eventsRef });
  cancelRunHealRef.current = cancelRunHeal; // 撤回（编辑）晚绑

    const { lastError, lastNotice, runningActive, pendingClarify, pendingPlan, askForActive, phase, stopped, phaseLabel, chosen, pickerValue } = useRunReadings({ sessionErrors, activeId, sessionNotices, runningSet, setElapsedSec, runStartBySession, events, askBySid, stoppedIds, lastDeltaAt, selections, providerInfo, activeWorkspace });

    const usage = usageAggregate(events);
  // 头像菜单「用量统计」面板的数据（批 130）：当前会话口径，纯投影 ⇒ 判卷可测。
  const usageStats = useMemo(() => usageSummary(events), [events]);
  // 状态条数据：步数（主会话 tool_call 计数）与所选模型窗口（上下文水位）。
  const steps = countToolSteps(events);
  const runSteps = countRunSteps(events);
  const chosenCtx = (() => {
    const spec = providerInfo?.models.find((m) => m.id === pickerValue);
    return spec?.ctxWindow;
  })();
  // 变更审阅指示器（蓝本 §3.6）：改动出现即顶栏徽标亮数（去重文件数）。
  const fileCount = useMemo(() => changedFileCount(events), [events]);  // 来源视图：分叉会话的转录 = 祖先前缀 + 本地有效历史 + 快照之后的实时增量。
  // 非分叉会话保持旧路径（events 原样进投影，字节不变）。
  const referencedEvents = useMemo(
    () => (sessionView === null ? null : mergeViewEvents(sessionView, events)),
    [sessionView, events],
  );
  const streamEvents = useMemo(
    () => (referencedEvents === null ? events : referencedEvents.map((entry) => entry.event)),
    [referencedEvents, events],
  );
  const rowRefs = useMemo(
    () => (referencedEvents === null ? null : refsByDisplayIndex(referencedEvents)),
    [referencedEvents],
  );
  const inheritedSeqs = useMemo(
    () => (referencedEvents === null ? null : inheritedDisplayIndexes(referencedEvents)),
    [referencedEvents],
  );
  // 事件流投影一次性算好：Stream 渲染与「思考档是否进环」共用同一份。
  const streamRows = useMemo(() => projectStream(streamEvents, runningActive), [streamEvents, runningActive]);
  // ↑ 历史回填（2026-10-18）：打开旧会话就能翻到之前发过的话（本实例没发过也没有本地历史）。
  // 取投影后的用户行（userVisibleText 已还原技能轮原文），最新在前。
  // 目标芯片读数（2026-10-18）：与主进程续跑判据同一份 reduce（core goal-trace，纯函数、无 Node 依赖）。
  const goalTrace = useMemo(() => traceGoal(events), [events]);
  const promptHistory = useMemo(
    () => streamRows.filter((r) => r.kind === "user").map((r) => r.text).reverse().slice(0, 50),
    [streamRows],
  );
  // 想下一条（第二十四遍·业主裁 A②）：Tab 触发时拼上下文摘录（suggest.ts 纯函数）+ 当前选中模型
  // 走 main 单发模型调用；「没内容可依」与 IPC 失败都在这里分类成上屏文案，Composer 只管展示。
  const onSuggestNext = useCallback(async (): Promise<SuggestNextResult> => {
    const excerpt = buildSuggestContext(streamRows);
    if (excerpt === null) {
      return { ok: false, reason: "error", message: "会话还没有内容", hint: "先说两句或派一条任务，Tab 才有上下文可依。" };
    }
    try {
      return await window.agent.suggestNext({ model: chosen ?? null, excerpt });
    } catch (err: unknown) {
      const brief = err instanceof Error ? err.message : String(err);
      return { ok: false, reason: "error", message: brief, hint: `想建议失败（${brief.slice(0, 60)}）——再按一次 Tab 重试。` };
    }
  }, [streamRows, chosen]);
  // 目录数据（v7.2）：用户轮列表（round + 首句）；≥2 轮才出目录入口（1 轮没有可跳的目标）。
  const outlineTurns = useMemo(() => turnSummaries(streamRows), [streamRows]);
  const hasThinking = useMemo(
    () => streamRows.some((r) => r.kind === "assistant" && r.thinking !== undefined && r.thinking !== ""),
    [streamRows],
  );
  // 会话条标题（§2.2 会话名 13px）：取会话真实标题；索引未到时退 id（不编名字）。
  const sessionTitle = activeId === null ? "" : (findSessionByRef(sessions, activeId, activeWorkspace ?? undefined)?.title ?? activeId);
  const { cycleView, toggleFoldRound, foldAllTurns, unfoldAllTurns, jumpToRound, jumpToEvent } = useConversationNavigation({ viewRef, hasThinking, setViewMode, setViewToast, viewToastTimer, foldedBySession, activeId, setFoldedRounds, outlineTurns, setFlashRound, streamEl, flashRound, events, activeIdRef, stick, setOutlineOpen, setOutlineCurrent, outlineOpen, streamRows, foldedRounds });

    // 切会话 ⇒ **取消改名**（2026-10-20 独立评审追出，MEDIUM 的第二道保险）：
  // 改名输入框不该跨会话活着——切过去之后它还聚焦着、显示的还是**上一条**会话的标题，
  // 用户在 B 的界面里改着 A 的名。绑 id 那道保险保证「不改错对象」，
  // 这一道保证「界面不撒谎」（输入框直接收起来，不留一个改不动的框）。
  useEffect(() => {
    setBarRenaming(null);
  }, [activeId, activeWorkspace]);

  // ── 蓝本 §3.6 快捷键全表（一处挂载；latest-ref 模式——监听器只订阅一次，闭包每次渲染取最新值）──
  /** F2 重命名当前会话（2026-10-18）：桌面端肌肉记忆；点会话名也能改，这里补键盘入口。
   *  不劫持输入框里的 F2（用户在写正文时按 F2 不是想改名）。 */
  const startBarRename = useCallback((): boolean => {
    const sid = activeIdRef.current;
    if (sid === null) return false;
    setBarRenaming({ id: sid, text: findSessionByRef(sessions, sid, activeWorkspaceRef.current ?? undefined)?.title ?? sid });
    return true;
  }, [sessions]);
  // 输入区锁因（2026-10-18 唯一处）：快捷键提示、Composer disabled、占位文案三面共用同一判据，
  // 不再各推各的（真机实证：门未决时占位写成「正在创建会话…」）。理由只在这里排优先级。
  const composerLock = composerLockReason({
    queueLoading,
    creating: pendingSend && activeId === null,
    gateActive: pendingClarify !== null || pendingPlan !== null,
  });
  // 锁定时 ⌘⇧I/M/E 的可见回执；未锁 = null（正常开菜单）。
  const composerMenuBlock = composerLock === "queue"
    ? STR.shortcut.menuLockedQueue
    : composerLock === "creating"
      ? STR.shortcut.menuLockedCreating
      : composerLock === "gate"
        ? STR.shortcut.menuLockedGate
        : null;

  /** 查找下一个/上一个（⌘G / ⇧⌘G / 菜单「查找下一个」）：查找条没开时先开（与 ⌘F 同一落点——
   *  原生查找的肌肉记忆是先按下一个，旧实现此时静默无响应，会被读成键坏了）。
   *  返回是否接管了这次按键（没接管就不 preventDefault）。 */
  const findStep = useCallback((dir: 1 | -1): boolean => {
    if (findOpen) { findRef.current?.step(dir); return true; }
    // 2026-10-20 独立评审追出（LOW-MEDIUM）：旧形状对 `dir === -1` 直接 return false ⇒
    // 「查找上一个」（⌘⇧G / 菜单「查找上一个」）在查找条**没开**时**静默无响应**
    // ——与这条函数自己的理由（「旧实现此时静默无响应，会被读成键坏了」）自相矛盾。
    // 改法：两个方向都先**开条**（从关着状态没有"上一个"可跳，开条即回执）。
    if (activeIdRef.current === null) return false;
    setFindOpen(true);
    findRef.current?.focus();
    return true;
  }, [findOpen]);
  /** ⌘F / 菜单「查找…」：没开会话时给回执，不静默。 */
  const openFindBar = useCallback((): void => {
    if (activeIdRef.current === null) { toast.error("先打开一个会话再查找"); return; }
    setFindOpen(true);
    findRef.current?.focus();
  }, []);
  useAppCommands({ togglePane, closeLastPane, newSession, cycleSession, cycleView, openComposerMenu, toggleSidebar, togglePluginSidebar, closePluginSidebar, pluginSidebarOpen, cancelRunHeal, runningActive, activeId, cheatOpen, toggleCheat, closeCheat, ctrlTabCycle, composerMenuBlock, askForActive, pendingClarify, pendingPlan, requestPickElement, outlineOpen, setOutlineOpen, stick, toggleInspector, toggleFocusMode, handleOpenPalette, pickAndAddProject, setSettingsSection, setSettingsOpen, paletteOpen, findOpen, setFindOpen, closeFind, startBarRename, findStep, closeSessionToHome, cycleSessionOrToast, handlePaletteAction, openFindBar, findRef, setDragOverApp, projectsRef, handleAddProject });

    // v6 交付卡：同一份投影同时供卡片与"最后一轮"判定（恢复上一版只对最后一轮有意义）。
  const deliveries = useMemo(() => turnDelivery(events), [events]);
  const lastDeliveryRound = deliveries.length > 0 ? deliveries[deliveries.length - 1]?.round : undefined;
  // 批 3：流尾序列 = 有交付的轮出卡；空轮不出内容（2026-10-24 弱行撤下）。
  const deliveryTrailItems = useMemo(
    () => deliveryTrail(deliveries),
    [deliveries],
  );

  const handleOpenArtifact = useCallback<NonNullable<StreamActions["onOpenArtifact"]>>((a) => {
  if (activeWorkspace === null) return;
  const abs = a.path.startsWith("/") ? a.path : `${activeWorkspace}/${a.path}`;
  if (a.kind === "html" || a.kind === "svg") void openPreview(abs);
  else void window.agent.revealInFinder(abs);
  }, [activeWorkspace, openPreview]);
  const streamActions = useMemo<StreamActions>(() => ({
  feedback,
  feedbackBusy,
  pinBusy,
  annotationPending,
  onPin: handlePin,
  ...(pinnedEventIds.size > 0 ? { pinnedEventIds } : {}),
  onFeedback: handleFeedback,
  onRevertTurn: handleRevertTurn,
  onCopyText: handleCopyText,
  onOpenAttachment: openAttachment,
  onBranch: handleBranch,
  onEditRound: handleEditUser,
  onSpeak: handleSpeak,
  speakingEventId,
  onToggleFold: toggleFoldRound,
  // 错误行「重试」：最后一轮输入再跑一轮（追加；运行中 Stream 侧不摆按钮）
  onRetryLast: handleRetryLast,
  running: runningActive,
  // 产物直达（2026-10-16）：工具交付的东西给一个入口，指向**落盘那一份**
  // （不是模型在回复里重新抄的那份）。可预览的走 openPreview，其余回落 Finder。
  onOpenArtifact: handleOpenArtifact,
  }), [feedback, feedbackBusy, pinBusy, annotationPending, handlePin, pinnedEventIds, handleFeedback,
    handleRevertTurn, handleCopyText, openAttachment, handleBranch, handleEditUser,
    handleSpeak, speakingEventId, toggleFoldRound, handleRetryLast, runningActive, handleOpenArtifact]);

  // P1 侧栏数据面（诚实边界：只同步本进程可见态）：等门集合 + 服务状态点
  //（demo 演示恒可用；真家看 keyConfigured。null = 还没探测到，点标「未检测」不摆假绿）。
  const waitingIdSet = new Set(waitingCounts.current.keys());
  const providerOk = providerInfo === null ? null : (providerInfo.kind === "demo" || providerInfo.keyConfigured);
  // P2-1 空屏：项目 chip 弹层清单（搜索过滤名字与路径；未加载 = 空数组，列表占位文案在场）。
  const chipQueryNorm = chipQuery.trim().toLowerCase();
  const chipList = (chipRecent ?? []).filter((p) =>
    chipQueryNorm === "" || p.name.toLowerCase().includes(chipQueryNorm) || p.path.toLowerCase().includes(chipQueryNorm),
  );
  return {
    protocolMismatch,
    activeWorkspace,
    projects,
    pickerValue,
    providerInfo,
    settingsOpen,
    activeId,
    barRenaming,
    setBarRenaming,
    sessions,
    renameSessionById,
    sessionTitle,
    goalTrace,
    dismissedGoals,
    goalAct,
    activeIdRef,
    setDismissedGoals,
    outlineTurns,
    outlineOpen,
    setOutlineOpen,
    paneTabs,
    togglePane,
    fileCount,
    pluginSidebarOpen,
    togglePluginSidebar,
    focusMode,
    toggleFocusMode,
    sidebarCollapsed,
    toggleSidebar,
    newSession,
    handleOpenPalette,
    openPane,
    setSettingsSection,
    setSettingsOpen,
    sidebarWidth,
    runningSet,
    waitingIdSet,
    draftIds,
    outcomes,
    registryNotice,
    sessionsLoaded,
    sessionsLoadError,
    retrySessions,
    providerOk,
    openSession,
    setActiveWorkspace,
    activeWorkspaceRef,
    touchWorkspace,
    handleAddProject,
    handleCloneProject,
    setNewProjectOpen,
    handleUpdateProject,
    handleRemoveProject,
    handleRevealProject,
    pinSessionById,
    forkSessionFromMenu,
    requestArchiveSession,
    openSessionInCli,
    setWtDiscard,
    sessionWorktreeOp,
    requestDeleteSession,
    themePref,
    changeTheme,
    usageStats,
    usageAll,
    loadUsageAll,
    startSidebarDrag,
    persistSidebarWidth,
    sidebarWidthRef,
    mainGroupRef,
    showEmpty,
    findRef,
    findOpen,
    streamEl,
    closeFind,
    lastError,
    clearLastError,
    setLogTarget,
    lastNotice,
    clearLastNotice,
    importDiagnosis,
    setImportDiagnosis,
    chipRef,
    chipOpen,
    openChipPopover,
    emptyData,
    chipQuery,
    setChipQuery,
    chipRecent,
    chipList,
    closeChip,
    setLastError,
    setStreamEl,
    stick,
    streamRows,
    rowRefs,
    inheritedSeqs,
    viewMode,
    runningActive,
    foldedRounds,
    flashRound,
    streamActions,
    deliveryTrailItems,
    deliveryExpandedFor,
    openPreview,
    exportActiveProject,
    lastDeliveryRound,
    handleRevertTurn,
    setDeliveryExpandedFor,
    outlineCurrent,
    jumpToRound,
    unfoldAllTurns,
    foldAllTurns,
    askForActive,
    setMode,
    setLastNotice,
    pendingClarify,
    pendingPlan,
    composerZoneRef,
    editCtx,
    events,
    sendQueue,
    setEditCtx,
    setDraftRemap,
    draftRemapSeq,
    refreshSessions,
    setQueueFor,
    cancelRunHeal,
    queueLoading,
    pendingSend,
    resumeQueue,
    skills,
    composerLock,
    mode,
    planRequired,
    onPlanRequiredChange: changePlanRequired,
    stopped,
    usage,
    phaseLabel,
    phase,
    elapsedSec,
    steps,
    runSteps,
    chosenCtx,
    recentRefsBySession,
    noteRecentRef,
    promptHistory,
    noteDraft,
    injectedText,
    injectedTextSeq,
    draftRemap,
    draftRestore,
    sendWithGoal,
    configuredProviders,
    thinkingBySession,
    pendingThinking,
    setPendingThinking,
    force,
    selections,
    refreshProviderInfo,
    compactNow,
    composerMenuSignal,
    onSuggestNext,
    injectedAttachment,
    injectedAppend,
    onboarded,
    onboarding,
    injectText,
    inspectorRef,
    inspectorDefault,
    setInspectorCollapsed,
    inspectorSaveTimer,
    inspectorColRef,
    jumpToEvent,
    handleRestoreSnapshot,
    toggleInspector,
    attachFromPane,
    pickSignal,
    handlePickResult,
    preview,
    closePane,
    send,
    setPaneTabs,
    pluginSidebarWidth,
    setPluginSidebarWidthPersist,
    closePluginSidebar,
    fillPluginCommand,
    viewToast,
    cheatOpen,
    closeCheat,
    revertConfirm,
    setRevertConfirm,
    doRevertTurn,
    projectRemoveConfirm,
    setProjectRemoveConfirm,
    doRemoveProject,
    archiveConfirm,
    setArchiveConfirm,
    doArchiveSession,
    deleteConfirm,
    setDeleteConfirm,
    doDeleteSession,
    wtDiscard,
    paletteOpen,
    setPaletteOpen,
    focusComposer,
    handlePaletteAction,
    startBarRename,
    logTarget,
    settingsSection,
    refreshProviderKeys,
    setThemePref,
    setTextSize,
    setUiSize,
    setCtrlTabCycle,
    dragOverApp,
    newProjectOpen,
    templates,
    handleCreateFromDialog,
  };
}
