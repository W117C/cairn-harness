// 面板层 · 工作台全局浮层（快捷键速查 / 确认闸 / 命令面板 / 会话日志 / 设置面板 / 拖放蒙层 / 新建项目）。
//
// 分层契约（见 src/renderer/LAYERING.md）：
//   · 本层只吃 props、只吐事件；
//   · 本层不 import App.tsx（I1）。
import { lazy, Suspense, useMemo, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { FolderPlus, X } from "lucide-react";
import type { PermissionMode, ProjectRecord } from "../../../../../src/main/ipc-protocol";
import type { TextSizeSetting, UiSizeSetting } from "../../../../../src/main/settings";
import type { AppDestination, SectionId } from "../app-controls";
import type { PaletteAction } from "../components/CommandPalette";
import { ModalSurface } from "../components/ModalSurface";
import { NewProjectDialog } from "../components/NewProjectDialog";
import { MODE_LABEL } from "../components/PermissionMenu";
import { SessionLogDialog } from "../components/SessionLogDialog";
import type { PaneKind } from "../components/panes";
import type { DeleteConfirmTarget, SessionConfirmTarget, WorkspaceSession } from "../sessions-view";
import { SHORTCUT_GROUPS } from "../shortcuts";
import type { SlashSkill } from "../slash";
import type { RevertTurnTarget } from "../state/message-actions";
import type { PermissionConfirmApi } from "../state/use-permission-confirm";
import { STR } from "../strings";
import { readOrError } from "../read-result";
import type { ThemePref } from "../theme";
import { toast } from "../toast";
import { ConfirmScrims } from "./ConfirmScrims";

const CommandPalette = lazy(() => import("../components/CommandPalette").then((m) => ({ default: m.CommandPalette })));
const SettingsPanel = lazy(() => import("../components/SettingsPanel").then((m) => ({ default: m.SettingsPanel })));

export interface WorkbenchOverlaysProps {
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
  setWtDiscard: Dispatch<SetStateAction<WorkspaceSession | null>>;
  sessionWorktreeOp: (kind: "create" | "merge" | "discard", s: WorkspaceSession) => Promise<void>;
  permissionGuard: PermissionConfirmApi;
  paletteOpen: boolean;
  setPaletteOpen: Dispatch<SetStateAction<boolean>>;
  activeWorkspace: string | null;
  focusComposer: () => void;
  sessions: WorkspaceSession[];
  projects: ProjectRecord[];
  openSession: (id: string, workspace?: string | undefined) => void;
  setActiveWorkspace: Dispatch<SetStateAction<string | null>>;
  activeWorkspaceRef: MutableRefObject<string | null>;
  touchWorkspace: (path: string | null) => void;
  newSession: () => void;
  setSettingsSection: Dispatch<SetStateAction<SectionId | undefined>>;
  setSettingsOpen: Dispatch<SetStateAction<boolean>>;
  openDestination: (destination: AppDestination) => void;
  openPane: (kind: PaneKind) => void;
  setFileTarget: Dispatch<SetStateAction<{ path: string; seq: number } | null>>;
  handlePaletteAction: (action: PaletteAction) => void;
  skills: readonly SlashSkill[];
  injectText: (text: string) => void;
  activeId: string | null;
  startBarRename: () => boolean;
  requestArchiveSession: (s: WorkspaceSession, archived: boolean) => void;
  requestDeleteSession: (s: WorkspaceSession) => void;
  logTarget: string | null;
  setLogTarget: Dispatch<SetStateAction<string | null>>;
  settingsOpen: boolean;
  settingsSection: SectionId | undefined;
  refreshProviderInfo: () => Promise<void>;
  refreshProviderKeys: () => Promise<void>;
  mode: PermissionMode;
  setMode: Dispatch<SetStateAction<PermissionMode>>;
  setLastNotice: (message: string, sessionId?: string | undefined) => void;
  setThemePref: Dispatch<SetStateAction<ThemePref>>;
  setTextSize: Dispatch<SetStateAction<TextSizeSetting>>;
  setUiSize: Dispatch<SetStateAction<UiSizeSetting>>;
  setCtrlTabCycle: Dispatch<SetStateAction<boolean>>;
  dragOverApp: boolean;
  newProjectOpen: boolean;
  setNewProjectOpen: Dispatch<SetStateAction<boolean>>;
  templates: { id: string; name: string; description: string; runKind: "static" | "vite" }[];
  handleCreateFromDialog: (input: { name: string; templateId: string; parentDir?: string | undefined }) => Promise<void>;
}

export function WorkbenchOverlays(props: WorkbenchOverlaysProps): React.JSX.Element {
  const {
    cheatOpen, closeCheat,
    revertConfirm, setRevertConfirm, doRevertTurn,
    projectRemoveConfirm, setProjectRemoveConfirm, doRemoveProject,
    archiveConfirm, setArchiveConfirm, doArchiveSession,
    deleteConfirm, setDeleteConfirm, doDeleteSession,
    wtDiscard, setWtDiscard, sessionWorktreeOp, permissionGuard,
    paletteOpen, setPaletteOpen, activeWorkspace, focusComposer,
    sessions, projects, openSession, setActiveWorkspace, activeWorkspaceRef,
    touchWorkspace, newSession, setSettingsSection, setSettingsOpen,
    openDestination, openPane, setFileTarget, handlePaletteAction,
    skills, injectText, activeId, startBarRename,
    requestArchiveSession, requestDeleteSession,
    logTarget, setLogTarget,
    settingsOpen, settingsSection, refreshProviderInfo, refreshProviderKeys,
    mode, setMode, setLastNotice, setThemePref, setTextSize, setUiSize, setCtrlTabCycle,
    dragOverApp, newProjectOpen, setNewProjectOpen, templates, handleCreateFromDialog,
  } = props;

  // 第 1155 页：会话日志标题按 sessions/logTarget 记忆；打开日志时的流式事件不重扫会话表。
  const logTitle = useMemo(() => logTarget === null ? "" : sessions.find((s) => s.id === logTarget)?.title ?? logTarget, [sessions, logTarget]);
  // 第 1179 页：命令面板项目行按 projects 记忆；浮层局部状态变化不再给面板换一份新数组。
  const paletteProjects = useMemo(() => projects.map((p) => ({ id: p.id, name: p.name, path: p.path })), [projects]);
  return (
    <>
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
            projects={paletteProjects}
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
          title={logTitle}
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
              void readOrError(() => window.agent.getSettings()).then((r) => {
                if (!r.ok) {
                  setLastNotice(STR.settingsPanel.liveRefreshFailedPrefix + r.error);
                  return;
                }
                const s = r.value;
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
              });
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
    </>
  );
}
