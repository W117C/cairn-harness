// 侧栏（P1 主界面重做，对 brief 第二节）：
//   顶栏「＋ 新任务」（⌘N）＋ 搜索（⌘K 命令面板入口）——旧四图标行与行内表单整体下架（brief 明裁）；
//   项目区：按项目分组（显示名不是路径，完整路径只进 tooltip），可折叠，有任务在跑/等门显小圆点；
//   项目右键菜单（也可 hover ⋯ 打开）：Finder 显示 / 重命名显示名 / 项目设置 / 移除（不删文件，说明清楚）；
//   会话行：状态图标（运行中/等待/完成/失败——只取本进程可见态）+ 标题（省略号，hover 全称）+ 相对时间（常驻）；
//     双击标题重命名（开态全选 + 视口回串首）；hover ⋯ 五项菜单（置顶/重命名/分叉/归档/删除，对齐原型序）；
//   组内分段：置顶段恒前（不摆标签），其余按时间（今天/昨天/过去7天/更早）带桶标签；
//   底部「添加项目」四入口（打开文件夹…/新建项目…/从 Git 仓库克隆…/最近打开）；
//   页脚 48px：模型服务状态点（绿=可用，红=不可用，点击直达「模型与 Provider」分区）+ 头像。
//     头像是侧栏的「账户/外观/用量」枢纽（2026-10-20 批 130）：点开有 外观（主题三选一）/
//     用量统计（当前会话 + 全部会话双口径，批 131）/ 设置 / 关于与更新。**页脚不再常驻「⚙ 设置」钮**——
//     同一个语义两处入口是本仓反复要治的病（批 #128 同款）。
// 文案一律走 STR（strings.ts——源文扫描判卷钉死）；图标 = lucide（ADR 0003）；会话行菜单 = Radix。
import { useCallback, useEffect, useRef, useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Archive, Check, ChevronRight, Folder, GitBranch, Loader2, MoreHorizontal, Pencil, Pin, Plus, Search, Settings2, X } from "lucide-react";
import type { ProjectRecord } from "../../../../../src/main/ipc-protocol";
import { relativeTime } from "../projections";
import type { UsageSummary } from "../projections";
import { keysOf } from "../shortcuts";
import { filterSessions, groupByWorkspace, projectLabelFor, projectMenuItems, projectSections, sessionStatus, sessionTime, splitArchived, workspaceLabel, OTHER_WORKSPACE, type TimeBucket, type WorkspaceSession } from "../sessions-view";
import { STR } from "../strings";
import { Popover, usePopoverDismiss } from "./Popover";
import { UsagePanel, type UsageAllState, type UsageScope } from "./UsagePanel";
import { useNow } from "../useNow";
import type { ThemePref } from "../theme";
import { ModalSurface } from "./ModalSurface";
import { AddProjectMenu } from "./AddProjectMenu";

/** 头像菜单的「外观」三档（2026-10-20 批 130）。与设置页 GeneralSection 的 THEME_OPTIONS
 *  同三档同措辞——**同一个语义两处措辞不许各写一份**（这里直接引用 STR.footer 的文案）。 */
const THEME_CHOICES: readonly { id: ThemePref; label: string }[] = [
  { id: "system", label: STR.footer.themeSystem },
  { id: "light", label: STR.footer.themeLight },
  { id: "dark", label: STR.footer.themeDark },
];

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
  // 子菜单条目（纯函数算：菜单是关着的 Radix 弹层，静态渲染里看不见 ⇒ 逻辑必须可判）。
  const menuItems = projectMenuItems(s, props.projectOptions);
  const t = sessionTime(s);
  const a = props.actions;
  const now = useNow();
  // 2026-10-18：行从 role=button 升为 role=option（父级 .sidenav 是 listbox）。
  // option 的激活键仍是 Enter/Space（WAI-ARIA listbox 模式），所以 activates() 的口径不变；
  // 变的是读屏语义：aria-selected 说「这是当前打开的那个」，aria-posinset/setsize 说「第几项/共几项」。
      // 右键也能开会话菜单（2026-10-18 补）：此前只有 hover 出的「…」一条路。macOS 上右键列表行
      // 是肌肉记忆——在会话行上右键什么也不发生，会被读成「这个应用坏了」。
      // 走 Radix 的受控 open（不另写一套自绘菜单）：菜单内容与「…」完全同一个，行为也不会分叉。
      const [ctxOpen, setCtxOpen] = useState(false);
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
      onClick={props.renaming ? undefined : () => { props.onOpen(s.id, s.workspace); }}
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
      <StatusIcon status={props.status} title={statusTitle} />
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
            if (e.key === "Enter") { e.preventDefault(); props.onRenameCommit(); }
            else if (e.key === "Escape") { e.preventDefault(); props.onRenameCancel(); }
          }}
          onBlur={props.onRenameCommit}
        />
      ) : (
        <>
          {s.pinned === true && <Pin size={11} className="s-pin" aria-label={STR.sidebar.pinned} />}
          <div className="s-summary">
            <span className="s-title" title={title} onDoubleClick={() => { props.onRenameStart(); }}>{title}</span>
            <div className="s-meta">
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

/** 项目行菜单（右键或 hover ⋯ 打开）：自绘 fixed 定位菜单——Radix DropdownMenu 的 Trigger 点击语义
 *  与「整行点击=折叠」冲突，这里要的是纯右键面；自绘同时保住键盘/焦点语义（Esc 关、外点关）。 */
function ProjectContextMenu(props: {
  at: { x: number; y: number };
  onClose: () => void;
  onReveal: () => void;
  onRename: () => void;
  onSettings: () => void;
  onRemove: () => void;
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (ref.current !== null && !ref.current.contains(e.target as Node)) props.onClose();
    };
    const onKey = (e: KeyboardEvent): void => { if (e.key === "Escape") props.onClose(); };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("mousedown", onDown); window.removeEventListener("keydown", onKey); };
  }, [props]);
  const item = (label: string, tip: string, run: () => void, danger = false): React.JSX.Element => (
    <button
      className={"menu-item" + (danger ? " danger-text" : "")}
      role="menuitem"
      title={tip}
      onClick={() => { props.onClose(); run(); }}
    >
      {label}
    </button>
  );
  return (
    <div
      ref={ref}
      className="pop show ctx-menu"
      role="menu"
      style={{ left: Math.min(props.at.x, window.innerWidth - 220), top: props.at.y }}
    >
      {item(STR.projectMenu.reveal, STR.projectMenu.revealTip, props.onReveal)}
      {item(STR.projectMenu.rename, STR.projectMenu.renameTip, props.onRename)}
      {item(STR.projectMenu.settings, STR.projectMenu.settingsTip, props.onSettings)}
      <div className="menu-sep" role="separator" />
      {item(STR.projectMenu.remove, STR.projectMenu.removeTip, props.onRemove, true)}
    </div>
  );
}

/** 项目设置 Dialog（brief 第二节「项目设置…」）：显示名 + 默认运行位置（系统选择器）。
 *  保存 = addProject 同路径 upsert（零新通道）；位置只展示不可手输（原则 1：用户不碰绝对路径）。 */
export function ProjectSettingsDialog(props: {
  project: ProjectRecord;
  onClose: () => void;
  onSave: (patch: { name: string; defaultLocation: string }) => Promise<void>;
  onPickDirectory: () => Promise<string | null>;
}): React.JSX.Element {
  const [name, setName] = useState(props.project.name);
  const [location, setLocation] = useState(props.project.defaultLocation);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameInput = useRef<HTMLInputElement | null>(null);
  return (
    <div className="modal-backdrop" role="presentation" onClick={props.onClose}>
      <ModalSurface
        className="modal-card"
        label={STR.projectSettings.title}
        onClose={props.onClose}
        initialFocusRef={nameInput}
        onClick={(e) => { e.stopPropagation(); }}
      >
        <div className="modal-head">
          <span>{STR.projectSettings.title}</span>
          <button className="iconbtn sm" aria-label={STR.projectSettings.close} title={STR.projectSettings.close} onClick={props.onClose}>
            <X size={13} />
          </button>
        </div>
        <label className="modal-field">
          <span>{STR.projectSettings.nameLabel}</span>
          <input ref={nameInput} value={name} onChange={(e) => { setName(e.target.value); }} aria-label={STR.projectSettings.nameLabel} />
        </label>
        <div className="modal-field">
          <span>{STR.projectSettings.locationLabel}</span>
          <div className="modal-row">
            <code className="modal-path" title={location}>{location}</code>
            <button
              className="mini-btn"
              title={STR.projectSettings.locationHint}
              onClick={() => {
                void props.onPickDirectory().then((picked) => { if (picked !== null) setLocation(picked); });
              }}
            >
              {STR.projectSettings.change}
            </button>
          </div>
          <span className="sp-dim">{STR.projectSettings.locationHint}</span>
        </div>
        {error !== null && <div className="form-error" role="alert">{error}</div>}
        <div className="modal-foot">
          <button className="mini-btn" title={STR.common.cancel} onClick={props.onClose}>{STR.common.cancel}</button>
          <button
            className="mini-btn primary"
            title={STR.projectRename.save}
            disabled={busy}
            onClick={() => {
              const trimmed = name.trim();
              if (trimmed === "") { setError(STR.projectRename.empty); return; }
              setBusy(true);
              setError(null);
              void props.onSave({ name: trimmed, defaultLocation: location }).then(
                () => { props.onClose(); },
                (err: unknown) => { setError(err instanceof Error ? err.message : String(err)); setBusy(false); },
              );
            }}
          >
            {busy ? STR.common.creating : STR.projectRename.save}
          </button>
        </div>
      </ModalSurface>
    </div>
  );
}

export interface SidebarProps {
  projects: ProjectRecord[];
  sessions: WorkspaceSession[];
  activeId: string | null;
  /** 当前新任务归属工作区（项目路径）；null＝host 缺省。 */
  activeWorkspace: string | null;
  running: ReadonlySet<string>;
  /** 等门会话（ask 的 sessionId 映射；App 维护——只含本进程可见态）。 */
  waitingIds: ReadonlySet<string>;
  /** 有未发送草稿的会话（2026-10-18）；缺省 = 不画标记。 */
  draftIds?: ReadonlySet<string>;
  /** 本进程观察到的轮末结果（agent_status 终态记账）；重启归零是诚实行为。 */
  outcomes: ReadonlyMap<string, "ok" | "failed">;
  notice?: string | null;
  /** 首屏会话清单仍在读（2026-10-18）：此前这段时间直接摆「还没有任务」——
   *  一句话同时在说「你什么都没有」和「我还没看完」，读起来像丢数据。 */
  loading?: boolean;
  /** 会话清单读取失败（2026-10-18）：与「空」分开，给重试入口，不把失败读成没有会话。 */
  loadError?: boolean;
  onRetryLoad?: () => void;
  /** 模型服务状态点：true=可用绿 / false=不可用红 / null=未检测灰。 */
  providerOk: boolean | null;
  onOpen: (id: string, workspace?: string) => void;
  onNewTask: () => void;
  onOpenPalette: () => void;
  onSwitchWorkspace: (path: string) => void;
  onAddProject: (path: string) => Promise<void>;
  onCloneProject: (url: string, parentDir: string) => Promise<void>;
  onOpenNewProjectDialog: () => void;
  /** 改名 / 改默认位置合并走一次 upsert（App 侧 addProject 同路径更新语义）。 */
  onUpdateProject: (p: ProjectRecord, patch: { name?: string; defaultLocation?: string }) => Promise<void>;
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
  onOpenSettings: () => void;
  onOpenAbout?: () => void;
  /** 状态点：直接进「模型与 Provider」分区（它就是为修模型服务而存在的入口，
   *  笼统地开设置页等于让用户自己找那一格）。 */
  onOpenProviderSettings?: () => void;
  /** 当前主题（头像菜单「外观」子菜单打勾用）。 */
  theme: ThemePref;
  /** 切主题（子菜单点选即生效）。 */
  onThemeChange: (t: ThemePref) => void;
  /** 当前会话用量（头像菜单「用量统计」面板读它）；null = 没有会话。 */
  usage: UsageSummary | null;
  /** 全部会话账本（v14）：状态由 App 持有；缺省 = 未接（面板仍可显示当前会话）。 */
  usageAll?: UsageAllState;
  /** 切到「全部会话」时拉取/刷新账本；主进程按 mtime 缓存，重复打开成本低。 */
  onLoadUsageAll?: () => void;
  /** 系统目录选择（「打开文件夹…」「选择克隆位置」「项目设置·更改」共用）。 */
  onPickDirectory: () => Promise<string | null>;
}

export function Sidebar(props: SidebarProps): React.JSX.Element {
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
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  const [renamingProject, setRenamingProject] = useState<{ id: string; value: string } | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; project: ProjectRecord } | null>(null);
  const [settingsFor, setSettingsFor] = useState<ProjectRecord | null>(null);
  // 用量统计面板（批 130）：头像菜单点开；锚在头像上，外点/Esc 关。
  // 批 131：面板内双口径（当前会话 / 全部会话）；关面板回到当前会话，不把上次口径当默认。
  const [usageOpen, setUsageOpen] = useState(false);
  const [usageScope, setUsageScope] = useState<UsageScope>("session");
  const usageAnchorRef = useRef<HTMLDivElement | null>(null);
  const closeUsage = useCallback(() => { setUsageOpen(false); setUsageScope("session"); }, []);
  usePopoverDismiss(usageOpen, closeUsage, usageAnchorRef);
  const changeUsageScope = (next: UsageScope): void => {
    setUsageScope(next);
    if (next === "all") props.onLoadUsageAll?.();
  };
  // 侧栏会话搜索（2026-10-18 接通）：筛选纯函数与词表（filterSessions / SESSION_FILTERS）
  // 从 P3-3 起就在 sessions-view.ts 里、也有判卷，但一直没有调用方——侧栏顶的放大镜实际打开
  // 的是 ⌘K 命令面板（整屏模态），用户点「搜索」想收窄列表，得到的却是盖住整个应用的弹窗。
  // 现在：列表上方常驻一行搜索框（有内容才出现，不占常态高度），命中走 filterSessions，
  // 空结果给一句明确的「没有匹配的会话」而不是闪回空列表。
  // ⌘K 仍是全局入口（搜命令/项目/设置），两者分工不冲突。
  const [sessionQuery, setSessionQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const searchOpen = sessionQuery.trim() !== "";

  const toggleGroup = (key: string): void => {
    if (searchOpen) setSessionQuery("");
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key) && !searchOpen) next.delete(key); else next.add(key);
      return next;
    });
  };

  const statusOf = (id: string): ReturnType<typeof sessionStatus> =>
    sessionStatus({
      running: props.running.has(id),
      waiting: props.waitingIds.has(id),
      lastOutcome: props.outcomes.get(id),
    });

  // 归档会话单列（2026-10-17）：常规项目组只吃 active；已归档进底部「已归档」分组找回。
  const { active: activeSessions, archived: archivedSessions } = splitArchived(props.sessions);
  // 搜索收窄（2026-10-18）：先过 filterSessions 再分组。空查询时 filterSessions 原样返回
  // （判卷钉过：search "" + filter all ⇒ 全量），所以常态零成本、无行为变化。
  // 搜索时归档分组也参与——用户搜一个已归档的旧会话，应该能搜到并在归档组里看到它。
  const searchTerm = sessionQuery.trim();
  const visibleActive = filterSessions(activeSessions, { search: searchTerm, filter: "all", running: props.running });
  const visibleArchived = filterSessions(archivedSessions, { search: searchTerm, filter: "all", running: props.running });
  const groups = groupByWorkspace(visibleActive, props.projects.map((p) => p.path));
  const byPath = new Map(props.projects.map((p) => [p.path, p]));
  const now = Date.now();
  const hasRowActions =
    props.onRenameSession !== undefined || props.onPinSession !== undefined ||
    props.onArchiveSession !== undefined || props.onDeleteSession !== undefined ||
    props.onOpenInCliSession !== undefined || props.onSessionWorktree !== undefined ||
    props.onAssignSessionProject !== undefined;
  // 归属项目的两条数据面：可选项（子菜单用） ＋ 行上标签（把 projectId 翻成项目名）。
  // 项目被移除而归属还在时，标签退回**原始 id**（如实地显示它还指着什么），不编一个名字。
  const projectOptions = props.projects.map((p) => ({ id: p.id, name: p.name }));
  const projectNameOf = (s: WorkspaceSession): string | null => projectLabelFor(s, projectOptions);
  // 扁平可见序（2026-10-18）：给 role=option 的 aria-posinset/setsize 用，也是 ↑↓ 键的依据。
  // 与渲染顺序同源：常规组（按项目 → 组内置顶/时间桶）在前，「已归档」组在末尾。
  // 注意这是**渲染序**，不是「打开顺序」——被折叠的组其行仍在 DOM 里（高度过渡），
  // 键盘移动靠 `.session:not([inert])` 或可见性另行过滤（见 SessionRow 的 ↑↓ 处理）。
  const flatOrder: readonly WorkspaceSession[] = [
    ...groups.flatMap((g) => projectSections(g.sessions, now).flatMap((sec) => sec.sessions)),
    ...visibleArchived,
  ];

  /** 会话行（常规组与「已归档」分组共用同一渲染面：状态图标/标题/相对时间/五种行操作）。 */
  const rowFor = (s: WorkspaceSession): React.JSX.Element => (
                    <SessionRow
                      key={s.id}
                      session={s}
                      activeId={s.workspace === props.activeWorkspace ? props.activeId : null}
                      status={statusOf(s.id)}
                      onOpen={props.onOpen}
                      posInSet={flatOrder.indexOf(s) + 1}
                      setSize={flatOrder.length}
                      renaming={renaming !== null && renaming.id === s.id}
                      renameValue={renaming !== null && renaming.id === s.id ? renaming.value : (s.title ?? s.id)}
                      hasDraft={props.draftIds?.has(s.id) === true}
                      projectName={projectNameOf(s)}
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
    <aside className="side" aria-label={STR.app.brand}>
      {/* 顶栏 48px（brief：＋ 新任务 ⌘N + 搜索 ⌘K；旧四图标行与行内表单在此下架） */}
      <div className="side-head">
        <button className="btn-primary side-new" title={withKeys(STR.sidebar.newTaskTip, "new-session")} onClick={props.onNewTask}>
          <Plus size={13} />
          {STR.sidebar.newTask}
        </button>
        {/* 2026-10-18：放大镜从「打开 ⌘K 命令面板」改为「聚焦侧栏搜索框」。
            此前它打开的是整屏模态——用户点「搜索」想收窄左侧列表，得到的却是盖住整个应用的弹窗，
            列表一屏没变。真正的列表筛选（filterSessions）自此有入口。
            ⌘K 仍是全局入口（搜命令/项目/设置），不冲突：一个收窄本栏，一个跨面跳转。 */}
        <button className="iconbtn" aria-label={STR.sidebar.search} title={withKeys(STR.sidebar.searchTip, "palette")} onClick={() => { searchInputRef.current?.focus(); searchInputRef.current?.select(); }}>
          <Search size={14} />
        </button>
      </div>

      {/* 侧栏会话搜索（2026-10-18 接通）：常驻一行，有内容才显示清空钮；Esc 两级语义——
          有字先清空，空着才让给全局（关浮层/停本轮，见 App 的 Esc 分支）。
          ⏎ 直接打开第一个命中（搜索的终点就是打开它）。 */}
      <div className="side-search">
        <Search size={12} aria-hidden="true" />
        <input
          ref={searchInputRef}
          className="side-search-input"
          type="text"
          value={sessionQuery}
          placeholder={STR.sidebar.searchPlaceholder}
          aria-label={STR.sidebar.search}
          onChange={(e) => { setSessionQuery(e.target.value); }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              if (sessionQuery !== "") { setSessionQuery(""); return; }
              searchInputRef.current?.blur();
              return;
            }
            if (e.key === "Enter") {
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

      {props.notice !== null && props.notice !== undefined && props.notice !== "" && (
        <div className="side-notice" role="status">{props.notice}</div>
      )}

      {/* 会话列表的 ARIA 结构（2026-10-18 补）：此前每行是裸 role=button，读屏念不出
          「第几项 / 共几项」，方向键也无从判断边界。listbox + option 是「一组可选项、一次选一个」
          的正解；行内「…」按钮是 option 的子控件（listbox 允许 option 内含可聚焦后代）。
          分组标题用 role=group 包住各自的 option，读屏能报出「哪个项目里第几项」。 */}
      <nav className="sidenav" role="listbox" aria-label={STR.sidebar.listAria} aria-busy={props.loading === true}>
        {/* 首屏读取中（2026-10-18）：三条骨架只占位，不摆「还没有任务」——
            用户没有『空』这个事实，只有『还没读完』这个事实。 */}
        {props.loading === true && (
          <div className="side-skeleton" role="presentation" aria-hidden="true">
            {[0, 1, 2].map((i) => <div className="side-skeleton-row" key={i} />)}
          </div>
        )}
        {/* 读取失败（2026-10-18）：失败与空分开，并给重试入口；否则一次 IPC 抖动会被读成
            「所有会话都没了」，且永远停在空屏（sessionsLoaded 此前只会在成功时落真）。 */}
        {props.loadError === true && props.loading !== true && (
          <div className="side-empty side-load-error" role="status">
            <span>{STR.sidebar.loadFailed}</span>
            {props.onRetryLoad !== undefined && (
              <button className="btn-ghost side-retry" onClick={props.onRetryLoad}>{STR.sidebar.retry}</button>
            )}
          </div>
        )}
        {props.loading !== true && props.loadError !== true && groups.length === 0 && visibleArchived.length === 0 && !searchOpen && (
          <div className="side-empty">{STR.sidebar.emptyList}</div>
        )}
        {/* 搜索无命中：说清「没有匹配的会话 + 当前搜索词」，不能闪回空列表——
            那会被读成「你什么都没有」，与事实不符（只是没匹配上）。 */}
        {props.loading !== true && props.loadError !== true && searchOpen && groups.length === 0 && visibleArchived.length === 0 && (
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
          const sections = projectSections(g.sessions, now);
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
                        if (e.key === "Enter") {
                          e.preventDefault();
                          const v = renamingProject.value.trim();
                          if (v !== "" && v !== project.name) void props.onUpdateProject(project, { name: v });
                          setRenamingProject(null);
                        } else if (e.key === "Escape") {
                          e.preventDefault();
                          setRenamingProject(null);
                        }
                      }}
                      onBlur={() => {
                        const v = renamingProject.value.trim();
                        if (v !== "" && project !== null && v !== project.name) void props.onUpdateProject(project, { name: v });
                        setRenamingProject(null);
                      }}
                    />
                  ) : (
                    <span className="g-name">{isTemp ? STR.sidebar.tempChats : (project?.name ?? workspaceLabel(g.workspace))}</span>
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
                  {sections.map((sec) => (
                    <div key={sec.kind === "pinned" ? "pinned" : sec.bucket} className="sess-section">
                      {/* 置顶段不摆标签（钉形图标已自证）；时间桶摆标签 */}
                      {sec.kind === "time" && <div className="s-bucket">{BUCKET_LABEL[sec.bucket]}</div>}
                      {sec.sessions.map((s) => rowFor(s))}
                    </div>
                  ))}
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

      {/* 页脚 48px：模型服务状态点 + 头像。
          **页脚不再常驻「设置」按钮**（2026-10-20 批 130）：设置入口收进头像菜单——
          同一个语义两处入口是本仓反复要治的病（批 #128 同类：主页叠两个同名项目 chip）。
          状态点仍在页脚常驻：它是「模型服务可用/不可用」的常驻事实位，不是设置入口的重复。 */}
      <footer className="side-foot">
        <button
          className="provider-dot"
          data-ok={props.providerOk === null ? "unknown" : props.providerOk ? "ok" : "bad"}
          aria-label={props.providerOk === null ? STR.footer.providerUnknown : props.providerOk ? STR.footer.providerOk : STR.footer.providerBad}
          title={props.providerOk === null ? STR.footer.providerUnknown : props.providerOk ? STR.footer.providerOk : STR.footer.providerBad}
          onClick={props.onOpenProviderSettings ?? props.onOpenSettings}
        />
        <div className="foot-avatar-wrap">
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button className="avatar" aria-label={STR.footer.accountTip} title={STR.footer.accountTip}>
                <Settings2 size={15} aria-hidden="true" />
                <span>{STR.footer.preferences}</span>
                <ChevronRight size={12} aria-hidden="true" />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content
              className="pop-rd pop-account"
              side="top"
              align="end"
              sideOffset={6}
              collisionPadding={10}
            >
              {/* 外观：主题三选一（子菜单，当前项打勾）。给的是快捷切换，
                  完整的外观面（主题 + 文字大小 + 界面密度）在设置页「通用」分区。 */}
              <DropdownMenu.Sub>
                <DropdownMenu.SubTrigger className="menu-item">
                  <span>{STR.footer.appearance}</span>
                </DropdownMenu.SubTrigger>
                <DropdownMenu.SubContent className="pop-rd" sideOffset={2}>
                  {THEME_CHOICES.map((t) => (
                    <DropdownMenu.Item key={t.id} className="menu-item" onSelect={() => { props.onThemeChange(t.id); }}>
                      <span>{t.label}</span>
                      {props.theme === t.id && <span className="check" aria-hidden="true">✓</span>}
                    </DropdownMenu.Item>
                  ))}
                </DropdownMenu.SubContent>
              </DropdownMenu.Sub>
              {/* 用量统计：开一个贴着头像的面板（当前会话口径，面板自己写明口径）。 */}
              <DropdownMenu.Item className="menu-item" onSelect={() => { setUsageOpen(true); }}>
                <span>{STR.footer.usage}</span>
              </DropdownMenu.Item>
              <DropdownMenu.Separator className="menu-sep" />
              <DropdownMenu.Item
                className="menu-item"
                title={withKeys(STR.footer.settingsTip, "settings")}
                onSelect={() => { props.onOpenSettings(); }}
              >
                <span>{STR.footer.settings}</span>
                {/* 键位从 SHORTCUTS 表取（不手抄——哨兵判卷盯的就是这个） */}
                {keysOf("settings") !== null && <span className="sub">{keysOf("settings")}</span>}
              </DropdownMenu.Item>
              {props.onOpenAbout !== undefined && (
                <DropdownMenu.Item className="menu-item" onSelect={() => { props.onOpenAbout?.(); }}>{STR.footer.about}</DropdownMenu.Item>
              )}
            </DropdownMenu.Content>
          </DropdownMenu.Root>
        </div>
        {/* 用量统计面板：锚在**侧栏**右下角（不是头像旁）——面板宽 184px、侧栏最窄 200px，
            贴头像锚会把它推到窗口左缘外裁掉标题行。 */}
        {usageOpen && (
          /* 锚：0×0 的定位点。面板本体在锚里 ⇒ 外点判定（usePopoverDismiss）
             不会把「点面板内部」判成外点。 */
          <div className="usage-anchor" ref={usageAnchorRef}>
            <Popover open up className="usage-pop" role="dialog" aria-label={STR.footer.usageTitle}>
              <UsagePanel
                scope={usageScope}
                onScopeChange={changeUsageScope}
                usage={props.usage}
                all={props.usageAll ?? { status: "idle" }}
                onRetry={() => { props.onLoadUsageAll?.(); }}
              />
            </Popover>
          </div>
        )}
      </footer>

      {ctxMenu !== null && (
        <ProjectContextMenu
          at={{ x: ctxMenu.x, y: ctxMenu.y }}
          onClose={() => { setCtxMenu(null); }}
          onReveal={() => { props.onRevealProject(ctxMenu.project); }}
          onRename={() => { setRenamingProject({ id: ctxMenu.project.id, value: ctxMenu.project.name }); }}
          onSettings={() => { setSettingsFor(ctxMenu.project); }}
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
