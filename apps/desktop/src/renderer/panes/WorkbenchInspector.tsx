// 第 1110 页：WorkbenchView 右侧检查器列拆出（Inspector + 条件 PaneDock），
// WorkbenchView 只保留三栏编排；deps 仍是单入口，避免再造一层逐 prop 传递。
import { lazy, Suspense } from "react";
import type { WorkbenchViewDeps } from "./WorkbenchView";
import { Inspector } from "../components/Inspector";
import { movePane, type PaneKind } from "../components/panes";
import type { ChangesFocus } from "../components/ChangesPane";

const PaneDock = lazy(() => import("../components/PaneDock").then((m) => ({ default: m.PaneDock })));

export function WorkbenchInspector({ deps, paneTarget, changesFocus, fileTarget, sessionPreview, setSessionPreview, browserLinkTarget }: {
  deps: WorkbenchViewDeps;
  paneTarget: { kind: PaneKind; seq: number } | null;
  changesFocus: ChangesFocus | null;
  fileTarget: { path: string; seq: number } | null;
  sessionPreview: { id: string; workspace?: string; title: string; seq: number } | null;
  setSessionPreview: React.Dispatch<React.SetStateAction<{ id: string; workspace?: string; title: string; seq: number } | null>>;
  browserLinkTarget: { url: string; seq: number } | null;
}): React.JSX.Element {
  const {
    activeId, events, jumpToEvent, openPane, handleRestoreSnapshot, toggleInspector,
    paneTabs, activeWorkspace,
    openSession, closePane, sendTo, cancelRunHeal, resumeQueueFor,
    attachFromPane, pickSignal, handlePickResult, preview,
    destination, settingsOpen, inspectorCollapsed, setPaneTabs, send, inspectorColRef,
  } = deps;
  return (
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
  );
}
