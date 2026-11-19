// 全局导航行族（ADR 0019 1:1 复刻 P3 第一刀；官方首屏真机对照 2026-11-19，official-home.png）：
// 左栏单栏化——窄图标轨下架，全局导航改为**会话列顶部的行**（图标+文字，与官方
// New / Search / Routines / Customize 同形制）。官方 4 行 vs 我们 6 行：多出的
// 「技能 / 记忆」两行是自有能力按官方行形制安置（ADR 0019 §4）。
//
// 对位关系：
//   New        = 新任务（chat 不再是目的地行——它就是「新建任务」这一主动作，主行/高亮块）；
//   Search     = 搜索（展开侧栏会话搜索；输入行仍在会话列内，状态归栏宿主 WorkbenchSidebar）；
//   Routines   = 定时任务（automation）；Skills = 技能（plugins）；Memory = 记忆（memory）；
//   Customize  = 自定义（settings 不是 destination，接现有设置入口的同一回调）。
//
// 账户入口不再是本组件的一部分：它钉在单栏**底部**（WorkbenchSidebar 渲染）——官方轮廓
// 「顶部行族 → 项目分组列表 → 底部账户」。rail-context（收起侧栏快捷入口）随轨消失：
// 单栏下收起即整列隐藏（TitleBar ⌘B 承担展开），新建/搜索由行承担，文件/终端窗格
// 由工具栏「工具」菜单承担（与收起轨无关）。
import { Brain, Briefcase, Clock3, Plus, Puzzle, Search, type LucideIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import type { AppDestination, AppPageDestination } from "../app-controls";
import { STR } from "../strings";
import { keysOf, withKeys } from "../shortcuts";

export interface AppRailProps {
  destination: AppDestination;
  onOpen: (destination: AppDestination) => void;
  /** New 行（主行/高亮块，官方 New 同形制）。 */
  onNewTask: () => void;
  /** 自定义行：与 AccountMenu／旧设置入口同一回调（settings 不是 destination）。 */
  onSettings: () => void;
  /** 搜索行的受控展开态（输入行在会话列内）。缺省 = 收起、点击无效（纯导航测试面）。 */
  searchOpen?: boolean;
  onToggleSearch?: () => void;
  badges?: Partial<Record<AppDestination, number>>;
}

/** 目的地行（图标沿用原轨 Icon 表；行名见 strings.sidebar.row* 的出处注释）。 */
const DESTINATION_ROWS: readonly { destination: AppPageDestination; icon: LucideIcon; label: string }[] = [
  { destination: "automation", icon: Clock3, label: STR.sidebar.rowRoutines },
  { destination: "plugins", icon: Puzzle, label: STR.sidebar.rowSkills },
  { destination: "memory", icon: Brain, label: STR.sidebar.rowMemory },
];

export function AppRail(props: AppRailProps): React.JSX.Element {
  // 切换目的地后焦点落回对应行（原轨行为，键盘用户不丢位置）。
  const activeItem = useRef<HTMLButtonElement | null>(null);
  const previousDestination = useRef(props.destination);
  useEffect(() => {
    if (previousDestination.current === props.destination) return;
    previousDestination.current = props.destination;
    activeItem.current?.focus({ preventScroll: true });
  }, [props.destination]);

  const badgeOf = (destination: AppPageDestination): number | undefined => props.badges?.[destination];
  const destinationRow = ({ destination, icon: Icon, label }: (typeof DESTINATION_ROWS)[number]): React.JSX.Element => {
    const badge = badgeOf(destination);
    const hasBadge = badge !== undefined && Number.isInteger(badge) && badge > 0;
    return (
      <button
        key={destination}
        type="button"
        className="app-rail-item"
        ref={props.destination === destination ? activeItem : undefined}
        data-destination={destination}
        aria-label={hasBadge ? `${label}，${String(badge)} 项` : undefined}
        aria-current={props.destination === destination ? "page" : undefined}
        title={label}
        onClick={() => { props.onOpen(destination); }}
      >
        <Icon size={17} aria-hidden="true" />
        <span className="app-rail-label">{label}</span>
        {hasBadge && <span className="app-rail-badge" aria-hidden="true">{badge > 99 ? "99+" : String(badge)}</span>}
      </button>
    );
  };

  return (
    <nav className="app-rail" aria-label="全局功能">
      <button
        type="button"
        className="app-rail-item"
        data-row="new"
        title={withKeys(STR.sidebar.newTaskTip, "new-session")}
        onClick={props.onNewTask}
      >
        <Plus size={17} aria-hidden="true" />
        <span className="app-rail-label">{STR.sidebar.newTask}</span>
        {keysOf("new-session") !== null && <kbd className="app-rail-keys">{keysOf("new-session")}</kbd>}
      </button>
      <button
        type="button"
        className="app-rail-item"
        data-row="search"
        data-sidebar-search-toggle="true"
        aria-label={STR.sidebar.search}
        title={STR.sidebar.searchTip}
        aria-expanded={props.searchOpen === true}
        aria-controls="sidebar-session-search"
        onClick={props.onToggleSearch}
      >
        <Search size={17} aria-hidden="true" />
        <span className="app-rail-label">{STR.sidebar.rowSearch}</span>
      </button>
      {DESTINATION_ROWS.map(destinationRow)}
      <button
        type="button"
        className="app-rail-item"
        data-row="customize"
        aria-label={STR.sidebar.rowCustomize}
        title={STR.sidebar.rowCustomize}
        onClick={props.onSettings}
      >
        <Briefcase size={17} aria-hidden="true" />
        <span className="app-rail-label">{STR.sidebar.rowCustomize}</span>
      </button>
    </nav>
  );
}
