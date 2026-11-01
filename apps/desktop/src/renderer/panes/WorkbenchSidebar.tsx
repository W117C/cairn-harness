import type { ComponentProps, KeyboardEvent, PointerEvent } from "react";
import type { AppDestination } from "../app-controls";
import { AppRail } from "../components/AppRail";
import { PageContextSidebar } from "../components/PageContextSidebar";
import { Sidebar } from "../components/Sidebar";
import { SidebarRail } from "../components/SidebarRail";
import type { PageFilterItem } from "../navigation";
import { SIDEBAR_DEFAULT, SIDEBAR_MAX, SIDEBAR_MIN } from "../state/chrome";

export interface WorkbenchSidebarProps {
  destination: AppDestination;
  sidebarCollapsed: boolean;
  focusMode: boolean;
  sidebarWidth: number;
  chatSidebar: ComponentProps<typeof Sidebar>;
  badges?: Partial<Record<AppDestination, number>>;
  pageItems: readonly PageFilterItem[];
  activeFilter: string;
  onFilter: (filter: string) => void;
  onOpenDestination: (destination: AppDestination) => void;
  onSettings: () => void;
  onNewTask: () => void;
  onSearch: () => void;
  onFiles: () => void;
  onTerminal: () => void;
  onStartResize: (event: PointerEvent<HTMLDivElement>) => void;
  onPersistWidth: (width: number) => void;
  onKeyResize: (event: KeyboardEvent<HTMLDivElement>) => void;
}

export function WorkbenchSidebar(props: WorkbenchSidebarProps): React.JSX.Element {
  return (
    <div className="workbench-sidebar" data-destination={props.destination}>
      <AppRail
        destination={props.destination}
        badges={props.badges}
        onOpen={props.onOpenDestination}
        onSettings={props.onSettings}
        {...(!props.focusMode && props.destination === "chat"
          ? {
              actions: (
                <SidebarRail
                  onNewTask={props.onNewTask}
                  onSearch={props.onSearch}
                  onFiles={props.onFiles}
                  onTerminal={props.onTerminal}
                />
              ),
            }
          : {})}
      />
      {!props.focusMode && props.destination === "chat" && !props.sidebarCollapsed && (
        <div
          className="side-wrap"
          data-dsh-claude-part="sidebar-column"
          style={{ width: props.sidebarWidth }}
        >
          <Sidebar {...props.chatSidebar} />
          <div
            className="side-handle"
            role="separator"
            aria-orientation="vertical"
            aria-label={`调整侧栏宽度（${SIDEBAR_MIN}–${SIDEBAR_MAX}px）`}
            aria-valuemin={SIDEBAR_MIN}
            aria-valuemax={SIDEBAR_MAX}
            aria-valuenow={props.sidebarWidth}
            title={`拖动调整侧栏宽度；双击回到 ${SIDEBAR_DEFAULT}px`}
            tabIndex={0}
            onPointerDown={props.onStartResize}
            onDoubleClick={() => { props.onPersistWidth(SIDEBAR_DEFAULT); }}
            onKeyDown={props.onKeyResize}
          />
        </div>
      )}
      {!props.focusMode && props.destination !== "chat" && !props.sidebarCollapsed && (
        <PageContextSidebar
          destination={props.destination}
          items={props.pageItems}
          activeFilter={props.activeFilter}
          onFilter={props.onFilter}
        />
      )}
    </div>
  );
}
