// 第 1114 页：WorkbenchView 的侧栏宿主拆出（WorkbenchSidebar + chatSidebar 对象 + account 映射）。
// WorkbenchView 只留三栏编排；deps 单入口，本地 show/pageItems/pluginCount/setSessionPreview 显式传入。
import type { Dispatch, SetStateAction } from "react";
import type { PageFilterItem } from "../navigation";
import type { WorkbenchViewDeps } from "./WorkbenchView";
import { WorkbenchSidebar } from "./WorkbenchSidebar";
import { toast } from "../toast";

type SessionPreview = { id: string; workspace?: string; title: string; seq: number };

export function WorkbenchSidebarHost({ deps, chatSidebarVisible, pageItems, pluginUpdateCount, setNewProjectOpen, setSessionPreview }: {
  deps: WorkbenchViewDeps;
  chatSidebarVisible: boolean;
  pageItems: readonly PageFilterItem[];
  pluginUpdateCount: number;
  setNewProjectOpen: (open: boolean) => void;
  setSessionPreview: Dispatch<SetStateAction<SessionPreview | null>>;
}): React.JSX.Element {
  const {
    destination, sidebarCollapsed, focusMode, sidebarWidth,
    projects, sessions, sessionsLoaded, activeId, activeWorkspace, runningSet, waitingIdSet, draftIds, outcomes, registryNotice,
    retryProjects, sessionsLoadError, sessionsLoadErrorDetail, retrySessions, sessionsRefreshing,
    openSession, openPane, newSession, handleOpenPalette, setActiveWorkspace, activeWorkspaceRef, touchWorkspace,
    handleAddProject, handleCloneProject, handleUpdateProject, handleRelocateProject, handleRemoveProject,
    handleRevealProject, renameSessionById, pinSessionById, forkSessionFromMenu, requestArchiveSession,
    openSessionInCli, setWtDiscard, sessionWorktreeOp, requestDeleteSession, refreshSessions,
    pageFilter, setPageFilter, openDestination, setSettingsSection, setSettingsOpen,
    themePref, changeTheme, startSidebarDrag, persistSidebarWidth, sidebarWidthRef,
  } = deps;
  return (
    <WorkbenchSidebar
      destination={destination}
      sidebarCollapsed={sidebarCollapsed}
      focusMode={focusMode}
      showChatSidebar={chatSidebarVisible}
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

  );
}
