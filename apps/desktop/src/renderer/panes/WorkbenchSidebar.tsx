// 单栏宿主（ADR 0019 1:1 复刻 P3 第一刀；官方首屏真机对照 2026-11-19，official-home.png）：
// 左栏 = **一列**——顶部全局行族（AppRail）→ 中段会话列表（chat）或目的地筛选（页面）→
// 底部账户入口（AccountMenu）。窄图标轨（48px 目的地列）下架，会话列吃满栏宽。
//
// 收起（⌘B）= 整列 CSS 隐藏（width 0 + visibility 延迟，与窄窗 760 断点同一套手感），
// 列保持挂载让收/开有过渡；专注模式 = 整列卸载（官方一致：专注没有左栏）。
// 旧的 rail-context（收起态快捷入口）随轨消失：新建/搜索由行承担，文件/终端窗格
// 由工具栏「工具」菜单承担（SidebarRail 已删）。
import { useState, type ComponentProps, type KeyboardEvent, type PointerEvent } from "react";
import type { AppDestination } from "../app-controls";
import type { AccountMenuProps } from "../components/AccountMenu";
import { AccountMenu } from "../components/AccountMenu";
import { AppRail } from "../components/AppRail";
import { PageContextSidebar } from "../components/PageContextSidebar";
import { Sidebar } from "../components/Sidebar";
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
  /** 底部头像菜单的完整配置（设置/外观/用量/关于）。缺省时只给一个「设置」入口，
   *  让纯导航/单元测试面不必构造整套回调。 */
  account?: AccountMenuProps;
  onNewTask: () => void;
  onStartResize: (event: PointerEvent<HTMLDivElement>) => void;
  onPersistWidth: (width: number) => void;
  onKeyResize: (event: KeyboardEvent<HTMLDivElement>) => void;
}

export function WorkbenchSidebar(props: WorkbenchSidebarProps): React.JSX.Element {
  // 侧栏会话搜索的受控态归单栏宿主：行族的「搜索」行是开关，输入行在会话列内。
  const [searchExpanded, setSearchExpanded] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const searchOpen = searchExpanded || searchQuery.trim() !== "";
  const toggleSearch = (): void => {
    if (searchOpen && searchQuery.trim() === "") { setSearchExpanded(false); return; }
    setSearchExpanded(true);
  };
  const isChat = props.destination === "chat";
  // 专注模式整列卸载；收起走 CSS（列保持挂载，收/开有宽度过渡）。
  if (props.focusMode) return <div className="workbench-sidebar" data-destination={props.destination} />;
  return (
    <div className="workbench-sidebar" data-destination={props.destination}>
      <div
        className="side-wrap"
        data-destination={props.destination}
        data-dsh-claude-part="sidebar-column"
        style={{ width: props.sidebarWidth }}
      >
        <AppRail
          destination={props.destination}
          badges={props.badges}
          onOpen={props.onOpenDestination}
          onNewTask={props.onNewTask}
          onSettings={props.onSettings}
          searchOpen={searchOpen}
          onToggleSearch={toggleSearch}
        />
        {isChat ? (
          <Sidebar
            {...props.chatSidebar}
            searchExpanded={searchExpanded}
            onSearchExpandedChange={setSearchExpanded}
            searchQuery={searchQuery}
            onSearchQueryChange={setSearchQuery}
          />
        ) : (
          <PageContextSidebar
            destination={props.destination}
            items={props.pageItems}
            activeFilter={props.activeFilter}
            onFilter={props.onFilter}
          />
        )}
        {/* 账户入口钉在单栏底部（官方一致；2026-11-03 业主「设置和偏好挪到左边底下」的语义位）。
            每个目的地 / 收起态都是这一道门——列隐藏时入口随列一起退场（TitleBar ⌘B 展开）。 */}
        <AccountMenu {...(props.account ?? { onOpenSettings: props.onSettings })} />
        {isChat && (
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
        )}
      </div>
    </div>
  );
}
