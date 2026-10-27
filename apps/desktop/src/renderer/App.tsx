// App 根（Claude 蓝本 v1 重建）：外壳（TitleBar + Sidebar + Main）+ 覆盖层（设置页）。
// 状态编排/事件驱动/运行链全部沿用既有实现（逻辑资产原样搬运）：
//   · 会话清单同步、竞态守卫（openSeq）、运行集（runningSet）、按会话错误/提示条
//   · 运行链：send → runOn（drainQueue FIFO）→ 收束续派；v2.17 运行中可沟通（回车入队）
//   · 审批/澄清/计划三卡（GateSlot ≤1）、反馈/回滚/复制、主题、协议握手。
// 本文件只换外壳与布局（蓝本 §3.1 应用外壳）；业务语义不动。
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ArrowDown, ChevronDown, FileDiff, Focus, Folder, FolderPlus, GitBranch, Globe, List, MoreHorizontal, Sparkles, Terminal, X } from "lucide-react";
import { Group, Panel, Separator, type PanelImperativeHandle } from "react-resizable-panels";
import type { AgentEvent, AskPayload, PermissionMode, ProjectDiagnosis, ProjectRecord, ProviderInfo, RunAttachmentReference, RunResponse, SuggestNextResult } from "../../../../src/main/ipc-protocol";
import type { StreamActions } from "./components/Stream";
import type { TextSizeSetting, UiSizeSetting } from "../../../../src/main/settings";
// 预览状态是**类型**导入（值面留在主进程：project-preview 拖 node:http/child_process，
// 渲染层只消费推送快照；文案在渲染层按 status 组合）。
import type { PreviewSnapshot } from "../../../../src/main/project-preview";
import { deliveryTrail, deriveRunPhase, elapsedSecondsFor, runPhaseLabel, formatEmptyTrailNote, formatRevertNotice, hasAssistantTextThisRun, isMainSessionTerminalEvent, mergeSessionSnapshot, pendingClarifyOf, pendingPlanOf, projectStream, roundOfEvent, turnDelivery, usageAggregate, usageSummary, countToolSteps, countRunSteps, userTextOfRound } from "./projections";
import { composerLockReason, continueAfterRun, drainQueue, dropQueued, fromSessionQueueEntries, isSessionEndDistillAsk, promoteQueued, shouldHealStaleRun, takeQueued, toSessionQueueEntries, type QueuedSend } from "./send-queue";
import { stripMarkdownForSpeech } from "./speech";
import { useMessageAnnotations } from "./useMessageAnnotations";
import { Sidebar } from "./components/Sidebar";
import { SidebarRail } from "./components/SidebarRail";
import { NewProjectDialog } from "./components/NewProjectDialog";
import { AddProjectMenu } from "./components/AddProjectMenu";
import { QuickStarts } from "./components/QuickStarts";
import { Popover, usePopoverDismiss } from "./components/Popover";
import { buildQuickStarts, greetingFor, type QuickStartInput } from "./quick-starts";
import type { WorkspaceSession } from "./sessions-view";
import type { MenuCommandId } from "../shared/menu-commands";
import { classifyDrop } from "./sessions-view";
import { commandAllowed, isEditableTarget, overlayBlocked, readGateInput } from "./command-gate";
import { STR } from "./strings";
import { toast } from "./toast";
import { TitleBar } from "./components/TitleBar";
import { foldAllButLast, turnSummaries } from "./components/stream-model";
import { OutlinePanel } from "./components/Outline";
import { Inspector } from "./components/Inspector";
import { ModalSurface } from "./components/ModalSurface";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { FindBar, type FindBarHandle } from "./components/FindBar";
import { ProviderBanner } from "./components/ProviderBanner";
import { transcriptFileName, transcriptMarkdown } from "./transcript";
import { readDraftIds } from "./drafts";
import { parseGoalCommand, type GoalCommand } from "./goal-command";
import { readDismissedGoals, writeDismissedGoals } from "./goal-dismiss";
import { relInWorkspace } from "./workspace-rel";
import { traceGoal } from "../../../../src/agent/goal-trace";
import { GoalChip } from "./components/GoalChip";
import type { SlashSkill } from "./slash";
import { Composer } from "./components/Composer";
import { MODE_LABEL } from "./components/PermissionMenu";
import { SendQueueStrip } from "./components/SendQueueStrip";
import { ApprovalCard } from "./components/ApprovalCard";
import { ClarifyCard } from "./components/ClarifyCard";
import { PlanCard } from "./components/PlanCard";
import { ChangeSummaryCard } from "./components/ChangeSummaryCard";
import { ErrorStrip } from "./components/ErrorStrip";
import { ImportDiagnosisCard } from "./components/ImportDiagnosisCard";
import { changedFileCount, lastOpenedPane, movePane, PANE_META, PANE_OPENABLE, type PaneKind } from "./components/panes";
import type { PaletteAction } from "./components/CommandPalette";
import type { SectionId } from "./components/settings-nav";
import { scrollBehavior, useStickyScroll } from "./useStickyScroll";
import { applyTheme, browserThemeEnv, type ThemePref } from "./theme";
import { nextViewMode, VIEW_LABEL, type ViewMode } from "./view-mode";
import { buildSuggestContext } from "./suggest";
import { SHORTCUT_GROUPS } from "./shortcuts";
import { paneShortcutFor, paneShortcutKeys } from "./pane-shortcuts";

const PaneDock = lazy(() => import("./components/PaneDock").then((m) => ({ default: m.PaneDock })));
const CommandPalette = lazy(() => import("./components/CommandPalette").then((m) => ({ default: m.CommandPalette })));
const SettingsPanel = lazy(() => import("./components/SettingsPanel").then((m) => ({ default: m.SettingsPanel })));
const Stream = lazy(() => import("./components/Stream").then((m) => ({ default: m.Stream })));

declare global { interface Window { agent: import("../../../../src/main/ipc-protocol").AgentApi } }

// SEMA §3.5/§12：构建期注入的期望协议版本（vite define 换字面量——产物零运行时 import src）。
declare const __IPC_PROTOCOL_VERSION__: number;

/**
 * 侧栏宽度域（2026-10-20 真机还原更正）。
 * 依据：Claude 桌面端 2.42304.2 真机实测——1100×700 原生窗、2× 截图（2200×1400，
 * 倍率严格 2.0，已用 CGWindowList 独立验证 bounds），侧栏/主区接缝在 y=200/400/900/1300
 * 四个高度**完全一致**落在 x=399–400 ⇒ 侧栏宽 **(399−2)/2 = 198.5pt**。
 * 规范 §3.11 写的 242px 与实测差 −18%，据此改域：缺省取 200（198.5 的整数近似）。
 * 上限保留 280（规范既有上限，不因本轮实测收窄）。
 */
const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 280;
const SIDEBAR_DEFAULT = 200;

/** 文本编辑面（输入框/文本域/可编辑元素）：⌘↑/⌘↓ 在这些地方是文本编辑语义，全局快捷键让路（不劫持）。
 *  2026-10-20 搬进 `command-gate.ts`：它同时管着**菜单路径**要不要让给文本编辑——
 *  两处各写一份判法就会漂（keydown 让了、菜单没让 = 同一个键两种行为）。 */

/** P2-1 空屏建议面（App 装配数据 → quick-starts 纯函数出题；缓存单位=项目路径）。 */
interface EmptySurface {
  quickStarts: string[];
  branch: string | null;
}

/** 零数据建议输入（无项目 / 一切未知 ⇒ 纯回退三条通用建议）。 */
const NULL_QUICK_INPUT: QuickStartInput = {
  git: null,
  hasPackageJson: false,
  scripts: [],
  readmeExists: false,
  lastSessionTitle: null,
};

/** 主区最小 420 + 检查器最小 320 + 分隔条 3 + 余量 1：不足时先收起侧栏再展开检查器。 */
const INSPECTOR_SIDEBAR_COLLAPSE_BELOW = 744;

export function App() {
  // 会话清单带归属工作区（host.listSessions 的 desktop 扩展字段，交叉类型收窄——同 aborted 先例）。
  const [sessions, setSessions] = useState<WorkspaceSession[]>([]);
  // 会话清单是否已从盘上读过一轮（空屏建议要等它——「继续上次」的原料是最近标题，抢跑会漏）。
  const [sessionsLoaded, setSessionsLoaded] = useState(false);
  // 清单读取失败（2026-10-18）：此前失败只会让 sessionsLoaded 永远停在 false，
  // 侧栏分不出「还没有任务」与「没读到」；现在失败可见并可重试（空 ≠ 失败）。
  const [sessionsLoadError, setSessionsLoadError] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [events, setEvents] = useState<AgentEvent[]>([]);
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
  const [preview, setPreview] = useState<PreviewSnapshot | null>(null);
  const previewByPath = useRef(new Map<string, PreviewSnapshot>());
  // 推送回调闭包只建一次 ⇒ 用 ref 存当前工作区，避免读到过期值（同 activeIdRef 的纪律）。
  const activeWorkspaceRef = useRef<string | null>(null);
  // P1-4「最近打开」：projects/sessions 的渲染镜像（callback 在事件时刻读最新值，不吃陈旧闭包）。
  const projectsRef = useRef<ProjectRecord[]>([]);
  projectsRef.current = projects;
  const sessionsRef = useRef<WorkspaceSession[]>([]);
  sessionsRef.current = sessions;
  // 侧栏折叠（渲染态，V1 不落 settings）。
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  // 侧栏宽度：可拖拽，持久在 localStorage。
  // 2026-10-20 真机还原更正：Claude 真机实测侧栏 **198.5pt**（1100×700 原生窗 2× 截图，
  // y=200/400/900/1300 四个高度接缝一致）。旧域 240–280（brief 第九节）据此改为
  // 200–280、缺省 200；旧值读回时就地收进新域。
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    try {
      const raw = Number(window.localStorage.getItem("cairn.sidebar.width"));
      if (Number.isFinite(raw) && raw > 0) return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, raw));
    } catch { /* 读不到用缺省 */ }
    return SIDEBAR_DEFAULT;
  });
  const sidebarWidthRef = useRef(sidebarWidth);
  sidebarWidthRef.current = sidebarWidth;
  const persistSidebarWidth = useCallback((w: number) => {
    const clamped = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, w));
    setSidebarWidth(clamped);
    try { window.localStorage.setItem("cairn.sidebar.width", String(clamped)); } catch { /* 存不下则本会话内生效 */ }
  }, []);
  const startSidebarDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sidebarWidthRef.current;
    let last = startW;
    // 拖拽期间关掉宽度过渡（2026-10-18）：.side-wrap 上挂着 `transition: width var(--t-fast)`
    // （⌘B 收/开要它），而拖拽是同一个 width 属性逐 pointermove 重写 ⇒ 每次移动都被插值 140ms，
    // 把手肉眼可见地落后于光标、松手又补一段。收/开要过渡、拖拽要即时，靠 data-resizing 分流。
    document.body.dataset.resizing = "sidebar";
    const onMove = (ev: PointerEvent): void => {
      last = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, startW + (ev.clientX - startX)));
      setSidebarWidth(last);
    };
    const onUp = (): void => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      delete document.body.dataset.resizing;
      try { window.localStorage.setItem("cairn.sidebar.width", String(last)); } catch { /* 同上 */ }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, []);
  // M1 T3 deferred 收口（onOpen 竞态守卫）。
  const openSeq = useRef(0);
  /** 打开会话期间到达的 live 事件先落这里，读盘快照回来后再合并（见 mergeSessionSnapshot）。 */
  const openPending = useRef<{ id: string; events: AgentEvent[] } | null>(null);
  // 空态 pills / 编辑 / 回放共用的「填入输入框」信号：seq 每次递增 ⇒ 连续点同一条建议也能再次填入。
  const [injectedText, setInjectedText] = useState<string | undefined>(undefined);
  const [injectedTextSeq, setInjectedTextSeq] = useState(0);
  const injectedSeqRef = useRef(0);
  const injectText = useCallback((text: string) => {
    setInjectedText(text);
    setInjectedTextSeq(++injectedSeqRef.current);
  }, []);
  // 草稿桶搬家通道（`{from, to, seq}`）：Composer's 草稿桶跟着换键。
  // ① 重命名换 id：否则 Composer 在渲染期把字存回旧 id、再读新 id 的空桶；
  // ② 「回到原会话」删掉第 1 轮编辑建的空分支：那份未发出去的稿得跟着用户走
  //    （2026-10-20 独立评审追出，LOW-MEDIUM）——删会话不删草稿 ⇒ 稿子变孤儿。
  const [draftRemap, setDraftRemap] = useState<{ from: string; to: string; seq: number } | undefined>(undefined);
  const draftRemapSeq = useRef(0);
  // 发送失败回滚：Composer 提交即清空输入框，失败时把原文/附件还回去（按会话归属，切走了只存桶）。
  const [draftRestore, setDraftRestore] = useState<{ forSession: string | null; text: string; attachments: RunAttachmentReference[]; seq: number } | undefined>(undefined);
  const draftRestoreSeq = useRef(0);
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
  // M4-4：权限档从 settings 读；send 透传。
  const [mode, setMode] = useState<PermissionMode>("default");
  // 排队消息在**派发那一刻**读档位：drainQueue 持有起跑时的 run 闭包，若闭包直接捕获 mode，
  // 用户在运行中切档后排队消息仍按旧档执行（与「下一条消息起生效」的文案相反）。
  const modeRef = useRef(mode);
  modeRef.current = mode;
  // 主题（设计规范 §4.6）：settings.theme 单一持有 → data-theme 属性（tokens.css 消费）。
  const [themePref, setThemePref] = useState<ThemePref>("system");
  // 2026-10-18：界面字号档（双轴变体的文字轴）。settings.textSize 单一持有 → html[data-text-size]，
  // tokens.css 的 `--rem-scale` 乘在每一个字号 calc 上 ⇒ 全界面文字一起缩放。
  // CSS 三档（html[data-text-size=sm|md|lg] → --rem-scale .92|1|1.08）早已写好，
  // 此前缺的只是「一个字段 + 这一处赋值」——data-text-size 从来没被任何代码写过。
  const [textSize, setTextSize] = useState<TextSizeSetting>("md");
  // 2026-10-20：组件尺寸档（双轴变体的**尺寸轴**，销 G2）。Claude 实测 data-step="1…5"。
  // 与 textSize 正交：几何令牌乘 --size-scale，字号令牌乘 --rem-scale，
  // 于是「调大字号」不再连带把控件也撑大（规范 §4.5 尾）。
  const [uiSize, setUiSize] = useState<UiSizeSetting>("2");
  // P3-3 命令面板（⌘K / 侧栏搜索钮）。
  const [paletteOpen, setPaletteOpen] = useState(false);
  // §3.6/§7.3.3：Ctrl+Tab 会话循环开关（设置页可关；缺省开）。
  const [ctrlTabCycle, setCtrlTabCycle] = useState(true);
  const [pendingSend, setPendingSend] = useState(false);
  // M3-5 已停态真值驱动。
  const [stoppedIds, setStoppedIds] = useState<ReadonlySet<string>>(new Set());
  // 设置页（initialSection：直达分区）。
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SectionId | undefined>(undefined);
  // 窗格区（蓝本 §3.4）：打开的窗格集（网格化后多窗格同屏、纵向堆叠；渲染态，不落 settings）。
  // 窗格布局跨重启保留（2026-10-18）：上次开着的终端/浏览器/变更…重启后应还在。
  // 只存 kind 列表；终端会挂一个新 PTY、浏览器窗格空着开——各窗格自己的状态（标签/tab）不在此列。
  const [paneTabs, setPaneTabs] = useState<PaneKind[]>(() => {
    try {
      const raw = window.localStorage.getItem("cairn.panes.v1");
      if (raw === null) return [];
      const list: unknown = JSON.parse(raw);
      if (!Array.isArray(list)) return [];
      const valid = new Set<string>(Object.keys(PANE_META));
      const seen = new Set<string>();
      return list.filter((k): k is PaneKind => {
        if (typeof k !== "string" || !valid.has(k) || seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    } catch {
      return [];
    }
  });
  useEffect(() => {
    try { window.localStorage.setItem("cairn.panes.v1", JSON.stringify(paneTabs)); } catch { /* 存不下则本会话内生效 */ }
  }, [paneTabs]);
  // 窗格打开顺序（2026-10-18）：只增不减（关掉的不删，lastOpenedPane 会跳过已不在场的）。
  // 为什么单记一份：paneTabs 的数组顺序是**渲染顺序**，会被拖拽/⌥↑⌥↓ 重排；
  // 而 ⌘\ 的文档承诺是「关闭最近打开的窗格」——那是打开顺序，两件事不能共用一个数组。
  const paneOpenOrder = useRef<PaneKind[]>(paneTabs);
  // 当前窗格集的镜像 ref：closeLastPane 要读「此刻开着哪些」，但不能为此把 paneTabs 塞进依赖
  // （那会让回调每次开合窗格都变，快捷键表跟着重建）。镜像 ref 是既有模式（activeIdRef 同用法）。
  const paneTabsRef = useRef<PaneKind[]>(paneTabs);
  paneTabsRef.current = paneTabs;
  const notePaneOpened = useCallback((kind: PaneKind): void => {
    const cur = paneOpenOrder.current;
    if (!cur.includes(kind)) paneOpenOrder.current = [...cur, kind];
  }, []);
  // 视图三档（蓝本 §3.4）：Ctrl+O 循环，toast 一闪即走（不留常驻态）。
  const [viewMode, setViewMode] = useState<ViewMode>("normal");
  const [viewToast, setViewToast] = useState<string | null>(null);
  const viewToastTimer = useRef<number | null>(null);
  // 长对话导航（v7.2）：对话目录 + 轮折叠 + ⌘↑/⌘↓。折叠按会话记忆（渲染态，不落 settings）。
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [outlineCurrent, setOutlineCurrent] = useState<number | null>(null);
  const [flashRound, setFlashRound] = useState<number | null>(null);
  const [foldedRounds, setFoldedRounds] = useState<ReadonlySet<number>>(new Set<number>());
  // 有草稿的会话（2026-10-18）：启动从 localStorage 读一次，之后 Composer 防抖上报；侧栏画铅笔。
  const [draftIds, setDraftIds] = useState<Set<string>>(() => readDraftIds());
  // 已停止目标的本地隐藏（2026-10-18）：核心 clear 对已停目标幂等、不落新事件，
  // 只有“隐藏”能让芯片从会话条上消失；新 goal_set（at 变化）会重新显示。
  // 按会话记录被隐藏的已停目标（2026-10-18：单个 number 会跨会话误伤——A 的 at 与 B 的 at
  // 是两条事件流里的下标，数字相等不代表同一个目标）。
  const [dismissedGoals, setDismissedGoals] = useState<Map<string, number>>(() => readDismissedGoals());
  // 编辑并重发的上下文（2026-10-18）：点「编辑」会立刻建新分支并切换会话，但界面上没有一句话
  // 说明“你现在在新分支里编辑第 N 轮，原会话不动”——静默切换最容易让人以为原会话被改了。
  const [editCtx, setEditCtx] = useState<{ originId: string; originTitle: string; forkId: string; round: number } | null>(null);
  // 交付轨迹默认只留最新一张卡（2026-10-18 第二轮业主截图：收起后仍有二十多张单行卡铺满流尾）。
  // 早期交付收进一行入口；展开状态按会话记，切走再回来不会又铺开。
  const [deliveryExpandedFor, setDeliveryExpandedFor] = useState<string | null>(null);
  const editCtxRef = useRef(editCtx);
  editCtxRef.current = editCtx;
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
    void window.agent.getSettings().then((s) => { setMode(s.mode); setThemePref(s.theme); setCtrlTabCycle(s.ctrlTabCycle); setTextSize(s.textSize); setUiSize(s.uiSize); setOnboarded(s.onboarded); }).catch(() => undefined);
  }, []);
  // v6 模板目录：入口下拉的数据面（拉不到 = 空表，入口禁用而不是摆一个点不动的按钮）。
  useEffect(() => {
    void window.agent.projectTemplates().then(
      (list) => { setTemplates(list.map((t) => ({ ...t, runKind: t.runKind as "static" | "vite" }))); },
      () => { setTemplates([]); },
    );
  }, []);
  // v6 预览快照：按工作区缓存（切回工作区能看到上次的状态），推送只刷新当前工作区。
  useEffect(() => {
    activeWorkspaceRef.current = activeWorkspace;
    setPreview(activeWorkspace === null ? null : (previewByPath.current.get(activeWorkspace) ?? null));
  }, [activeWorkspace]);
  useEffect(() => {
    const off = window.agent.onPreviewState((s) => {
      previewByPath.current.set(s.projectPath, s);
      if (s.projectPath === activeWorkspaceRef.current) setPreview(s);
    });
    return off;
  }, []);
  // 主题应用（§4.6）：偏好变化即写 data-theme；system 跟随系统并订阅变化（清理函数解除）。
  useEffect(() => applyTheme(themePref, browserThemeEnv()), [themePref]);
  // 头像菜单「外观」子菜单的切主题（批 130）：点选即生效并落盘；
  // 失败要说人话（否则界面停在旧主题，用户以为点了没反应）。
  const changeTheme = useCallback((next: ThemePref) => {
    void window.agent.setSettings({ theme: next }).then(() => {
      setThemePref(next);
    }).catch((err: unknown) => {
      toast.error(`主题切换失败：${err instanceof Error ? err.message : String(err)}`);
    });
  }, []);
  // 2026-10-18 字号档应用：与主题同一形制——单一事实源写一个 data 属性，tokens.css 消费。
  // md 档不写属性（让 --rem-scale 保持 :root 的 1），不往 DOM 上堆无意义的状态。
  useEffect(() => {
    if (textSize === "md") document.documentElement.removeAttribute("data-text-size");
    else document.documentElement.setAttribute("data-text-size", textSize);
  }, [textSize]);
  // 2026-10-20 尺寸档应用：与字号同一形制——单一事实源写一个 data 属性，tokens.css 消费。
  // "2" 档不写属性（让 --size-scale 保持 :root 的 1），不往 DOM 上堆无意义的状态。
  useEffect(() => {
    if (uiSize === "2") document.documentElement.removeAttribute("data-ui-size");
    else document.documentElement.setAttribute("data-ui-size", uiSize);
  }, [uiSize]);
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
  useEffect(() => {
    void window.agent.setWorkspaceContext(activeWorkspace ?? "");
  }, [activeWorkspace]);
  useEffect(() => {
    knownSessionIds.current = new Set(sessions.map((s) => s.id));
  }, [sessions]);

  // P2-1/P2-5 空屏建议装配：进入空屏（挂载 / 切项目 / ⌘N）时并发三查——
  // gitStatus（分支 + 未提交计数）/ 根目录清单（README 在场）/ package.json（test script）。
  // 失败项按 null 处理（纯函数回退自动补齐）；结果按项目路径缓存（同项目来回切不重打 IPC）。
  // 等会话清单读过一轮再装配：「继续上次」的原料是最近会话标题，抢跑会把它漏掉。
  useEffect(() => {
    if (!showEmpty) return;
    const ws = activeWorkspace;
    if (ws === null) {
      setEmptyData({ quickStarts: buildQuickStarts(NULL_QUICK_INPUT), branch: null });
      return;
    }
    const cached = emptyCache.current.get(ws);
    if (cached !== undefined) { setEmptyData(cached); return; }
    if (!sessionsLoaded) return;
    let alive = true;
    void (async () => {
      const [git, list, pkg] = await Promise.all([
        window.agent.gitStatus(ws).catch(() => null),
        window.agent.workspaceListDir("").catch(() => null),
        window.agent.workspaceReadText("package.json").catch(() => null),
      ]);
      if (!alive) return;
      const scripts = ((): readonly string[] => {
        if (pkg === null || !pkg.ok) return [];
        try {
          const parsed = JSON.parse(pkg.text) as { scripts?: Record<string, unknown> };
          return parsed.scripts !== null && typeof parsed.scripts === "object" ? Object.keys(parsed.scripts) : [];
        } catch {
          return []; // 解析失败 = 无 scripts（计划判据）
        }
      })();
      const readmeExists = list !== null && list.ok && list.entries.some((en) => /^readme(\.|$)/i.test(en.name));
      const last = sessionsRef.current.find((s) => s.workspace === ws && (s.title ?? "").trim() !== "");
      const surface: EmptySurface = {
        quickStarts: buildQuickStarts({
          git: git === null ? null : git.ok ? { ok: true, branch: git.branch, dirtyFiles: git.dirtyFiles } : { ok: false },
          hasPackageJson: pkg !== null && pkg.ok,
          scripts,
          readmeExists,
          lastSessionTitle: last?.title ?? null,
        }),
        branch: git !== null && git.ok ? git.branch : null,
      };
      emptyCache.current.set(ws, surface);
      setEmptyData(surface);
    })();
    return () => { alive = false; };
  }, [showEmpty, activeWorkspace, sessionsLoaded]);

  // 下沉动画（FLIP）：空屏期间持续记录输入区位置——这就是转场时的「前一帧」。
  useLayoutEffect(() => {
    if (!showEmpty) return;
    const el = composerZoneRef.current;
    if (el !== null) prevEmptyRect.current = el.getBoundingClientRect();
  });

  // 空屏 → 对话态：从旧位补 200ms 下沉（transform + opacity）；reduced-motion 直接落位。
  useLayoutEffect(() => {
    if (showEmpty) return;
    const el = composerZoneRef.current;
    const prev = prevEmptyRect.current;
    if (el === null || prev === null) return;
    prevEmptyRect.current = null; // 只在「空屏 → 对话」这一步动画一次
    const next = el.getBoundingClientRect();
    const dy = prev.top - next.top;
    if (Math.abs(dy) < 8) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    el.animate(
      [
        { transform: `translateY(${String(dy)}px)`, opacity: 0.6 },
        { transform: "translateY(0px)", opacity: 1 },
      ],
      { duration: 200, easing: "ease-out" },
    );
  }, [showEmpty]);

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
      // 第十八遍：首条消息自动命名（push-only 合成事件，同收束终态先例）——只刷侧栏让新标题
      // 落位；不进事件流（会渲染成怪行）、不点运行灯。
      if ((e as { type?: string }).type === "session_titled") {
        void refreshSessions();
        return;
      }
      const sid = (e as { session_id?: string }).session_id;
      if (sid && !knownSessionIds.current.has(sid) && !refetching.current) {
        refetching.current = true;
        refreshSessions().finally(() => { refetching.current = false; });
      }
      // 打开会话的读盘快照还没回来：这段窗口内的 live 事件先入缓冲，快照到达后按序合并。
      // 否则 setEvents(快照) 会把这几百毫秒的增量整段覆盖掉（长会话尤其明显）。
      if (sid !== undefined && openPending.current !== null && openPending.current.id === sid) {
        openPending.current.events.push(e);
        return;
      }
      // 运行集口径（2026-10-06 收口）：活动会话不由事件置位（置位只走发送那条路）；
      // 任何会话收到**主会话**终态 agent_status 摘位；worker 子流的终态不摘主会话旗
      // （二者同型且同带 session_id，唯一判据在 projections.isMainSessionTerminalEvent）。
      const deltaSid = sid ?? (e.type === "assistant_delta" ? activeIdRef.current : null);
      if (e.type === "assistant_delta" && deltaSid !== null) lastDeltaAt.current.set(deltaSid, Date.now());
      const terminal = isMainSessionTerminalEvent(e);
      if (sid && terminal) {
        runningSet.current.delete(sid);
        lastDeltaAt.current.delete(sid);
        // P1 侧栏状态记账（诚实边界）：done ⇒ 对勾、failed ⇒ 红点、cancelled ⇒ 清位
        // （用户主动停的不冒充完成也不报失败）。会话终态不落盘 ⇒ 本进程记账，重启归零如实。
        const status = (e as { status?: string }).status;
        if (status === "done") outcomes.current.set(sid, "ok");
        else if (status === "failed") outcomes.current.set(sid, "failed");
        else outcomes.current.delete(sid);
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
      // 对话优先跳沉（owner 实证 2026-10-15「记忆沉淀挡住正常对话了」）：队列里还有待发消息
      // ⇒ 这轮收尾的自动沉淀不与对话抢审批，当场拒掉（快销）——distill 的合并审批一次到位，
      // run 收束后队列立即开派；沉淀只是本轮跳过（下次会话收尾再试），notice 明示不暗吞。
      // 手打的记忆写入审批（args 无 trigger）不在此列，照常弹卡。
      if (isSessionEndDistillAsk(p) && (sendQueue.current.get(sid)?.length ?? 0) > 0) {
        void window.agent.decide(p.askId, false).catch(() => undefined);
        setLastNotice("已跳过本轮全局记忆写入（你在继续对话；下次收尾再试）", sid);
        return;
      }
      askById.current.set(sid, p);
      setAskBySid(new Map(askById.current));
      // P1：等门集会记账（侧栏黄点数据面；归属未知的空串不计）。
      if (sid !== "") {
        waitingByAsk.current.set(p.askId, sid);
        waitingCounts.current.set(sid, (waitingCounts.current.get(sid) ?? 0) + 1);
        force((n) => n + 1);
      }
    });
    const offDone = window.agent.onAskDone((p) => {
      // 只摘这一张（按 askId 反查会话）：另一会话仍停在门上的卡不能被顺手抹掉。
      for (const [sid, payload] of askById.current) {
        if (payload.askId === p.askId) askById.current.delete(sid);
      }
      setAskBySid(new Map(askById.current));
      // P1：凭 askId 反查会话减计数（outcome 载荷无 sessionId——反查表是唯一桥梁）。
      const sid = waitingByAsk.current.get(p.askId);
      if (sid !== undefined) {
        waitingByAsk.current.delete(p.askId);
        const left = (waitingCounts.current.get(sid) ?? 1) - 1;
        if (left <= 0) waitingCounts.current.delete(sid); else waitingCounts.current.set(sid, left);
        force((n) => n + 1);
      }
    });
    return () => { offEvent(); offAsk(); offDone(); };
  }, [refreshSessions, refreshProviderInfo, refreshProviderKeys]);

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

  const openSession = useCallback((id: string) => {
    activate(id);
    const sessionWs = sessionsRef.current.find((s) => s.id === id)?.workspace ?? null;
    // 打开会话 = 用它归属的项目（最近打开序的数据面；归属未知则跳过）。
    touchWorkspace(sessionWs);
    // 工作区上下文跟着「正在看的会话」走（2026-10-17）：从侧栏直接打开旧会话时 activeWorkspace
    // 可能仍是 null（没有选项目），此前 diff/文件窗格会因「没有已知的工作区」整块不可用。
    // 2026-10-18：**渲染层状态也要跟**——此前只通知了主进程，activeWorkspace 仍停在旧项目：
    // 空屏项目 chip、预览、斜杠技能清单都会读错工作区。会话归属已知即以它为准。
    if (sessionWs !== null) setActiveWorkspace(sessionWs);
    void window.agent.setWorkspaceContext(sessionWs ?? "");
    const seq = ++openSeq.current;
    // 立刻清掉上一会话的转录/门卡数据面：此前要等 openSession 回包才整体替换，窗口内
    // B 的标题下仍挂着 A 的转录、A 的澄清/方案门与行内「重试/还原」——用户可操作且会发错会话。
    // 读盘期间到达的 B 增量进 openPending，回包时合并（不丢流式文本）。
    const pending = { id, events: [] as AgentEvent[] };
    openPending.current = pending;
    setEvents([]);
    setQueueLoading(true);
    // 开会对账（desktop 扩展字段，交叉类型收窄——同 listSessions 的 workspace、run 的 aborted
    // 先例，不动 ipc-protocol）：main 侧运行实况。换渲染层实例（HMR/重载）后陈旧的「运行中」
    // 标记没有主人（收束时旧实例的 finally 已随实例销毁），打开即用 main 真值收敛：在跑补上、
    // 已收束摘掉。收束补发终态是正路，这条是每次开会话自愈一次的兜底，两者互不依赖。
    const opened = (window.agent.openSession(id) as Promise<{ events: AgentEvent[]; running?: boolean; startedAt?: number }>).then((r) => {
      if (seq !== openSeq.current) return;
      if (openPending.current === pending) openPending.current = null;
      setEvents(mergeSessionSnapshot(r.events, pending.events));
      if (typeof r.running === "boolean") {
        const was = runningSet.current.has(id);
        if (r.running) runningSet.current.add(id); else runningSet.current.delete(id);
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
    const queued = window.agent.queueGet(id).then(({ items }) => {
      if (seq !== openSeq.current) return;
      setQueueLocal(id, fromSessionQueueEntries(items, () => ++queueSeq.current));
    }).catch((err: unknown) => {
      if (seq === openSeq.current) setLastError(`发送队列读取失败：${err instanceof Error ? err.message : String(err)}`, id);
    });
    void Promise.allSettled([opened, queued]).finally(() => {
      if (seq === openSeq.current) setQueueLoading(false);
    });
  }, [activate, setLastError, setQueueLocal, touchWorkspace]);

  // 重启回到上次的会话（2026-10-18）：桌面应用每次启动都落回空屏，等于把上下文丢了。
  // 规则：只记“最后一次真正打开过的会话”；用户主动按 ⌘N 回主页 = 清掉记录 ⇒ 重启也回主页。
  // 跨工作区不恢复（sessions 只含当前工作区；找不到就清键、落主页）。
  const bootLastRef = useRef<string | null>((() => {
    try { return window.localStorage.getItem("cairn.lastSession.v1"); } catch { return null; }
  })());
  const bootRestored = useRef(false);
  useEffect(() => {
    if (bootRestored.current || !sessionsLoaded) return;
    bootRestored.current = true;
    if (activeId !== null) return; // 用户抢在恢复前自己开了会话
    const id = bootLastRef.current;
    if (id !== null && sessions.some((s) => s.id === id)) { openSession(id); return; }
    try { window.localStorage.removeItem("cairn.lastSession.v1"); } catch { /* 存不下则忽略 */ }
  }, [sessionsLoaded, sessions, activeId, openSession]);
  useEffect(() => {
    if (!bootRestored.current) return;
    try {
      if (activeId === null) window.localStorage.removeItem("cairn.lastSession.v1");
      else window.localStorage.setItem("cairn.lastSession.v1", activeId);
    } catch { /* 存不下则本会话内生效 */ }
  }, [activeId, sessionsLoaded]);

  // ---- v7 消息操作条：分叉（forkSession 到该轮，P3-1 挪到 user 行）+ 回放（agent 行）+ 朗读（macOS say）----
  // 位置在 activate/refreshSessions 之后：useCallback 依赖数组在渲染期求值，TDZ 不许前置引用。
  const [speakingEventId, setSpeakingEventId] = useState<number | null>(null);
  const handleBranch = useCallback((round: number) => {
    const sid = activeIdRef.current;
    if (sid === null) return;
    void window.agent.forkSession(sid, round, true).then((r) => {
      if (r.ok !== true || r.id === undefined) { setLastError(`分叉失败：${r.error ?? "未知原因"}`, sid); return; }
      void refreshSessions();
      openSession(r.id); // 分叉 = 前 N 轮的全量拷贝；切过去并载入转录/队列（裸 activate 会留旧流）
    }, (err: unknown) => {
      setLastError(`分叉失败：${err instanceof Error ? err.message : String(err)}`, sid);
    });
  }, [refreshSessions, openSession, setLastError]);
  /** P3-1 回放（agent 行 hover「回放到此步」）：fork 保留到该轮 → 切换 → 把该轮用户输入注入新会话
   *  输入框（**不自动发送**——汇报注明取舍：留出「改一改再发」的余地。轮号/输入原文都从事件日志
   *  投影 roundOfEvent / userTextOfRound，拿不到即 fail-visible，不猜）。 */
  /** 编辑并重发（2026-10-18）：新分支里填入原文供修改，不自动发送。
   *  round>1 ⇒ fork 到上一轮（保住前文）；round=1 ⇒ 新建空会话（没有前置上下文可保）；
   *  两种情况原会话都不动。名字唯一（unique=true），反复编辑不撞名。 */
  /** 手动压缩（2026-10-18）：斜杠 /compact、上下文菜单、命令面板三处共用这一条——
   *  必须带当前会话 id（旧协议不带，主进程会落到 lastLogPath，压错会话或报无日志）。 */
  const compactNow = useCallback((): void => {
    const sid = activeIdRef.current;
    if (sid === null) { toast.error(STR.composer.compactNoSession); return; }
    const compact = window.agent.compact;
    if (compact === undefined) { toast.error(STR.composer.compactUnavailable); return; }
    void compact(sid).then((r) => {
      if (!r.ok) { setLastError(r.error ?? "压缩失败", sid); return; }
      toast.success(STR.composer.compactDone);
    }, (err: unknown) => {
      setLastError(STR.composer.compactFail.replace("{reason}", err instanceof Error ? err.message : String(err)), sid);
    });
  }, [setLastError, toast]);
  /** 目标动作（暂停/继续/清除）：只发 IPC；事件由主进程推回，芯片读同一份事件流自更新。 */
  const goalAct = useCallback((req: { pause?: boolean; resume?: boolean; clear?: boolean }): void => {
    const sid = activeIdRef.current;
    if (sid === null) return;
    void window.agent.setGoal({ sessionId: sid, ...req }).then((r) => {
      if (!r.ok) setLastError(r.error ?? "目标操作失败", sid);
    }, (err: unknown) => setLastError(err instanceof Error ? err.message : String(err), sid));
  }, [setLastError]);
  const noteDraft = useCallback((sessionId: string | null, has: boolean): void => {
    if (sessionId === null) return;
    setDraftIds((prev) => {
      if (prev.has(sessionId) === has) return prev;
      const next = new Set(prev);
      if (has) next.add(sessionId); else next.delete(sessionId);
      return next;
    });
  }, []);
  const handleEditUser = useCallback((round: number, text: string): void => {
    const sid = activeIdRef.current;
    if (sid === null) return;
    const originTitle = sessions.find((s) => s.id === sid)?.title ?? sid;
    const inject = (id: string): void => {
      refreshSessions();
      openSession(id); // 必须载入新会话转录：第 1 轮编辑会建空会话，裸 activate 会把原会话历史留在屏上
      injectText(text);
      setEditCtx({ originId: sid, originTitle, forkId: id, round });
    };
    if (round <= 1) {
      void window.agent.createSession(activeWorkspaceRef.current ?? undefined).then((r) => {
        inject(r.id);
      }, (err: unknown) => {
        setLastError(`编辑失败：${err instanceof Error ? err.message : String(err)}`, sid);
      });
      return;
    }
    void window.agent.forkSession(sid, round - 1, true).then((r) => {
      if (r.ok !== true || r.id === undefined) { setLastError(`编辑失败：${r.error ?? "未知原因"}`, sid); return; }
      inject(r.id);
    }, (err: unknown) => {
      setLastError(`编辑失败：${err instanceof Error ? err.message : String(err)}`, sid);
    });
  }, [refreshSessions, openSession, injectText, setLastError, sessions]);
  const handleReplay = useCallback((eventId: number) => {
    const sid = activeIdRef.current;
    if (sid === null) return;
    const round = roundOfEvent(eventsRef.current, eventId);
    if (round === null) { setLastError("回放失败：这条消息不在事件日志的轮次里", sid); return; }
    const text = userTextOfRound(eventsRef.current, round);
    void window.agent.forkSession(sid, round, true).then((r) => {
      if (r.ok !== true || r.id === undefined) { setLastError(`回放失败：${r.error ?? "未知原因"}`, sid); return; }
      void refreshSessions();
      openSession(r.id); // 同分叉：只 activate 会显示原会话的旧转录
      if (text !== null) injectText(text); // 注入不发送（Composer 覆盖草稿并聚焦）
    }, (err: unknown) => {
      setLastError(`回放失败：${err instanceof Error ? err.message : String(err)}`, sid);
    });
  }, [refreshSessions, openSession, injectText, setLastError]);
  /** P3-2 检查器「撤销此文件改动」：snapshotRestore（v11 通道，渲染层首个消费者）。
   *  成功 toast（STR 文案 v11 就位）；失败 fail-visible 原文上屏（不装成功）。
   *  带上 sessionId：主进程还原成功后要往**这个会话**的事件流落一条 `file_restored`，
   *  否则改动面（改动 Tab / 变更窗格 / Changes 徽标 / 交付卡的「改动已验证」）还当这个文件没撤。 */
  const handleRestoreSnapshot = useCallback((path: string, snapshotId: string): void => {
    const sid = activeIdRef.current;
    void window.agent.snapshotRestore({
      path, snapshotId,
      ...(sid !== null ? { sessionId: sid } : {}),
    }).then((r) => {
      if (r.ok !== true) { toast.error(r.error ?? "还原失败"); return; }
      toast.success(STR.toast.snapshotRestored.replace("{path}", path));
      // 主进程直接 append 事件日志、不经 run 的事件推流：不本地补一条的话，改动面/徽标/
      // 交付卡会一直停在“未还原”，直到切走再开（2026-10-20 真机：还原成功、文件已回退，
      // 但 Inspector 仍显示撤销钮；重开会话才消失）。只补到发起还原的那个会话。
      if (sid !== null && activeIdRef.current === sid) {
        setEvents((prev) => [...prev, { type: "file_restored", path, snapshotId } as AgentEvent]);
      }
    }, (err: unknown) => {
      toast.error(err instanceof Error ? err.message : String(err));
    });
  }, []);
  const handleSpeak = useCallback((eventId: number, text: string) => {
    if (speakingEventId === eventId) {
      // 再点 = 停止（幂等）
      setSpeakingEventId(null);
      void window.agent.stopSpeaking();
      return;
    }
    const clean = stripMarkdownForSpeech(text);
    setSpeakingEventId(eventId); // 先点亮：say 是 fire-and-return，真实声音随后到
    void window.agent.speakText(clean).then((r) => {
      if (!r.ok) {
        setSpeakingEventId(null); // fail-visible：出错熄灭按钮态，错误照常上屏
        setLastError(`朗读失败：${r.error ?? "未知原因"}`);
      }
    }, (err: unknown) => {
      setSpeakingEventId(null);
      setLastError(`朗读失败：${err instanceof Error ? err.message : String(err)}`);
    });
  }, [speakingEventId, setLastError]);

  // ---- P1 项目管理接线（brief 第二节；失败面 throw 给调用组件 fail-visible，成功面带 Toast）----
  const refreshProjects = useCallback(async (): Promise<void> => {
    const registered = await window.agent.listProjects();
    setProjects(registered);
    setRegistryNotice(null);
  }, []);

  /** v12 导入诊断：只读判定，失败如实报错（诊断是提示面，取不到就说取不到，不摆假绿）。 */
  const diagnoseImported = useCallback(async (name: string, path: string): Promise<void> => {
    try {
      const diagnosis = await window.agent.projectDiagnose(path);
      setImportDiagnosis({ name, diagnosis });
    } catch (err) {
      setLastError(STR.errors.diagnoseFailed.replace("{message}", err instanceof Error ? err.message : String(err)));
    }
  }, [setLastError]);

  /** 打开文件夹 / 拖入 / 最近打开共用：登记 → 刷新 → Toast（名字取注册表返回值，不猜路径尾段）。 */
  const handleAddProject = useCallback(async (path: string): Promise<void> => {
    const record = await window.agent.addProject({ path });
    await refreshProjects();
    refreshSessions();
    toast.success(STR.toast.projectAdded.replace("{name}", record.name));
    void diagnoseImported(record.name, record.path);
  }, [refreshProjects, refreshSessions, diagnoseImported]);

  /** 克隆：先克隆后登记；成功切过去 + Toast；失败 throw（表单内 fail-visible 显示 git 原话）。 */
  const handleCloneProject = useCallback(async (url: string, parentDir: string): Promise<void> => {
    const cloned = await window.agent.gitClone({ url, parentDir });
    if (!cloned.ok) throw new Error(cloned.error);
    const record = await window.agent.addProject({ path: cloned.path });
    await refreshProjects();
    refreshSessions();
    setActiveWorkspace(record.path);
    activeWorkspaceRef.current = record.path;
    toast.success(STR.toast.projectCloned.replace("{name}", record.name));
    void diagnoseImported(record.name, record.path);
  }, [refreshProjects, refreshSessions, diagnoseImported]);

  /** 显示名 / 默认运行位置：同路径 upsert（addProject 既有语义，零新通道）。 */
  const handleUpdateProject = useCallback(async (p: ProjectRecord, patch: { name?: string; defaultLocation?: string }): Promise<void> => {
    try {
      await window.agent.addProject({
        path: p.path,
        name: patch.name ?? p.name,
        defaultLocation: patch.defaultLocation ?? p.defaultLocation,
      });
      await refreshProjects();
      refreshSessions();
    } catch (err) {
      // 内联改名是 fire-and-forget：失败必须上屏，不能变成未处理的 rejection。
      setLastError(`项目更新失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }, [refreshProjects, refreshSessions, setLastError]);

  /** 移除项目（必问闸 + 明说不删文件；确认文案走 STR——「不删除文件」四个字必须在）。
   *  2026-10-17：确认由原生 window.confirm 换成产品自绘卡；真正执行拆到 doRemoveProject。 */
  const doRemoveProject = useCallback(async (p: ProjectRecord): Promise<void> => {
    await window.agent.removeProject(p.id);
    await refreshProjects();
    refreshSessions();
  }, [refreshProjects, refreshSessions]);
  const handleRemoveProject = useCallback(async (p: ProjectRecord): Promise<void> => {
    setProjectRemoveConfirm(p);
  }, []);

  const handleRevealProject = useCallback((p: ProjectRecord): void => {
    void window.agent.revealInFinder(p.path).then((r) => {
      if (!r.ok) toast.error(r.error ?? "无法在 Finder 中显示");
    }, (err: unknown) => { toast.error(err instanceof Error ? err.message : String(err)); });
  }, []);

  /** 新建项目 Dialog 提交：建项 → 刷新 → 切过去 → Toast → 聚焦输入框（brief 第四节）。 */
  const handleCreateFromDialog = useCallback(async (input: { name: string; templateId: string; parentDir?: string }): Promise<void> => {
    const r = await window.agent.projectCreateFromTemplate(input);
    if (!r.ok) throw new Error(r.message);
    await refreshProjects();
    refreshSessions();
    setActiveWorkspace(r.path);
    activeWorkspaceRef.current = r.path;
    toast.success(STR.toast.projectCreated.replace("{name}", r.name));
    // 聚焦输入框（brief 第四节）：回新会话空态 + 焦点落回任务输入。
    newSessionRef.current?.();
    requestAnimationFrame(() => {
      document.querySelector<HTMLTextAreaElement>('textarea[aria-label="任务输入"]')?.focus();
    });
  }, [refreshProjects, refreshSessions]);

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

  // newSession 在下方定义（TDZ）：经 ref 引用，dialog 回调声明顺序不受限。
  const newSessionRef = useRef<(() => void) | null>(null);
  // revealInspector 同理在下方定义；openPreview 要调它 ⇒ 同一解法（ref 绕开 TDZ）。
  const revealInspectorRef = useRef<(() => void) | null>(null);

  // v6 预览：先开浏览器窗格再起服务（就绪后由快照推着导航）；失败按分类文案落到错误条，
  // 不把「点过一次预览」说成「已经能看了」。
  // 传 HTML 文件路径也认（2026-10-15 修）：单文件交付物此前只会拿到 spec 阶段失败
  // 「不是 Cairn 模板项目 + 去用模板新建一个」，而那是错的方向——main 侧 PreviewRuntime
  // 对 .html/.htm 文件走静态服务，URL 直接指向那个文件。
  const openPreview = useCallback(async (target: string): Promise<void> => {
    let snapshot: PreviewSnapshot;
    try {
      snapshot = await window.agent.previewStart(target);
    } catch (err) {
      setLastError(`预览启动失败：${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    setPreview(snapshot);
    previewByPath.current.set(snapshot.projectPath, snapshot);
    if (snapshot.status === "failed") {
      // 失败不开窗格（2026-10-18）：先开再失败会留下一个空白浏览器页，用户还得手动关；
      // 错误条已经说清原因与下一步，窗格只在真有东西可看时出现。
      setLastError(
        `预览失败（${snapshot.stage ?? "未知阶段"}）：${snapshot.message ?? ""}${snapshot.hint !== undefined ? `——${snapshot.hint}` : ""}`,
      );
      return;
    }
    // 同 requestPickElement（2026-10-18 修）：开浏览器窗格必须同时展开检查器，
    // 否则预览起来却落在 width 0 且 inert 的列里——「预览已就绪」与「看得见」是两件事。
    // revealInspector 在下方声明（TDZ），与本文件既有的 newSessionRef 同一解法：经 ref 引用。
    setPaneTabs((tabs) => (tabs.includes("browser") ? tabs : [...tabs, "browser"]));
    notePaneOpened("browser");
    revealInspectorRef.current?.();
  }, [setLastError, notePaneOpened]);

  // v6 导出：用户取消不是错误（不弹失败条）。
  const exportActiveProject = useCallback(async (projectPath: string): Promise<void> => {
    try {
      const r = await window.agent.projectExport(projectPath);
      if (r.ok) {
        setLastNotice(`项目已导出：${r.dest}（${r.copiedFiles} 个文件）`);
        return;
      }
      if (r.cancelled === true) return;
      setLastError(`导出失败：${r.error}`);
    } catch (err) {
      setLastError(`导出失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }, [setLastError, setLastNotice]);

  const newSession = useCallback(() => {
    openSeq.current += 1;
    setQueueLoading(false);
    activate(null);
    setEvents([]);
    // 新任务默认落在当前项目（activeWorkspace）：这也是一次「用它」（最近打开序）。
    touchWorkspace(activeWorkspaceRef.current);
  }, [activate, touchWorkspace]);
  // dialog 回调经 ref 触达（声明顺序解耦）；赋值同步于每次渲染。
  newSessionRef.current = newSession;

  // 窗格开关（顶栏入口与 ⋮ 菜单共用）：未开→开（追加到堆叠尾）；已开→关。
  // ── P3-2 右侧检查器（Inspector）：右 Panel 常驻但默认收起；⌘⌥B 开合；打开窗格时自动露出。──
  const [inspectorCollapsed, setInspectorCollapsed] = useState(true);
  const sidebarAutoCollapsedRef = useRef(false);
  const mainGroupRef = useRef<HTMLDivElement | null>(null);
  const inspectorRef = useRef<PanelImperativeHandle | null>(null);
  const inspectorColRef = useRef<HTMLDivElement | null>(null);
  // 检查器宽度跨重启（2026-10-18）：320–420 内才记（0 = 收起不记）；拖动防抖 300ms 再落盘。
  const [inspectorDefault] = useState<number>(() => {
    try {
      const n = Number(window.localStorage.getItem("cairn.inspector.width"));
      return Number.isFinite(n) && n >= 320 && n <= 420 ? Math.round(n) : 360;
    } catch { return 360; }
  });
  const inspectorSaveTimer = useRef<number | null>(null);
  // 检查器开合状态（2026-10-18）：只记用户显式 ⌘⌥B 的结果；有恢复窗格时窗格优先可见。
  const [inspectorDefaultOpen] = useState<boolean>(() => {
    try { return window.localStorage.getItem("cairn.inspector.open.v1") === "1"; } catch { return false; }
  });
  const revealInspector = useCallback((): void => {
    // 专注模式里打开窗格/预览/检查器 = 明确要看右栏：先退出专注（不还原旧布局），再展开。
    exitFocusRef.current();
    const ref = inspectorRef.current;
    if (ref === null || !ref.isCollapsed()) return;
    const groupWidth = mainGroupRef.current === null ? window.innerWidth : mainGroupRef.current.getBoundingClientRect().width;
    if (groupWidth < INSPECTOR_SIDEBAR_COLLAPSE_BELOW) {
      if (!sidebarCollapsed) sidebarAutoCollapsedRef.current = true;
      setSidebarCollapsed(true);
      // 2026-10-20 真机：窄窗（主组 < 744）且侧栏开着时，⌘⌥B 第一次只把 storage 写成 "1"、
      // 宽度仍是 0；再按一次才开。两个 rAF 时侧栏 240ms 收起动画还没走完，expand() 被布局
      // 夹回 0。等过渡落定再 expand（与专注模式退出恢复宽度的 240ms 同口径）。
      const expandDelay = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 260;
      window.setTimeout(() => { inspectorRef.current?.expand(); setInspectorCollapsed(false); }, expandDelay);
      return;
    }
    ref.expand();
  }, [sidebarCollapsed]);
  revealInspectorRef.current = revealInspector; // 供上方 openPreview 绕开 TDZ 调用
  // 专注模式（批 101）：只留中栏与输入区。进入时记下侧栏/检查器的开合，退出原样放回；
  // 专注中用户改开侧栏/检查器/窗格 ⇒ 视为放弃专注（不还原旧布局），状态与画面不打架。
  const [focusMode, setFocusMode] = useState(false);
  const focusModeRef = useRef(false);
  const focusRestoreRef = useRef<{ sidebar: boolean; inspector: boolean; inspectorWidth: number | null } | null>(null);
  const exitFocusRef = useRef<() => void>(() => undefined);
  const toggleSidebar = useCallback((): void => {
    exitFocusRef.current();
    const opening = sidebarCollapsed;
    const groupWidth = mainGroupRef.current === null ? window.innerWidth : mainGroupRef.current.getBoundingClientRect().width;
    sidebarAutoCollapsedRef.current = false;
    if (opening && inspectorRef.current?.isCollapsed() === false && groupWidth - sidebarWidthRef.current < INSPECTOR_SIDEBAR_COLLAPSE_BELOW) {
      inspectorRef.current.collapse();
      // 2026-10-20：imperative collapse() 不保证触发 Panel onResize ⇒ React 仍以为展开、inert 不上、
      // 窄窗自动收起的侧栏也不回开。显式落状态，别只信 resize 回调。
      setInspectorCollapsed(true);
    }
    setSidebarCollapsed(!sidebarCollapsed);
  }, [sidebarCollapsed]);
  const toggleInspector = useCallback((): void => {
    exitFocusRef.current();
    const ref = inspectorRef.current;
    if (ref === null) return;
    if (ref.isCollapsed()) {
      revealInspector();
      try { window.localStorage.setItem("cairn.inspector.open.v1", "1"); } catch { /* 存不下则忽略 */ }
    } else {
      ref.collapse();
      setInspectorCollapsed(true);
      try { window.localStorage.setItem("cairn.inspector.open.v1", "0"); } catch { /* 同上 */ }
    }
  }, [revealInspector]);
  // 专注模式开合（⌘⌥F / 顶栏按钮）：进入 = 收起侧栏与检查器；退出 = 回到进入前的开合。
  // 退出路径只认这一处（⌘⌥F / 按钮）；专注中改开其它 chrome 走 exitFocusRef（不还原）。
  const toggleFocusMode = useCallback((): void => {
    if (focusModeRef.current) {
      focusModeRef.current = false;
      setFocusMode(false);
      const prev = focusRestoreRef.current;
      focusRestoreRef.current = null;
      setSidebarCollapsed(prev?.sidebar ?? false);
      if (prev !== null && !prev.inspector) {
        const width = prev.inspectorWidth;
        window.requestAnimationFrame(() => {
          const ref = inspectorRef.current;
          ref?.expand();
          setInspectorCollapsed(false);
          // 宽度也回到进入前（展开是百分比口径，侧栏同时回开时会重新分配）；等侧栏过渡落定再钉宽。
          if (width !== null) {
            const restoreDelay = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 240;
            window.setTimeout(() => { ref?.resize(width); }, restoreDelay);
          }
        });
      }
      toast("已退出专注模式");
      return;
    }
    {
      const inspector = inspectorRef.current;
      const inspectorOpen = inspector !== null && !inspector.isCollapsed();
      focusRestoreRef.current = {
        sidebar: sidebarCollapsed,
        inspector: !inspectorOpen,
        inspectorWidth: inspectorOpen ? Math.round(inspector.getSize().inPixels) : null,
      };
    }
    focusModeRef.current = true;
    setFocusMode(true);
    setSidebarCollapsed(true);
    inspectorRef.current?.collapse();
    setInspectorCollapsed(true);
    toast("专注模式：只留对话与输入（⌘⌥F 退出）");
  }, [sidebarCollapsed]);
  exitFocusRef.current = () => {
    if (!focusModeRef.current) return;
    focusModeRef.current = false;
    setFocusMode(false);
    focusRestoreRef.current = null;
  };
  useLayoutEffect(() => {
    // 初始收起（brief 七「默认收起」）：layout 时机 collapse，不闪出 360 再收。
    // 2026-10-18：恢复了窗格（cairn.panes.v1）时保持展开——否则窗格在 width 0 的右栏里
    // 虽然挂载了却完全看不见，“恢复了”等于没恢复。
    if (paneTabs.length > 0 || inspectorDefaultOpen) {
      // 2026-10-20 真机：带窗格重载后 Panel 实际展开（宽 ~293），但 inspectorCollapsed 初值 true
      // ⇒ inert 挂在可见面板上，整列点不动/读屏不念。初始展开必须同步落状态。
      setInspectorCollapsed(false);
      return;
    }
    inspectorRef.current?.collapse();
    setInspectorCollapsed(true);
  }, []);
  useEffect(() => {
    if (!inspectorCollapsed || !sidebarAutoCollapsedRef.current) return;
    sidebarAutoCollapsedRef.current = false;
    setSidebarCollapsed(false);
  }, [inspectorCollapsed]);
  // 检查器收起 ⇒ 整列 inert（2026-10-18）：屏外控件不许进 Tab 序与无障碍树。
  // 为什么不用 hidden/display:none：那会把 react-resizable-panels 正在做的宽度收起动画
  // 一刀砍掉（⌘⌥B 退化成硬切）。inert 同样移出 Tab 序/无障碍树，但保留布局、过渡照常播完。
  // 走 setAttribute（同 ModalSurface 的 imperative 口径）——@types/react 18.3 没有 inert prop。
  useEffect(() => {
    const el = inspectorColRef.current;
    if (el === null) return;
    if (inspectorCollapsed) el.setAttribute("inert", "");
    else el.removeAttribute("inert");
  }, [inspectorCollapsed]);
  const togglePane = useCallback((kind: PaneKind) => {
    const opening = !paneTabs.includes(kind);
    setPaneTabs((tabs) => (tabs.includes(kind) ? tabs.filter((k) => k !== kind) : [...tabs, kind]));
    if (opening) { notePaneOpened(kind); revealInspector(); } // 打开窗格 ⇒ 检查器区必须可见（collapsed 时展开）
  }, [paneTabs, notePaneOpened, revealInspector]);
  const closePane = useCallback((kind: PaneKind) => {
    setPaneTabs((tabs) => tabs.filter((k) => k !== kind));
  }, []);
  /** ⌘\ 「关闭最近打开的窗格」（2026-10-18 修）：从 paneOpenOrder 里找最后一位仍在场的窗格。
   *  旧实现直接 slice(0,-1) 取数组尾项——数组顺序会被拖拽/⌥↑⌥↓ 重排，重排后关的就不再是
   *  「最近打开」的那个；且空窗格时 slice 仍是空数组、键却被 preventDefault 吞掉，按了没反应。
   *  返回 false = 无可关 ⇒ 调用方别 preventDefault（不吞键）。读 paneTabsRef 而非 paneTabs，
   *  好让本回调保持稳定引用（ shortcuts 表每次渲染重建无谓）。 */
  const closeLastPane = useCallback((): boolean => {
    const target = lastOpenedPane(paneTabsRef.current, paneOpenOrder.current);
    if (target === null) return false;
    setPaneTabs((tabs) => tabs.filter((k) => k !== target));
    return true;
  }, []);
  /** 「＋」菜单/命令面板用：打开（幂等，不做 toggle）。 */
  const openPane = useCallback((kind: PaneKind): void => {
    setPaneTabs((tabs) => (tabs.includes(kind) ? tabs : [...tabs, kind]));
    notePaneOpened(kind);
    revealInspector();
  }, [notePaneOpened, revealInspector]);
  /** 复制整段对话（2026-10-18，命令面板）：用户/助手正文成 Markdown 进剪贴板，toast 回执。
   *  标题不从 sessionTitle 取（它在本回调之后才声明，TDZ）——直接由 sessions + activeId 派生。 */
  const copyTranscript = useCallback((): void => {
    if (activeId === null) { toast.error("先打开一个会话再复制"); return; }
    const title = sessions.find((s) => s.id === activeId)?.title ?? activeId;
    const text = transcriptMarkdown(events, title);
    void navigator.clipboard.writeText(text).then(
      () => { toast.success("已复制整段对话"); },
      (err: unknown) => { toast.error(`复制失败：${err instanceof Error ? err.message : String(err)}`); },
    );
  }, [activeId, events, sessions]);

  /** 导出整段对话为 .md（2026-10-18）：原生保存面板在 main；取消 = 合法结果，不报错误。 */
  const exportTranscriptFile = useCallback((): void => {
    if (activeId === null) { toast.error("先打开一个会话再导出"); return; }
    const title = sessions.find((s) => s.id === activeId)?.title ?? activeId;
    void window.agent.exportTranscript(transcriptMarkdown(events, title), transcriptFileName(title)).then((r) => {
      if (r.ok) { toast.success(`已导出：${r.path ?? ""}`); return; }
      if (r.canceled === true) { toast("已取消导出"); return; }
      toast.error(`导出失败：${r.error ?? "未知原因"}`);
    }).catch((err: unknown) => {
      toast.error(`导出失败：${err instanceof Error ? err.message : String(err)}`);
    });
  }, [activeId, events, sessions]);

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
        const runningHere = activeId !== null && runningSet.current.has(activeId); // runningActive 的同一读法（TDZ 口径在其定义之前不可引用）
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
        // 同一个 ⌘B/⌘⌥B 家族只进来一半。键盘用户不记得 ⌘B 时，面板里也该能点到。
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
    }
  }, [pickAndAddProject, themePref, mode, activeId, setLastError, toggleInspector, copyTranscript, exportTranscriptFile]);

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
      lastDeltaAt.current.delete(sid);
      // 代际号（2026-10-18 真机：打断并发送后新 run 在跑、running 却为 false）：旧 run 的
      // finally 会把**新 run**刚置上的旗摘掉——经典“旧清理清掉新状态”。每次起跑领一个号，
      // 清理/停止态写入只在“号还是自己的”时生效。
      const myGen = (runGen.current.get(sid) ?? 0) + 1;
      runGen.current.set(sid, myGen);
      runStartBySession.current.set(sid, Date.now());
      force((n) => n + 1);
      try {
        const thinking = thinkingBySession.current.get(sid);
        const res = (await window.agent.run({
          message: msg.text, mode: modeRef.current, sessionId: sid, model: selections.current.get(sid) ?? undefined,
          ...(thinking !== undefined ? { thinking: thinking as "off" | "low" | "medium" | "high" } : {}),
          ...(msg.attachments.length > 0 ? { attachments: msg.attachments } : {}),
        })) as RunResponse & { aborted?: boolean };
        if ((runGen.current.get(sid) ?? 0) === myGen) {
          setStoppedIds((prev) => {
            const want = res.aborted === true;
            if (prev.has(sid) === want) return prev;
            const fresh = new Set(prev);
            if (want) fresh.add(sid); else fresh.delete(sid);
            return fresh;
          });
        }
        const keepGoing = continueAfterRun(res);
        if (!keepGoing) setLastError(res.error ?? "本轮运行失败", sid);
        return keepGoing;
      }
      catch (err) {
        setLastError(`本轮运行失败：${err instanceof Error ? err.message : String(err)}`, sid);
        return false;
      }
      finally {
        if ((runGen.current.get(sid) ?? 0) === myGen) runningSet.current.delete(sid);
        // 起点随这一轮一起收掉（收之前先判代际：新 run 已经起跑时不能把它的起点删了）。
        if ((runGen.current.get(sid) ?? 0) === myGen) runStartBySession.current.delete(sid);
        force((n) => n + 1);
      }
    }, () => takeQueuedHead(sid));
  }, [setLastError, takeQueuedHead]);

  const send = useCallback(async (text: string, attachments: RunAttachmentReference[] = []) => {
    const sid = activeId;
    if (sid !== null && editCtxRef.current?.forkId === sid) setEditCtx(null);
    // 运行中发送 = 入队（收束后 runOn 的循环自动派下一条）。判据用 ref 不用渲染态：
    // 收束与点击在同一拍竞争时，runningSet 是唯一真值。
    if (sid !== null && runningSet.current.has(sid)) {
      // 对话优先跳沉（owner 实证 2026-10-15「记忆沉淀挡住正常对话了」）：本轮收尾的自动沉淀
      // 正卡在合并审批时，用户按下发送 = 「接着聊」的最高信号——立即拒掉该审批让 run 收束、
      // 队列开派；否则这条消息会排在记忆审批后面（distill 在 runAgent 尾部，run 不 settle
      // 队列不动）。拒是 fire-and-forget + 随后同拍同步入队：若 await 审批收束后再入队，
      // run 可能先 settle、drain 读到空队列收摊，这条消息就孤在表里再没人派。
      const pendingAsk = askById.current.get(sid);
      if (pendingAsk !== undefined && isSessionEndDistillAsk(pendingAsk)) {
        void window.agent.decide(pendingAsk.askId, false).catch(() => undefined);
        setLastNotice("已跳过本轮全局记忆写入（你在继续对话；下次收尾再试）", sid);
      }
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
      const goalCmd = pendingGoal.current;
      if (goalCmd !== null) {
        pendingGoal.current = null;
        const g = await window.agent.setGoal({ sessionId: newId, objective: goalCmd.objective, ...(goalCmd.maxTurns !== undefined ? { maxTurns: goalCmd.maxTurns } : {}), ...(goalCmd.maxUsd !== undefined ? { maxUsd: goalCmd.maxUsd } : {}) });
        if (!g.ok) setLastError(STR.goal.setFail.replace("{reason}", g.error ?? "未知原因"), newId);
      }
      await runOn(newId, { text, attachments });
    }
    catch (err) {
      setLastError(`本轮运行失败：${err instanceof Error ? err.message : String(err)}`, id ?? "");
      // 这条消息没能派出去：把原文与附件还给输入框（Composer 提交时已清空）。
      // 只回滚「抛出」这一支——run 返回 {ok:false} 时消息已经送达，回滚会造成重复发送。
      setDraftRestore({ forSession: id ?? null, text, attachments, seq: ++draftRestoreSeq.current });
    }
    finally {
      pendingGoal.current = null; // 建会话失败时别把旧目标挂到下一次 send 上
      setPendingSend(false);
      force((n) => n + 1);
    }
  }, [activeId, activeWorkspace, activate, refreshSessions, runOn, setQueueFor, setLastError, setLastNotice]);
  /** /goal <目标>（2026-10-18）：先把目标写进会话（setGoal），再用目标原文起第一轮。
   *  此前斜杠项只往输入框塞字，发出去就是一条普通消息，目标从未被设过。 */
  // 首页发 /goal 时还没有会话可挂目标：先记下来，等 send 建好会话、拿到 id 再 setGoal。
  const pendingGoal = useRef<GoalCommand | null>(null);
  const sendWithGoal = useCallback((text: string, attachments: RunAttachmentReference[]): void => {
    // /compact 是**命令**，不是消息（2026-10-18 同 /goal 病）：此前斜杠项把字塞进输入框，
    // 发出去只是一条普通消息，从没调用过 compact 通道；菜单里的「压缩历史…」才是真入口。
    if (text.trim() === "/compact") {
      compactNow();
      return;
    }
    const cmd = parseGoalCommand(text);
    if (cmd === null) { void send(text, attachments); return; }
    const sid = activeIdRef.current;
    if (cmd.objective === "") { toast.error(STR.goal.emptyObjective); return; }
    if (sid === null) {
      // 首页：先让 send 建会话，建好后再落目标（见 send 里的 pendingGoal 分支）。
      pendingGoal.current = cmd;
      void send(cmd.objective, attachments);
      return;
    }
    void window.agent.setGoal({ sessionId: sid, objective: cmd.objective, ...(cmd.maxTurns !== undefined ? { maxTurns: cmd.maxTurns } : {}), ...(cmd.maxUsd !== undefined ? { maxUsd: cmd.maxUsd } : {}) }).then((r) => {
      if (!r.ok) { setLastError(STR.goal.setFail.replace("{reason}", r.error ?? "未知原因"), sid); return; }
      void send(cmd.objective, attachments);
    }, (err: unknown) => {
      setLastError(STR.goal.setFail.replace("{reason}", err instanceof Error ? err.message : String(err)), sid);
    });
  }, [send, setLastError, toast]);

  /** 错误行「重试」（brief 六）：拿最后一轮的用户输入再跑一轮——**追加为新轮，不改写历史**
   *  （本仓事件日志只追加；改写要另开覆盖通道，不在本轮范围）。运行中不动作：Stream 已按
   *  running 隐按钮，这里再兜一次，防键盘/程序化触发双发。 */
  const handleRetryLast = useCallback(() => {
    const sid = activeIdRef.current;
    if (sid === null || runningSet.current.has(sid)) return;
    let rounds = 0;
    for (const e of eventsRef.current) if (e.type === "user_message") rounds += 1;
    const text = rounds === 0 ? null : userTextOfRound(eventsRef.current, rounds);
    if (text === null) { setLastError("重试失败：找不到上一轮的输入原文", sid); return; }
    void send(text);
  }, [send, setLastError]);

  /** 消息操作条「重跑这一轮」（2026-10-17，Claude 式重试）：取该轮用户输入再发一次，追加为新轮。
   *  与「回放」的区别：回放 = fork 新会话 + 只填不发；重跑 = 当前会话原地再来一轮。运行中不动作。 */
  const handleRetryRound = useCallback((round: number) => {
    const sid = activeIdRef.current;
    if (sid === null || runningSet.current.has(sid)) return;
    const text = userTextOfRound(eventsRef.current, round);
    if (text === null) { setLastError("重跑失败：找不到该轮的输入原文", sid); return; }
    void send(text);
  }, [send, setLastError]);

  /** 重启恢复：不自动执行，用户显式点「继续发送」才把队首交给同一条 runOn/权限/沙箱链路。
   *  （第十三遍拆出按 sid 版：陈旧旗自愈要按点击时的会话派发，不随 activeId 漂。） */
  const resumeQueueFor = useCallback((sid: string) => {
    if (runningSet.current.has(sid)) return;
    const first = takeQueuedHead(sid);
    if (first === null) return;
    void runOn(sid, first).catch((err: unknown) => {
      setLastError(`恢复发送失败：${err instanceof Error ? err.message : String(err)}`, sid);
    });
  }, [runOn, setLastError, takeQueuedHead]);
  const resumeQueue = useCallback(() => {
    const sid = activeIdRef.current;
    if (sid !== null) resumeQueueFor(sid);
  }, [resumeQueueFor]);

  /** 打断/停止的唯一实现（第十三遍·业主实测「排队中·打断并发送，点击没有反应」）：main 答
   *  {ok:false,「会话不在运行」}＝本实例「运行中」是陈旧旗——旧代码 void 掉结果，点了像没点。
   *  现在摘旗重渲染，再照「停止后队列照派」的既有语义把队列续上（对「打断并发送」＝用户按的
   *  正是「这条现在发」；对停止钮＝与正常打断同形）。同拍竞态守卫见 shouldHealStaleRun。 */
  const cancelRunHeal = useCallback((sid: string) => {
    const genAtClick = runGen.current.get(sid) ?? 0;
    void window.agent.runCancel(sid).then((res) => {
      const heal = shouldHealStaleRun({
        cancelOk: res.ok,
        genAtClick,
        genNow: runGen.current.get(sid) ?? 0,
        flagPresent: runningSet.current.has(sid),
      });
      if (!heal) return;
      runningSet.current.delete(sid);
      force((n) => n + 1);
      resumeQueueFor(sid); // 无队列 ⇒ 自然 no-op
    }).catch(() => undefined);
  }, [resumeQueueFor]);

  const lastError = sessionErrors.get(activeId ?? "") ?? null;
  const lastNotice = sessionNotices.get(activeId ?? "") ?? null;
  const runningActive = activeId !== null && runningSet.current.has(activeId);
  // 运行秒表：起点在 send() 里按会话盖；这里只负责 interval 的开与关（终态由 runningActive 翻假收掉）。
  // 依赖里有 activeId：切会话时重算起点（否则切回一个还在跑的会话，秒表会接着别人的起点算）。
  useEffect(() => {
    if (!runningActive || activeId === null) return;
    setElapsedSec(elapsedSecondsFor(runStartBySession.current, activeId, Date.now()));
    const id = setInterval(
      () => setElapsedSec(elapsedSecondsFor(runStartBySession.current, activeId, Date.now())),
      1000,
    );
    return () => clearInterval(id);
  }, [runningActive, activeId]);
  const pendingClarify = pendingClarifyOf(events);
  const pendingPlan = pendingPlanOf(events);
  // 只认当前会话那张卡（判定唯一处在 send-queue.askBelongsToSession）；归属未知落 "" 键，照旧显示。
  const askForActive = activeId !== null
    ? askBySid.get(activeId) ?? askBySid.get("") ?? null
    : askBySid.get("") ?? null;
  const phase = deriveRunPhase(events, askForActive !== null, pendingClarify !== null, pendingPlan !== null);
  const stopped = activeId !== null && stoppedIds.has(activeId) && !runningActive;
  const hasAnswerText = hasAssistantTextThisRun(events);
  const lastDelta = activeId !== null ? (lastDeltaAt.current.get(activeId) ?? 0) : 0;
  // 正文已停 >1.5s，run 还没回 ⇒ 主进程在跑收尾（Stop hook / 安全报告 / 记忆沉淀等），
  // 不是模型还在想。没有时间戳（如重载后接管在跑会话）就不猜，按生成中显示。
  const answerQuiet = hasAnswerText && lastDelta > 0 && Date.now() - lastDelta > 1500;
  // 文案口径在 projections.runPhaseLabel 一处（纯函数，好判卷）：
  // 2026-10-20 独立评审追出 MEDIUM-HIGH——旧实现先判 `finishing`，而 `answerQuiet`
  // （正文停了 >1.5s）**恰好是"工具在跑"的形状** ⇒ 任何超过 1.5s 的构建都被报成"收尾中"。
  const phaseLabel = runPhaseLabel({ phase, stopped, running: runningActive, hasAnswerText, answerQuiet });
  const chosen = activeId !== null ? selections.current.get(activeId) : undefined;
  const pickerValue = chosen !== undefined ? chosen : (providerInfo?.modelId ?? null);
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
  // 空态 pills 的填入信号在文件上部定义（injectText/injectedText：编辑/回放也要用）。
  // v7 附为上下文（§2.3 路径右键）：附件注入信号（seq 递增触发一次 append；与 injectedText 同式）。
  const [injectedAttachment, setInjectedAttachment] = useState<{ path: string; kind: "file" | "directory"; seq: number } | undefined>(undefined);
  const attachSeqRef = useRef(0);
  const attachFromPane = useCallback((rel: string, kind: "file" | "directory") => {
    void window.agent.workspacePathAction(rel, "abs").then((r) => {
      if (r.ok && r.path !== undefined) {
        attachSeqRef.current += 1;
        setInjectedAttachment({ path: r.path, kind, seq: attachSeqRef.current });
        setLastNotice(`已引用：${rel}（送出时随附件读取）`);
      } else {
        setLastError(`引用失败：${r.error ?? "无法解析工作区路径"}`);
      }
    }, (err: unknown) => {
      setLastError(`引用失败：${err instanceof Error ? err.message : String(err)}`);
    });
  }, [setLastError, setLastNotice]);
  // v7 元素选择（§3.6 ⌘⇧S）：App 递增信号 → browser 窗格对活动标签发起选择；结果拼文 append 进输入框。
  const [pickSignal, setPickSignal] = useState(0);
  const [injectedAppend, setInjectedAppend] = useState<{ text: string; seq: number } | undefined>(undefined);
  const appendSeqRef = useRef(0);
  const handlePickResult = useCallback((r: { selector: string; snippet: string; url: string }) => {
    appendSeqRef.current += 1;
    const lines = [
      `浏览器中选中的页面元素（${r.url}）：`,
      `选择器：${r.selector}`,
      ...(r.snippet !== "" ? [`HTML 片段：${r.snippet}`] : []),
    ];
    setInjectedAppend({ text: lines.join("\n"), seq: appendSeqRef.current });
    setLastNotice("已把选中元素写入输入框");
  }, [setLastNotice]);
  const requestPickElement = useCallback(() => {
    setPaneTabs((t) => (t.includes("browser") ? t : [...t, "browser"]));
    notePaneOpened("browser");
    setPickSignal((s) => s + 1);
    // 必须展开检查器（2026-10-18 修）：此前与 togglePane/openPane 不同，这里没有 revealInspector()。
    // 检查器默认收起（inspectorCollapsed 初值 true，paneTabs 为 0 时 layoutEffect 也保持收起），
    // 于是 ⌘⇧S 新开的浏览器窗格落在 width 0 且 inert 的列里 ⇒ 用户看不见任何东西，
    // 而 pick 的失败回执（「本标签页还没有视图」）只渲染在那个不可见窗格内部，连错都看不到。
    // 文档承诺「⌘⇧S 浏览器：选择页面元素（结果进输入框）」，落空且无任何反馈。
    revealInspector();
  }, [notePaneOpened, revealInspector]);
  // 变更审阅指示器（蓝本 §3.6）：改动出现即顶栏徽标亮数（去重文件数）。
  const fileCount = useMemo(() => changedFileCount(events), [events]);  // 事件流投影一次性算好：Stream 渲染与「思考档是否进环」共用同一份。
  const streamRows = useMemo(() => projectStream(events, runningActive), [events, runningActive]);
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
  const viewRef = useRef(viewMode);
  viewRef.current = viewMode;
  // 会话条标题（§2.2 会话名 13px）：取会话真实标题；索引未到时退 id（不编名字）。
  const sessionTitle = activeId === null ? "" : (sessions.find((s) => s.id === activeId)?.title ?? activeId);
  // Ctrl+O 循环视图三档（§3.4）：toast 一闪即走，不留常驻态。
  const cycleView = useCallback(() => {
    const next = nextViewMode(viewRef.current, hasThinking);
    setViewMode(next);
    setViewToast(VIEW_LABEL[next]);
    if (viewToastTimer.current !== null) window.clearTimeout(viewToastTimer.current);
    viewToastTimer.current = window.setTimeout(() => { setViewToast(null); viewToastTimer.current = null; }, 1600);
  }, [hasThinking]);
  // 快捷键开 composer 菜单信号（§3.6 ⌘⇧I/M/E）：seq 单调递增即"开一次"。
  const [composerMenuSignal, setComposerMenuSignal] = useState<{ kind: "perm" | "model" | "effort"; seq: number } | null>(null);
  const menuSeqRef = useRef(0);
  const openComposerMenu = useCallback((kind: "perm" | "model" | "effort") => {
    menuSeqRef.current += 1;
    setComposerMenuSignal({ kind, seq: menuSeqRef.current });
  }, []);
  // 会话循环（§3.6：⌘⇧] / ⌘⇧[，以及可关的 Ctrl+Tab）。返回是否真的切了——
  // 快捷键层据此决定「消费按键」还是「给一句回执」，不再出现空列表时静默吞键。
  const cycleSession = useCallback((dir: 1 | -1): boolean => {
    const list = sessions;
    if (list.length === 0) return false;
    const i = list.findIndex((s) => s.id === activeId);
    const idx = i < 0 ? (dir === 1 ? 0 : list.length - 1) : (i + dir + list.length) % list.length;
    const target = list[idx];
    if (target === undefined) return false;
    openSession(target.id);
    return true;
  }, [sessions, activeId, openSession]);
  // 行级会话操作（蓝本 §2.1）：重命名 / 置顶 / 分叉 / 归档——通道已存在，这里只做编排与 fail-visible。
  const renameSessionById = useCallback(async (id: string, name: string) => {
    try {
      const r = await window.agent.renameSession(id, name);
      if (activeIdRef.current === id) {
        if (r.id !== id) setDraftRemap({ from: id, to: r.id, seq: ++draftRemapSeq.current });
        activate(r.id); // 改名换 id：当前会话与新 id 同步（含 ref）
      }
      void refreshSessions();
    } catch (err) {
      setLastError(`重命名失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }, [refreshSessions, activate]);
  const pinSessionById = useCallback(async (id: string, pinned: boolean) => {
    try {
      await window.agent.setSessionPinned(id, pinned);
      void refreshSessions();
    } catch (err) {
      setLastError(`置顶失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }, [refreshSessions]);
  /** 对话菜单「分叉…」（第十四遍对齐原型 v3-lite 五项菜单）：全量分叉——round=0 是 desktop 侧
   *  「保留到最后一轮」的哨兵（main 按实际轮数命名 <id>-f<总>，与 CLI --from <总> 同源）；
   *  分叉成功即切过去继续干活。这里走 openSession 而非动作条的裸 activate：菜单能分**非当前**会话，
   *  只切 activeId 会把上一个会话的流留在屏上（显示与会话错位）；openSession = 切 + 载转录 + 载队列。 */
  const forkSessionFromMenu = useCallback(async (s: WorkspaceSession) => {
    try {
      const r = await window.agent.forkSession(s.id, 0, true);
      if (r.ok !== true || r.id === undefined) {
        setLastError(`分叉失败：${r.error ?? "未知原因"}`, s.id);
        return;
      }
      void refreshSessions();
      openSession(r.id);
    } catch (err) {
      setLastError(`分叉失败：${err instanceof Error ? err.message : String(err)}`, s.id);
    }
  }, [refreshSessions, openSession]);
  /** 跨面接力（规范 §3.9 · 必抄 #6）：桌面与 CLI 是**同一个 sessions 存储的两个面**。
   *  这里给出等价命令并复制到剪贴板——不假装能拉起终端（桌面没有那条通道，设了就是占位）。
   *  反向那一面由 CLI 收尾时打印「在桌面打开：<id>」接回来。 */
  const openSessionInCli = useCallback((s: WorkspaceSession) => {
    const cmd = `cairn --session ${s.id}`;
    void navigator.clipboard.writeText(cmd).then(
      () => { setLastNotice(`已复制：${cmd}——在终端粘贴后续跑（CLI 还需要一句任务描述）`); },
      (err: unknown) => { setLastError(`复制失败：${err instanceof Error ? err.message : String(err)}`); },
    );
  }, []);
  /** 会话级 worktree 隔离（§3.7 · G4）：三个动作共用一条 IPC。成功/失败都落到流尾那一行——
   *  隔离标记由 listSessions 读侧现算，所以动完必须刷新清单，否则菜单文案还是旧的。 */
  const sessionWorktreeOp = useCallback(async (kind: "create" | "merge" | "discard", s: WorkspaceSession) => {
    try {
      const r = await window.agent.sessionWorktree(
        kind === "create" ? { kind, sessionId: s.id, ...(s.title !== undefined ? { title: s.title } : {}) } : { kind, sessionId: s.id },
      );
      if (!r.ok) {
        // 冲突单独说：主 checkout 已被 abort 回干净态，用户的活还在隔离树里，不是丢了。
        setLastError(
          r.conflict === true
            ? `合并冲突：${(r.conflictedFiles ?? []).join("、")}——主工作区已恢复干净态，改动仍在隔离工作区里`
            : `${kind === "create" ? "隔离" : kind === "merge" ? "合并" : "丢弃"}失败：${r.error ?? "未知原因"}`,
          s.id,
        );
        void refreshSessions();
        return;
      }
      setLastNotice(
        kind === "create"
          ? `已隔离：下一条消息起写在这条会话自己的隔离工作区里${r.path !== undefined ? `（${r.path}）` : ""}`
          : kind === "merge"
            ? `已合并回主工作区${r.branch !== undefined ? `（${r.branch}）` : ""}`
            : "隔离工作区已丢弃",
        s.id,
      );
      if (r.warnings !== undefined && r.warnings.length > 0) setLastNotice(`隔离已建成，但有降级：${r.warnings.join("；")}`, s.id);
      void refreshSessions();
    } catch (err) {
      setLastError(`隔离工作区操作失败：${err instanceof Error ? err.message : String(err)}`, s.id);
    }
  }, [refreshSessions, setLastError, setLastNotice]);
  const doArchiveSession = useCallback(async (id: string, archived: boolean) => {
    try {
      await window.agent.setSessionArchived(id, archived);
      if (archived && activeIdRef.current === id) newSession(); // 归档的是当前会话 ⇒ 回主页
      void refreshSessions();
    } catch (err) {
      setLastError(`归档失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }, [refreshSessions, newSession]);
  /** 归档必问（§3.3 硬闸：「归档任何会话前必问」，与权限档无关）；取消归档不问。 */
  const requestArchiveSession = useCallback((s: WorkspaceSession, archived: boolean) => {
    if (archived) setArchiveConfirm(s);
    else void doArchiveSession(s.id, false);
  }, [doArchiveSession]);
  // §6.3 删除会话：必问（不可撤销）→ 真删；删的是当前会话 ⇒ 回 settings.currentSession 指定的最近一个（core 已回退），无则回主页。
  const requestDeleteSession = useCallback((s: WorkspaceSession) => { setDeleteConfirm(s); }, []);
  const doDeleteSession = useCallback(async (id: string) => {
    try {
      const res = await window.agent.deleteSession(id);
      if (activeIdRef.current === id) {
        if (res.currentSession === null) newSession();
        else openSession(res.currentSession);
      }
      void refreshSessions();
    } catch (err) {
      setLastError(`删除失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }, [openSession, newSession, refreshSessions, setLastError]);
  // ── 长对话导航（v7.2）：折叠开合 / 目录跳转 / 折叠全部。折叠按会话记忆（切回还是原样）。──
  const rememberFolds = useCallback((next: ReadonlySet<number>) => {
    foldedBySession.current.set(activeId ?? "", next);
    setFoldedRounds(next);
  }, [activeId]);
  const toggleFoldRound = useCallback((round: number) => {
    setFoldedRounds((prev) => {
      const next = new Set(prev);
      if (next.has(round)) next.delete(round); else next.add(round);
      foldedBySession.current.set(activeId ?? "", next);
      return next;
    });
  }, [activeId]);
  const foldAllTurns = useCallback(() => {
    rememberFolds(foldAllButLast(outlineTurns.map((t) => t.round)));
  }, [outlineTurns, rememberFolds]);
  const unfoldAllTurns = useCallback(() => { rememberFolds(new Set<number>()); }, [rememberFolds]);
  // 目录跳转：目标轮若折叠先展开（DOM 里要有落点），两帧后滚过去 + 该轮用户行闪一下。
  const jumpToRound = useCallback((round: number) => {
    setFoldedRounds((prev) => {
      if (!prev.has(round)) return prev;
      const next = new Set(prev);
      next.delete(round);
      foldedBySession.current.set(activeId ?? "", next);
      return next;
    });
    setFlashRound(round);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const el = streamEl?.querySelector(`[data-round-anchor="${String(round)}"]`);
      (el instanceof HTMLElement ? (el.closest(".row") ?? el) : null)?.scrollIntoView({ behavior: scrollBehavior("smooth"), block: "start" });
    }));
  }, [activeId, streamEl]);
  // 闪光一跳一闪即走（不留常驻高亮）。
  useEffect(() => {
    if (flashRound === null) return;
    const t = window.setTimeout(() => setFlashRound(null), 1300);
    return () => window.clearTimeout(t);
  }, [flashRound]);
  /** P3-2 时间线跳转：事件 id → 对话中的落点（data-event-id 锚；折叠轮先展开；该轮闪一下定位）。
   *  事件 id 口径 = 事件全序 1-based 行号（Stream 行锚 / roundOfEvent 同一份）。 */
  const jumpToEvent = useCallback((eventId: number) => {
    const round = roundOfEvent(events, eventId);
    if (round !== null) {
      setFoldedRounds((prev) => {
        if (!prev.has(round)) return prev;
        const next = new Set(prev);
        next.delete(round);
        foldedBySession.current.set(activeIdRef.current ?? "", next);
        return next;
      });
      setFlashRound(round);
    }
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const el = streamEl?.querySelector(`[data-event-id="${String(eventId)}"]`);
      // 工具组也可能收起；时间线跳转先沿既有披露入口展开，再定位。
      const toggle = el?.closest(".toolcluster")?.querySelector<HTMLButtonElement>('.tool-group-toggle[aria-expanded="false"]');
      toggle?.click();
      requestAnimationFrame(() => {
        (el instanceof HTMLElement ? el : null)?.scrollIntoView({ behavior: scrollBehavior("smooth"), block: "center" });
      });
    }));
  }, [events, streamEl]);
  // ── P3-1 滚动记忆：Map(sessionId → scrollTop) 存 App 内存——切走存、切回取；回底钮逻辑不动。──
  const scrollMemory = useRef(new Map<string, number>());
  const lastScrollTop = useRef(0);
  const lastScrollOwner = useRef<string | null>(null);
  const lastScrollSession = useRef<string | null>(null);
  const restoreTo = stick.restoreTo;
  useEffect(() => {
    if (streamEl === null) return;
    const onScroll = (): void => {
      lastScrollTop.current = streamEl.scrollTop;
      lastScrollOwner.current = activeIdRef.current;
    };
    streamEl.addEventListener("scroll", onScroll, { passive: true });
    return () => streamEl.removeEventListener("scroll", onScroll);
  }, [streamEl]);
  useEffect(() => {
    // 离场存：读的是上一会话在 DOM 换内容前由 scroll 监听持续刷新的最后位置（本 effect 先于
    // 浏览器对换内容后的 clamp scroll 事件跑，读数不被污染）；owner 守卫——没滚动过的会话
    // 不落盘（lastScrollTop 还揣着上个会话的数，直接存会把别人的位置记到它头上）。
    if (
      lastScrollSession.current !== null &&
      lastScrollSession.current !== activeId &&
      lastScrollOwner.current === lastScrollSession.current
    ) {
      scrollMemory.current.set(lastScrollSession.current, lastScrollTop.current);
    }
    lastScrollSession.current = activeId;
    // 回场取：会话内容异步载入——目标位「可达」（scrollHeight 容纳得下）前逐帧等，早落会被空流
    // clamp 成 0（P3 真机抓到的竞态）；至多 30 帧仍不可达则贴可达上限。instant——不排 smooth
    // 动画队列（与粘底口径一致）；restoreTo 按落点重判贴底，跟底观察器不把回场视口拽回底部。
    const restore = activeId === null ? undefined : scrollMemory.current.get(activeId);
    if (restore === undefined || streamEl === null) return;
    let frames = 0;
    let raf = requestAnimationFrame(function step() {
      if (streamEl.scrollHeight - streamEl.clientHeight >= restore || frames >= 30) {
        restoreTo(restore);
        return;
      }
      frames += 1;
      raf = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(raf);
  }, [activeId, streamEl, restoreTo]);
  // 切会话：折叠记忆随会话换（读回该会话的折叠集）；目录/高亮/闪光复位。
  useEffect(() => {
    setFoldedRounds(foldedBySession.current.get(activeId ?? "") ?? new Set<number>());
    setOutlineOpen(false);
    setOutlineCurrent(null);
    setFlashRound(null);
  }, [activeId]);
  // scrollspy（目录开着才算）：随滚动算"当前读到第几轮"（rAF 节流）。
  useEffect(() => {
    if (!outlineOpen) return;
    const el = streamEl;
    if (el === null) return;
    let raf = 0;
    const compute = (): void => {
      let cur: number | null = null;
      const boxTop = el.getBoundingClientRect().top;
      for (const a of el.querySelectorAll<HTMLElement>("[data-round-anchor]")) {
        if (a.getBoundingClientRect().top - boxTop <= 24) cur = Number(a.getAttribute("data-round-anchor"));
        else break;
      }
      setOutlineCurrent(cur);
    };
    const onScroll = (): void => { cancelAnimationFrame(raf); raf = requestAnimationFrame(compute); };
    el.addEventListener("scroll", onScroll, { passive: true });
    compute();
    return () => { el.removeEventListener("scroll", onScroll); cancelAnimationFrame(raf); };
  }, [outlineOpen, streamRows, foldedRounds, streamEl]);
  // 切会话 ⇒ **取消改名**（2026-10-20 独立评审追出，MEDIUM 的第二道保险）：
  // 改名输入框不该跨会话活着——切过去之后它还聚焦着、显示的还是**上一条**会话的标题，
  // 用户在 B 的界面里改着 A 的名。绑 id 那道保险保证「不改错对象」，
  // 这一道保证「界面不撒谎」（输入框直接收起来，不留一个改不动的框）。
  useEffect(() => {
    setBarRenaming(null);
  }, [activeId]);

  // ── 蓝本 §3.6 快捷键全表（一处挂载；latest-ref 模式——监听器只订阅一次，闭包每次渲染取最新值）──
  /** F2 重命名当前会话（2026-10-18）：桌面端肌肉记忆；点会话名也能改，这里补键盘入口。
   *  不劫持输入框里的 F2（用户在写正文时按 F2 不是想改名）。 */
  const startBarRename = useCallback((): boolean => {
    const sid = activeIdRef.current;
    if (sid === null) return false;
    setBarRenaming({ id: sid, text: sessions.find((s) => s.id === sid)?.title ?? sid });
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

  /** 切换会话（键位双入口与菜单共用一处出口）：无会话时给回执——静默无响应会被读成「键坏了」。
   *  这条回执此前在三个键位里各抄一份；菜单再抄两份就是五份，改口径时必然漏。 */
  const cycleSessionOrToast = useCallback((dir: 1 | -1): void => {
    if (!cycleSession(dir)) toast(STR.shortcut.noSession);
  }, [cycleSession]);
  /** 关闭当前会话回主页（⌘W 与菜单「关闭会话」同一出口）：主页按 = 可见回执；
   *  在跑的一轮回主页后仍在后台，也要说清楚（否则用户以为它被关掉了）。 */
  const closeSessionToHome = useCallback((): void => {
    const sid = activeIdRef.current;
    if (sid !== null) {
      const wasRunning = runningSet.current.has(sid);
      newSession();
      if (wasRunning) toast(STR.shortcut.leftRunning);
    } else {
      toast(STR.shortcut.alreadyHome);
    }
  }, [newSession]);
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
  const hotkeysRef = useRef({ togglePane, closeLastPane, newSession, cycleSession, cycleView, openComposerMenu, toggleSidebar, cancelRun: cancelRunHeal, running: runningActive, activeId, cheatOpen, toggleCheat, closeCheat, ctrlTabCycle, composerMenuBlock, gatePending: askForActive !== null || pendingClarify !== null || pendingPlan !== null, requestPickElement, outlineOpen, setOutlineOpen, jumpTop: () => stick.scrollToTop("smooth"), jumpBottom: () => stick.scrollToBottom("smooth"), toggleInspector, toggleFocusMode, openPalette: handleOpenPalette, openFolder: () => { void pickAndAddProject(); }, openSettings: () => { setSettingsSection(undefined); setSettingsOpen(true); }, paletteOpen, findOpen, openFind: () => { setFindOpen(true); }, closeFind, startRename: startBarRename, findStep, closeSessionToHome, cycleSessionOrToast });
  hotkeysRef.current = { togglePane, closeLastPane, newSession, cycleSession, cycleView, openComposerMenu, toggleSidebar, cancelRun: cancelRunHeal, running: runningActive, activeId, cheatOpen, toggleCheat, closeCheat, ctrlTabCycle, composerMenuBlock, gatePending: askForActive !== null || pendingClarify !== null || pendingPlan !== null, requestPickElement, outlineOpen, setOutlineOpen, jumpTop: () => stick.scrollToTop("smooth"), jumpBottom: () => stick.scrollToBottom("smooth"), toggleInspector, toggleFocusMode, openPalette: handleOpenPalette, openFolder: () => { void pickAndAddProject(); }, openSettings: () => { setSettingsSection(undefined); setSettingsOpen(true); }, paletteOpen, findOpen, openFind: () => { setFindOpen(true); }, closeFind, startRename: startBarRename, findStep, closeSessionToHome, cycleSessionOrToast };
  /** 原生菜单命令 → 既有动作（蓝本 §5.2 菜单树）。**唯一**一张菜单分发表：类型是
   *  `Record<MenuCommandId, () => void>` ⇒ 菜单里加一条而这里不接，typecheck 直接红。
   *  菜单项自己不实现行为，全部转发到既有能力——同一个动作两条入口（键盘/菜单）必须同源，
   *  否则迟早出现「⌘N 建会话、菜单新建建别的东西」这种两套口径。表放 ref：订阅挂一次，动作取最新帧。 */
  const menuCommandsRef = useRef<Record<MenuCommandId, () => void> | null>(null);
  menuCommandsRef.current = {
    "new-session": () => { newSession(); },
    "open-folder": () => { void pickAndAddProject(); },
    "close-session": closeSessionToHome,
    "export-transcript": () => { handlePaletteAction("export-transcript"); },
    "compact": () => { handlePaletteAction("compact"); },
    "find": openFindBar,
    "find-next": () => { findStep(1); },
    // 查找条没开时「查找上一个」也要有回执（与「查找…」同一口径：没会话就说没会话）
    "find-prev": () => { if (!findStep(-1)) toast.error("先打开一个会话再查找"); },
    "palette": handleOpenPalette,
    "toggle-sidebar": toggleSidebar,
    "toggle-inspector": toggleInspector,
    "toggle-theme": () => { handlePaletteAction("toggle-theme"); },
    "cycle-perm": () => { handlePaletteAction("cycle-perm"); },
    "copy-transcript": () => { handlePaletteAction("copy-transcript"); },
    "prev-session": () => { cycleSessionOrToast(-1); },
    "next-session": () => { cycleSessionOrToast(1); },
    "jump-top": () => { stick.scrollToTop("smooth"); },
    "jump-bottom": () => { stick.scrollToBottom("smooth"); },
    "settings": () => { setSettingsSection(undefined); setSettingsOpen(true); },
    "cheat-sheet": () => { toggleCheat(); },
    "about": () => { setSettingsSection("about"); setSettingsOpen(true); },
  };
  useEffect(() => {
    // 原生菜单（main 进程）→ 这里分发。id 与 main/menu-template.ts 同表；未知 id 静默丢弃
    // （版本错配时的旧 main 不该把渲染层带崩）。
    return window.agent.onMenu((id) => {
      const fn = menuCommandsRef.current?.[id as MenuCommandId];
      if (fn === undefined) return;
      // ⚠️ 与 keydown 路径**同一道门**（2026-10-20 独立评审追出的 HIGH）：
      // macOS 上 `registerAccelerator:false` 是**空操作**（Electron 的 typings 标着
      // `@platform linux,win32`）⇒ 那些键被系统注册给了菜单 ⇒ macOS 把键交给菜单、
      // 渲染层的 keydown 根本不响 ⇒ 菜单转发过来的命令**绕过了 keydown 那道浮层门**。
      // 实测形状：确认卡（「删除会话确认」）开着时按 ⌘W ⇒ 会话被关掉回到主页，而那张卡还开着。
      // 判据（浮层在不在 / 移动光标的命令要不要让给输入框）都在 command-gate.ts 一处。
      if (!commandAllowed(id as string, readGateInput(hotkeysRef.current.paletteOpen))) return;
      fn();
    });
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const h = hotkeysRef.current;
      // 浮层在不在 ⇒ 快捷键一律不动作（与菜单路径**同一道门**，见 command-gate.ts）。
      if (overlayBlocked(readGateInput(h.paletteOpen))) return;
      if (e.key === "Escape") {
        // 站点授权弹层自己吃 Esc（2026-10-18）：全局这里让路，否则按 Esc 想关弹层会顺带停掉本轮。
        if (document.querySelector('.bp-permit[role="alertdialog"]') !== null) return;
        // Esc 智慧停止（§7.3 禁令的正面写法）：浮层优先——开着菜单/弹层/速查表/目录时 Esc 只关它，不动运行。
        // capture 阶段检查：此刻菜单还开着，能可靠判定；等冒泡时 Radix 已把它关了。
        if (h.cheatOpen) { e.preventDefault(); h.closeCheat(); return; }
        if (h.outlineOpen) { e.preventDefault(); h.setOutlineOpen(false); return; }
        if (h.findOpen) { e.preventDefault(); h.closeFind(); return; }
        // 审批/澄清/计划卡在场 ⇒ Esc 什么都不做（2026-10-20 真机实测的坑）：卡面写着
        // 「Esc 不做决议」，旧实现却会让全局 Esc 顺带取消整轮——用户想关掉卡，任务没了。
        // 停止仍有明确出口：卡上的停止键 / ⌘. / 状态条；Esc 不承担这个语义。
        if (h.gatePending) return;
        // 侧栏是常驻 `role=listbox`（收起时 display:none 也照样命中），不能把它当「浮层开着」。
        // 只让真正会出现的浮层短路：侧栏排除后，Esc 才能按速查表承诺停掉本轮。
        if (document.querySelector(".pop.show, .pop-rd, [role='menu'][data-state='open'], [role='listbox']:not(.sidenav)") !== null) return;
        if (h.running && h.activeId !== null) { e.preventDefault(); h.cancelRun(h.activeId); }
        return;
      }
      // F2 重命名当前会话（2026-10-18）：裸键，不要求修饰；输入框聚焦时让给文本编辑。
      // 主页没有会话可改名 ⇒ 给一句回执（2026-10-18：此前 preventDefault 后什么都没发生）。
      if (e.key === "F2" && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        if (!isEditableTarget(e.target)) {
          e.preventDefault();
          if (!h.startRename()) toast(STR.shortcut.renameNeedsSession);
        }
        return;
      }
      if (!(e.metaKey || e.ctrlKey)) return;
      // §3.6 Ctrl+Tab / Ctrl+Shift+Tab = 下一个 / 上一个会话（全平台 Ctrl；§7.3.3「可关闭」：
      // 设置页 ctrlTabCycle 关掉即整键让路——不 preventDefault、不切换，浏览器/系统行为透传）。
      if (e.key === "Tab" && e.ctrlKey && !e.metaKey && !e.altKey) {
        if (!h.ctrlTabCycle) return;
        e.preventDefault();
        h.cycleSessionOrToast(e.shiftKey ? -1 : 1);
        return;
      }
      // 窗格族走 pane-shortcuts.ts 单一表：键位、修饰键、落点同源（速查表也从同一张表生成）；
      // 多按了修饰键不匹配，交给下面的普通键处理（不误吞）。
      const paneKind = paneShortcutFor(e.code, { meta: e.metaKey, ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey });
      if (paneKind !== null) {
        e.preventDefault();
        h.togglePane(paneKind);
        return;
      }
      const shift = e.shiftKey;
      switch (e.code) {
        case "ArrowUp": // ⌘↑ 回顶（v7.2 长对话导航）；输入框聚焦时让给文本编辑（不劫持）
          if (!shift && !e.altKey && !isEditableTarget(e.target)) { e.preventDefault(); h.jumpTop(); }
          break;
        case "ArrowDown": // ⌘↓ 回底（v7.2，同「回到底部」浮钮）；输入框里让给文本编辑
          if (!shift && !e.altKey && !isEditableTarget(e.target)) { e.preventDefault(); h.jumpBottom(); }
          break;
        case "Backslash": // ⌘\ 关最近打开的窗格（§3.4）
          // 2026-10-18 修两处：① 旧实现 `tabs.slice(0,-1)` 取数组尾项，而数组顺序会被
          //    拖拽/⌥↑⌥↓ 重排——重排后关掉的就不是「最近打开」的那个，文档承诺落空；
          //    改从 paneOpenOrder（只增不减的打开顺序）里找最后一位仍在场的。
          //    ② 空窗格时 slice(0,-1) 仍是空数组，键却被 preventDefault 吃掉 ⇒ 按了没反应。
          //    现在没有可关的窗格就不 preventDefault，让键继续往外走（不吞）。
          if (!shift) {
            if (h.closeLastPane()) e.preventDefault();
          }
          break;
        case "KeyB": // ⌘B 侧栏；⌘⌥B 检查器（⌘⇧B 浏览器窗格已由 pane-shortcuts 表接走）
          if (e.altKey) { e.preventDefault(); h.toggleInspector(); }
          else { e.preventDefault(); h.toggleSidebar(); }
          break;
        case "KeyF": // ⌘F 对话内查找（⌘⇧F 文件窗格已由 pane-shortcuts 表接走）；⌘⌥F 专注模式
          if (e.altKey && !shift) { e.preventDefault(); h.toggleFocusMode(); }
          else if (!shift && !e.altKey && h.activeId !== null) { e.preventDefault(); h.openFind(); findRef.current?.focus(); }
          break;
        case "BracketRight": // ⌘⇧] 下一个会话（§3.6）
          if (shift) { e.preventDefault(); h.cycleSessionOrToast(1); }
          break;
        case "BracketLeft": // ⌘⇧[ 上一个会话（§3.6）
          if (shift) { e.preventDefault(); h.cycleSessionOrToast(-1); }
          break;
        case "KeyN": // ⌘N 新会话（§3.6）
          if (!shift) { e.preventDefault(); h.newSession(); }
          break;
        case "KeyO": // Ctrl+O 循环视图三档（§3.6，全平台 Ctrl）；⌘O 打开文件夹（P3-3）
          if (e.ctrlKey) { e.preventDefault(); h.cycleView(); }
          else if (!shift && !e.altKey) { e.preventDefault(); h.openFolder(); }
          break;
        case "KeyG": // ⌘G / ⇧⌘G 查找下一个 / 上一个（Claude Edit > Find Next/Previous 的标准键）
          // 落点/开合口径在 findStep 一处（菜单「查找下一个」共用同一出口）。
          if (e.altKey) break;
          if (h.findStep(shift ? -1 : 1)) e.preventDefault();
          break;
        case "KeyK": // ⌘K 命令面板（P3-3 · brief 八）
          if (!shift && !e.altKey) { e.preventDefault(); h.openPalette(); }
          break;
        case "Period": // ⌘. 停止本轮（P3-3 全局；输入框聚焦时由 Composer 自己处理，不双发；无运行安全 no-op）
          if (!shift && !e.altKey && !isEditableTarget(e.target) && h.running && h.activeId !== null) {
            e.preventDefault();
            h.cancelRun(h.activeId);
          }
          break;
        case "Comma": // ⌘, 设置（P3-3 · brief 九）
          if (!shift && !e.altKey) { e.preventDefault(); h.openSettings(); }
          break;
        // ⌘⇧I / ⌘⇧M / ⌘⇧E：输入区被锁时给一句「为什么」，不再 preventDefault 后静默（2026-10-18）。
        // ⌘⇧E 走 effort 焦点：同一个模型菜单，但打开后落到思考档分段（不再与 ⌘⇧I 完全同路）。
        case "KeyI": // ⌘⇧I 模型菜单（§3.6）
          if (shift) {
            e.preventDefault();
            if (h.composerMenuBlock !== null) toast(h.composerMenuBlock);
            else h.openComposerMenu("model");
          }
          break;
        case "KeyM": // ⌘⇧M 权限模式菜单（§3.6）
          if (shift) {
            e.preventDefault();
            if (h.composerMenuBlock !== null) toast(h.composerMenuBlock);
            else h.openComposerMenu("perm");
          }
          break;
        case "KeyE": // ⌘⇧E effort 菜单（单芯片裁定：思考档就在模型菜单里）
          if (shift) {
            e.preventDefault();
            if (h.composerMenuBlock !== null) toast(h.composerMenuBlock);
            else h.openComposerMenu("effort");
          }
          break;
        case "KeyS": // ⌘⇧S 浏览器元素选择（§3.6；页内焦点时由主进程 before-input-event 捕获，同效）
          if (shift) { e.preventDefault(); h.requestPickElement(); }
          break;
        case "KeyW": // ⌘W 关会话回主页（蓝本 §3.6；窗口关闭走红绿灯——菜单已相应定制）
          // 回执口径在 closeSessionToHome 一处（菜单「关闭会话」共用同一出口）。
          if (!shift) {
            e.preventDefault();
            h.closeSessionToHome();
          }
          break;
        case "Slash": // ⌘/ 快捷键速查（蓝本 §3.6「查看全部」）
          if (!shift) { e.preventDefault(); h.toggleCheat(); }
          break;
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => { window.removeEventListener("keydown", onKey, true); };
  }, []);
  // 全局拖放（brief 第四节 + §3.1 防导航）：拖文件进窗口亮「添加为项目」提示；落下时——
  //   已被内层认领（Composer 卡片附件，先于 window 冒泡跑过，defaultPrevented 留痕）⇒ 不重复处理；
  //   目录 ⇒ 登记为项目（DataTransfer.files 不带 isDirectory，用 webkitGetAsEntry 分流）；
  //   其余一律 preventDefault——否则 Electron 会把整窗导航成 file://。
  useEffect(() => {
    const hasFiles = (e: DragEvent): boolean => Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const onDragOver = (e: DragEvent): void => {
      e.preventDefault();
      if (hasFiles(e)) {
        setDragOverApp(true);
        if (e.dataTransfer !== null) e.dataTransfer.dropEffect = "copy";
      }
    };
    const onDragLeave = (e: DragEvent): void => {
      // 只有真离开窗口才熄提示（窗口内子元素之间移动会反复触发 leave，relatedTarget 非空）。
      if (e.relatedTarget === null) setDragOverApp(false);
    };
    const onDrop = (e: DragEvent): void => {
      const claimed = e.defaultPrevented; // 先读后写：preventDefault 自身也会置位这个旗。
      e.preventDefault();
      setDragOverApp(false);
      if (claimed) return;
      const api = window.agent as unknown as { pathForFile?: (f: File) => string };
      const dropped: { path: string; isDirectory: boolean }[] = [];
      for (const it of Array.from(e.dataTransfer?.items ?? [])) {
        if (it.kind !== "file") continue;
        const entry = it.webkitGetAsEntry?.();
        const f = it.getAsFile();
        const p = f !== null ? api.pathForFile?.(f) : undefined;
        if (p !== undefined && p !== "") dropped.push({ path: p, isDirectory: entry?.isDirectory === true });
      }
      // 分流判据走纯函数（判卷资产）：这里只取 projects 支——目录拖入即添加；
      // inProject / outside（文件）留给 Composer 落点（P2 附件升级时接）。
      const { projects: dirPaths } = classifyDrop(dropped, projectsRef.current.map((p) => p.path));
      if (dirPaths.length === 0) return;
      void (async () => {
        for (const p of dirPaths) {
          await handleAddProject(p).catch((err: unknown) => {
            toast.error(`添加项目失败：${err instanceof Error ? err.message : String(err)}`);
          });
        }
      })();
    };
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [handleAddProject]);
  // v6 交付卡：同一份投影同时供卡片与"最后一轮"判定（恢复上一版只对最后一轮有意义）。
  const deliveries = useMemo(() => turnDelivery(events), [events]);
  const lastDeliveryRound = deliveries.length > 0 ? deliveries[deliveries.length - 1]?.round : undefined;
  // 批 3：流尾序列 = 有交付的轮出卡 + 空轮一行弱提示（连续空轮并一段）；运行中的末轮不预告。
  const deliveryTrailItems = useMemo(
    () => deliveryTrail(deliveries, outlineTurns.length, runningActive),
    [deliveries, outlineTurns, runningActive],
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
  onReplay: handleReplay,
  onSpeak: handleSpeak,
  speakingEventId,
  onToggleFold: toggleFoldRound,
  // 错误行「重试」：最后一轮输入再跑一轮（追加；运行中 Stream 侧不摆按钮）
  onRetryLast: handleRetryLast,
  onRetryRound: handleRetryRound,
  running: runningActive,
  // 产物直达（2026-10-16）：工具交付的东西给一个入口，指向**落盘那一份**
  // （不是模型在回复里重新抄的那份）。可预览的走 openPreview，其余回落 Finder。
  onOpenArtifact: handleOpenArtifact,
  }), [feedback, feedbackBusy, pinBusy, annotationPending, handlePin, pinnedEventIds, handleFeedback,
    handleRevertTurn, handleCopyText, openAttachment, handleBranch, handleEditUser, handleReplay,
    handleSpeak, speakingEventId, toggleFoldRound, handleRetryLast, handleRetryRound, runningActive, handleOpenArtifact]);

  // SEMA §3.5/§12：协议失配 fatal 早退面。
  if (protocolMismatch !== null) {
    return (
      <div className="app">
        <div className="fatal">
          <h1>Cairn</h1>
          <div className="fatal-note">{protocolMismatch}</div>
        </div>
      </div>
    );
  }

  // P1 侧栏数据面（诚实边界：只同步本进程可见态）：等门集合 + 服务状态点
  //（demo 演示恒可用；真家看 keyConfigured。null = 还没探测到，点标「未检测」不摆假绿）。
  const waitingIdSet = new Set(waitingCounts.current.keys());
  const providerOk = providerInfo === null ? null : (providerInfo.kind === "demo" || providerInfo.keyConfigured);
  // P2-1 空屏：项目 chip 弹层清单（搜索过滤名字与路径；未加载 = 空数组，列表占位文案在场）。
  const chipQueryNorm = chipQuery.trim().toLowerCase();
  const chipList = (chipRecent ?? []).filter((p) =>
    chipQueryNorm === "" || p.name.toLowerCase().includes(chipQueryNorm) || p.path.toLowerCase().includes(chipQueryNorm),
  );
  // 统一工具栏 · 中栏主体（2026-10-20 批 129）：上下文锚点。
  // 首页无会话 ⇒ 品牌名；会话内 ⇒ 可重命名的会话名。
  // **任何时刻只有一个标题**——批 120/121 的「标题出现两次」争点随两栏合并自然消解。
  const toolbarCenter = activeId === null ? (
    <span className="tb-brand">Cairn</span>
  ) : (
    <>
      {/* 会话名可点重命名（蓝本 §2.1「点工具栏会话名可重命名」）：Enter/失焦提交，Esc 取消。 */}
      {barRenaming !== null ? (
        <input
          className="tb-rename"
          autoFocus
          value={barRenaming.text}
          aria-label="重命名会话"
          onFocus={(e) => {
            // 业主四图批：开态从串首读起——全选（键入即替换整名）并回卷视口到串首
            // （长标题此前停在串尾，只露中段碎片）。rAF 让浏览器先完成首次滚动再回卷。
            const el = e.target;
            el.select();
            requestAnimationFrame(() => { el.scrollLeft = 0; });
          }}
          onChange={(e) => setBarRenaming({ ...barRenaming, text: e.target.value })}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") {
              e.preventDefault();
              // 提交给**绑定的那条会话**（不是 activeId）：会话切换过也不能改名改到别人头上。
              const v = barRenaming.text.trim();
              const original = sessions.find((s) => s.id === barRenaming.id)?.title ?? "";
              if (v !== "" && v !== original) void renameSessionById(barRenaming.id, v);
              setBarRenaming(null);
            } else if (e.key === "Escape") {
              e.preventDefault();
              setBarRenaming(null);
            }
          }}
          onBlur={() => {
            const v = barRenaming.text.trim();
            const original = sessions.find((s) => s.id === barRenaming.id)?.title ?? "";
            if (v !== "" && v !== original) void renameSessionById(barRenaming.id, v);
            setBarRenaming(null);
          }}
        />
      ) : (
        <button className="tb-title" title={`${sessionTitle} · 点按或按 F2 重命名`} aria-keyshortcuts="F2" onClick={() => { if (activeId !== null) setBarRenaming({ id: activeId, text: sessionTitle }); }}>
          {sessionTitle}
        </button>
      )}
    </>
  );

  // 统一工具栏 · 目标芯片（批 129）：单独占「标题右侧的翼」，
  // 不与标题同槽 ⇒ 芯片的宽度不会把标题挤偏（标题恒对中栏居中）。
  const toolbarAside = goalTrace !== null && (goalTrace.stopped === null || dismissedGoals.get(activeId ?? "") !== goalTrace.at) ? (
    <GoalChip
      trace={goalTrace}
      onPause={() => { goalAct({ pause: true }); }}
      onResume={() => { goalAct({ resume: true }); }}
      onClear={() => { goalAct({ clear: true }); }}
      onDismiss={() => {
        const sid = activeIdRef.current;
        if (sid === null) return;
        setDismissedGoals((prev) => {
          const next = new Map(prev).set(sid, goalTrace.at);
          writeDismissedGoals(next);
          return next;
        });
      }}
    />
  ) : null;

  // 统一工具栏 · 右组（批 129）：对话目录 + 窗格入口（Terminal / Changes / Browser）+ ⋯ + 专注模式。
  // 窄窗（≤920px）三钮收进 ⋮（CSS 收口）；⋯ 恒列全部窗格。
  const toolbarRight = !settingsOpen && (
    <>
      {activeId !== null && (
        <div className="tb-cluster">
          {/* 对话目录（v7.2 长对话导航）：2026-10-17 从流内浮片迁入会话条
              （真机目验：absolute 浮片压住第一条工具行）。批 129 起随会话条并入工具栏。 */}
          {outlineTurns.length >= 2 && (
            <button
              className="tb-btn"
              aria-label="对话目录"
              aria-expanded={outlineOpen}
              title="对话目录（跳到任意一轮）"
              data-on={outlineOpen}
              onClick={() => setOutlineOpen((v) => !v)}
            >
              <List size={13} />
            </button>
          )}
          <span className="tb-quick">
            <button
              className="tb-btn"
              aria-label="终端窗格"
              title={`终端窗格（${paneShortcutKeys("terminal")}）`}
              data-on={paneTabs.includes("terminal")}
              onClick={() => togglePane("terminal")}
            >
              <Terminal size={13} />
            </button>
            <button
              className="tb-btn"
              aria-label="变更窗格"
              title={`变更窗格（${paneShortcutKeys("changes")}）`}
              data-on={paneTabs.includes("changes")}
              onClick={() => togglePane("changes")}
            >
              <FileDiff size={13} />
              {fileCount > 0 && <span className="tb-badge num">{String(fileCount)}</span>}
            </button>
            <button
              className="tb-btn"
              aria-label="浏览器窗格"
              title={`浏览器窗格（${paneShortcutKeys("browser")}）`}
              data-on={paneTabs.includes("browser")}
              onClick={() => togglePane("browser")}
            >
              <Globe size={13} />
            </button>
          </span>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button className="tb-btn" aria-label="更多窗格" title="更多窗格">
                <MoreHorizontal size={13} />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content className="pop-rd" side="bottom" align="end" sideOffset={4}>
              {PANE_OPENABLE.map((k) => (
                <DropdownMenu.Item key={k} className="menu-item" onSelect={() => togglePane(k)}>
                  <span>{paneTabs.includes(k) ? `关闭${PANE_META[k].label}窗格` : `打开${PANE_META[k].label}窗格`}</span>
                  <span className="sub">{paneShortcutKeys(k)}</span>
                </DropdownMenu.Item>
              ))}
            </DropdownMenu.Content>
          </DropdownMenu.Root>
        </div>
      )}
      {/* 专注模式是窗口级动作，与内容级动作分组（macOS 工具栏的分组惯例）。 */}
      {activeId !== null && <span className="tb-sep" aria-hidden="true"></span>}
      <button
        className="iconbtn sm"
        aria-label={focusMode ? "退出专注模式" : "进入专注模式"}
        aria-pressed={focusMode}
        data-on={focusMode}
        title={focusMode ? "退出专注模式（⌘⌥F）" : "专注模式（⌘⌥F）：收起侧栏与检查器"}
        onClick={toggleFocusMode}
      >
        <Focus size={14} />
      </button>
    </>
  );

  return (
    <div className="app" data-sidebar={sidebarCollapsed ? "collapsed" : "expanded"}>
      <TitleBar
        center={settingsOpen ? <span className="tb-brand">设置</span> : toolbarCenter}
        aside={settingsOpen ? undefined : toolbarAside}
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={toggleSidebar}
        right={toolbarRight}
      />
      <div className="shell">
        {sidebarCollapsed && !focusMode && <SidebarRail
          onExpand={toggleSidebar}
          onNewTask={newSession}
          onSearch={handleOpenPalette}
          onFiles={() => openPane("file")}
          onTerminal={() => openPane("terminal")}
          onSettings={() => { setSettingsSection(undefined); setSettingsOpen(true); }}
        />}
        <div className="side-wrap" data-dsh-claude-part="sidebar-column" style={{ width: sidebarWidth }}>
        <Sidebar
          projects={projects}
          sessions={sessions}
          activeId={activeId}
          activeWorkspace={activeWorkspace}
          running={runningSet.current}
          waitingIds={waitingIdSet}
          draftIds={draftIds}
          outcomes={outcomes.current}
          notice={registryNotice}
          loading={!sessionsLoaded && !sessionsLoadError}
          loadError={sessionsLoadError}
          onRetryLoad={retrySessions}
          providerOk={providerOk}
          onOpen={openSession}
          onNewTask={newSession}
          onOpenPalette={handleOpenPalette}
          onSwitchWorkspace={(p) => { setActiveWorkspace(p); activeWorkspaceRef.current = p; touchWorkspace(p); }}
          onAddProject={handleAddProject}
          onCloneProject={handleCloneProject}
          onOpenNewProjectDialog={() => setNewProjectOpen(true)}
          onUpdateProject={handleUpdateProject}
          onRemoveProject={handleRemoveProject}
          onRevealProject={handleRevealProject}
          onRenameSession={renameSessionById}
          onPinSession={pinSessionById}
          onForkSession={forkSessionFromMenu}
          onArchiveSession={requestArchiveSession}
          onOpenInCliSession={openSessionInCli}
          onSessionWorktree={(kind, s) => {
            if (kind === "discard") setWtDiscard(s);
            else void sessionWorktreeOp(kind, s);
          }}
          onDeleteSession={requestDeleteSession}
          onPickDirectory={() => window.agent.pickDirectory()}
          onOpenSettings={() => { setSettingsSection(undefined); setSettingsOpen(true); }}
          onOpenAbout={() => { setSettingsSection("about"); setSettingsOpen(true); }}
          /* 状态点是「模型服务可用与否」的常驻事实位 ⇒ 直接进「模型与 Provider」分区，
             笼统开设置页等于让用户自己找那一格。 */
          onOpenProviderSettings={() => { setSettingsSection("provider"); setSettingsOpen(true); }}
          theme={themePref}
          onThemeChange={changeTheme}
          usage={activeId === null ? null : usageStats}
        />
          <div
            className="side-handle"
            role="separator"
            aria-orientation="vertical"
            aria-label={`调整侧栏宽度（${SIDEBAR_MIN}–${SIDEBAR_MAX}px）`}
            aria-valuemin={SIDEBAR_MIN}
            aria-valuemax={SIDEBAR_MAX}
            aria-valuenow={sidebarWidth}
            title={`拖动调整侧栏宽度；双击回到 ${SIDEBAR_DEFAULT}px`}
            tabIndex={0}
            onPointerDown={startSidebarDrag}
            onDoubleClick={() => { persistSidebarWidth(SIDEBAR_DEFAULT); }}
            onKeyDown={(e) => {
              if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
              e.preventDefault();
              persistSidebarWidth(sidebarWidthRef.current + (e.key === "ArrowRight" ? 16 : -16));
            }}
          />
        </div>
        <Group orientation="horizontal" id="cairn-main" className="main-group" elementRef={mainGroupRef}>
          <Panel minSize={420}>
        <main className="main" data-dsh-claude-part="center-column" data-empty={showEmpty ? "true" : "false"}>
          <FindBar ref={findRef} open={findOpen && !showEmpty} container={streamEl} onClose={closeFind} />
          {showEmpty ? (
            /* 空屏（P2-1）：品牌字标 → 问候 → 项目 chip →（输入区居中枢位见 zone-composer）→ 建议行。
               错误/提示条在这里也渲染：新建项目与预览的失败发生在"还没有会话"时，
               以前这条路径不显示 strips ⇒ 用户点了创建却看不到失败原因。 */
            <div className="zone-stream">
              <div>
                {lastError !== null && <ErrorStrip message={lastError} onDismiss={clearLastError} />}
                {lastNotice !== null && (
                  <div className="notice-strip" role="status">
                    <span className="msg">{lastNotice}</span>
                    <button className="btn-ghost" aria-label="关闭提示" onClick={clearLastNotice}>×</button>
                  </div>
                )}
                {/* 未配置模型服务的空屏横幅（2026-10-18）：发送前就说清楚，别等错误行。 */}
                {providerOk === false && (
                  <ProviderBanner onOpenSettings={() => { setSettingsSection(undefined); setSettingsOpen(true); }} />
                )}
                {importDiagnosis !== null && (
                  <ImportDiagnosisCard
                    name={importDiagnosis.name}
                    diagnosis={importDiagnosis.diagnosis}
                    onDismiss={() => { setImportDiagnosis(null); }}
                  />
                )}
              </div>
              <div className="empty">
                {/* 2026-10-18 对照 Claude 桌面端：hero 不是「字标 + 问候」两行，而是珊瑚星标与
                    问候同一行、衬线大字（Claude 的「✳ You're here!」）。品牌名仍在窗口顶栏，
                    这里不再叠一个 CAIRN 字标。 */}
                <h1 className="empty-greet" data-dsh-claude-part="hero-headline" data-dsh-claude-holds="hero-mark">
                  <Sparkles size={26} strokeWidth={2.2} className="empty-greet-mark" aria-hidden="true" />
                  <span>{greetingFor(new Date().getHours())}，{STR.empty.greetingAsk}</span>
                </h1>
                {/* 项目 chip：📁 名 · 分支；点开 = 搜索 + 最近项目 + 复用 AddProjectMenu 四入口。 */}
                <div className="empty-chip-row" ref={chipRef}>
                  <button
                    className="empty-chip"
                    aria-haspopup="true"
                    aria-expanded={chipOpen}
                    title={STR.empty.pickProject}
                    onClick={openChipPopover}
                  >
                    <Folder size={13} aria-hidden="true" />
                    {/* 2026-10-17：已登记项目显示「显示名」（与侧栏一致）；未登记才回落文件夹名。 */}
                    <span>{activeWorkspace !== null
                      ? (projects.find((p) => p.path === activeWorkspace)?.name ?? activeWorkspace.slice(activeWorkspace.lastIndexOf("/") + 1))
                      : STR.empty.pickProject}</span>
                    {emptyData !== null && emptyData.branch !== null && emptyData.branch !== "" && (
                      <>
                        <span className="chip-sep" aria-hidden="true">·</span>
                        <GitBranch size={11} aria-hidden="true" />
                        <span>{emptyData.branch}</span>
                      </>
                    )}
                    <ChevronDown size={11} aria-hidden="true" className="chip-caret" />
                  </button>
                  {/* 项目选择弹层向上开（2026-10-17 真机目验：向下开会盖住 composer 本身，
                      你一边选项目一边看不见自己要发的输入）。 */}
                  <Popover open={chipOpen} up className="chip-pop" aria-label={STR.empty.projectsLabel}>
                    <input
                      className="chip-search"
                      aria-label={STR.empty.searchProjects}
                      placeholder={STR.empty.searchProjects}
                      value={chipQuery}
                      onChange={(e) => { setChipQuery(e.target.value); }}
                    />
                    <div className="chip-list">
                      {chipRecent === null && <div className="menu-note">{STR.common.loading}</div>}
                      {chipRecent !== null && chipList.length === 0 && (
                        <div className="menu-note">{projects.length === 0 ? STR.empty.pickProject : STR.empty.noProjectMatch}</div>
                      )}
                      {chipList.map((p) => {
                        const registered = projects.some((x) => x.path === p.path);
                        return (
                          <button
                            key={p.id}
                            className={"menu-item" + (p.path === activeWorkspace ? " on" : "")}
                            title={p.path}
                            onClick={() => {
                              closeChip();
                              if (registered) {
                                setActiveWorkspace(p.path);
                                activeWorkspaceRef.current = p.path;
                                touchWorkspace(p.path);
                              } else {
                                // 最近但已移除：点 = 重新添加 + 切过去（空屏点项目就是要用它）。
                                void handleAddProject(p.path).then(() => {
                                  setActiveWorkspace(p.path);
                                  activeWorkspaceRef.current = p.path;
                                  touchWorkspace(p.path);
                                }).catch((err: unknown) => { setLastError(`添加项目失败：${err instanceof Error ? err.message : String(err)}`); });
                              }
                            }}
                          >
                            <span className="mi-ico" aria-hidden="true"><Folder size={12} /></span>
                            <span>{p.name}</span>
                            <span className="sub">{p.path}</span>
                          </button>
                        );
                      })}
                    </div>
                    <div className="chip-foot">
                      <AddProjectMenu
                        onPickDirectory={() => window.agent.pickDirectory()}
                        onAddProject={handleAddProject}
                        onOpenNewProjectDialog={() => { closeChip(); setNewProjectOpen(true); }}
                        onCloneProject={handleCloneProject}
                        activePaths={projects.map((p) => p.path)}
                      />
                      <div className="menu-note">{STR.empty.dropHint}</div>
                    </div>
                  </Popover>
                </div>
              </div>
            </div>
          ) : (
            <div className="zone-stream">
              {lastError !== null && <ErrorStrip message={lastError} onDismiss={clearLastError} />}
              {lastNotice !== null && (
                <div className="notice-strip" role="status">
                  <span className="msg">{lastNotice}</span>
                  <button className="btn-ghost" aria-label="关闭提示" onClick={clearLastNotice}>×</button>
                </div>
              )}
              {importDiagnosis !== null && (
                <ImportDiagnosisCard
                  name={importDiagnosis.name}
                  diagnosis={importDiagnosis.diagnosis}
                  onDismiss={() => { setImportDiagnosis(null); }}
                />
              )}
              <div className="stream" id="stream" ref={setStreamEl}>
                <div className="reading" id="reading">
                  <Suspense fallback={null}>
                    <Stream
                      // 切会话重挂（2026-10-18）：行内局部状态（工具展开/思考折叠/审批卡展开）
                      // 不能跨会话复用——真机 A 展开 read_file 后切 B，B 的第一条工具行也展开；
                      // 只给行 key 加前缀会让 React 留下旧行（实测 31→57 并出现重复 event id），
                      // 重挂 Stream 本体是可靠边界（.stream 滚动容器与 sticky 观察对象都不动）。
                      key={activeId ?? "home"}
                      rows={streamRows}
                      view={viewMode}
                      streaming={runningActive}
                      foldedRounds={foldedRounds}
                      flashRound={flashRound}
                      actions={streamActions}
                    />
                  </Suspense>
                  {/* 交付摘要卡（批 3）：有交付的轮各一张、空轮一行弱提示（连续空轮并一段），流尾展示。
                      2026-10-18 业主截图批：默认只渲染最新一张卡；早期记录收进一行「查看早期交付」，
                      展开状态按会话记（deliveryExpandedFor），切走再回来不会又铺开。 */}
                  {(() => {
                    let lastCard = -1;
                    deliveryTrailItems.forEach((it, i) => { if (it.kind === "card") lastCard = i; });
                    // 最新卡**及其后的空轮弱行**一起留在流尾（此前只取那一个 card，末尾的
                    // 「第 N–M 轮 · 无文件改动」会被整段吞掉——最新几轮没改文件时反而什么都看不到）。
                    const tailItems = lastCard >= 0 ? deliveryTrailItems.slice(lastCard) : deliveryTrailItems;
                    const olderItems = lastCard >= 0 ? deliveryTrailItems.slice(0, lastCard) : [];
                    const earlierCards = olderItems.filter((it) => it.kind === "card").length;
                    const showEarlier = activeId !== null && deliveryExpandedFor === activeId;
                    const renderItem = (item: (typeof deliveryTrailItems)[number]): React.ReactNode =>
                      item.kind === "card" ? (
                      <ChangeSummaryCard
                        key={`d${String(item.delivery.round)}`}
                        delivery={item.delivery}
                        {...(activeWorkspace !== null
                          ? {
                              actions: {
                                onOpenPreview: () => void openPreview(activeWorkspace),
                                onExport: () => void exportActiveProject(activeWorkspace),
                                ...(item.delivery.round === lastDeliveryRound ? { onRevert: () => handleRevertTurn(item.delivery.round) } : {}),
                              },
                            }
                          : {})}
                      />
                    ) : (
                      <div key={`e${String(item.from)}-${String(item.to)}`} className="round-note">
                        {formatEmptyTrailNote(item.from, item.to)}
                      </div>
                    );
                    return (
                      <>
                        {olderItems.length > 0 && (
                          <button
                            type="button"
                            className="delivery-earlier"
                            aria-expanded={showEarlier}
                            onClick={() => { setDeliveryExpandedFor(showEarlier ? null : activeId); }}
                          >
                            {showEarlier
                              ? "收起早期交付"
                              : `查看早期交付（${String(earlierCards)} 张卡 / ${String(olderItems.length)} 项）`}
                          </button>
                        )}
                        {showEarlier && olderItems.map(renderItem)}
                        {tailItems.map(renderItem)}
                      </>
                    );
                  })()}
                </div>
              </div>
              {outlineOpen && outlineTurns.length >= 2 && (
                <OutlinePanel
                  turns={outlineTurns}
                  currentRound={outlineCurrent}
                  anyFolded={foldedRounds.size > 0}
                  onJump={jumpToRound}
                  onToggleAllFold={() => { if (foldedRounds.size > 0) unfoldAllTurns(); else foldAllTurns(); }}
                  onClose={() => setOutlineOpen(false)}
                />
              )}
              {!stick.stuck && (
                <button className="jump-latest" aria-label="回到底部" title="回到底部" onClick={() => stick.scrollToBottom("smooth")}>
                  <ArrowDown size={14} />
                </button>
              )}
            </div>
          )}
          <div className="zone-gate">
            {askForActive !== null && (
              <ApprovalCard
                ask={askForActive}
                // 连拦降级（§2.2 双向断路器）：一键落到**比当前更保守**的那一档。
                // 为什么落「默认」而不是再往下：auto/guided 都是「免逐笔问写」的档，
                // 连拦说明被免掉的那层正在出事，退回逐笔审批就是这副断路器要说的话。
                // 不自动改档：这里只有用户点了才写 settings。
                onDowngrade={() => {
                  void window.agent.setSettings({ mode: "default" }).then(() => {
                    setMode("default");
                    setLastNotice(`权限档已降到「${MODE_LABEL.default.label}」——${MODE_LABEL.default.desc}`);
                  }).catch((err: unknown) => {
                    setLastError(`权限档保存失败：${err instanceof Error ? err.message : String(err)}`);
                  });
                }}
                onDecide={(approved, scope) => {
                  void window.agent.decide(askForActive.askId, approved, scope).then((ok) => {
                    if (!ok) setLastError("审批提交失败");
                  }).catch((err: unknown) => {
                    setLastError(`审批提交失败：${err instanceof Error ? err.message : String(err)}`);
                  });
                }}
              />
            )}
            {askForActive === null && pendingClarify !== null && (
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
            )}
            {askForActive === null && pendingClarify === null && pendingPlan !== null && (
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
            )}
          </div>
          <div className="zone-composer" ref={composerZoneRef}>
            {editCtx !== null && activeId === editCtx.forkId && (
              <div className="notice-strip" role="status">
                <span className="msg">正在新分支里编辑第 {editCtx.round} 轮消息；原会话「{editCtx.originTitle}」不动。</span>
                <button
                  className="btn-ghost"
                  onClick={() => {
                    const ctx = editCtx;
                    if (ctx === null) return;
                    // 2026-10-20 真机：旧实现只 activate(originId)，只换标题不载入原会话转录——
                    // 回到原会话后屏上是空流（rows=0）。必须走 openSession 重新载入。
                    const emptyBranch = activeIdRef.current === ctx.forkId
                      && events.length === 0
                      && (sendQueue.current.get(ctx.forkId)?.length ?? 0) === 0;
                    setEditCtx(null);
                    openSession(ctx.originId);
                    // 第 1 轮编辑建的空分支：回到原会话即无内容，顺手清掉，别留 0 字节会话。
                    // 删除与 openSession 谁先落都收敛到 origin（openSession 会写 currentSession）。
                    if (emptyBranch) {
                      // 删之前先把**用户还没发出去的编辑稿**搬到 origin（2026-10-20 独立评审追出，
                      // LOW-MEDIUM）：那份稿存在空分支的草稿键下 ⇒ 删会话不删草稿 ⇒ 稿子变孤儿
                      // （那条会话没了，谁也读不到它）⇒ 用户以为写的字还在，其实没了。
                      // 走**既有的草稿搬家通道**（draftRemap）：Composer 那侧是草稿桶的**唯一写手**，
                      // 另起一条直写 localStorage 的路会被它的内存桶盖回去（等于没搬）。
                      setDraftRemap({ from: ctx.forkId, to: ctx.originId, seq: ++draftRemapSeq.current });
                      void window.agent.deleteSession(ctx.forkId).then(() => { void refreshSessions(); }, (err: unknown) => {
                        setLastError(`空分支清理失败：${err instanceof Error ? err.message : String(err)}`, ctx.originId);
                      });
                    }
                  }}
                >回到原会话</button>
              </div>
            )}
            {activeId !== null && (
              <SendQueueStrip
                items={sendQueue.current.get(activeId) ?? []}
                running={runningActive}
                onInterruptSend={(index) => {
                  // 「打断并发送」：先把它提到队首，再打断本轮——收束在轮界，runOn 随即先派它。
                  // 打断走 cancelRunHeal：陈旧旗（main 无在跑）时摘旗并把这条当场派出去，不再是死点。
                  const sid = activeIdRef.current;
                  if (sid === null) return;
                  setQueueFor(sid, promoteQueued(sendQueue.current.get(sid) ?? [], index));
                  cancelRunHeal(sid);
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
              skills={skills}
              disabled={composerLock !== null}
              {...(composerLock !== null ? { disabledReason: composerLock } : {})}
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
              runSteps={runSteps}
              {...(chosenCtx !== undefined ? { ctxWindow: chosenCtx } : {})}
              workspaceLabel={!showEmpty && activeWorkspace ? activeWorkspace.slice(activeWorkspace.lastIndexOf("/") + 1) : null}
              workspacePath={activeWorkspace}
              recentRefs={activeId !== null ? recentRefsBySession.current.get(activeId) ?? [] : []}
              onReferenceAdded={noteRecentRef}
              promptHistory={promptHistory}
              onDraftPresence={noteDraft}
              injectedText={injectedText}
              injectedTextSeq={injectedTextSeq}
              draftRemap={draftRemap}
              {...(draftRestore !== undefined ? { restoreDraft: draftRestore } : {})}
              onSend={(t, attachments) => { sendWithGoal(t, attachments); }}
              onCancel={() => { if (activeId !== null) cancelRunHeal(activeId); }}
              onPickDirectory={() => window.agent.pickDirectory()}
              onPickFiles={() => window.agent.pickFiles()}
              configuredProviders={configuredProviders}
              onModeChange={(m) => {
                // 换档必须留下**可见后果**：芯片标签换字 + 一条 notice 说清新档从哪一刻起算。
                // 业主实测 2026-10-16「点了切换感觉没用」——芯片确实换了字，但没有任何一句告诉用户
                // 这一刻发生了什么、下一轮会怎样。runAgent 装配时 mode 进 sessionObj（整场 run 的
                // 常量，agent-runner.ts:1140）⇒ 运行中的那一轮改不了，这是真实语义不是缺陷，
                // 缺的只是把它说出来。
                void window.agent.setSettings({ mode: m }).then(() => {
                  setMode(m);
                  const info = MODE_LABEL[m];
                  setLastNotice(
                    runningActive
                      ? `权限档已切到「${info.label}」（${info.desc}）——本轮仍在原档下跑，下一条消息起生效`
                      : `权限档已切到「${info.label}」——${info.desc}`,
                  );
                }).catch((err: unknown) => {
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
                // 有会话就记成"本会话选择"，没有就只落全局缺省；两种情况都必须有可见后果。
                if (activeId !== null) {
                  selections.current.set(activeId, registryId);
                  force((n) => n + 1);
                }
                // provider 必须一起写：模型自带属于哪一家；演示项把 provider 拨回 demo。
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
              onCompact={() => { compactNow(); }}
              menuSignal={composerMenuSignal}
              onSuggestNext={onSuggestNext}
              injectedAttachment={injectedAttachment}
              injectedAppend={injectedAppend}
            />
          </div>
          {showEmpty && (
            /* 空屏下半区（P2-1）：建议行（点击=填入输入框不发送）+ 首启副标题；
               .empty-tail 是 .main 的直接弹性子女——把整组构图托到视觉中心偏上。 */
            <>
              <QuickStarts
                items={emptyData?.quickStarts ?? []}
                firstRunSub={onboarded === false ? STR.empty.firstRunSub : null}
                onPick={(t) => { injectText(t); }}
              />
              <div className="empty-tail" aria-hidden="true" />
            </>
          )}
        </main>
          </Panel>
          {/* P3-2 右侧检查器（brief 七）：常驻 Panel、默认收起（collapsible + collapsedSize 0；
              ⌘⌥B 开合 / 打开窗格自动露出 / 边沿拖出）。宽 320–420（defaultSize 360）。
              Inspector 三 Tab（改动/计划/时间线）在上；开了窗格时 PaneDock 在下方（组件与数据面不动）。 */}
          <Separator className="pane-handle" aria-label="调整检查器宽度" />
          <Panel
            panelRef={inspectorRef}
            collapsible
            collapsedSize={0}
            defaultSize={inspectorDefault}
            minSize={320}
            maxSize={420}
            className="pane-panel"
            onResize={(panelSize) => {
              setInspectorCollapsed(panelSize.inPixels <= 0);
              const px = Math.round(panelSize.inPixels);
              if (px < 320 || px > 420) return;
              if (inspectorSaveTimer.current !== null) window.clearTimeout(inspectorSaveTimer.current);
              inspectorSaveTimer.current = window.setTimeout(() => {
                try { window.localStorage.setItem("cairn.inspector.width", String(px)); } catch { /* 存不下则忽略 */ }
              }, 300);
            }}
          >
            {/* 收起态用 inert 而不是 hidden（2026-10-18）：
                · hidden={inspectorCollapsed} → display:none，会把 react-resizable-panels
                  正在做的宽度收起动画一刀砍掉，⌘⌥B 开合退化成硬切；
                · inert 同样把内部控件移出 Tab 序与无障碍树（屏外不劫持键盘、不被读屏念到），
                  但保留布局，宽度过渡照常播完。
                实现走 setAttribute（同 ModalSurface 的 imperative 口径）：@types/react 18.3
                的 HTMLAttributes 还没有 inert 这个 prop，写成 JSX 属性会直接编译红。
                收起瞬间若仍能 Tab 进检查器，是因为过渡还在跑（width > 0）——此刻控件在屏上，
                可聚焦是正确的；inert 在宽度归 0 的那一刻由 onResize 置上。 */}
            <div className="inspector-col" ref={inspectorColRef}>
              <Inspector
                key={activeId ?? "home"} // 切会话即重挂：内部 openKey/diff 状态不能跨会话复用
                events={events}
                onJump={jumpToEvent}
                onOpenPane={openPane}
                onRestore={handleRestoreSnapshot}
                onClose={toggleInspector}
              />
              {paneTabs.length > 0 && (
                <div className="pane-dock-zone">
                  <Suspense fallback={null}>
                    <PaneDock
                      tabs={paneTabs}
                      events={events}
                      sessionId={activeId}
                      onAttach={attachFromPane}
                      pickSignal={pickSignal}
                      onPickResult={handlePickResult}
                      {...(preview !== null && preview.status === "ready" && preview.url !== undefined ? { browserUrl: preview.url } : {})}
                      onClose={closePane}
                      onOpen={openPane}
                      onReview={(text) => void send(text)}
                      onReorder={(from, to) => setPaneTabs((tabs) => movePane(tabs, from, to))}
                      onPopout={(kind) => { void window.agent.panePopout(kind, activeId ?? undefined); }}
                    />
                  </Suspense>
                </div>
              )}
            </div>
          </Panel>
        </Group>
      </div>
      {/* 视图三档 toast（§3.4）：Ctrl+O 切换时一闪即走 */}
      {viewToast !== null && (
        <div className="view-toast" role="status">{viewToast}</div>
      )}
      {/* ⌘/ 快捷键速查（§3.6「查看全部」）：数据单一源 shortcuts.ts（只列已实现的键）。 */}
      {cheatOpen && (
        <ModalSurface className="sheet-scrim" label="快捷键速查" onClose={closeCheat} onClick={closeCheat}>
          <div className="sheet" onClick={(e) => { e.stopPropagation(); }}>
            <div className="sheet-head">
              <span className="sheet-title">快捷键</span>
              <button className="iconbtn sm" aria-label="关闭速查表" onClick={closeCheat}><X size={13} /></button>
            </div>
            <div className="sheet-body">
              {SHORTCUT_GROUPS.map((g) => (
                <div key={g.title} className="sheet-group">
                  <div className="sheet-group-title">{g.title}</div>
                  {g.rows.map((r) => (
                    <div key={r.keys} className="sheet-row">
                      <span className="sheet-keys">{r.keys}</span>
                      <span className="sheet-what">{r.what}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </ModalSurface>
      )}
      {/* 回滚轮次 / 移除项目的确认卡（2026-10-17：原生 confirm → 产品自绘）。 */}
      {revertConfirm !== null && (
        <ConfirmDialog
          title={`还原第 ${String(revertConfirm)} 轮的改动？`}
          note={"本轮新建的文件会删除；本轮之后又被改过的文件不会动，会列进「需手动处理」。"}
          confirmLabel="还原"
          danger
          onClose={() => setRevertConfirm(null)}
          onConfirm={() => { const round = revertConfirm; setRevertConfirm(null); doRevertTurn(round); }}
        />
      )}
      {projectRemoveConfirm !== null && (
        <ConfirmDialog
          title={STR.removeProject.title.replace("{name}", projectRemoveConfirm.name)}
          note={STR.removeProject.body}
          confirmLabel="移除"
          danger
          onClose={() => setProjectRemoveConfirm(null)}
          onConfirm={() => { const p = projectRemoveConfirm; setProjectRemoveConfirm(null); void doRemoveProject(p); }}
        />
      )}
      {/* 归档必问闸（§3.3 硬闸：所有权限模式下都问；取消归档不问）。 */}
      {archiveConfirm !== null && (
        <ModalSurface className="confirm-scrim" label="归档确认" onClose={() => setArchiveConfirm(null)}>
          <div className="confirm-card">
            <div className="cc-title">归档「{archiveConfirm.title ?? archiveConfirm.id}」？</div>
            <div className="cc-note">归档后会话移出常规列表，收进侧栏底部的「已归档」分组；随时能取消归档。归档不删任何内容。</div>
            <div className="cc-actions">
              <button className="mini-btn" onClick={() => setArchiveConfirm(null)}>取消</button>
              <button
                className="mini-btn primary"
                onClick={() => {
                  const target = archiveConfirm;
                  setArchiveConfirm(null);
                  void doArchiveSession(target.id, true);
                }}
              >归档</button>
            </div>
          </div>
        </ModalSurface>
      )}
      {/* 删除会话闸（§6.3 文案规范）：后果前置（删什么）+ 明示不可撤销 + 什么没被动（工作区文件）。 */}
      {deleteConfirm !== null && (
        <ModalSurface className="confirm-scrim" label="删除会话确认" onClose={() => setDeleteConfirm(null)}>
          <div className="confirm-card">
            <div className="cc-title">删除「{deleteConfirm.title ?? deleteConfirm.id}」？</div>
            <div className="cc-note">
              此操作无法撤销：该会话的全部记录将从磁盘删除（含旁路提升历史与队列残留）。<br />
              工作区里的文件不受影响——agent 改过的文件不会随会话回滚。
            </div>
            <div className="cc-actions">
              <button className="mini-btn" onClick={() => setDeleteConfirm(null)}>取消</button>
              <button
                className="mini-btn danger"
                onClick={() => {
                  const target = deleteConfirm;
                  setDeleteConfirm(null);
                  void doDeleteSession(target.id);
                }}
              >删除</button>
            </div>
          </div>
        </ModalSurface>
      )}
      {/* §3.7 · G4 丢弃隔离工作区闸：后果前置（哪棵树、会丢什么）+ 明示不可撤销。 */}
      {wtDiscard !== null && (
        <ModalSurface className="confirm-scrim" label="丢弃隔离工作区确认" onClose={() => setWtDiscard(null)}>
          <div className="confirm-card">
            <div className="cc-title">丢弃「{wtDiscard.title ?? wtDiscard.id}」的隔离工作区？</div>
            <div className="cc-note">
              此操作无法撤销：这块隔离工作区会被删除，里面未提交的改动一并消失。<br />
              主工作区不受影响——合并前它本来就没被动过。
            </div>
            <div className="cc-actions">
              <button className="mini-btn" onClick={() => setWtDiscard(null)}>取消</button>
              <button
                className="mini-btn danger"
                onClick={() => {
                  const target = wtDiscard;
                  setWtDiscard(null);
                  void sessionWorktreeOp("discard", target);
                }}
              >丢弃</button>
            </div>
          </div>
        </ModalSurface>
      )}
      {/* 命令面板（P3-3 · brief 八）：⌘K / 侧栏搜索钮；数据全从 App 拿（技能组待数据面接入）。 */}
      {paletteOpen && (
        <Suspense fallback={null}>
          <CommandPalette
            open
            onClose={() => { setPaletteOpen(false); focusComposer(); }}
            sessions={sessions}
            projects={projects.map((p) => ({ id: p.id, name: p.name, path: p.path }))}
            onOpenSession={(id) => { setPaletteOpen(false); openSession(id); }}
            onSwitchWorkspace={(path) => { setPaletteOpen(false); setActiveWorkspace(path); activeWorkspaceRef.current = path; touchWorkspace(path); }}
            onOpenSettings={(section) => { setPaletteOpen(false); setSettingsSection(section); setSettingsOpen(true); }}
            onAction={(action) => { setPaletteOpen(false); handlePaletteAction(action); }}
            activeSessionId={activeId}
            onSessionAction={(action, id) => {
              setPaletteOpen(false);
              const target = sessions.find((s) => s.id === id);
              if (target === undefined) { toast.error("会话已不存在"); return; }
              if (action === "rename") startBarRename();
              else if (action === "archive") requestArchiveSession(target, target.archived !== true);
              else requestDeleteSession(target);
            }}
          />
        </Suspense>
      )}
      {settingsOpen && (
        <Suspense fallback={null}>
          <SettingsPanel
            onClose={() => setSettingsOpen(false)}
            {...(settingsSection !== undefined ? { initialSection: settingsSection } : {})}
            onSettingsSaved={() => {
              void refreshProviderInfo();
              void refreshProviderKeys();
              // 设置页那条路也要给出「换档之后发生了什么」：与 Composer 档位菜单同一句口径
              // （面板保存后不主动喊，用户点完单选卡只看到对勾移动，仍旧读不出下一轮何时生效）。
              void window.agent.getSettings().then((s) => {
                if (s.mode !== mode) {
                  const info = MODE_LABEL[s.mode];
                  setLastNotice(`权限档已切到「${info.label}」——${info.desc}`);
                }
                setMode(s.mode);
                setThemePref(s.theme);
                setTextSize(s.textSize);
                setUiSize(s.uiSize);
                // 2026-10-18 真机：Ctrl+Tab 开关只落盘、未回灌 live 状态 ⇒ 关掉后快捷键照样切会话
                // （重启才生效）。设置页保存的回灌必须覆盖快捷键读取的那份 state。
                setCtrlTabCycle(s.ctrlTabCycle);
              }).catch(() => undefined);
            }}
          />
        </Suspense>
      )}
      {/* 拖放提示（brief 第四节）：拖文件夹进窗口即亮；松手落在全局 drop（目录 = 添加项目）。 */}
      {dragOverApp && (
        <div className="drop-overlay" aria-hidden="true">
          <div className="drop-card">
            <FolderPlus size={18} />
            <span>{STR.drop.hintAddProject}</span>
          </div>
        </div>
      )}
      {newProjectOpen && (
        <NewProjectDialog
          templates={templates}
          existingNames={projects.map((p) => p.name)}
          onClose={() => { setNewProjectOpen(false); }}
          onPickDirectory={() => window.agent.pickDirectory()}
          onCreate={handleCreateFromDialog}
        />
      )}
    </div>
  );
}
