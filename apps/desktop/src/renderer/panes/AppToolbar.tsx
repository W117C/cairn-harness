import type { Dispatch,MutableRefObject,SetStateAction } from 'react';
// renderAppToolbar: extracted without changing event or callback behavior.
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Blocks,FileDiff,Focus,Folder,Globe,List,MoreHorizontal,Terminal } from "lucide-react";
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
import type { StreamActions } from "../components/Stream";
import type { UsageAllState } from "../components/UsagePanel";
import { PANE_META,PANE_OPENABLE,type PaneKind } from "../components/panes";
import type { SectionId } from "../components/settings-nav";
import { writeDismissedGoals } from "../goal-dismiss";
import { paneShortcutKeys } from "../pane-shortcuts";
import type { DeliveryTrailItem,RunPhase,StreamRow,UsageSummary } from "../projections";
import { type QuickStartInput } from "../quick-starts";
import type { ComposerLockReason } from "../send-queue";
import { type QueuedSend } from "../send-queue";
import type { WorkspaceSession } from "../sessions-view";
import type { SlashSkill } from "../slash";
import { STR } from "../strings";
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
  togglePane: (kind: PaneKind) => void;
  fileCount: number;
  pluginSidebarOpen: boolean;
  togglePluginSidebar: () => void;
  focusMode: boolean;
  toggleFocusMode: () => void;
}

export function renderAppToolbar(deps: AppToolbarProps) {
  const { settingsOpen, activeId, activeWorkspace, activeProjectLabel, barRenaming, setBarRenaming, sessions, renameSessionById, sessionTitle, goalTrace, dismissedGoals, goalAct, activeIdRef, setDismissedGoals, outlineTurns, outlineOpen, setOutlineOpen, paneTabs, togglePane, fileCount, pluginSidebarOpen, togglePluginSidebar, focusMode, toggleFocusMode } = deps;
  const toolbarContext = !settingsOpen && activeId !== null && activeWorkspace !== null && activeProjectLabel !== null ? (
    <span className="tb-workspace" title={activeWorkspace} aria-label={`${STR.composer.workspaceAria}：${activeProjectLabel}`}>
      <Folder size={12} aria-hidden="true" />
      <span className="tb-workspace-name">{activeProjectLabel}</span>
      <span className="tb-workspace-tag">{STR.composer.workspaceLocal}</span>
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
        aria-label="插件侧栏"
        aria-controls="mod-sidebar"
        aria-expanded={pluginSidebarOpen}
        data-on={pluginSidebarOpen}
        title="插件侧栏（⌘⌥B）"
        onClick={togglePluginSidebar}
      >
        <Blocks size={14} />
      </button>
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


  return { toolbarContext, toolbarCenter, toolbarAside, toolbarRight };
}
