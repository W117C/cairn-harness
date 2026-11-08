import { isCompositionEnter } from "../ime";
import type { Dispatch,MutableRefObject,SetStateAction } from 'react';
// renderAppToolbar: extracted without changing event or callback behavior.
import { Folder,List } from "lucide-react";
import type { PointerEvent } from "react";
import { type PanelImperativeHandle } from "react-resizable-panels";
import type { GoalTrace } from "../../../../../src/agent/goal-trace";
import type { ClarifyQuestion,PlanProposal } from "../../../../../src/events";
import type { AgentEvent,AskPayload,ProjectDiagnosis,ProjectRecord,ProviderInfo,RunAttachmentReference,SuggestNextResult } from "../../../../../src/main/ipc-protocol";
import type { PreviewSnapshot } from "../../../../../src/main/project-preview";
import type { TextSizeSetting,UiSizeSetting } from "../../../../../src/main/settings";
import type { PaletteAction } from "../components/CommandPalette";
import { type FindBarHandle } from "../components/FindBar";
import { GoalChip } from "../components/GoalChip";
import { CairnMark } from "../components/CairnMark";
import { WorkbenchTools } from "../components/WorkbenchTools";
import type { StreamActions } from "../components/Stream";
import { PANE_META,PANE_OPENABLE,type PaneKind } from "../components/panes";
import type { SectionId } from "../components/settings-nav";
import { writeDismissedGoals } from "../goal-dismiss";
import { paneShortcutKeys } from "../pane-shortcuts";
import { WorkStatusPill } from "../components/WorkStatusPanel";
import type { TodoProjection } from "../derived/todo";
import type { DeliveryTrailItem,RunPhase,StreamRow,UsageSummary } from "../projections";
import { type QuickStartInput } from "../quick-starts";
import type { ComposerLockReason } from "../send-queue";
import { type QueuedSend } from "../send-queue";
import type { WorkspaceSession } from "../sessions-view";
import type { SlashSkill } from "../slash";
import { STR } from "../strings";
import { runKey } from "../state/session-identity";
import { type ThemePref } from "../theme";
import type { StickyScroll } from "../useStickyScroll";
import { type ViewMode } from "../view-mode";
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

interface AppToolbarProps {
  settingsOpen: boolean;
  activeId: string | null;
  activeWorkspace: string | null;
  activeProjectLabel: string | null;
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
  onOpenPane: (kind: PaneKind) => void;
  inspectorOpen: boolean;
  onToggleInspector: () => void;
  fileCount: number;
  pluginSidebarOpen: boolean;
  togglePluginSidebar: () => void;
  focusMode: boolean;
  toggleFocusMode: () => void;
  /** demo provider：标题栏常驻「演示模式」小胶囊，点开模型设置。 */
  demo?: boolean;
  onOpenProviderSettings?: () => void;
  /** 工作状态面板（2026-11-04 截图右上角）：运行读数 + todo_write 清单。 */
  running?: boolean;
  phaseLabel?: string;
  elapsedSec?: number;
  runSteps?: number;
  todos?: TodoProjection | null;
}

export function renderAppToolbar(deps: AppToolbarProps) {
  const { settingsOpen, activeId, activeWorkspace, activeProjectLabel, barRenaming, setBarRenaming, sessions, renameSessionById, sessionTitle, goalTrace, dismissedGoals, goalAct, activeIdRef, setDismissedGoals, outlineTurns, outlineOpen, setOutlineOpen, paneTabs, onOpenPane, inspectorOpen, onToggleInspector, fileCount, pluginSidebarOpen, togglePluginSidebar, focusMode, toggleFocusMode, demo, onOpenProviderSettings } = deps;
  const toolbarContext = !settingsOpen && activeId !== null && activeWorkspace !== null && activeProjectLabel !== null ? (
    <span className="tb-workspace" title={activeWorkspace} aria-label={`${STR.composer.workspaceAria}：${activeProjectLabel}`}>
      <Folder size={12} aria-hidden="true" />
      <span className="tb-workspace-name">{activeProjectLabel}</span>
    </span>
  ) : null;

  // 统一工具栏 · 中栏主体（2026-10-20 批 129）：上下文锚点。
  // 首页无会话 ⇒ 品牌名；会话内 ⇒ 可重命名的会话名。
  // **任何时刻只有一个标题**——批 120/121 的「标题出现两次」争点随两栏合并自然消解。
  const toolbarCenter = activeId === null ? (
    <span className="tb-brand"><CairnMark />Cairn</span>
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
            if (e.key === "Enter" && !isCompositionEnter(e, null)) {
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

  // 右组：对话目录按内容出现，改动直达，其余工具按需打开；窄窗保留文字入口。
  const toolbarRight = !settingsOpen && (
    <>
      {demo === true && (
        <button
          className="tb-demo"
          title={STR.demoBanner.tip}
          aria-label={STR.demoBanner.tip}
          onClick={onOpenProviderSettings}
        >
          <span className="tb-demo-dot" aria-hidden="true" />
          {STR.demoBanner.chip}
        </button>
      )}
      {activeId !== null && (
        <div className="tb-cluster">
          {/* 工作状态 pill（2026-11-04 截图右上角）：当前任务/阶段一行，点开进程面板。 */}
          <WorkStatusPill
            key={runKey(activeWorkspace, activeId)}
            running={deps.running === true}
            phaseLabel={deps.phaseLabel ?? ""}
            elapsedSec={deps.elapsedSec ?? 0}
            steps={deps.runSteps ?? 0}
            todos={deps.todos ?? null}
          />
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
        </div>
      )}
      <WorkbenchTools
        hasSession={activeId !== null}
        paneTabs={paneTabs}
        fileCount={fileCount}
        inspectorOpen={inspectorOpen}
        pluginSidebarOpen={pluginSidebarOpen}
        focusMode={focusMode}
        onOpenPane={onOpenPane}
        onToggleInspector={onToggleInspector}
        onTogglePluginSidebar={togglePluginSidebar}
        onToggleFocusMode={toggleFocusMode}
      />
    </>
  );


  return { toolbarContext, toolbarCenter, toolbarAside, toolbarRight };
}
