import { runKey } from "../state/session-identity";
import type { RevertTurnTarget } from "../state/message-actions";
import type { SendOutcome } from "../state/run-queue";
import { composerThinking, thinkingChangeTarget } from "../state/thinking-selection";
import { applySessionModelPick, saveSessionPrefs } from "../state/session-prefs";
import { useMemo } from "react";
import type { Dispatch,MutableRefObject,PointerEvent,SetStateAction } from "react";
import type { GoalTrace } from "../../../../../src/agent/goal-trace";
import type { ClarifyQuestion,PlanProposal } from "../../../../../src/events";
import type { DeliveryTrailItem,RunPhase,StreamRow,UsageSummary } from "../projections";
import type { ThinkingEffort } from "../../../../../src/providers/capabilities";
import type { ComposerLockReason } from "../send-queue";
import type { StickyScroll } from "../useStickyScroll";
import { renderAppToolbar } from "./AppToolbar";
// WorkbenchView: extracted without changing event or callback behavior.
import { ArrowDown,Check,ChevronDown,Folder,FolderPlus,GitBranch,X } from "lucide-react";
import { CairnMark } from "../components/CairnMark";
import { menuNavIndex } from "../components/popover-keys";
import { lazy,Suspense,useEffect,useRef,useState } from "react";
import { useUpdateNotice } from "../state/update-notice";
import { registerBrowserLinkHandler } from "../browser-link";
import { Group,Panel,Separator,type PanelImperativeHandle } from "react-resizable-panels";
import type { AgentEvent,AskPayload,PermissionMode,ProjectDiagnosis,ProjectRecord,ProviderInfo,RunAttachmentReference,SuggestNextResult } from "../../../../../src/main/ipc-protocol";
import type { PreviewSnapshot } from "../../../../../src/main/project-preview";
import type { TextSizeSetting,UiSizeSetting } from "../../../../../src/main/settings";
import type { AppDestination,SectionId } from "../app-controls";
import { AddProjectMenu } from "../components/AddProjectMenu";
import { ApprovalCard } from "../components/ApprovalCard";
import { BackgroundCommands } from "../components/BackgroundCommands";
import { ChangeSummaryCard } from "../components/ChangeSummaryCard";
import type { ChangesFocus } from "../components/ChangesPane";
import { ClarifyCard } from "../components/ClarifyCard";
import type { PaletteAction } from "../components/CommandPalette";
import { Composer } from "../components/Composer";
import { ErrorStrip } from "../components/ErrorStrip";
import { NoticeStrip } from "../components/NoticeStrip";
import { SessionLoadNotice } from "../components/SessionLoadNotice";
import { FindBar,type FindBarHandle } from "../components/FindBar";
import { ImportDiagnosisCard } from "../components/ImportDiagnosisCard";
import { Inspector } from "../components/Inspector";
import { ModalSurface } from "../components/ModalSurface";
import { NewProjectDialog } from "../components/NewProjectDialog";
import { OutlinePanel } from "../components/Outline";
import { MODE_LABEL } from "../components/PermissionMenu";
import { PlanCard } from "../components/PlanCard";
import { PluginSidebar } from "../components/PluginSidebar";
import { Popover } from "../components/Popover";
import { ProviderBanner } from "../components/ProviderBanner";
import { QuickStarts } from "../components/QuickStarts";
import { QueueDock } from "./QueueDock";
import { todoProjection } from "../derived/todo";
import { SessionLogDialog } from "../components/SessionLogDialog";
import type { StreamActions } from "../components/Stream";
import { TitleBar } from "../components/TitleBar";
import { movePane,type PaneKind } from "../components/panes";
import { destinationForSection,PAGE_CONTEXT_ITEMS,pageForDestination } from "../navigation";
import { greetingFor,type QuickStartInput } from "../quick-starts";
import type { QueuedSend } from "../send-queue";
import type { SurfaceError } from "../surface-error";
import type { DeleteConfirmTarget, SessionConfirmTarget, SessionEditContext, WorkspaceSession } from "../sessions-view";
import { SHORTCUT_GROUPS } from "../shortcuts";
import type { SlashSkill } from "../slash";
import { STR } from "../strings";
import { type ThemePref } from "../theme";
import { toast } from "../toast";
import { type ViewMode } from "../view-mode";
import { ConfirmScrims } from "./ConfirmScrims";
import type { PermissionConfirmApi } from "../state/use-permission-confirm";
import { DestinationWorkspace } from "./DestinationWorkspace";
import { WorkbenchSidebar } from "./WorkbenchSidebar";
import type { PickedElementSignal } from "../picked-element";
const PaneDock = lazy(() => import("../components/PaneDock").then((m) => ({ default: m.PaneDock })));
const AppPageBody = lazy(() => import("../components/AppPage").then((m) => ({ default: m.AppPageBody })));
const CommandPalette = lazy(() => import("../components/CommandPalette").then((m) => ({ default: m.CommandPalette })));
const SettingsPanel = lazy(() => import("../components/SettingsPanel").then((m) => ({ default: m.SettingsPanel })));
const Stream = lazy(() => import("../components/Stream").then((m) => ({ default: m.Stream })));
interface EmptySurface {
  quickStarts: string[];
  branch: string | null;
}
const NULL_QUICK_INPUT: QuickStartInput = {
  git: null,
  hasPackageJson: false,
  scripts: [],
  readmeExists: false,
  lastSessionTitle: null,
};

interface WorkbenchViewDeps {
  activeWorkspace: string | null;
  projects: ProjectRecord[];
  pickerValue: string | null;
  providerInfo: ProviderInfo | null;
  settingsOpen: boolean;
  destination: AppDestination;
  pageFilter: string;
  openDestination: (destination: AppDestination) => void;
  setPageFilter: (filter: string) => void;
  activeId: string | null;
  barRenaming: { id: string; text: string; } | null;
  setBarRenaming: Dispatch<SetStateAction<{ id: string; text: string; } | null>>;
  sessions: WorkspaceSession[];
  renameSessionById: (id: string, name: string) => Promise<void>;
  sessionTitle: string;
  goalTrace: GoalTrace | null;
  dismissedGoals: Map<string, number>;
  goalAct: (req: { pause?: boolean | undefined; resume?: boolean | undefined; clear?: boolean | undefined; }) => void;
  activeIdRef: MutableRefObject<string | null>;
  setDismissedGoals: Dispatch<SetStateAction<Map<string, number>>>;
  outlineTurns: { round: number; text: string; }[];
  outlineOpen: boolean;
  setOutlineOpen: Dispatch<SetStateAction<boolean>>;
  paneTabs: PaneKind[];
  togglePane: (kind: PaneKind) => void;
  fileCount: number;
  pluginSidebarOpen: boolean;
  togglePluginSidebar: () => void;
  focusMode: boolean;
  toggleFocusMode: () => void;
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  newSession: () => void;
  handleOpenPalette: () => void;
  openPane: (kind: PaneKind) => void;
  setSettingsSection: Dispatch<SetStateAction<SectionId | undefined>>;
  setSettingsOpen: Dispatch<SetStateAction<boolean>>;
  sidebarWidth: number;
  runningSet: MutableRefObject<Set<string>>;
  waitingIdSet: Set<string>;
  draftIds: Set<string>;
  outcomes: MutableRefObject<Map<string, "ok" | "failed">>;
  registryNotice: string | null;
  /** 项目注册表读取失败后的就地重试（侧栏 notice 的出口）。 */
  retryProjects: () => void;
  sessionsLoaded: boolean;
  sessionsRefreshing: boolean;
  sessionsLoadError: boolean;
  sessionsLoadErrorDetail: string | null;
  retrySessions: () => void;
  providerOk: boolean | null;
  openSession: (id: string, workspace?: string | undefined) => void;
  setActiveWorkspace: Dispatch<SetStateAction<string | null>>;
  activeWorkspaceRef: MutableRefObject<string | null>;
  touchWorkspace: (path: string | null) => void;
  handleAddProject: (path: string) => Promise<void>;
  handleCloneProject: (url: string, parentDir: string) => Promise<void>;
  setNewProjectOpen: Dispatch<SetStateAction<boolean>>;
  handleUpdateProject: (p: ProjectRecord, patch: { name?: string | undefined; defaultLocation?: string | undefined; }) => Promise<void>;
  handleRelocateProject: (p: ProjectRecord, nextPath: string) => Promise<void>;
  handleRemoveProject: (p: ProjectRecord) => Promise<void>;
  handleRevealProject: (p: ProjectRecord) => void;
  pinSessionById: (id: string, pinned: boolean) => Promise<void>;
  forkSessionFromMenu: (s: WorkspaceSession) => Promise<void>;
  requestArchiveSession: (s: WorkspaceSession, archived: boolean) => void;
  openSessionInCli: (s: WorkspaceSession) => void;
  setWtDiscard: Dispatch<SetStateAction<WorkspaceSession | null>>;
  sessionWorktreeOp: (kind: "create" | "merge" | "discard", s: WorkspaceSession) => Promise<void>;
  requestDeleteSession: (s: WorkspaceSession) => void;
  themePref: ThemePref;
  changeTheme: (next: ThemePref) => void;
  usageStats: UsageSummary;
  startSidebarDrag: (e: PointerEvent<HTMLDivElement>) => void;
  persistSidebarWidth: (w: number) => void;
  sidebarWidthRef: MutableRefObject<number>;
  mainGroupRef: MutableRefObject<HTMLDivElement | null>;
  showEmpty: boolean;
  findRef: MutableRefObject<FindBarHandle | null>;
  findOpen: boolean;
  streamEl: HTMLDivElement | null;
  closeFind: () => void;
  /** 错误条载荷：一句话，或结构化的 SurfaceError（原因/依据/下一步，2026-11-02 真机订正）。 */
  lastError: string | SurfaceError | null;
  clearLastError: () => void;
  setLogTarget: Dispatch<SetStateAction<string | null>>;
  lastNotice: string | null;
  clearLastNotice: () => void;
  importDiagnosis: { name: string; diagnosis: ProjectDiagnosis; } | null;
  setImportDiagnosis: Dispatch<SetStateAction<{ name: string; diagnosis: ProjectDiagnosis; } | null>>;
  chipRef: MutableRefObject<HTMLDivElement | null>;
  chipOpen: boolean;
  openChipPopover: () => void;
  emptyData: EmptySurface | null;
  chipQuery: string;
  setChipQuery: Dispatch<SetStateAction<string>>;
  chipRecent: ProjectRecord[] | null;
  chipList: ProjectRecord[];
  closeChip: () => void;
  setLastError: (message: string, sessionId?: string | undefined) => void;
  setStreamEl: Dispatch<SetStateAction<HTMLDivElement | null>>;
  stick: StickyScroll;
  streamRows: StreamRow[];
  rowRefs: ReadonlyMap<number, import("../../../../../src/events").EventRef> | null;
  inheritedSeqs: ReadonlySet<number> | null;
  viewMode: ViewMode;
  runningActive: boolean;
  modelWaiting?: boolean;
  foldedRounds: ReadonlySet<number>;
  flashRound: number | null;
  streamActions: StreamActions;
  deliveryTrailItems: DeliveryTrailItem[];
  deliveryExpandedFor: string | null;
  openPreview: (target: string) => Promise<void>;
  exportActiveProject: (projectPath: string) => Promise<void>;
  lastDeliveryRound: number | undefined;
  handleRevertTurn: (round: number) => void;
  setDeliveryExpandedFor: Dispatch<SetStateAction<string | null>>;
  outlineCurrent: number | null;
  jumpToRound: (round: number) => void;
  unfoldAllTurns: () => void;
  foldAllTurns: () => void;
  askForActive: AskPayload | null;
  setMode: Dispatch<SetStateAction<PermissionMode>>;
  setLastNotice: (message: string, sessionId?: string | undefined) => void;
  pendingClarify: { callId: string; questions: ClarifyQuestion[]; } | null;
  pendingPlan: { callId: string; plan: PlanProposal; } | null;
  composerZoneRef: MutableRefObject<HTMLDivElement | null>;
  editCtx: SessionEditContext | null;
  events: AgentEvent[];
  sendQueue: MutableRefObject<Map<string, QueuedSend[]>>;
  setEditCtx: (v: SessionEditContext | null) => void;
  setDraftRemap: (v: { from: string; to: string; seq: number; } | undefined) => void;
  draftRemapSeq: MutableRefObject<number>;
  refreshSessions: () => Promise<void>;
  setQueueFor: (sid: string, list: QueuedSend[], workspace?: string | null) => void;
  cancelRunHeal: (sid: string, workspace?: string | null) => void;
  resumeQueueFor: (sid: string, workspace?: string | null) => void;
  /** 预览/后台会话发送：与主发送共用插话与队列；`running` 由预览按目标会话事件态传入。 */
  sendTo: (sid: string, workspace: string | null, text: string, attachments?: RunAttachmentReference[], options?: { forceQueue?: boolean; running?: boolean }) => Promise<SendOutcome>;
  queueLoading: boolean;
  queueSaving: boolean;
  queueSaveFailed: boolean;
  sessionLoadError: string | null;
  retrySessionOpen: () => void;
  pendingSend: boolean;
  resumeQueue: () => void;
  skills: readonly SlashSkill[];
  composerLock: ComposerLockReason | null;
  mode: PermissionMode;
  stopped: boolean;
  usage: { inputTokens: number; outputTokens: number; usageCount: number; cacheReadTokens: number; lastInputTokens: number; };
  phaseLabel: string;
  phase: RunPhase;
  elapsedSec: number;
  steps: number;
  runSteps: number;
  chosenCtx: number | undefined;
  recentRefsBySession: MutableRefObject<Map<string, string[]>>;
  noteRecentRef: (path: string) => void;
  promptHistory: string[];
  noteDraft: (draftKey: string | null, has: boolean) => void;
  injectedText: string | undefined;
  injectedTextSeq: number;
  draftRemap: { from: string; to: string; seq: number; } | undefined;
  draftRestore: { forSession: string | null; text: string; attachments: RunAttachmentReference[]; seq: number; } | undefined;
  /** 第三参 `forceQueue`（第 9 点）：只入队、不插话（「加入队列」钮专用）。 */
  sendWithGoal: (text: string, attachments: RunAttachmentReference[], forceQueue?: boolean) => void;
  configuredProviders: Set<string> | undefined;
  thinkingBySession: MutableRefObject<Map<string, string>>;
  /** 空屏上选的思考档（下一条新会话起点）；activeId 为 null 时 Composer 显示它。 */
  pendingThinking: ThinkingEffort;
  setPendingThinking: (level: ThinkingEffort) => void;
  force: Dispatch<SetStateAction<number>>;
  selections: MutableRefObject<Map<string, string | null>>;
  refreshProviderInfo: () => Promise<void>;
  compactNow: () => void;
  composerMenuSignal: { kind: "model" | "perm" | "effort"; seq: number; } | null;
  onSuggestNext: () => Promise<SuggestNextResult>;
  injectedAttachment: { path: string; kind: "file" | "directory"; seq: number; } | undefined;
  injectedElement: PickedElementSignal | undefined;
  injectText: (text: string) => void;
  inspectorRef: MutableRefObject<PanelImperativeHandle | null>;
  inspectorDefault: number;
  inspectorCollapsed: boolean;
  setInspectorCollapsed: Dispatch<SetStateAction<boolean>>;
  inspectorSaveTimer: MutableRefObject<number | null>;
  inspectorColRef: MutableRefObject<HTMLDivElement | null>;
  jumpToEvent: (eventId: number) => void;
  handleRestoreSnapshot: (path: string, snapshotId: string) => void;
  toggleInspector: () => void;
  attachFromPane: (rel: string, kind: "file" | "directory") => void;
  pickSignal: number;
  handlePickResult: (r: { selector: string; snippet: string; url: string; }) => void;
  preview: PreviewSnapshot | null;
  closePane: (kind: PaneKind) => void;
  send: (text: string, attachments?: RunAttachmentReference[]) => Promise<void>;
  setPaneTabs: Dispatch<SetStateAction<PaneKind[]>>;
  pluginSidebarWidth: number;
  setPluginSidebarWidthPersist: (width: number) => void;
  closePluginSidebar: () => void;
  fillPluginCommand: (invoke: string) => void;
  viewToast: string | null;
  cheatOpen: boolean;
  closeCheat: () => void;
  revertConfirm: RevertTurnTarget | null;
  setRevertConfirm: Dispatch<SetStateAction<RevertTurnTarget | null>>;
  doRevertTurn: (target: RevertTurnTarget) => void;
  projectRemoveConfirm: ProjectRecord | null;
  setProjectRemoveConfirm: Dispatch<SetStateAction<ProjectRecord | null>>;
  doRemoveProject: (p: ProjectRecord) => Promise<void>;
  archiveConfirm: SessionConfirmTarget | null;
  setArchiveConfirm: Dispatch<SetStateAction<SessionConfirmTarget | null>>;
  doArchiveSession: (id: string, archived: boolean) => Promise<void>;
  deleteConfirm: DeleteConfirmTarget | null;
  setDeleteConfirm: Dispatch<SetStateAction<DeleteConfirmTarget | null>>;
  doDeleteSession: (id: string, target?: WorkspaceSession) => Promise<void>;
  wtDiscard: WorkspaceSession | null;
  permissionGuard: PermissionConfirmApi;
  paletteOpen: boolean;
  setPaletteOpen: Dispatch<SetStateAction<boolean>>;
  focusComposer: () => void;
  handlePaletteAction: (action: PaletteAction) => void;
  startBarRename: () => boolean;
  logTarget: string | null;
  settingsSection: SectionId | undefined;
  refreshProviderKeys: () => Promise<void>;
  setThemePref: Dispatch<SetStateAction<ThemePref>>;
  setTextSize: Dispatch<SetStateAction<TextSizeSetting>>;
  setUiSize: Dispatch<SetStateAction<UiSizeSetting>>;
  setCtrlTabCycle: Dispatch<SetStateAction<boolean>>;
  dragOverApp: boolean;
  newProjectOpen: boolean;
  templates: { id: string; name: string; description: string; runKind: "static" | "vite"; }[];
  handleCreateFromDialog: (input: { name: string; templateId: string; parentDir?: string | undefined; }) => Promise<void>;
}

export function WorkbenchView(deps: WorkbenchViewDeps) {
  // 空屏问候语（2026-10-24）：按时段分组、组内轮换，每次挂载取定一句——
  // 重渲染不再重抽（文字闪变），换会话/重开才有机会换词。
  const [greeting] = useState(() => greetingFor(new Date().getHours()));
  const [pluginUpdateCount, setPluginUpdateCount] = useState(0);
  // 命令面板快速打开的文件目标（本地信号；递增 seq 允许连续打开同一文件）。
  const [fileTarget, setFileTarget] = useState<{ path: string; seq: number } | null>(null);
  // ⌘+点击侧栏会话：右侧预览目标（可继续发送；seq 允许连续预览同一会话）。
  const [sessionPreview, setSessionPreview] = useState<{ id: string; workspace?: string; title: string; seq: number } | null>(null);
  const [paneTarget, setPaneTarget] = useState<{ kind: PaneKind; seq: number } | null>(null);
  // 聊天链接直达侧栏浏览器（2026-11-05 业主）：markdown http(s) 链接点击 → browser 窗格导航。
  // 注册收口在常驻的 WorkbenchView（PaneDock 条件挂载，paneTabs 为空时它不存在，监听放它
  // 身上会丢「窗格全关后的第一击」）；弹出窗不注册 → browser-link 自动回落系统浏览器。
  const [browserLinkTarget, setBrowserLinkTarget] = useState<{ url: string; seq: number } | null>(null);
  const browserLinkSeqRef = useRef(0);
  const [changesFocus, setChangesFocus] = useState<ChangesFocus | null>(null);
  const changesFocusSeq = useRef(0);
  const { activeWorkspace, projects, pickerValue, providerInfo, settingsOpen, destination, pageFilter, openDestination, setPageFilter, activeId, barRenaming, setBarRenaming, sessions, renameSessionById, sessionTitle, goalTrace, dismissedGoals, goalAct, activeIdRef, setDismissedGoals, outlineTurns, outlineOpen, setOutlineOpen, paneTabs, togglePane, fileCount, pluginSidebarOpen, togglePluginSidebar, focusMode, toggleFocusMode, sidebarCollapsed, toggleSidebar, newSession, handleOpenPalette, openPane, setSettingsSection, setSettingsOpen, sidebarWidth, runningSet, waitingIdSet, draftIds, outcomes, registryNotice, retryProjects, sessionsLoaded, sessionsLoadError, sessionsLoadErrorDetail, retrySessions, providerOk, openSession, setActiveWorkspace, activeWorkspaceRef, touchWorkspace, handleAddProject, handleCloneProject, setNewProjectOpen, handleUpdateProject, handleRelocateProject, handleRemoveProject, handleRevealProject, pinSessionById, forkSessionFromMenu, requestArchiveSession, openSessionInCli, setWtDiscard, sessionWorktreeOp, requestDeleteSession, themePref, changeTheme, usageStats, startSidebarDrag, persistSidebarWidth, sidebarWidthRef, mainGroupRef, showEmpty, findRef, findOpen, streamEl, closeFind, lastError, clearLastError, setLogTarget, lastNotice, clearLastNotice, importDiagnosis, setImportDiagnosis, chipRef, chipOpen, openChipPopover, emptyData, chipQuery, setChipQuery, chipRecent, chipList, closeChip, setLastError, setStreamEl, stick, streamRows, rowRefs, inheritedSeqs, viewMode, runningActive, foldedRounds, flashRound, streamActions, deliveryTrailItems, deliveryExpandedFor, openPreview, setDeliveryExpandedFor, outlineCurrent, jumpToRound, unfoldAllTurns, foldAllTurns, askForActive, setMode, setLastNotice, pendingClarify, pendingPlan, composerZoneRef, editCtx, events, sendQueue, setEditCtx, setDraftRemap, draftRemapSeq, refreshSessions, setQueueFor, cancelRunHeal, resumeQueueFor, sendTo, queueLoading, pendingSend, skills, composerLock, mode, stopped, usage, phaseLabel, phase, elapsedSec, steps, runSteps, chosenCtx, recentRefsBySession, noteRecentRef, promptHistory, noteDraft, injectedText, injectedTextSeq, draftRemap, draftRestore, sendWithGoal, configuredProviders, thinkingBySession, pendingThinking, setPendingThinking, force, selections, refreshProviderInfo, compactNow, composerMenuSignal, onSuggestNext, injectedAttachment, injectedElement, injectText, inspectorRef, inspectorDefault, setInspectorCollapsed, inspectorSaveTimer, inspectorColRef, jumpToEvent, handleRestoreSnapshot, toggleInspector, attachFromPane, pickSignal, handlePickResult, preview, closePane, send, setPaneTabs, pluginSidebarWidth, setPluginSidebarWidthPersist, closePluginSidebar, fillPluginCommand, viewToast, cheatOpen, closeCheat, revertConfirm, setRevertConfirm, doRevertTurn, permissionGuard, projectRemoveConfirm, setProjectRemoveConfirm, doRemoveProject, archiveConfirm, setArchiveConfirm, doArchiveSession, deleteConfirm, setDeleteConfirm, doDeleteSession, wtDiscard, paletteOpen, setPaletteOpen, focusComposer, handlePaletteAction, startBarRename, logTarget, settingsSection, refreshProviderKeys, setThemePref, setTextSize, setUiSize, setCtrlTabCycle, dragOverApp, newProjectOpen, templates, handleCreateFromDialog } = deps;
  // 启动时轻量检查更新：有更新源才查，24h 一次，有可用版本才出 notice。
  useUpdateNotice(setLastNotice);
  // 记忆正文也复用 Markdown 链接：先露出会话工作台，浏览器不在隐藏页面后面打开。
  useEffect(() => {
    registerBrowserLinkHandler((url) => {
      browserLinkSeqRef.current += 1;
      setBrowserLinkTarget({ url, seq: browserLinkSeqRef.current });
      if (destination !== "chat") openDestination("chat");
      openPane("browser");
    });
    return () => registerBrowserLinkHandler(null);
  }, [destination, openDestination, openPane]);
  // 浏览器窗格关闭时清掉待导航目标：seq 闸只活在一次挂载内（PaneDock 重挂后 openTargetSeqRef
  // 归零），不清的话重开窗格会静默重放上一次点过的旧链接。
  useEffect(() => {
    if (!paneTabs.includes("browser") && browserLinkTarget !== null) setBrowserLinkTarget(null);
  }, [paneTabs, browserLinkTarget]);
  const { inspectorCollapsed } = deps;
  const pendingSession = pendingSend && activeId === null;
  const page = pageForDestination(destination);
  const pageItems = page === null ? [] : PAGE_CONTEXT_ITEMS[page];
  const openToolbarPane = (kind: PaneKind): void => {
    openPane(kind);
    setPaneTarget(prev => ({ kind, seq: (prev?.seq ?? 0) + 1 }));
  };
  // 主区正常打开预览中的同一场会话时，预览已没有意义：两块同内容副本既占宽又像故障。
  // 「切到会话」按钮已显式收起；从侧栏直接打开同一场也走这一条。
  useEffect(() => {
    if (sessionPreview === null || activeId !== sessionPreview.id) return;
    if (sessionPreview.workspace !== undefined && activeWorkspace !== null && sessionPreview.workspace !== activeWorkspace) return;
    setSessionPreview(null);
    closePane("session");
  }, [activeId, activeWorkspace, sessionPreview, closePane]);
  // 项目弹层（2026-10-24 第二版）：向上开时按 chip 行上方的**实测空间**封顶。
  // 只给列表 240px 上限不够——搜索框 + 列表 + 页脚一起仍可能高于可用空间，弹层顶到
  // 窗口上沿（截图复现：top=0，圆角/阴影被裁）。封顶后列表自己缩，搜索与页脚始终可见。
  useEffect(() => {
    if (!chipOpen) return;
    const row = chipRef.current;
    if (row === null) return;
    const place = (): void => {
      const pop = row.querySelector<HTMLElement>(".chip-pop");
      if (pop === null) return;
      const r = row.getBoundingClientRect();
      const above = r.top - 58; // 顶栏 48 + 10 留白：弹层压到标题栏同样算被裁
      const below = window.innerHeight - r.bottom - 10;
      const down = below > above;
      pop.classList.toggle("down", down);
      pop.style.maxHeight = `${String(Math.max(160, Math.min(480, down ? below : above)))}px`;
    };
    place();
    window.addEventListener("resize", place);
    const ro = new ResizeObserver(place);
    ro.observe(row);
    return () => { window.removeEventListener("resize", place); ro.disconnect(); };
  }, [chipOpen, chipRef]);
  // 统一工具栏 · 左翼工作区上下文（2026-10-21 设计重做）：会话内把工作区名从输入区
  // 搬到这里——同一语义只留一处，输入区回到纯粹的写作面。
  const activeProjectLabel = activeWorkspace === null ? null
    : (projects.find((p) => p.path === activeWorkspace)?.name ?? activeWorkspace.slice(activeWorkspace.lastIndexOf("/") + 1));
  // 工作状态面板（2026-11-04 截图右上角）：todo_write 清单投影 + 运行读数（阶段/耗时/步数）。
  const workTodos = useMemo(() => todoProjection(events), [events]);
  const { toolbarContext, toolbarCenter, toolbarAside, toolbarRight } = renderAppToolbar({ settingsOpen: settingsOpen || destination !== "chat", activeId, activeWorkspace, activeProjectLabel, barRenaming, setBarRenaming, sessions, renameSessionById, sessionTitle, goalTrace, dismissedGoals, goalAct, activeIdRef, setDismissedGoals, outlineTurns, outlineOpen, setOutlineOpen, paneTabs, onOpenPane: openToolbarPane, inspectorOpen: !inspectorCollapsed, onToggleInspector: toggleInspector, fileCount, pluginSidebarOpen, togglePluginSidebar, focusMode, toggleFocusMode, demo: providerInfo?.kind === "demo", onOpenProviderSettings: () => { setSettingsSection("provider"); setSettingsOpen(true); }, running: runningActive, phaseLabel, elapsedSec, runSteps, todos: workTodos });

    return (
    <div className="app" data-sidebar={sidebarCollapsed ? "collapsed" : "expanded"}>
      <TitleBar
        center={settingsOpen ? <span className="tb-brand">设置</span> : destination === "chat" ? toolbarCenter : <span className="tb-brand"><CairnMark />Cairn</span>}
        aside={settingsOpen || destination !== "chat" ? undefined : toolbarAside}
        context={settingsOpen || destination !== "chat" ? undefined : toolbarContext ?? undefined}
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={toggleSidebar}
        showToggle={!settingsOpen}
        right={toolbarRight}
      />
      <div className="shell">
        <WorkbenchSidebar
          destination={destination}
          sidebarCollapsed={sidebarCollapsed}
          focusMode={focusMode}
          sidebarWidth={sidebarWidth}
          chatSidebar={{
            projects,
            sessions,
            activeId,
            activeWorkspace,
            running: runningSet.current,
            waitingIds: waitingIdSet,
            draftIds,
            outcomes: outcomes.current,
            notice: registryNotice,
            onRetryNotice: retryProjects,
            loading: !sessionsLoaded && !sessionsLoadError,
            refreshing: deps.sessionsRefreshing,
            loadError: sessionsLoadError,
            loadErrorDetail: sessionsLoadErrorDetail,
            onRetryLoad: retrySessions,
            providerOk, providerDemo: providerInfo?.kind === "demo",
            onOpen: openSession,
            onPreviewSession: (s) => {
              if (s.id === activeId) return;
              openPane("session");
              setSessionPreview((prev) => ({
                id: s.id,
                ...(s.workspace !== undefined ? { workspace: s.workspace } : {}),
                title: s.title ?? s.id,
                seq: (prev?.seq ?? 0) + 1,
              }));
            },
            onNewTask: newSession,
            onOpenPalette: handleOpenPalette,
            onSwitchWorkspace: (p) => { setActiveWorkspace(p); activeWorkspaceRef.current = p; touchWorkspace(p); },
            onAddProject: handleAddProject,
            onCloneProject: handleCloneProject,
            onOpenNewProjectDialog: () => setNewProjectOpen(true),
            onUpdateProject: handleUpdateProject,
            onRelocateProject: handleRelocateProject,
            onRemoveProject: handleRemoveProject,
            onRevealProject: handleRevealProject,
            onRenameSession: renameSessionById,
            onPinSession: pinSessionById,
            onForkSession: forkSessionFromMenu,
            onArchiveSession: requestArchiveSession,
            onOpenInCliSession: openSessionInCli,
            onAssignSessionProject: (id, projectId) => {
              void window.agent.assignSessionProject(id, projectId).then(
                () => { void refreshSessions(); },
                (err: unknown) => { toast.error("归项目失败：" + (err instanceof Error ? err.message : String(err))); },
              );
            },
            onSessionWorktree: (kind, s) => {
              if (kind === "discard") setWtDiscard(s);
              else void sessionWorktreeOp(kind, s);
            },
            onDeleteSession: requestDeleteSession,
            onPickDirectory: () => window.agent.pickDirectory(),
          }}
          badges={pluginUpdateCount > 0 ? { plugins: pluginUpdateCount } : {}}
          pageItems={pageItems}
          activeFilter={pageFilter}
          onFilter={setPageFilter}
          onOpenDestination={openDestination}
          onSettings={() => { setSettingsSection(undefined); setSettingsOpen(true); }}
          account={{
            onOpenSettings: () => { setSettingsSection(undefined); setSettingsOpen(true); },
            onOpenAbout: () => { setSettingsSection("about"); setSettingsOpen(true); },
            onOpenUpdateSettings: () => { setSettingsSection("about"); setSettingsOpen(true); },
            onOpenUsage: () => { setSettingsSection("usage"); setSettingsOpen(true); },
            theme: themePref,
            onThemeChange: changeTheme,
          }}
          onNewTask={newSession}
          onSearch={handleOpenPalette}
          onFiles={() => openPane("file")}
          onTerminal={() => openPane("terminal")}
          onStartResize={startSidebarDrag}
          onPersistWidth={persistSidebarWidth}
          onKeyResize={(e) => {
            if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
            e.preventDefault();
            persistSidebarWidth(sidebarWidthRef.current + (e.key === "ArrowRight" ? 16 : -16));
          }}
        />
        <DestinationWorkspace
          destination={destination}
          renderPage={(next) => (
            <Suspense fallback={<div className="ap-empty">正在加载页面…</div>}>
              <AppPageBody
                page={next}
                workspace={activeWorkspace}
                mutationBlocked={runningActive}
                onPluginUpdateCount={(count) => { setPluginUpdateCount(count); }}
                onOpenSection={(id) => { setSettingsSection(id); setSettingsOpen(true); }}
                {...(next === destination ? { filter: pageFilter, onFilter: setPageFilter } : {})}
              />
            </Suspense>
          )}
        >
        <Group orientation="horizontal" id="cairn-main" className="main-group" elementRef={mainGroupRef}>
          <Panel minSize={420}>
        <main className="main" data-dsh-claude-part="center-column" data-empty={showEmpty ? "true" : "false"}>
          <FindBar
            ref={findRef}
            open={findOpen && !showEmpty}
            container={streamEl}
            rows={streamRows}
            foldedRounds={foldedRounds}
            onExpandRound={(round) => { streamActions.onToggleFold?.(round); }}
            onClose={closeFind}
          />
          {showEmpty ? (
            /* 空屏（P2-1）：品牌字标 → 问候 → 项目 chip →（输入区居中枢位见 zone-composer）→ 建议行。
               错误/提示条在这里也渲染：新建项目与预览的失败发生在"还没有会话"时，
               以前这条路径不显示 strips ⇒ 用户点了创建却看不到失败原因。 */
            <div className="zone-stream">
              <div>
                {lastError !== null && (
                <ErrorStrip
                  message={lastError}
                  onDismiss={clearLastError}
                  {...(activeId !== null ? { onViewLog: () => { setLogTarget(activeId); } } : {})}
                />
              )}
                {lastNotice !== null && <NoticeStrip message={lastNotice} onDismiss={clearLastNotice} />}
                {/* 未配置模型服务的空屏横幅（2026-10-18）：发送前就说清楚，别等错误行。 */}
                {providerOk === false && (
                  <ProviderBanner onOpenSettings={() => { setSettingsSection("provider"); setSettingsOpen(true); }} />
                )}
                {importDiagnosis !== null && (
                  <ImportDiagnosisCard
                    name={importDiagnosis.name}
                    diagnosis={importDiagnosis.diagnosis}
                    onDismiss={() => { setImportDiagnosis(null); }}
                  />
                )}
              </div>
              {/* 弹层开着时给 hero 打 data-picking：问候语淡出让焦点（弹层向上开会压到问候线，2026-10-24）。 */}
              <div className="empty" {...(chipOpen ? { "data-picking": "true" } : {})}>
                {/* 2026-10-18 对照 Claude 桌面端：hero 不是「字标 + 问候」两行，而是珊瑚星标与
                    问候同一行、衬线大字（Claude 的「✳ You're here!」）。品牌名仍在窗口顶栏，
                    这里不再叠一个 CAIRN 字标。 */}
                <h1 className="empty-greet" data-dsh-claude-part="hero-headline" data-dsh-claude-holds="hero-mark">
                  <CairnMark className="empty-greet-mark" />
                  <span><span className="empty-greet-period">{greeting}，</span>{STR.empty.greetingAsk}</span>
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
                  <Popover
                    open={chipOpen}
                    up
                    className="chip-pop"
                    aria-label={STR.empty.projectsLabel}
                    onKeyDown={(e) => {
                      const items = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>(".chip-list .menu-item:not(:disabled)"));
                      if (items.length === 0) return;
                      const current = items.indexOf(document.activeElement as HTMLButtonElement);
                      // 焦点还在搜索框时，Home/End 归光标（别抢输入法/文本编辑的键）；只放行 ↑↓。
                      if (current < 0 && e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
                      const next = menuNavIndex(e.key, current, items.length);
                      if (next === null) return;
                      e.preventDefault();
                      items[next]?.focus();
                    }}
                  >
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
                            {/* 最近项目的 name 可能为空（只剩 path）；空名在弹层里会显示成一行空白，
                                回落到路径 basename，与侧栏/项目 chip 的显示口径一致。 */}
                            <span>{p.name || p.path.slice(p.path.lastIndexOf("/") + 1)}</span>
                            <span className="sub">{p.path}</span>
                            {p.path === activeWorkspace && <Check size={12} className="mi-check" aria-hidden="true" />}
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
              {lastNotice !== null && <NoticeStrip message={lastNotice} onDismiss={clearLastNotice} />}
              {importDiagnosis !== null && (
                <ImportDiagnosisCard
                  name={importDiagnosis.name}
                  diagnosis={importDiagnosis.diagnosis}
                  onDismiss={() => { setImportDiagnosis(null); }}
                />
              )}
              <div className="stream" id="stream" ref={setStreamEl}>
                <div className="reading" id="reading">
                  <div className="stream-fade-top" data-on={!stick.atTop} aria-hidden="true" />
                  <Suspense fallback={null}>
                    <Stream
                      // 切会话重挂（2026-10-18）：行内局部状态（工具展开/思考折叠/审批卡展开）
                      // 不能跨会话复用——真机 A 展开 read_file 后切 B，B 的第一条工具行也展开；
                      // 只给行 key 加前缀会让 React 留下旧行（实测 31→57 并出现重复 event id），
                      // 重挂 Stream 本体是可靠边界（.stream 滚动容器与 sticky 观察对象都不动）。
                      key={activeId ?? "home"}
                      rows={streamRows}
                      refs={rowRefs}
                      inherited={inheritedSeqs}
                      view={viewMode}
                      streaming={runningActive || pendingSession}
                      waiting={deps.modelWaiting === true || pendingSession}
                      foldedRounds={foldedRounds}
                      flashRound={flashRound}
                      actions={streamActions}
                    />
                  </Suspense>
                  {/* 交付摘要卡（批 3）：有交付的轮各一张，流尾展示；空轮不出内容（2026-10-24 弱行撤下）。
                      2026-10-18 业主截图批：默认只渲染最新一张卡；早期记录收进一行「查看早期交付」，
                      展开状态按会话记（deliveryExpandedFor），切走再回来不会又铺开。 */}
                  {(() => {
                    const lastIdx = deliveryTrailItems.length - 1;
                    const tailItems = lastIdx >= 0 ? deliveryTrailItems.slice(lastIdx) : [];
                    const olderItems = lastIdx >= 0 ? deliveryTrailItems.slice(0, lastIdx) : [];
                    const showEarlier = activeId !== null && deliveryExpandedFor === activeId;
                    const renderItem = (item: (typeof deliveryTrailItems)[number]): React.ReactNode => (
                      <ChangeSummaryCard
                        key={`d${String(item.delivery.round)}`}
                        delivery={item.delivery}
                        // DSH ChangedFiles 的「块头/行打开本轮 review」= Cairn 的「变更」窗格。
                        onOpenChanges={(path) => {
                          changesFocusSeq.current += 1;
                          const file = item.delivery.files.find((f) => f.path === path);
                          setChangesFocus({ round: item.delivery.round, path, snapshotId: file?.snapshotId, seq: changesFocusSeq.current });
                          openToolbarPane("changes");
                        }}
                      />
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
                              : `查看早期交付（${String(olderItems.length)} 张卡）`}
                          </button>
                        )}
                        {showEarlier && olderItems.map(renderItem)}
                        {tailItems.map(renderItem)}
                      </>
                    );
                  })()}
                </div>
              </div>
              <div className="stream-fade-bottom" data-on={!stick.stuck} aria-hidden="true" />
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
            {editCtx !== null && activeId === editCtx.forkId && activeWorkspace === editCtx.workspace && (
              <div className="notice-strip" role="status">
                <span className="msg">正在新分支里编辑第 {editCtx.round} 轮消息；原会话「{editCtx.originTitle}」不动。</span>
                <button
                  className="btn-ghost"
                  onClick={() => {
                    const ctx = editCtx;
                    if (ctx === null || activeWorkspaceRef.current !== ctx.workspace) return;
                    // 2026-10-20 真机：旧实现只 activate(originId)，只换标题不载入原会话转录——
                    // 回到原会话后屏上是空流（rows=0）。必须走 openSession 重新载入。
                    const emptyBranch = activeIdRef.current === ctx.forkId
                      && events.length === 0
                      && (sendQueue.current.get(runKey(activeWorkspace, ctx.forkId))?.length ?? 0) === 0;
                    setEditCtx(null);
                    openSession(ctx.originId, ctx.workspace ?? undefined);
                    // 第 1 轮编辑建的空分支：回到原会话即无内容，顺手清掉，别留 0 字节会话。
                    // 删除与 openSession 谁先落都收敛到 origin（openSession 会写 currentSession）。
                    if (emptyBranch) {
                      // 删之前先把**用户还没发出去的编辑稿**搬到 origin（2026-10-20 独立评审追出，
                      // LOW-MEDIUM）：那份稿存在空分支的草稿键下 ⇒ 删会话不删草稿 ⇒ 稿子变孤儿
                      // （那条会话没了，谁也读不到它）⇒ 用户以为写的字还在，其实没了。
                      // 走**既有的草稿搬家通道**（draftRemap）：Composer 那侧是草稿桶的**唯一写手**，
                      // 另起一条直写 localStorage 的路会被它的内存桶盖回去（等于没搬）。
                      setDraftRemap({ from: ctx.forkId, to: ctx.originId, seq: ++draftRemapSeq.current });
                      void window.agent.deleteSession(ctx.forkId, ctx.workspace ?? undefined).then(() => { void refreshSessions(); }, (err: unknown) => {
                        setLastError(`空分支清理失败：${err instanceof Error ? err.message : String(err)}`, ctx.originId);
                      });
                    }
                  }}
                >回到原会话</button>
              </div>
            )}
            {activeId !== null && (
              <QueueDock
                activeId={activeId} activeWorkspace={activeWorkspace} queue={sendQueue} running={runningActive}
                queueLoading={queueLoading || deps.sessionLoadError !== null} pendingSend={pendingSend} pendingClarify={pendingClarify} pendingPlan={pendingPlan}
                queueSaving={deps.queueSaving} queueSaveFailed={deps.queueSaveFailed}
                setQueueFor={setQueueFor} cancelRunHeal={cancelRunHeal} resumeQueueFor={resumeQueueFor}
              />
            )}
            {activeId !== null && (
              <BackgroundCommands key={runKey(activeWorkspace, activeId)} sessionId={activeId} workspace={activeWorkspace ?? undefined} />
            )}
            {activeId !== null && <SessionLoadNotice loading={queueLoading} error={deps.sessionLoadError} onRetry={deps.retrySessionOpen} />}
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
              events={events}
              phaseLabel={phaseLabel}
              phase={phase}
              elapsedSec={elapsedSec}
              steps={steps}
              runSteps={runSteps}
              {...(chosenCtx !== undefined ? { ctxWindow: chosenCtx } : {})}
              workspacePath={activeWorkspace}
              recentRefs={activeId !== null ? recentRefsBySession.current.get(activeId) ?? [] : []}
              onReferenceAdded={noteRecentRef}
              promptHistory={promptHistory}
              onDraftPresence={noteDraft}
              injectedText={injectedText}
              injectedTextSeq={injectedTextSeq}
              draftRemap={draftRemap}
              {...(draftRestore !== undefined ? { restoreDraft: draftRestore } : {})}
              onSend={(t, attachments, forceQueue) => { sendWithGoal(t, attachments, forceQueue ?? false); }}
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
              thinking={composerThinking(activeId, pendingThinking, thinkingBySession.current, activeWorkspace)}
              onThinkingChange={(level) => {
                const change = thinkingChangeTarget(activeId, level);
                if (change === null) return; // 非法档位不猜、不夹紧
                if (change.kind === "pending") { setPendingThinking(change.level); return; }
                thinkingBySession.current.set(runKey(activeWorkspace, change.sessionId), change.level);
                force((n) => n + 1);
                // v35：会话级思考档落 sidecar（重启/切回仍生效）。
                void saveSessionPrefs(change.sessionId, { thinking: change.level }, activeWorkspace ?? undefined).catch((err: unknown) => {
                  setLastError(`会话思考档保存失败：${err instanceof Error ? err.message : String(err)}`);
                });
              }}
              onModelChange={(registryId) => applySessionModelPick({
                activeId, activeWorkspace, registryId, selections, force, providerInfo, refreshProviderInfo, setLastError,
              })}
              onOpenSettings={() => setSettingsOpen(true)}
              modelSessionOverride={activeId !== null && selections.current.has(runKey(activeWorkspace, activeId))}
              onCompact={() => { compactNow(); }}
              menuSignal={composerMenuSignal}
              onSuggestNext={onSuggestNext}
              injectedAttachment={injectedAttachment}
              injectedElement={injectedElement}
            />
          </div>
          {showEmpty && (
            /* 空屏下半区（P2-1）：建议行（点击=填入输入框不发送）；
               .empty-tail 是 .main 的直接弹性子女——把整组构图托到视觉中心偏上。 */
            <>
              <QuickStarts
                items={emptyData?.quickStarts ?? []}
                firstRunSub={STR.empty.firstRunSub}
                onPick={(t) => { injectText(t); }}
              />
              <div className="empty-tail" aria-hidden="true" />
            </>
          )}
        </main>
          </Panel>
          {/* P3-2 右侧检查器（brief 七）：常驻 Panel、默认收起（collapsible + collapsedSize 0；
              ⌘⌥I 开合 / 打开窗格自动露出 / 边沿拖出）。宽 320–420（defaultSize 360）。
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
                  正在做的宽度收起动画一刀砍掉，⌘⌥I 开合退化成硬切；
                · inert 同样把内部控件移出 Tab 序与无障碍树（屏外不劫持键盘、不被读屏念到），
                  但保留布局，宽度过渡照常播完。
                实现走 setAttribute（同 ModalSurface 的 imperative 口径）：@types/react 18.3
                的 HTMLAttributes 还没有 inert 这个 prop，写成 JSX 属性会直接编译红。
                收起瞬间若仍能 Tab 进检查器，是因为过渡还在跑（width > 0）——此刻控件在屏上，
                可聚焦是正确的；inert 在宽度归 0 的那一刻由 onResize 置上。 */}
            {/* 单窗格占满侧栏（2026-10-24 业主）：开着窗格 → 栏内检查器内容让位（CSS 隐藏 .isp），
                  窗格独占整条侧栏；全关 → 检查器内容回位。⌘⌥I 的整栏开合不受影响。 */}
            <div className="inspector-col" ref={inspectorColRef} {...(paneTabs.length > 0 ? { "data-panes-open": "true" } : {})}>
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
                      {...(paneTarget !== null ? { paneTarget } : {})}
                      {...(changesFocus !== null ? { changesFocus } : {})}
                      events={events}
                      sessionId={activeId}
                      workspace={activeWorkspace}
                      {...(fileTarget !== null ? { fileTarget } : {})}
                      {...(sessionPreview !== null ? { sessionPreview } : {})}
                      onSwitchSession={(id, workspace) => {
                        openSession(id, workspace);
                        // 切过去后主体与预览是同一场会话：留一块只读副本既占宽又像故障。
                        // 预览是「看一眼」的临时面，切走即收。
                        setSessionPreview(null);
                        closePane("session");
                      }}
                      {...(sessionPreview !== null
                        ? {
                            onSessionPreviewSend: (text: string, running: boolean) =>
                              sendTo(sessionPreview.id, sessionPreview.workspace ?? activeWorkspace, text, [], { running }),
                            onSessionPreviewStop: () =>
                              cancelRunHeal(sessionPreview.id, sessionPreview.workspace ?? activeWorkspace),
                            onSessionPreviewResume: () =>
                              resumeQueueFor(sessionPreview.id, sessionPreview.workspace ?? activeWorkspace),
                          }
                        : {})}
                      onAttach={attachFromPane}
                      pickSignal={pickSignal}
                      onPickResult={handlePickResult}
                      {...(preview !== null && preview.status === "ready" && preview.url !== undefined ? { browserUrl: preview.url } : {})}
                      {...(browserLinkTarget !== null ? { browserLinkTarget } : {})}
                      browserVisible={destination === "chat" && !settingsOpen && !inspectorCollapsed}
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
        </DestinationWorkspace>
        {destination === "chat" && pluginSidebarOpen && <PluginSidebar width={pluginSidebarWidth} onWidth={setPluginSidebarWidthPersist} onClose={closePluginSidebar} onInvoke={fillPluginCommand} />}
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
      {/* 五张确认闸（回滚轮次 / 移除项目 / 归档 / 删除会话 / 丢弃隔离工作区）
          搬进 panes/ConfirmScrims.tsx（Phase 2 · 批 2.4）：props 进、事件出，本体不碰状态。 */}
      <ConfirmScrims
        revertConfirm={revertConfirm}
        setRevertConfirm={setRevertConfirm}
        doRevertTurn={doRevertTurn}
        projectRemoveConfirm={projectRemoveConfirm}
        setProjectRemoveConfirm={setProjectRemoveConfirm}
        doRemoveProject={doRemoveProject}
        archiveConfirm={archiveConfirm}
        setArchiveConfirm={setArchiveConfirm}
        doArchiveSession={doArchiveSession}
        deleteConfirm={deleteConfirm}
        setDeleteConfirm={setDeleteConfirm}
        doDeleteSession={doDeleteSession}
        wtDiscard={wtDiscard}
        setWtDiscard={setWtDiscard}
        sessionWorktreeOp={sessionWorktreeOp}
        permissionGuard={permissionGuard}
      />
      {/* 命令面板（P3-3 · brief 八）：⌘K / 侧栏搜索钮；数据全从 App 拿（技能组已接同一条 skills 数据面）。 */}
      {paletteOpen && (
        <Suspense fallback={null}>
          <CommandPalette
            activeWorkspace={activeWorkspace}
            open
            onClose={() => { setPaletteOpen(false); focusComposer(); }}
            sessions={sessions}
            projects={projects.map((p) => ({ id: p.id, name: p.name, path: p.path }))}
            onOpenSession={(id, workspace) => { setPaletteOpen(false); openSession(id, workspace); }}
            onSwitchWorkspace={(path) => {
              setPaletteOpen(false);
              setActiveWorkspace(path);
              activeWorkspaceRef.current = path;
              touchWorkspace(path);
              // 切项目 = 切到该项目的空聊天面：旧 activeId 留在原项目，继续发送会把同一
              // sessionId 写进新工作区（2026-11-05 审计确认的数据串写）。
              newSession();
            }}
            onOpenSettings={(section) => { setPaletteOpen(false); setSettingsSection(section); setSettingsOpen(true); }}
            onOpenDestination={(next) => { setPaletteOpen(false); openDestination(next); }}
            onOpenFile={(path) => {
              setPaletteOpen(false);
              openPane("file");
              setFileTarget((prev) => ({ path, seq: (prev?.seq ?? 0) + 1 }));
              focusComposer();
            }}
            onAction={(action) => { setPaletteOpen(false); handlePaletteAction(action); }}
            skills={skills}
            onUseSkill={(invoke) => {
              // 与斜杠菜单同一落点：只填入、不发送；injectText 会覆盖草稿并聚焦输入框。
              setPaletteOpen(false);
              const trimmed = invoke.trim();
              injectText(`${trimmed.endsWith(" ") ? trimmed : trimmed + " "}`);
            }}
            activeSessionId={activeId}
            onSessionAction={(action, id) => {
              setPaletteOpen(false);
              const target = sessions.find((s) => s.id === id && s.workspace === activeWorkspace);
              if (target === undefined) { toast.error("会话已不存在"); return; }
              if (action === "rename") startBarRename();
              else if (action === "archive") requestArchiveSession(target, target.archived !== true);
              else requestDeleteSession(target);
            }}
          />
        </Suspense>
      )}
      {logTarget !== null && (
        <SessionLogDialog
          id={logTarget}
          title={sessions.find((s) => s.id === logTarget)?.title ?? logTarget}
          onClose={() => { setLogTarget(null); }}
        />
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
          templates={[...templates, { id: "blank", name: STR.newProject.blankName, description: STR.newProject.blankDesc }]}
          existingNames={projects.map((p) => p.name)}
          onClose={() => { setNewProjectOpen(false); }}
          onPickDirectory={() => window.agent.pickDirectory()}
          onCreate={handleCreateFromDialog}
        />
      )}
    </div>
  );
}
