// C-03/04/05/06/08 侧栏（v1.1 参考图口径）：SideHeader（新会话钮 + 功能菜单 + 工作区区头）→
// SideNav（ProjectGroup 折叠组 × SessionItem）→ SidebarFooter（设置入口 + 用户 chip 占位）。
// 分组纯函数 groupByWorkspace 是既有被测试资产，原样保留；「其他」哨兵组语义不变（防吞数据）。
// 状态点 C-07 五态词表：仅 running / waiting / error 在列表显示（v1.1 口径，done/idle 保持安静）。
import { useState, type FormEvent } from "react";
import type { SessionInfoPayload } from "../../../../../src/main/ipc-protocol";
import { relativeTime } from "../projections";
import type { RunPhase } from "../projections";
import { Ic } from "./icons";

/** host.listSessions() 的 desktop 扩展形状：每条带归属工作区（T1 合并清单的归组标记）。
 *  ipc-protocol 的 AgentApi.listSessions 尚未摊平该字段，渲染层以交叉类型收窄（同 aborted 先例）。 */
export type WorkspaceSession = SessionInfoPayload & { workspace: string };

export interface WorkspaceGroup {
  /** 注册工作区的 canonical 绝对路径；「其他」组＝OTHER_WORKSPACE 哨兵。 */
  workspace: string;
  sessions: WorkspaceSession[];
}

/** 「其他」组哨兵：真实工作区恒为 canonical 绝对路径（project-registry realpath 保证），
 *  空串不可能与之相撞；切工作区入口对哨兵组关闭（新任务不能落未注册工作区）。 */
export const OTHER_WORKSPACE = "";

/** 分组纯函数（任务书 Interfaces 逐字）：已注册工作区全列（空组也列、保持注册顺序），
 *  会话按归属落组；未登记工作区的会话不丢——归「其他」组垫底（防 listProjects 与盘上
 *  漂移时静默吞数据）。workspaces 重复条目去重（registry 保 path 唯一，纯函数不信任上游）。 */
export function groupByWorkspace(
  sessions: readonly WorkspaceSession[],
  workspaces: readonly string[],
): WorkspaceGroup[] {
  const seen = new Set<string>();
  const groups: WorkspaceGroup[] = [];
  for (const workspace of workspaces) {
    if (seen.has(workspace)) continue;
    seen.add(workspace);
    groups.push({ workspace, sessions: sessions.filter((s) => s.workspace === workspace) });
  }
  const others = sessions.filter((s) => !seen.has(s.workspace));
  if (others.length > 0) groups.push({ workspace: OTHER_WORKSPACE, sessions: others });
  return groups;
}

/** 分组标题＝路径末段（注册工作区）；「其他」组显示固定名。 */
function workspaceLabel(workspace: string): string {
  if (workspace === OTHER_WORKSPACE) return "其他";
  return workspace.slice(workspace.lastIndexOf("/") + 1) || workspace;
}

/** C-07 StatusDot 列表口径：running（橙·呼吸）/ waiting（蓝·脉冲环）/ error（红）；done/idle 不显示。 */
function StatusDot(props: { running: boolean; waiting: boolean; error: boolean }) {
  const cls = props.running ? "dot running" : props.waiting ? "dot waiting" : props.error ? "dot error" : null;
  if (cls === null) return null;
  return (
    <span
      className={cls}
      aria-hidden="true"
      title={props.running ? "运行中" : props.waiting ? "等待你的决定" : "出错"}
    />
  );
}

function SessionRow(props: {
  session: WorkspaceSession;
  activeId: string | null;
  dot: "none" | "running" | "waiting" | "error";
  onOpen: (id: string) => void;
}) {
  const s = props.session;
  const parsed = s.updatedAt ? Date.parse(s.updatedAt) : NaN;
  const timeMs = Number.isFinite(parsed) ? parsed : s.mtimeMs;
  return (
    <div
      className={"session" + (s.id === props.activeId ? " active" : "")}
      data-active={s.id === props.activeId}
      onClick={() => props.onOpen(s.id)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter") props.onOpen(s.id); }}
    >
      <StatusDot running={props.dot === "running"} waiting={props.dot === "waiting"} error={props.dot === "error"} />
      <span className="s-title">{s.title ?? s.id}</span>
      {Number.isFinite(timeMs) && <span className="s-time">{relativeTime(Date.now(), timeMs)}</span>}
    </div>
  );
}

export function Sidebar(props: {
  sessions: WorkspaceSession[];
  /** 已注册工作区（ProjectRecord.path，canonical 绝对路径）。 */
  workspaces: readonly string[];
  activeId: string | null;
  /** 当前新任务归属工作区；null＝host 缺省（尚未显式切换）。 */
  activeWorkspace: string | null;
  running: Set<string>;
  /** 活跃会话的相位（waiting 点用）；null＝无活跃或空闲。 */
  pendingPhase: RunPhase;
  /** 活跃会话是否在等门（ask/clarify/plan）。 */
  activePending: boolean;
  /** 活跃会话最近一轮是否失败（error 点）。 */
  lastRoundFailed: boolean;
  /** 活跃会话是否已停止。 */
  stopped: boolean;
  onOpen: (id: string) => void;
  /** 新会话按钮：回到空态并聚焦 Composer（App 负责焦点）。 */
  onNewSession: () => void;
  onSwitchWorkspace: (workspace: string) => void;
  /** addProject 桥调用（App 提供）；reject 时错误落表单内 fail-visible。 */
  onAddWorkspace: (path: string) => Promise<void>;
  /** M4-5：系统目录选择（AgentApi.pickDirectory）。必选而非 `?`：桥面缺行 typecheck 红。 */
  onPickDirectory: () => Promise<string | null>;
  /** 注册表桥不可用等的提示行（fail-visible；null＝无）。 */
  notice?: string | null;
  onOpenSettings: () => void;
  /** 头像菜单 → 「设置 → 关于与更新」（版本/检查更新的去处；缺省不给就不出菜单）。 */
  onOpenAbout?: () => void;
  /** C-03 功能菜单 → 应用页（v2.6 四页）。 */
  onOpenPage: (page: "plugins" | "automation" | "skills" | "memory") => void;
}) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [filter, setFilter] = useState<SessionFilterId>("all");
  const visible = filterSessions(props.sessions, { search, filter, running: props.running });
  const groups = groupByWorkspace(visible, props.workspaces);
  const filtering = search.trim() !== "" || filter !== "all";
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [userPop, setUserPop] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const path = draft.trim();
    if (path.length === 0) {
      setError("请输入工作区的绝对路径");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await props.onAddWorkspace(path);
      setDraft("");
      setAdding(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  // M4-5「浏览…」：系统目录选择 → 成功 ⇒ 填入路径输入框；取消 ⇒ null 草稿不动。手输兜底保留。
  const browse = async () => {
    setError(null);
    try {
      const picked = await props.onPickDirectory();
      if (picked !== null) setDraft(picked);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const toggleGroup = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  return (
    <aside className="sidebar">
      <div className="side-top">
        <button className="newtask-btn" onClick={props.onNewSession}>
          <Ic.compose size={15} />
          <span>新会话</span>
        </button>
        <nav className="side-menu" aria-label="功能导航">
          {([
            { page: "plugins", label: "插件", icon: <Ic.plugins size={15} /> },
            { page: "automation", label: "自动化任务", icon: <Ic.clock size={15} /> },
            { page: "skills", label: "技能中心", icon: <Ic.book size={15} /> },
            { page: "memory", label: "记忆系统", icon: <Ic.memory size={15} /> },
          ] as const).map((m) => (
            <button key={m.page} className="menu-row" onClick={() => props.onOpenPage(m.page)}>
              <span className="mi" aria-hidden="true">{m.icon}</span>
              {m.label}
            </button>
          ))}
        </nav>
        <div className="section-head">
          <span className="sec-label">工作区{filtering ? `（筛选中 ${String(visible.length)}/${String(props.sessions.length)}）` : ""}</span>
          <button
            className="iconbtn sm"
            aria-label="搜索会话"
            aria-expanded={searchOpen}
            onClick={() => setSearchOpen((v) => !v)}
          >
            <Ic.search size={14} />
          </button>
          <button
            className="iconbtn sm"
            aria-label="筛选会话"
            aria-expanded={filterOpen}
            onClick={() => setFilterOpen((v) => !v)}
          >
            <Ic.filter size={14} />
          </button>
          <button className="iconbtn sm" aria-label="新建工作区" onClick={() => { setAdding((v) => !v); setError(null); }}>
            <Ic.folderPlus size={14} />
          </button>
        </div>
        {filterOpen && (
          <div className="pop down show" role="menu" aria-label="筛选会话">
            <div className="pop-label">筛选会话</div>
            {SESSION_FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                role="menuitemradio"
                aria-checked={filter === f.id}
                className="menu-item"
                onClick={() => { setFilter(f.id); setFilterOpen(false); }}
              >
                <span>{f.label}</span>
                {filter === f.id && <span className="check">✓</span>}
              </button>
            ))}
            <div className="menu-note">{SESSION_FILTER_NOTE}</div>
          </div>
        )}
        {searchOpen && (
          <div className="ws-search-row show">
            <input
              autoFocus
              aria-label="搜索会话"
              placeholder="按标题或 id 搜"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <button className="mini-btn" type="button" onClick={() => { setSearch(""); setSearchOpen(false); }}>清除</button>
          </div>
        )}
        {adding && (
          <form className="ws-add-row show" onSubmit={(e) => void submit(e)}>
            <input
              value={draft}
              placeholder="/绝对/路径/到/工作区"
              autoFocus
              onChange={(e) => setDraft(e.target.value)}
            />
            <button className="btn secondary" type="button" disabled={busy} onClick={() => void browse()}>浏览…</button>
            <button className="btn primary" type="submit" disabled={busy}>{busy ? "添加中…" : "添加"}</button>
            {error !== null && <div className="form-error">{error}</div>}
          </form>
        )}
        {props.notice !== null && props.notice !== undefined && props.notice !== "" && (
          <div className="menu-note">{props.notice}</div>
        )}
      </div>
      <nav className="sidenav" aria-label="会话导航">
        {groups.map((g) => {
          // 「其他」组只是防吞数据的兜底展示：新任务不能落未注册工作区 ⇒ 头部不可点、不参与切换。
          const key = g.workspace === OTHER_WORKSPACE ? "其他" : g.workspace;
          const switchable = g.workspace !== OTHER_WORKSPACE;
          const isCollapsed = collapsed.has(key);
          const activeGroup = switchable && g.workspace === props.activeWorkspace;
          return (
            <div key={key} className="group" data-active={activeGroup} data-collapsed={isCollapsed} data-sentinel={!switchable}>
              <button
                className="group-head"
                title={switchable ? g.workspace : undefined}
                aria-expanded={!isCollapsed}
                onClick={() => {
                  if (!switchable) return;
                  props.onSwitchWorkspace(g.workspace);
                }}
              >
                <span className="g-folder" aria-hidden="true">
                  <Ic.folder size={14} />
                </span>
                <span className="g-name">{workspaceLabel(g.workspace)}</span>
                <span
                  className="g-chev"
                  aria-hidden="true"
                  onClick={(e) => { e.stopPropagation(); toggleGroup(key); }}
                >
                  <Ic.chevronRight size={10} />
                </span>
              </button>
              <div className="group-body">
                {g.sessions.map((s) => {
                  const isActive = s.id === props.activeId;
                  const dot: "none" | "running" | "waiting" | "error" =
                    props.running.has(s.id) ? "running"
                    : isActive && props.activePending && props.pendingPhase !== "idle" ? "waiting"
                    : isActive && props.lastRoundFailed ? "error"
                    : "none";
                  return (
                    <SessionRow key={s.id} session={s} activeId={props.activeId} dot={dot} onOpen={props.onOpen} />
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>
      <footer className="sidefooter">
        <button className="foot-btn" onClick={props.onOpenSettings}>
          <Ic.settings size={14} />
          设置
        </button>
        {props.onOpenAbout !== undefined && (
          <div style={{ position: "relative" }}>
            <button
              className="avatar"
              aria-haspopup="menu"
              aria-label="本机用户"
              title="本机用户"
              onClick={() => setUserPop((v) => !v)}
            >Z</button>
            {userPop && (
              <div className="pop up show" role="menu" style={{ left: "auto", right: 0, minWidth: 220 }}>
                <div className="pop-label">本机 · Z</div>
                <button className="menu-item" role="menuitem" onClick={() => { setUserPop(false); props.onOpenAbout?.(); }}>
                  <span>版本 0.1.0</span><span className="check">→</span>
                </button>
                <button className="menu-item" role="menuitem" onClick={() => { setUserPop(false); props.onOpenAbout?.(); }}>
                  <span>检查更新</span><span className="check">→</span>
                </button>
                <div className="menu-note">两项均跳转「设置 → 关于与更新」。</div>
              </div>
            )}
          </div>
        )}
      </footer>
    </aside>
  );
}

/** ⑤ 左栏筛选（对齐 prototype.html 的 `.section-head` + `.pop down` 菜单形态）。
 *
 *  **为什么不是原型那六个状态**：原型的 全部/运行中/等待决定/出错/已完成/空闲 是**实时运行态**，
 *  而 `SessionInfoPayload` 里没有这个字段（只有 mtime/固定/归档/定时任务这些**属性**）。
 *  摆一排点了没反应的菜单项，正是用户反馈 ④ 说的「按键细节不到位」。所以这里只列
 *  **今天有数据支撑**的那几项，并在菜单脚注里把缺的那半边说清楚（同原型的 `.menu-note` 口吻）。 */
export const SESSION_FILTERS = [
  { id: "all", label: "全部" },
  { id: "running", label: "运行中" },
  { id: "pinned", label: "已固定" },
  { id: "archived", label: "已归档" },
  { id: "scheduled", label: "定时任务" },
] as const;

export type SessionFilterId = (typeof SESSION_FILTERS)[number]["id"];

export const SESSION_FILTER_NOTE =
  "运行中 = 本进程里正在跑的会话；已固定 / 已归档 / 定时任务按会话属性。等待决定、出错、已完成这类实时状态要等会话索引接上后再加，先不摆空壳。";

export function matchSession(
  s: { id: string; title?: string; pinned?: boolean; archived?: boolean; origin?: "scheduled" },
  input: { search: string; filter: SessionFilterId; running?: ReadonlySet<string> },
): boolean {
  const q = input.search.trim().toLowerCase();
  if (q !== "") {
    const hay = `${s.title ?? ""} ${s.id}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }
  switch (input.filter) {
    case "all":
      return true;
    case "running":
      return input.running?.has(s.id) === true;
    case "pinned":
      return s.pinned === true;
    case "archived":
      return s.archived === true;
    case "scheduled":
      return s.origin === "scheduled";
  }
}

export function filterSessions<T extends { id: string; title?: string; pinned?: boolean; archived?: boolean; origin?: "scheduled" }>(
  sessions: readonly T[],
  input: { search: string; filter: SessionFilterId; running?: ReadonlySet<string> },
): T[] {
  return sessions.filter((s) => matchSession(s, input));
}
