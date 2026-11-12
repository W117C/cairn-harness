import type { ComponentProps, KeyboardEvent, PointerEvent } from "react";
import type { AppDestination } from "../app-controls";
import type { AccountMenuProps } from "../components/AccountMenu";
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
  /** chat 上下文列（品牌 brandline 所在）此刻是否可见：与工具栏补位共用 WorkbenchView 的单一判据。 */
  showChatSidebar: boolean;
  sidebarWidth: number;
  chatSidebar: ComponentProps<typeof Sidebar>;
  badges?: Partial<Record<AppDestination, number>>;
  pageItems: readonly PageFilterItem[];
  activeFilter: string;
  onFilter: (filter: string) => void;
  onOpenDestination: (destination: AppDestination) => void;
  onSettings: () => void;
  /** 底部头像菜单的完整配置（设置/外观/用量/关于）。缺省时只给一个「设置」入口，
   *  让纯导航/单元测试面不必构造整套回调。 */
  account?: AccountMenuProps;
  onNewTask: () => void;
  onSearch: () => void;
  onFiles: () => void;
  onTerminal: () => void;
  onStartResize: (event: PointerEvent<HTMLDivElement>) => void;
  onPersistWidth: (width: number) => void;
  onKeyResize: (event: KeyboardEvent<HTMLDivElement>) => void;
}

export function WorkbenchSidebar(props: WorkbenchSidebarProps): React.JSX.Element {
  // 2026-11-03 业主：账户/设置入口只留全局轨底部那一个（头像图标），侧栏页脚已删除。
  // 展开 / 收起 / 专注 / 任意目的地都渲染同一份，避免"某个状态下入口消失"。
  return (
    <div className="workbench-sidebar" data-destination={props.destination}>
      <AppRail
        destination={props.destination}
        badges={props.badges}
        onOpen={props.onOpenDestination}
        account={props.account ?? { onOpenSettings: props.onSettings }}
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
      {props.showChatSidebar && (
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
