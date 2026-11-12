// 侧栏（P1 主界面重做，对 brief 第二节）：
//   顶栏「＋ 新任务」（⌘N）＋ 按需展开的会话搜索 + 筛选——旧四图标行与常驻行内表单整体下架；
//   项目区：按项目分组（显示名不是路径，完整路径只进 tooltip），可折叠，有任务在跑/等门显小圆点；
//   项目右键菜单（也可 hover ⋯ 打开）：Finder 显示 / 重命名显示名 / 项目设置 / 移除（不删文件，说明清楚）；
//   会话行：状态图标（运行中/等待/完成/失败——只取本进程可见态）+ 标题（省略号，hover 全称）+ 相对时间（常驻）；
//     双击标题重命名（开态全选 + 视口回串首）；hover ⋯ 五项菜单（置顶/重命名/分叉/归档/删除，对齐原型序）；
//   组内分段：置顶段恒前（不摆标签），其余按时间（今天/昨天/过去7天/更早）带桶标签；
//   底部「添加项目」四入口（打开文件夹…/新建项目…/从 Git 仓库克隆…/最近打开）；
//   2026-11-03：页脚用户菜单整体下架——设置/外观/用量/关于搬到全局左轨底部的头像入口
//     （components/AccountMenu.tsx），侧栏只保留会话上下文。
// 文案一律走 STR（strings.ts——源文扫描判卷钉死）；图标 = lucide（ADR 0003）；会话行菜单 = Radix。
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { readMotionPref, setMotionPref, type MotionPref } from "../state/motion-pref";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Archive, Check, ChevronRight, Filter, Folder, GitBranch, Loader2, MoreHorizontal, Pencil, Pin, Plus, Search, X } from "lucide-react";
import type { ProjectRecord } from "../../../../../src/main/ipc-protocol";
import { relativeTime } from "../projections";
import { keysOf } from "../shortcuts";
import { countSessionsByFilter, filterSessions, groupByWorkspace, projectMenuItems, projectSections, sessionFilterInfo, sessionStatus, sessionTime, splitArchived, workspaceLabel, OTHER_WORKSPACE, SESSION_FILTERS, SESSION_FILTER_NOTE, type SessionFilterId, type TimeBucket, type WorkspaceSession } from "../sessions-view";
import { draftKeyFor } from "../drafts";
import { sessionKeyOf } from "../state/session-identity";
import { parseSidebarDensity, SIDEBAR_DENSITY_KEY, type SidebarDensity } from "../state/sidebar-density";
import { usePinnedOrder } from "../state/use-pinned-order";
import type { PinnedDragProps, PinnedRowAttrs } from "../state/use-pinned-order";
import { STR } from "../strings";
import { isCompositionEnter } from "../ime";
import { CairnMark } from "./CairnMark";
import { useNow } from "../useNow";
import { ModalSurface } from "./ModalSurface";
import { ProjectContextMenu, ProjectSettingsDialog } from "./SidebarProjects";
export { ProjectSettingsDialog } from "./SidebarProjects";
import { AddProjectMenu } from "./AddProjectMenu";
import { SessionFilterMenu } from "./SessionFilterMenu";
import { menuNavIndex } from "./popover-keys";
import { toast } from "../toast";
import "./sidebar-filter.css";

/** 会话筛选（2026-10-25）：词表/纯函数在 sessions-view.ts，侧栏此前硬编码 filter:"all"。
 *  选择持久化；筛选变化后展开全部项目组，避免命中项藏在旧折叠状态里（搜索用的是同一原则）。 */
const SESSION_FILTER_KEY = "cairn.sidebar.filter.v1";
const isSessionFilter = (value: string | null): value is SessionFilterId =>
  SESSION_FILTERS.some((f) => f.id === value);

/** 时间桶标签（业主四图批：brief §2.1 的「今天/昨天/过去7天/更早」要读得出来——
 *  原「间隔即分组」只剩无声空白，业主截图里读不出桶界）。文案走 STR（判卷钉）。 */
const BUCKET_LABEL: Record<TimeBucket, string> = {
  today: STR.sidebar.bucketToday,
  yesterday: STR.sidebar.bucketYesterday,
  past7: STR.sidebar.bucketPast7,
  earlier: STR.sidebar.bucketEarlier,
};

/** tooltip 键位与 SHORTCUTS 表同源（P3-3）：表里改键，这里自动跟。 */
function withKeys(base: string, id: string): string {
  const k = keysOf(id);
  return k === null ? base : `${base}（${k}）`;
}

// 筛选纯函数与词表迁居 sessions-view.ts（判据一字未动）；re-export 保旧引用面（P3-3 收进 ⌘K）。
export { SESSION_FILTERS, SESSION_FILTER_NOTE, filterSessions, matchSession, type SessionFilterId } from "../sessions-view";

/** 状态图标（brief：运行中转圈 / 等待审批黄点 / 完成对勾 / 失败红点；none 不显示）。
 *  tooltip 分档说清——「等待你的决定」与「运行中」是两回事，不合并成一个灯。 */
function StatusIcon(props: { status: ReturnType<typeof sessionStatus>; title: string }) {
  const s = props.status;
  if (s === "none") return null;
  if (s === "running") return <span className="s-ico" title={props.title}><Loader2 size={12} className="s-spin" aria-hidden="true" /></span>;
  if (s === "waiting") return <span className="s-dot waiting" aria-hidden="true" title={props.title} />;
  if (s === "done") return <span className="s-ico" title={props.title}><Check size={12} className="s-check" aria-hidden="true" /></span>;
  return <span className="s-dot failed" aria-hidden="true" title={props.title} />;
}

function SessionRow(props: {
  session: WorkspaceSession;
  activeId: string | null;
  status: ReturnType<typeof sessionStatus>;
  onOpen: (id: string, workspace?: string) => void;
  /** ⌘/Ctrl+点击：在右侧只读预览这个会话，不切走当前会话。 */
  onPreview?: (s: WorkspaceSession) => void;
  renaming: boolean;
  renameValue: string;
  onRenameValue: (v: string) => void;
  onRenameStart: () => void;
  onRenameCommit: () => void;
  onRenameCancel: () => void;
  /** 有未发送草稿（2026-10-18）：标题旁一支小铅笔；草稿在 localStorage，App 上报集合。 */
  hasDraft?: boolean;
  /** listbox 语义的位置读数（2026-10-18）：读屏据此报「第几项 / 共几项」。 */
  posInSet?: number;
  setSize?: number;
  /** 会话已归到的项目名（null = 未归属）。行上的标签据此画——**归属必须看得见**，
   *  看不见的归属等于没接：用户改完什么都不知道。 */
  projectName: string | null;
  /** 可归属的项目（子菜单用；空 = 没有可选项 ⇒ 子菜单不摆）。 */
  projectOptions: readonly { id: string; name: string }[];
  /** 由 Sidebar 单点订阅的活时钟；每行不再各开一个 useNow（第 1116 页）。 */
  now: number;
  /** 置顶段拖排（2026-10-31）：属性 + pointer 处理器 + Alt+↑/↓ 键盘排序。 */
  dragAttrs?: PinnedRowAttrs;
  dragProps?: PinnedDragProps;
  onReorder?: (delta: -1 | 1) => void;
  actions: {
    onPin: (pinned: boolean) => void;
    onFork: () => void;
    onArchive: (archived: boolean) => void;
    onDelete: () => void;
    /** 跨面接力（§3.9）：给出在 CLI 续跑的等价命令。 */
    onOpenInCli: () => void;
    /** 会话级 worktree 隔离（§3.7 · G4）：隔离 / 合并回主工作区 / 丢弃。 */
    onWorktree: (kind: "create" | "merge" | "discard") => void;
    /** 归到某个项目 / 取消归属（null = 取消）。主进程校验项目 id 存在。 */
    onAssignProject: (projectId: string | null) => void;
  } | null;
}): React.JSX.Element {
  const s = props.session;
  const title = s.title ?? s.id;
  const t = sessionTime(s);
  const a = props.actions;
  const now = props.now;
  // 2026-10-18：行从 role=button 升为 role=option（父级 .sidenav 是 listbox）。
  // option 的激活键仍是 Enter/Space（WAI-ARIA listbox 模式），所以 activates() 的口径不变；
  // 变的是读屏语义：aria-selected 说「这是当前打开的那个」，aria-posinset/setsize 说「第几项/共几项」。
      // 右键也能开会话菜单（2026-10-18 补）：此前只有 hover 出的「…」一条路。macOS 上右键列表行
      // 是肌肉记忆——在会话行上右键什么也不发生，会被读成「这个应用坏了」。
      // 走 Radix 的受控 open（不另写一套自绘菜单）：菜单内容与「…」完全同一个，行为也不会分叉。
      const [ctxOpen, setCtxOpen] = useState(false);
  // 第 1104 页：菜单关闭时不再为每行预生成项目子菜单条目（400 行×项目表纯浪费）；
  // 打开才按需算（Radix 关闭时不挂 Content，条目此时无人消费）。
  const menuItems = ctxOpen ? projectMenuItems(s, props.projectOptions) : [];
  // 键盘开菜单时，关闭后把焦点还给这一行（Radix 默认还给 ⋯ 触发器；从 ⋯ 按 ↑/↓ 不会进列表移动）。
  const rowRef = useRef<HTMLDivElement | null>(null);
  const ctxByKeyboard = useRef(false);
  const statusTitle =
    props.status === "running" ? `${STR.sidebar.sessionRunning}：${title}`
    : props.status === "waiting" ? `${STR.sidebar.sessionWaiting}：${title}`
    : props.status === "done" ? `${STR.sidebar.sessionDone}：${title}`
    : `${STR.sidebar.sessionFailed}：${title}`;
  return (
    <div
      ref={rowRef}
      className={"session" + (s.id === props.activeId ? " active" : "")}
      data-active={s.id === props.activeId}
      data-session-id={s.id}
      {...props.dragAttrs}
      {...props.dragProps}
      onClick={props.renaming ? undefined : (e) => {
        if ((e.metaKey || e.ctrlKey) && props.onPreview !== undefined) {
          e.preventDefault();
          props.onPreview(s);
          return;
        }
        props.onOpen(s.id, s.workspace);
      }}
      title={props.onPreview !== undefined ? `${statusTitle}${STR.sidebar.previewHint}` : undefined}
      // 右键开会话菜单（2026-10-18 补）：只在有行操作可做时接管；没有 actions 时让默认右键菜单出来。
      // 不 stopPropagation 会让整行的 onClick 跟着触发（React 合成事件冒泡回本行）=> 先开菜单也换了会话。
      onContextMenu={(e) => {
        if (props.renaming || a === null) return;
        e.preventDefault();
        e.stopPropagation();
        ctxByKeyboard.current = false;
        setCtxOpen(true);
      }}
      role="option"
      aria-selected={s.id === props.activeId}
      aria-posinset={props.posInSet}
      aria-setsize={props.setSize}
      tabIndex={0}
      aria-current={s.id === props.activeId ? "true" : undefined}
      // 键盘：Enter / Space 都打开（原生 button 的两键语义）。仅在行自身聚焦时处理——
      // 行内「…」按钮的 Enter/Space 冒泡上来会顺带开会话（按钮自己开菜单，会话不该跟着切）。
      // ↑/↓ 在会话之间移动焦点（2026-10-18 补 roving focus）：此前每行可 Tab、可 Enter，
      // 却没有方向键 ⇒ 换会话得逐行 Tab（还要穿过行内「…」），二十个会话就是二十次 Tab。
      // 焦点移动不做选择——选中仍是 Enter/Space，与原生 listbox 语义一致。
      onKeyDown={(e) => {
        if (props.renaming || e.target !== e.currentTarget) return;
        if (s.pinned === true && e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
          e.preventDefault();
          props.onReorder?.(e.key === "ArrowUp" ? -1 : 1);
          return;
        }
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); props.onOpen(s.id, s.workspace); return; }
        // Shift+F10 / ContextMenu：键盘打开行菜单（右键的等价入口）。没有 actions 时让路。
        if ((e.key === "F10" && e.shiftKey) || e.key === "ContextMenu") {
          if (a !== null) { e.preventDefault(); ctxByKeyboard.current = true; setCtxOpen(true); }
          return;
        }
        // Home/End 跳列表首尾（listbox 的标准键盘语义；↑/↓ 已覆盖逐行）。
        if (e.key === "Home" || e.key === "End") {
          e.preventDefault();
          const rows = Array.from(
            e.currentTarget.closest(".sidenav")?.querySelectorAll<HTMLElement>(".session") ?? [],
          ).filter((el) => el.getClientRects().length > 0 && el.closest('.group[data-collapsed="true"]') === null);
          const target = e.key === "Home" ? rows[0] : rows[rows.length - 1];
          target?.focus();
          return;
        }
        if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
        e.preventDefault();
        // 只把「看得见」的行算进移动序列：折叠组的行仍在 DOM 里（高度过渡要它），
        // 但 visibility:hidden + 高度 0 ⇒ 键盘移过去会聚焦一个看不见的行。
        // getClientRects 不排除 visibility:hidden 的后代；同时排除已折叠组。
        const rows = Array.from(
          e.currentTarget.closest(".sidenav")?.querySelectorAll<HTMLElement>(".session") ?? [],
        ).filter((el) => el.getClientRects().length > 0 && el.closest('.group[data-collapsed="true"]') === null);
        const at = rows.indexOf(e.currentTarget);
        const next = rows[at + (e.key === "ArrowDown" ? 1 : -1)];
        next?.focus();
      }}
    >
      <span className="s-status">
        <StatusIcon status={props.status} title={statusTitle} />
      </span>
      {props.renaming ? (
        <input
          className="s-rename"
          autoFocus
          value={props.renameValue}
          aria-label={STR.sessionMenu.rename}
          onClick={(e) => { e.stopPropagation(); }}
          onFocus={(e) => {
            // 业主四图批：开态从串首读起——全选（键入即替换整名）并把视口回卷到串首
            // （长标题此前停在串尾，只露中段碎片，读不出原文）。rAF 让浏览器先完成首次滚动再回卷。
            const el = e.target;
            el.select();
            requestAnimationFrame(() => { el.scrollLeft = 0; });
          }}
          onChange={(e) => { props.onRenameValue(e.target.value); }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter" && !isCompositionEnter(e, null)) { e.preventDefault(); props.onRenameCommit(); }
            else if (e.key === "Escape") { e.preventDefault(); props.onRenameCancel(); }
          }}
          onBlur={props.onRenameCommit}
        />
      ) : (
        <>
          <div className="s-summary">
            <span className="s-title" title={title} onDoubleClick={() => { props.onRenameStart(); }}>{title}</span>
            <div className="s-meta">
              {s.pinned === true && <Pin size={10} className="s-pin" aria-label={STR.sidebar.pinned} />}
              {Number.isFinite(t) && <span className="s-time">{relativeTime(now, t)}</span>}
              {props.hasDraft === true && (
                <span className="s-draft" aria-label={STR.sidebar.draftLabel} title={STR.sidebar.draftLabel}><Pencil size={9} /></span>
              )}
              {s.isolated === true && (
                <span className="s-draft" aria-label={STR.sidebar.isolatedLabel} title={STR.sidebar.isolatedLabel}><GitBranch size={9} /></span>
              )}
              {/* 归属项目的标签（会话已归到某个项目时才有）。归属若看不见就等于没接。 */}
              {props.projectName !== null && (
                <span className="s-project" aria-label={`${STR.sessionProject.tag}：${props.projectName}`} title={props.projectName}>{props.projectName}</span>
              )}
            </div>
          </div>
          {a !== null && (
            <DropdownMenu.Root open={ctxOpen} onOpenChange={setCtxOpen}>
              <DropdownMenu.Trigger asChild>
                <button
                  className="s-more"
                  aria-label={STR.sidebar.sessionMore}
                  title={STR.sidebar.sessionMoreTip.replace("{title}", title)}
                  onClick={(e) => { e.stopPropagation(); ctxByKeyboard.current = false; }}
                >
                  <MoreHorizontal size={13} />
                </button>
              </DropdownMenu.Trigger>
              {/* 行菜单点击不得冒泡到行的 onClick：Radix Content 走 Portal，但 React 合成事件沿
                  React 树冒泡回本行 ⇒ 点菜单项会被当成点行（换会话闪烁/误开会话）。键盘同理，一并按住。 */}
              <DropdownMenu.Content
                className="pop-rd"
                side="bottom"
                align="start"
                sideOffset={4}
                onCloseAutoFocus={(e) => {
                  if (!ctxByKeyboard.current) return;
                  ctxByKeyboard.current = false;
                  e.preventDefault();
                  rowRef.current?.focus();
                }}
                onClick={(e) => { e.stopPropagation(); }}
                onKeyDown={(e) => { e.stopPropagation(); }}
              >
                <DropdownMenu.Item className="menu-item" onSelect={() => {
                  a.onPin(s.pinned !== true);
                  // 置顶会重排列表；Radix 的 close auto-focus 在这里落空（实测 activeElement=null），
                  // 键盘开菜单的用户选完就掉出列表。下一帧把焦点还给同一行。
                  if (ctxByKeyboard.current) requestAnimationFrame(() => { rowRef.current?.focus(); });
                }}>
                  {s.pinned === true ? STR.sessionMenu.unpin : STR.sessionMenu.pin}
                </DropdownMenu.Item>
                <DropdownMenu.Item className="menu-item" onSelect={props.onRenameStart}>{STR.sessionMenu.rename}</DropdownMenu.Item>
                {/* 预览入口（2026-10-25）：⌘+点击是快捷径，但只靠隐藏手势等于没接线——
                    行菜单里给同一条动作，右键/⋯ 都能发现。当前会话不摆（预览自己没意义）。 */}
                {props.onPreview !== undefined && s.id !== props.activeId && (
                  <DropdownMenu.Item className="menu-item" onSelect={() => { props.onPreview?.(s); }}>
                    {STR.sessionMenu.preview}
                  </DropdownMenu.Item>
                )}
                <DropdownMenu.Item className="menu-item" onSelect={() => { a.onFork(); }}>{STR.sessionMenu.fork}</DropdownMenu.Item>
                {s.isolated === true ? (
                  <>
                    <DropdownMenu.Item className="menu-item" onSelect={() => { a.onWorktree("merge"); }}>{STR.sessionMenu.wtMerge}</DropdownMenu.Item>
                    <DropdownMenu.Item className="menu-item danger-text" onSelect={() => { a.onWorktree("discard"); }}>{STR.sessionMenu.wtDiscard}</DropdownMenu.Item>
                  </>
                ) : (
                  <DropdownMenu.Item className="menu-item" onSelect={() => { a.onWorktree("create"); }}>{STR.sessionMenu.wtIsolate}</DropdownMenu.Item>
                )}
                {/* 归到项目：子菜单列可归属的项目 ＋ 「取消归属」（已归属时才有）。
                    归到一个**不存在的**项目 id 会被主进程拒（getActive），所以选项只从项目清单里取。 */}
                {menuItems.length > 0 && (
                  <DropdownMenu.Sub>
                    <DropdownMenu.SubTrigger className="menu-item">
                      <span>{STR.sessionProject.assign}</span>
                    </DropdownMenu.SubTrigger>
                    <DropdownMenu.SubContent className="pop-rd" sideOffset={2}>
                      {menuItems.map((m) => (
                        <DropdownMenu.Item
                          key={m.projectId ?? "unassign"}
                          className="menu-item"
                          onSelect={() => { a.onAssignProject(m.projectId); }}
                        >
                          <span>{m.label}</span>
                        </DropdownMenu.Item>
                      ))}
                    </DropdownMenu.SubContent>
                  </DropdownMenu.Sub>
                )}
                <DropdownMenu.Item className="menu-item" onSelect={() => { a.onArchive(s.archived !== true); }}>
                  {s.archived === true ? STR.sessionMenu.unarchive : STR.sessionMenu.archive}
                </DropdownMenu.Item>
                <DropdownMenu.Item className="menu-item" onSelect={() => { a.onOpenInCli(); }}>{STR.sessionMenu.openInCli}</DropdownMenu.Item>
                <DropdownMenu.Item className="menu-item danger-text" onSelect={() => { a.onDelete(); }}>{STR.sessionMenu.delete}</DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Root>
          )}
        </>
      )}
    </div>
  );
}

export interface SidebarProps {
  /** listProjects 的派生行：missing = 盘点时目录不在场（不写回 registry）。 */
  projects: (ProjectRecord & { missing?: boolean })[];
  sessions: WorkspaceSession[];
  activeId: string | null;
  /** 当前新任务归属工作区（项目路径）；null＝host 缺省。 */
  activeWorkspace: string | null;
  running: ReadonlySet<string>;
  /** 等门会话（ask 的 sessionId 映射；App 维护——只含本进程可见态）。 */
  waitingIds: ReadonlySet<string>;
  /** 有未发送草稿的会话（2026-10-18）；缺省 = 不画标记。
   *  集合里是草稿桶键（工作区引用键）；裸会话 id 只可能是升级前的旧桶，故留一条兜底匹配。 */
  draftIds?: ReadonlySet<string>;
  /** 本进程观察到的轮末结果（agent_status 终态记账）；重启归零是诚实行为。 */
  outcomes: ReadonlyMap<string, "ok" | "failed">;
  notice?: string | null;
  /** notice 的就地重试（项目注册表读失败时）；缺省不摆按钮。 */
  onRetryNotice?: () => void;
  /** 首屏会话清单仍在读（2026-10-18）：此前这段时间直接摆「还没有任务」——
   *  一句话同时在说「你什么都没有」和「我还没看完」，读起来像丢数据。 */
  loading?: boolean;
  /** 后台更新保留已有列表；忙碌期间禁用重试。 */
  refreshing?: boolean;
  /** 会话清单读取失败（2026-10-18）：与「空」分开，给重试入口，不把失败读成没有会话。 */
  loadError?: boolean;
  /** 失败原句（含损坏文件的路径与出路）：有就上屏，重试解决不了时用户才知道要修什么。 */
  loadErrorDetail?: string | null;
  onRetryLoad?: () => void;
  onOpen: (id: string, workspace?: string) => void;
  /** ⌘/Ctrl+点击会话行：右侧只读预览（不切主体会话）。 */
  onPreviewSession?: (s: WorkspaceSession) => void;
  onNewTask: () => void;
  onOpenPalette: () => void;
  onSwitchWorkspace: (path: string) => void;
  onAddProject: (path: string) => Promise<void>;
  onCloneProject: (url: string, parentDir: string) => Promise<void>;
  onOpenNewProjectDialog: () => void;
  /** 改名 / 改默认位置合并走一次 upsert（App 侧 addProject 同路径更新语义）。 */
  onUpdateProject: (p: ProjectRecord, patch: { name?: string; defaultLocation?: string }) => Promise<void>;
  /** v36：目录移动/改名后按同一条记录重新定位（保住 id 与会话归属）。 */
  onRelocateProject: (p: ProjectRecord, nextPath: string) => Promise<void>;
  onRemoveProject: (p: ProjectRecord) => Promise<void>;
  onRevealProject: (p: ProjectRecord) => void;
  onRenameSession?: (id: string, name: string) => Promise<void>;
  onPinSession?: (id: string, pinned: boolean) => Promise<void>;
  onArchiveSession?: (s: WorkspaceSession, archived: boolean) => void;
  onOpenInCliSession?: (s: WorkspaceSession) => void;
  /** 把会话归到某个项目 / 取消归属（null = 取消）。归属要**看得见**（行上的标签），
   *  否则用户改完什么都不知道——那是「算出来不接」那一族。 */
  onAssignSessionProject?: (sessionId: string, projectId: string | null) => void;
  /** §3.7 · G4：丢弃由 App 侧先弹确认卡（未提交改动会消失）。 */
  onSessionWorktree?: (kind: "create" | "merge" | "discard", s: WorkspaceSession) => void;
  onDeleteSession?: (s: WorkspaceSession) => void;
  onForkSession?: (s: WorkspaceSession) => void;
  /** 系统目录选择（「打开文件夹…」「选择克隆位置」「项目设置·更改」共用）。 */
  onPickDirectory: () => Promise<string | null>;
}

export function Sidebar(props: SidebarProps): React.JSX.Element {
  // 置顶段拖排（2026-10-31）：顺序是视图偏好，落 localStorage，不改会话 metadata。
  const pinnedOrder = usePinnedOrder();
  // 第 1116 页：400 行共用一个活时钟，不再每行各订阅一次 useNow。
  const nowMs = useNow();
  // 减弱动效偏好（窗口级，落 localStorage；见 state/motion-pref.ts）。
  const [motionPref, setMotionPrefState] = useState<MotionPref>(readMotionPref);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => {
    try {
      if (typeof window === "undefined") return new Set();
      const saved: unknown = JSON.parse(window.localStorage.getItem("cairn.sidebar.groups.v1") ?? "null");
      return new Set(Array.isArray(saved) ? saved.filter((key): key is string => typeof key === "string") : []);
    } catch { return new Set(); }
  });
  useEffect(() => {
    try { window.localStorage.setItem("cairn.sidebar.groups.v1", JSON.stringify([...collapsed])); } catch { /* 本窗口仍然生效 */ }
  }, [collapsed]);
  const [density, setDensity] = useState<SidebarDensity>(() => {
    if (typeof window === "undefined") return "comfortable";
    try { return parseSidebarDensity(window.localStorage.getItem(SIDEBAR_DENSITY_KEY)); } catch { return "comfortable"; }
  });
  const changeDensity = (next: SidebarDensity): void => {
    setDensity(next);
    try { window.localStorage.setItem(SIDEBAR_DENSITY_KEY, next); } catch { /* 本窗口仍生效 */ }
  };
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  const [renamingProject, setRenamingProject] = useState<{ id: string; value: string } | null>(null);
  const renameProject = (project: ProjectRecord, name: string): void => {
    void props.onUpdateProject(project, { name }).catch((err: unknown) => {
      toast.error(STR.projectRename.failed.replace("{reason}", err instanceof Error ? err.message : String(err)));
    });
  };
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; project: ProjectRecord } | null>(null);
  const [settingsFor, setSettingsFor] = useState<ProjectRecord | null>(null);
  // 侧栏会话搜索（2026-10-18 接通）：筛选纯函数与词表（filterSessions / SESSION_FILTERS）
  // 从 P3-3 起就在 sessions-view.ts 里、也有判卷，但一直没有调用方——侧栏顶的放大镜实际打开
  // 的是 ⌘K 命令面板（整屏模态），用户点「搜索」想收窄列表，得到的却是盖住整个应用的弹窗。
  // 现在：搜索图标控制一行按需展开的输入框，命中走 filterSessions，
  // 空结果给一句明确的「没有匹配的会话」而不是闪回空列表。
  // ⌘K 仍是全局入口（搜命令/项目/设置），两者分工不冲突。
  const [sessionQuery, setSessionQuery] = useState("");
  const [searchExpanded, setSearchExpanded] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const searchToggleRef = useRef<HTMLButtonElement | null>(null);
  const searchOpen = sessionQuery.trim() !== "";
  const showSearch = searchExpanded || searchOpen;
  useEffect(() => {
    if (!searchExpanded) return;
    const frame = window.requestAnimationFrame(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    });
    return () => { window.cancelAnimationFrame(frame); };
  }, [searchExpanded]);
  const [filter, setFilter] = useState<SessionFilterId>(() => {
    try {
      if (typeof window === "undefined") return "all";
      const saved = window.localStorage.getItem(SESSION_FILTER_KEY);
      return isSessionFilter(saved) ? saved : "all";
    } catch { return "all"; }
  });
  const filterInfo = sessionFilterInfo(filter);
  // 第 1147 页：筛选计数原先每次渲染都做 4 遍 filterSessions；会话/运行集不变时复用。
  const runningKey = [...props.running].sort().join("\u0000");
  const filterCounts = useMemo(() => {
    // 一次遍历算五个筛选计数；纯函数见 sessions-view.countSessionsByFilter。
    const counts = countSessionsByFilter(props.sessions, props.running);
    return SESSION_FILTERS.map((f) => ({ ...f, count: counts[f.id] }));
  }, [props.sessions, runningKey]);
  const changeFilter = (next: SessionFilterId): void => {
    setFilter(next);
    // 筛选下组一律先展开：命中项藏在折叠组里等于没筛。搜索路径同一原则。
    if (next !== "all") setCollapsed(new Set());
    try { window.localStorage.setItem(SESSION_FILTER_KEY, next); } catch { /* 存不下本窗口仍生效 */ }
  };

  const toggleGroup = (key: string): void => {
    if (searchOpen) setSessionQuery("");
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key) && !searchOpen) next.delete(key); else next.add(key);
      return next;
    });
  };

  const statusOf = (id: string, workspace?: string): ReturnType<typeof sessionStatus> => {
    const key = sessionKeyOf(workspace, id) ?? id;
    return sessionStatus({
      running: props.running.has(key),
      waiting: props.waitingIds.has(key),
      lastOutcome: props.outcomes.get(key),
    });
  };

  // 归档会话单列（2026-10-17）：常规项目组只吃 active；已归档进底部「已归档」分组找回。
  // 第 1128 页：会话清单/搜索/筛选/运行集不变时，不重跑 split/filter/group（侧栏随每次流式事件父渲染）。
  const { active: activeSessions, archived: archivedSessions } = useMemo(() => splitArchived(props.sessions), [props.sessions]);
  // 搜索/筛选收窄（2026-10-18 / 2026-10-25）：先过 filterSessions 再分组。空查询 + all 时
  // filterSessions 原样返回（判卷钉过），所以常态零成本、无行为变化。
  // 搜索/筛选时归档分组也参与——已归档的旧会话也要能被搜到/筛到。
  const searchTerm = sessionQuery.trim();
  // running 是可变 Set：内容签名已在顶部算好，集合变了才重算过滤（Set 引用本身不变）。
  const visibleActive = useMemo(() => filterSessions(activeSessions, { search: searchTerm, filter, running: props.running }), [activeSessions, searchTerm, filter, runningKey]);
  const visibleArchived = useMemo(() => filterSessions(archivedSessions, { search: searchTerm, filter, running: props.running }), [archivedSessions, searchTerm, filter, runningKey]);
  // 空态判「有没有会话」，不是判「有没有项目组」：groupByWorkspace 会为已登记项目保留空组，
  // 只看 groups.length 会把「筛掉/搜掉全部会话」错读成「列表有内容」（2026-10-25 真机冒烟抓到的）。
  const visibleCount = visibleActive.length + visibleArchived.length;
  // 收窄态（搜索/筛选）没有 active 命中时，不再摆空项目组：空态文案与空组头会互相打架。
  const groups = useMemo(() => (searchOpen || filter !== "all") && visibleActive.length === 0
    ? []
    : groupByWorkspace(visibleActive, props.projects.map((p) => p.path)), [searchOpen, filter, visibleActive, props.projects]);
  const byPath = useMemo(() => new Map(props.projects.map((p) => [p.path, p])), [props.projects]);
  const now = nowMs;
  const sectionsFor = (list: readonly WorkspaceSession[]): ReturnType<typeof projectSections> => projectSections(pinnedOrder.ordered(list), now);
  const hasRowActions =
    props.onRenameSession !== undefined || props.onPinSession !== undefined ||
    props.onArchiveSession !== undefined || props.onDeleteSession !== undefined ||
    props.onOpenInCliSession !== undefined || props.onSessionWorktree !== undefined ||
    props.onAssignSessionProject !== undefined;
  // 归属项目的两条数据面：可选项（子菜单用） ＋ 行上标签（把 projectId 翻成项目名）。
  // 项目被移除而归属还在时，标签退回**原始 id**（如实地显示它还指着什么），不编一个名字。
  // 第 1103 页：项目名原先每行线性扫项目表；
  // options 与 name Map 都只在 props.projects 变化时重建，行渲染 O(1) 查表。
  const projectOptions = useMemo(() => props.projects.map((p) => ({ id: p.id, name: p.name })), [props.projects]);
  const projectNameById = useMemo(() => new Map(projectOptions.map((p) => [p.id, p.name] as const)), [projectOptions]);
  const projectNameOf = (s: WorkspaceSession): string | null => {
    const id = s.projectId;
    if (id === undefined || id === "") return null;
    return projectNameById.get(id) ?? id;
  };
  // 扁平可见序（2026-10-18）：给 role=option 的 aria-posinset/setsize 用，也是 ↑↓ 键的依据。
  // 与渲染顺序同源：常规组（按项目 → 组内置顶/时间桶）在前，「已归档」组在末尾。
  // 注意这是**渲染序**，不是「打开顺序」——被折叠的组其行仍在 DOM 里（高度过渡），
  // 键盘移动靠 `.session:not([inert])` 或可见性另行过滤（见 SessionRow 的 ↑↓ 处理）。
  // 第 1131 页：每组 section 只算一次，位置表与渲染树共用（此前 flatOrder 和行渲染各算一遍）。
  const sectionsByGroup = useMemo(() => new Map(groups.map((g) => [g.workspace, sectionsFor(g.sessions)])), [groups, now, pinnedOrder.order]);
  // 第 1153 页：flatOrder 与位置表同一次遍历建好；不再先 flatMap 两份数组、再 map 一遍。
  const { flatOrder, positionOf } = useMemo(() => {
    const flatOrder: WorkspaceSession[] = [];
    const positionOf = new Map<WorkspaceSession, number>();
    for (const g of groups) {
      for (const sec of sectionsByGroup.get(g.workspace) ?? []) {
        for (const s of sec.sessions) {
          flatOrder.push(s);
          positionOf.set(s, flatOrder.length);
        }
      }
    }
    for (const s of visibleArchived) {
      flatOrder.push(s);
      positionOf.set(s, flatOrder.length);
    }
    return { flatOrder, positionOf };
  }, [groups, sectionsByGroup, visibleArchived]);
  /** 会话行（常规组与「已归档」分组共用同一渲染面：状态图标/标题/相对时间/五种行操作）。 */
  const rowFor = (s: WorkspaceSession): React.JSX.Element => (
                    <SessionRow
                      key={s.id}
                      session={s}
                      now={nowMs}
                      activeId={s.workspace === props.activeWorkspace ? props.activeId : null}
                      status={statusOf(s.id, s.workspace)}
                      onOpen={props.onOpen}
                      {...(props.onPreviewSession !== undefined ? { onPreview: props.onPreviewSession } : {})}
                      posInSet={positionOf.get(s) ?? 1}
                      setSize={flatOrder.length}
                      renaming={renaming !== null && renaming.id === s.id}
                      renameValue={renaming !== null && renaming.id === s.id ? renaming.value : (s.title ?? s.id)}
                      hasDraft={props.draftIds?.has(draftKeyFor(s.workspace, s.id)) === true || props.draftIds?.has(s.id) === true}
                      projectName={projectNameOf(s)}
                      dragAttrs={!searchOpen && filter === "all" ? pinnedOrder.rowAttrs(s) : {}}
                      dragProps={!searchOpen && filter === "all" ? pinnedOrder.dragProps(s) : undefined}
                      onReorder={!searchOpen && filter === "all" ? (delta) => { pinnedOrder.moveByKeyboard(s, delta); } : undefined}
                      projectOptions={projectOptions}
                      onRenameValue={(v) => { setRenaming((cur) => (cur !== null && cur.id === s.id ? { id: cur.id, value: v } : cur)); }}
                      onRenameStart={() => { setRenaming({ id: s.id, value: s.title ?? s.id }); }}
                      onRenameCommit={() => {
                        setRenaming((cur) => {
                          if (cur === null || cur.id !== s.id) return cur;
                          const next = cur.value.trim();
                          if (next !== "" && next !== (s.title ?? s.id)) void props.onRenameSession?.(s.id, next);
                          return null;
                        });
                      }}
                      onRenameCancel={() => { setRenaming(null); }}
                      actions={hasRowActions ? {
                        onPin: (pinned) => { void props.onPinSession?.(s.id, pinned); },
                        onFork: () => { props.onForkSession?.(s); },
                        onArchive: (archived) => { props.onArchiveSession?.(s, archived); },
                        onDelete: () => { props.onDeleteSession?.(s); },
                        onOpenInCli: () => { props.onOpenInCliSession?.(s); },
                        onWorktree: (kind) => { props.onSessionWorktree?.(kind, s); },
                        onAssignProject: (projectId) => { props.onAssignSessionProject?.(s.id, projectId); },
                      } : null}
                    />
  );

  return (
    <aside className="side" data-density={density} aria-label={STR.app.brand}>
      {/* 顶栏 48px（brief：＋ 新任务 ⌘N + 搜索 ⌘K；旧四图标行与行内表单在此下架） */}
      <div className="side-head">
        <div className="side-brandline">
          <CairnMark outline className="side-brand-mark" />
          <span className="side-brand">{STR.app.brand}</span>
        </div>
        <div className="side-actions">
          <button className="side-new" title={withKeys(STR.sidebar.newTaskTip, "new-session")} onClick={props.onNewTask}>
            <Plus size={13} aria-hidden="true" />
            <span className="side-new-label">{STR.sidebar.newTask}</span>
            {keysOf("new-session") !== null && <kbd className="side-new-keys">{keysOf("new-session")}</kbd>}
          </button>
        {/* 2026-10-18：放大镜从「打开 ⌘K 命令面板」改为「聚焦侧栏搜索框」。
            此前它打开的是整屏模态——用户点「搜索」想收窄左侧列表，得到的却是盖住整个应用的弹窗，
            列表一屏没变。真正的列表筛选（filterSessions）自此有入口。
            ⌘K 仍是全局入口（搜命令/项目/设置），不冲突：一个收窄本栏，一个跨面跳转。 */}
        <button
          ref={searchToggleRef}
          className="iconbtn"
          data-sidebar-search-toggle="true"
          aria-label={STR.sidebar.search}
          aria-expanded={showSearch}
          aria-controls="sidebar-session-search"
          title={STR.sidebar.searchTip}
          onClick={() => {
            if (showSearch && sessionQuery.trim() === "") {
              setSearchExpanded(false);
              return;
            }
            setSearchExpanded(true);
          }}
        >
          <Search size={14} />
        </button>
        <SessionFilterMenu
          filter={filter}
          filterCounts={filterCounts}
          density={density}
          onChangeFilter={changeFilter}
          onChangeDensity={changeDensity}
        />
        </div>
      </div>

      {/* 侧栏会话搜索（2026-10-27 收口）：默认只保留顶栏图标，点击展开；有内容才显示清空钮。
          Esc 两级语义：有字先清空，空着再收起并把焦点还给入口。
          ⏎ 直接打开第一个命中（搜索的终点就是打开它）。 */}
      {showSearch && (
        <div className="side-search" id="sidebar-session-search">
          <Search size={12} aria-hidden="true" />
          <input
            ref={searchInputRef}
            className="side-search-input"
            type="text"
            value={sessionQuery}
            placeholder={STR.sidebar.searchPlaceholder}
            aria-label={STR.sidebar.search}
            onChange={(e) => { setSessionQuery(e.target.value); }}
            onBlur={(e) => {
              if (sessionQuery !== "") return;
              if (e.currentTarget.parentElement?.contains(e.relatedTarget as Node | null) === true) return;
              setSearchExpanded(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                if (sessionQuery !== "") { setSessionQuery(""); return; }
                setSearchExpanded(false);
                window.requestAnimationFrame(() => { searchToggleRef.current?.focus(); });
                return;
              }
              if (e.key === "Enter" && !isCompositionEnter(e, null)) {
                const first = visibleActive[0] ?? visibleArchived[0];
                if (first !== undefined) { e.preventDefault(); props.onOpen(first.id, first.workspace); }
              }
            }}
          />
          {searchOpen && (
            <button className="side-search-x" aria-label={STR.sidebar.searchClear} title={STR.sidebar.searchClear} onClick={() => { setSessionQuery(""); searchInputRef.current?.focus(); }}>
              <X size={11} />
            </button>
          )}
        </div>
      )}

      {props.notice !== null && props.notice !== undefined && props.notice !== "" && (
        <div className="side-notice" role="status">
          <span className="side-notice-text">{props.notice}</span>
          {props.onRetryNotice !== undefined && (
            <button type="button" className="mini-btn" onClick={props.onRetryNotice}>重试</button>
          )}
        </div>
      )}

      {/* 会话列表的 ARIA 结构（2026-10-18 补）：此前每行是裸 role=button，读屏念不出
          「第几项 / 共几项」，方向键也无从判断边界。listbox + option 是「一组可选项、一次选一个」
          的正解；行内「…」按钮是 option 的子控件（listbox 允许 option 内含可聚焦后代）。
          分组标题用 role=group 包住各自的 option，读屏能报出「哪个项目里第几项」。 */}
      <nav className="sidenav" role="listbox" aria-label={STR.sidebar.listAria} aria-busy={props.loading === true || props.refreshing === true}>
        {/* 首屏读取中（2026-10-18）：三条骨架只占位，不摆「还没有任务」——
            用户没有『空』这个事实，只有『还没读完』这个事实。 */}
        {props.loading === true && (
          <div className="side-skeleton" role="presentation" aria-hidden="true" data-cds="SkeletonGroup" data-motion="wave">
            {[0, 1, 2].map((i) => <div className="side-skeleton-row" data-cds="Skeleton" key={i} />)}
          </div>
        )}
        {/* 读取失败（2026-10-18）：失败与空分开，并给重试入口；否则一次 IPC 抖动会被读成
            「所有会话都没了」，且永远停在空屏（sessionsLoaded 此前只会在成功时落真）。 */}
        {props.loadError === true && props.loading !== true && (
          <div className="side-empty side-load-error">
            <div className="side-load-heading">
              <span role="status">{props.sessions.length > 0 ? STR.sidebar.refreshFailed : STR.sidebar.loadFailed}</span>
              {props.onRetryLoad !== undefined && (
                <button type="button" className="btn-ghost side-retry" disabled={props.refreshing === true} onClick={props.onRetryLoad}>
                  {props.refreshing === true ? STR.common.loading : STR.sidebar.retry}
                </button>
              )}
            </div>
            {props.loadErrorDetail !== null && props.loadErrorDetail !== undefined && props.loadErrorDetail !== "" && (
              <details className="side-load-reason">
                <summary>{STR.sidebar.errorDetails}</summary>
                <span className="side-load-detail" title={props.loadErrorDetail}>{props.loadErrorDetail}</span>
              </details>
            )}
          </div>
        )}
        {props.loading !== true && props.loadError !== true && visibleCount === 0 && !searchOpen && filter === "all" && (
          <div className="side-empty">{STR.sidebar.emptyList}</div>
        )}
        {/* 筛选无命中：不能说「还没有任务」——列表里可能有任务，只是不在这个筛选下。 */}
        {props.loading !== true && props.loadError !== true && visibleCount === 0 && !searchOpen && filter !== "all" && (
          <div className="side-empty side-filter-empty">
            <span>{STR.filter.empty.replace("{label}", filterInfo.label)}</span>
            <button className="btn-ghost side-retry" onClick={() => { changeFilter("all"); }}>{STR.filter.clear}</button>
          </div>
        )}
        {/* 搜索无命中：说清「没有匹配的会话 + 当前搜索词」，不能闪回空列表——
            那会被读成「你什么都没有」，与事实不符（只是没匹配上）。 */}
        {props.loading !== true && props.loadError !== true && searchOpen && visibleCount === 0 && (
          <div className="side-empty">{STR.sidebar.noMatch.replace("{q}", sessionQuery.trim())}</div>
        )}
        {groups.map((g) => {
          // 「临时对话」组（防吞数据的哨兵）：无项目归属的会话；项目菜单/＋对它关闭。
          const key = g.workspace === OTHER_WORKSPACE ? "\u0000temp" : g.workspace;
          const project = byPath.get(g.workspace) ?? null;
          const isTemp = project === null;
          const isCollapsed = !searchOpen && collapsed.has(key);
          const activeGroup = !isTemp && g.workspace === props.activeWorkspace;
          const busyDot = g.sessions.some((s) => props.running.has(s.id) || props.waitingIds.has(s.id));
          const sections = sectionsByGroup.get(g.workspace) ?? [];
          const isRenaming = renamingProject !== null && project !== null && renamingProject.id === project.id;
          return (
            <div key={key} className="group" data-active={activeGroup} data-collapsed={isCollapsed} data-sentinel={isTemp}>
              <div
                className="group-head"
                title={isTemp ? undefined : g.workspace}
                onContextMenu={project === null ? undefined : (e) => {
                  e.preventDefault();
                  setCtxMenu({ x: e.clientX, y: e.clientY, project });
                }}
              >
                <button
                  className="group-toggle"
                  aria-expanded={!isCollapsed}
                  title={STR.sidebar.collapseTip}
                  onClick={() => toggleGroup(key)}
                >
                  <span className="g-folder" aria-hidden="true">
                    <Folder size={14} />
                  </span>
                  {isRenaming && project !== null ? (
                    <input
                      className="s-rename"
                      autoFocus
                      value={renamingProject.value}
                      aria-label={STR.projectRename.label}
                      onClick={(e) => { e.stopPropagation(); }}
                      onChange={(e) => { setRenamingProject({ id: project.id, value: e.target.value }); }}
                      onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === "Enter" && !isCompositionEnter(e, null)) {
                          e.preventDefault();
                          const v = renamingProject.value.trim();
                          if (v !== "" && v !== project.name) renameProject(project, v);
                          setRenamingProject(null);
                        } else if (e.key === "Escape") {
                          e.preventDefault();
                          setRenamingProject(null);
                        }
                      }}
                      onBlur={() => {
                        const v = renamingProject.value.trim();
                        if (v !== "" && project !== null && v !== project.name) renameProject(project, v);
                        setRenamingProject(null);
                      }}
                    />
                  ) : (
                    <span className="g-name">{isTemp ? STR.sidebar.tempChats : (project?.name ?? workspaceLabel(g.workspace))}</span>
                  )}
                  {project?.missing === true && (
                    <span className="g-missing" title={STR.sidebar.missingBadgeTip}>
                      {STR.sidebar.missingBadge}
                    </span>
                  )}
                  {busyDot && <span className="g-dot" aria-hidden="true" title={STR.sidebar.projectDotTip} />}
                  <span className="g-chev" aria-hidden="true">
                    <ChevronRight size={11} />
                  </span>
                </button>
                {project !== null && (
                  <button
                    className="g-more"
                    aria-label={STR.sidebar.projectMoreTip}
                    title={STR.sidebar.projectMoreTip}
                    onClick={(e) => { e.stopPropagation(); setCtxMenu({ x: e.clientX, y: e.clientY + 8, project }); }}
                  >
                    <MoreHorizontal size={13} />
                  </button>
                )}
                {project !== null && (
                  <button
                    className="g-new"
                    title={withKeys(STR.sidebar.newTaskTip, "new-session")}
                    aria-label={STR.sidebar.newTask}
                    onClick={() => {
                      props.onSwitchWorkspace(project.path);
                      props.onNewTask();
                    }}
                  >
                    <Plus size={12} />
                  </button>
                )}
              </div>
              <div className="group-body">
                {/* 收/开做高度过渡（2026-10-18）：此前 display:none 瞬切。包一层 inner 是
                    grid-template-rows 0fr→1fr 动画的前提（直接多行子项不会整体收）。 */}
                <div className="group-body-inner">
                  {sections.map((sec) => {
                    // 时间桶可折叠（2026-10-24 业主：一个项目对话太多，别的项目不好找）。
                    // 折叠键复用同一张持久化集合（组键 + 桶 id）；搜索时恒展开（与项目组同口径）。
                    const bucketKey = sec.kind === "time" ? `${key}#${sec.bucket}` : null;
                    const bucketCollapsed = bucketKey !== null && !searchOpen && collapsed.has(bucketKey);
                    return (
                      <div key={sec.kind === "pinned" ? "pinned" : sec.bucket} className="sess-section">
                        {/* 置顶段不摆标签（钉形图标已自证）；时间桶标签 = 折叠开关（朝向；枚数只在收起时出现——展开时行本身就是枚数） */}
                        {sec.kind === "time" && (
                          <button
                            className="s-bucket"
                            aria-expanded={!bucketCollapsed}
                            title={STR.sidebar.collapseTip}
                            onClick={() => { if (bucketKey !== null) toggleGroup(bucketKey); }}
                          >
                            <span>{BUCKET_LABEL[sec.bucket]}</span>
                            {bucketCollapsed && <span className="s-bucket-count">{sec.sessions.length}</span>}
                            <ChevronRight size={10} className="s-bucket-chev" aria-hidden="true" />
                          </button>
                        )}
                        {!bucketCollapsed && sec.sessions.map((s) => rowFor(s))}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}
        {visibleArchived.length > 0 && (
          <div className="group" data-archived="true" data-collapsed={!searchOpen && collapsed.has("\u0000archived")}>
            <div className="group-head" title={STR.sidebar.archivedTip}>
              <button
                className="group-toggle"
                aria-expanded={searchOpen || !collapsed.has("\u0000archived")}
                title={STR.sidebar.collapseTip}
                onClick={() => toggleGroup("\u0000archived")}
              >
                <span className="g-folder" aria-hidden="true"><Archive size={13} /></span>
                <span className="g-name">{STR.sidebar.archivedGroup} · {visibleArchived.length}</span>
                <span className="g-chev" aria-hidden="true"><ChevronRight size={11} /></span>
              </button>
            </div>
            {/* 与项目组同一套收/开过渡（2026-10-18）：常驻 + inner 包一层，grid 0fr/1fr 才收得动。 */}
            <div className="group-body">
              <div className="group-body-inner">
                {visibleArchived.map((s) => rowFor(s))}
              </div>
            </div>
          </div>
        )}
        <AddProjectMenu
          onPickDirectory={props.onPickDirectory}
          onAddProject={props.onAddProject}
          onOpenNewProjectDialog={props.onOpenNewProjectDialog}
          onCloneProject={props.onCloneProject}
          activePaths={props.projects.map((p) => p.path)}
        />
      </nav>



      {ctxMenu !== null && (
        <ProjectContextMenu
          at={{ x: ctxMenu.x, y: ctxMenu.y }}
          onClose={() => { setCtxMenu(null); }}
          onReveal={() => { props.onRevealProject(ctxMenu.project); }}
          onRename={() => { setRenamingProject({ id: ctxMenu.project.id, value: ctxMenu.project.name }); }}
          onSettings={() => { setSettingsFor(ctxMenu.project); }}
          onRelocate={() => {
            const project = ctxMenu.project;
            void props.onPickDirectory().then((picked) => {
              if (picked !== null) return props.onRelocateProject(project, picked);
              return undefined;
            }).catch((err: unknown) => {
              toast.error(STR.projectMenu.relocateFailed.replace("{reason}", err instanceof Error ? err.message : String(err)));
            });
          }}
          onRemove={() => { void props.onRemoveProject(ctxMenu.project); }}
        />
      )}

      {settingsFor !== null && (
        <ProjectSettingsDialog
          project={settingsFor}
          onClose={() => { setSettingsFor(null); }}
          onSave={(patch) => props.onUpdateProject(settingsFor, patch)}
          onPickDirectory={props.onPickDirectory}
        />
      )}
    </aside>
  );
}
