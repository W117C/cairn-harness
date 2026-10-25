// 命令面板（P3-3 · brief 八）：⌘K 或侧栏搜索钮打开；可搜 会话 / 项目 / 设置页 / 常用操作；
// 键盘优先（cmdk 默认 ↑↓/⏎；Esc 由 Radix Dialog 收）。操作条目全部复用 App 既有能力（不另起炉灶）。
// 键位提示从 SHORTCUTS 表取（keysOf——单一事实源，防漂移）。
// 技能分组（2026-10-21 批 136）：与斜杠菜单共用 App 的 skills 数据面；空则整组缺席，不摆空组。
import { Command } from "cmdk";
import { useNow } from "../useNow";
import { Archive, Copy, Download, FileText, Folder, FolderOpen, FolderPlus, MessageSquare, PanelLeft, PanelRight, Pencil, Plus, Search, Shield, Sun, Trash2, Wand2 } from "lucide-react";
import { useEffect, useState } from "react";
import { SessionSearchResults, type SessionSearchState } from "./SessionSearchResults";
import { relativeTime } from "../projections";
import { sessionTime, type WorkspaceSession } from "../sessions-view";
import { keysOf } from "../shortcuts";
import { SECTIONS, SECTION_KEYWORDS, type SectionId } from "./settings-nav";

import type { PaletteAction } from "../app-controls";
export type { PaletteAction } from "../app-controls";

/** 操作组条目表（shortcutId 从 SHORTCUTS 取键位——表里改键，这里自动跟）。
 *  2026-10-21 命令面板 2.0：每条带图标与搜索同义词；`sessionOnly` 的条目只在有活动会话时出现
 *  ——在主页摆「压缩历史」等于给一个必然报错的入口。 */
const OPS: readonly {
  id: PaletteAction;
  label: string;
  icon: React.JSX.Element;
  shortcutId?: string;
  keywords?: string;
  sessionOnly?: boolean;
}[] = [
  { id: "new-session", label: "新任务", icon: <Plus size={14} />, shortcutId: "new-session", keywords: "新建 会话 任务" },
  { id: "open-folder", label: "打开文件夹", icon: <FolderOpen size={14} />, shortcutId: "open-folder", keywords: "目录 项目 打开" },
  { id: "new-project", label: "添加项目", icon: <FolderPlus size={14} />, keywords: "创建 新建 文件夹" },
  { id: "toggle-theme", label: "切换主题", icon: <Sun size={14} />, keywords: "外观 深色 暗色 亮色" },
  { id: "cycle-perm", label: "切换权限档", icon: <Shield size={14} />, keywords: "权限 只读 自动 审批" },
  { id: "toggle-sidebar", label: "开合侧栏", icon: <PanelLeft size={14} />, shortcutId: "sidebar", keywords: "收起 展开 左侧" },
  { id: "toggle-inspector", label: "开合检查器", icon: <PanelRight size={14} />, shortcutId: "inspector", keywords: "右侧 面板 收起 展开" },
  { id: "find-in-session", label: "在当前会话中查找", icon: <Search size={14} />, shortcutId: "find", keywords: "搜索 查找", sessionOnly: true },
  { id: "copy-transcript", label: "复制整段对话", icon: <Copy size={14} />, keywords: "复制 对话 全文", sessionOnly: true },
  { id: "compact", label: "压缩当前会话历史", icon: <Archive size={14} />, keywords: "压缩 上下文 历史", sessionOnly: true },
  { id: "view-log", label: "查看当前会话日志", icon: <FileText size={14} />, keywords: "日志 错误 排障", sessionOnly: true },
  { id: "export-transcript", label: "导出整段对话（Markdown 文件）", icon: <Download size={14} />, keywords: "导出 保存 文件 markdown", sessionOnly: true },
];

/** 最近使用（只存 action id，打开面板时按当前上下文过滤）：上限 4，去重后置顶。
 *  纯函数导出给判卷；localStorage 读写留在组件内。 */
export const PALETTE_RECENT_LIMIT = 4;
const PALETTE_RECENT_KEY = "cairn.palette.recent.v1";
const ACTION_IDS: ReadonlySet<string> = new Set(OPS.map((op) => op.id));
const SESSION_ONLY: ReadonlySet<PaletteAction> = new Set(OPS.filter((op) => op.sessionOnly === true).map((op) => op.id));

function isPaletteAction(v: unknown): v is PaletteAction {
  return typeof v === "string" && ACTION_IDS.has(v);
}

export function pushRecentAction(prev: readonly PaletteAction[], id: PaletteAction): PaletteAction[] {
  return [id, ...prev.filter((x) => x !== id)].slice(0, PALETTE_RECENT_LIMIT);
}

/** 最近列表按当前上下文过滤：主页不显示会话专属动作（与操作组同一条规则）。 */
export function visibleRecentActions(prev: readonly PaletteAction[], sessionOpen: boolean): PaletteAction[] {
  return prev.filter((id) => isPaletteAction(id) && (sessionOpen || !SESSION_ONLY.has(id))).slice(0, PALETTE_RECENT_LIMIT);
}

/** 技能/命令去重（2026-10-21 评审）：插件技能与命令都可能解析成同一个 `/plugin:name`，
 *  同一 invoke 摆两行既是 React key 撞车，也让"选中哪个"没有确定答案。先到先得，保留首条。 */
export function uniqueSkills<T extends { invoke: string }>(skills: readonly T[]): T[] {
  const seen = new Set<string>();
  return skills.filter((s) => {
    if (seen.has(s.invoke)) return false;
    seen.add(s.invoke);
    return true;
  });
}

function loadRecentActions(): PaletteAction[] {
  if (typeof window === "undefined") return [];
  try {
    const raw: unknown = JSON.parse(window.localStorage.getItem(PALETTE_RECENT_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter(isPaletteAction).slice(0, PALETTE_RECENT_LIMIT) : [];
  } catch { return []; }
}

function rememberRecentAction(prev: readonly PaletteAction[], id: PaletteAction): PaletteAction[] {
  const next = pushRecentAction(prev, id);
  try { window.localStorage.setItem(PALETTE_RECENT_KEY, JSON.stringify(next)); } catch { /* 存不下则只在本次打开期间生效 */ }
  return next;
}

export interface PaletteContentProps {
  /** 正文搜索只读当前已选择的项目；标题检索仍覆盖会话清单。 */
  activeWorkspace?: string | null;
  /** 工作区技能/插件命令（与斜杠菜单同一份数据面；缺省 = 不摆空组）。 */
  skills?: readonly { invoke: string; description: string; trust: string }[];
  /** 选中技能：App 关闭面板并把 `/invoke ` 填进输入框（不直接发送）。 */
  onUseSkill?: (invoke: string) => void;
  sessions: readonly WorkspaceSession[];
  projects: readonly { id: string; name: string; path: string }[];
  onOpenSession: (id: string, workspace?: string) => void;
  onSwitchWorkspace: (path: string) => void;
  onOpenSettings: (section: SectionId) => void;
  onAction: (action: PaletteAction) => void;
  /** 单会话动作（2026-10-18 补）：改名 / 归档 / 删除此前只在侧栏行内 ⋯ 菜单里，
   *  命令面板列得出会话却不给动作——用户搜到某个会话后想改名，得关掉面板去侧栏找那一行。
   *  App 侧把行菜单的同一批 handler 传下来（requestArchiveSession 自带确认卡，delete 同）。 */
  onSessionAction?: (action: "rename" | "archive" | "delete", id: string) => void;
  /** 当前打开的会话（单会话动作的作用对象）；null = 在主页，不给这三条。 */
  activeSessionId?: string | null;
}

/** 内容面（判卷/嵌用）：Command root 由外层给——CommandPalette 用 CommandDialog 包，判卷用裸 Command。 */
export function PaletteContent(props: PaletteContentProps): React.JSX.Element {
  const visible = props.sessions.filter((s) => s.archived !== true); // 归档不列（侧栏同口径）；搜索即过滤
  const now = useNow();
  const sessionOpen = props.activeSessionId !== undefined && props.activeSessionId !== null;
  const skillItems = uniqueSkills(props.skills ?? []);
  const [query, setQuery] = useState("");
  const [recent, setRecent] = useState<PaletteAction[]>(loadRecentActions);
  const searchQuery = query.trim();
  const searchWorkspace = props.activeWorkspace ?? null;
  const [retrySearch, setRetrySearch] = useState(0);
  const [bodySearch, setBodySearch] = useState<{ query: string; workspace: string; state: SessionSearchState } | null>(null);
  useEffect(() => {
    if (searchQuery === "" || searchWorkspace === null) { setBodySearch(null); return; }
    let alive = true;
    const update = (state: SessionSearchState): void => {
      if (alive) setBodySearch({ query: searchQuery, workspace: searchWorkspace, state });
    };
    update({ status: "loading" });
    const timer = window.setTimeout(() => {
      void Promise.resolve().then(() => window.agent.sessionSearch(searchWorkspace, searchQuery)).then(
        (result) => update(result === undefined
          ? { status: "error", error: "正文搜索没有返回结果，请重试" }
          : { status: "ready", result }),
        (error: unknown) => update({ status: "error", error: `正文搜索失败：${error instanceof Error ? error.message : String(error)}` }),
      );
    }, 200);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [searchQuery, searchWorkspace, retrySearch]);
  const searchActive = searchQuery !== "" && searchWorkspace !== null;
  const searchState: SessionSearchState = bodySearch?.query === searchQuery && bodySearch.workspace === searchWorkspace
    ? bodySearch.state : { status: "loading" };

  const actions = OPS.filter((op) => op.sessionOnly !== true || sessionOpen);
  const recents = query.trim() === "" ? visibleRecentActions(recent, sessionOpen) : [];
  const runAction = (id: PaletteAction): void => {
    setRecent(rememberRecentAction(recent, id));
    props.onAction(id);
  };
  return (
    <>
      {/* 搜索行（2026-10-17）：图标 + 吃满面板宽度的输入框。此前 .cp-input 不设宽，实测 186px，
          占位符被截半句；行容器补图标后与 Claude 命令面板同形。 */}
      <div className="cp-search">
        <Search size={14} className="cp-search-ico" aria-hidden="true" />
        <Command.Input
          className="cp-input"
          placeholder="搜索会话、项目、设置与常用操作…"
          value={query}
          onValueChange={setQuery}
          autoFocus
        />
      </div>
      <Command.List className="cp-list">
        {!searchActive && <Command.Empty className="cp-empty">没有匹配的结果</Command.Empty>}
        {/* 最近使用（2026-10-21）：空查询时把最近 4 条放到最上面；输入后自然让位给搜索结果。
            只存 action id，不存文案——文案/键位仍只从 OPS 与 SHORTCUTS 取。 */}
        {recents.length > 0 && (
          <Command.Group heading="最近" className="cp-group cp-recent">
            {recents.map((id) => {
              const op = OPS.find((o) => o.id === id);
              if (op === undefined) return null;
              const k = op.shortcutId !== undefined ? keysOf(op.shortcutId) : null;
              return (
                <Command.Item
                  key={`recent-${id}`}
                  value={`最近 ${op.label} ${op.keywords ?? ""}`}
                  className="cp-item"
                  onSelect={() => { runAction(op.id); }}
                >
                  <span className="cp-ico" aria-hidden="true">{op.icon}</span>
                  <span className="cp-label">{op.label}</span>
                  {k !== null && <span className="cp-keys">{k}</span>}
                </Command.Item>
              );
            })}
          </Command.Group>
        )}
        <Command.Group heading="操作" className="cp-group">
          {actions.map((op) => {
            const k = op.shortcutId !== undefined ? keysOf(op.shortcutId) : null;
            return (
              <Command.Item
                key={op.id}
                value={`${op.label} ${op.keywords ?? ""}`}
                className="cp-item"
                onSelect={() => { runAction(op.id); }}
              >
                <span className="cp-ico" aria-hidden="true">{op.icon}</span>
                <span className="cp-label">{op.label}</span>
                {k !== null && <span className="cp-keys">{k}</span>}
              </Command.Item>
            );
          })}
        </Command.Group>
        {skillItems.length > 0 && props.onUseSkill !== undefined && (
          <Command.Group heading="技能" className="cp-group">
            {skillItems.map((sk) => {
              const pending = sk.trust !== "trusted";
              return (
                <Command.Item
                  key={`skill-${sk.invoke}`}
                  value={`技能 ${sk.invoke} ${sk.description}`}
                  className="cp-item cp-skill"
                  onSelect={() => { props.onUseSkill?.(sk.invoke); }}
                >
                  <span className="cp-ico" aria-hidden="true"><Wand2 size={14} /></span>
                  <span className="cp-stack">
                    <span className="cp-label">{sk.invoke}</span>
                    <span className="cp-sub" title={sk.description}>{sk.description}</span>
                  </span>
                  {pending && <span className="cp-trust">{sk.trust === "declined" ? "已拒绝" : "待批准"}</span>}
                </Command.Item>
              );
            })}
          </Command.Group>
        )}
        {searchActive && (
          <SessionSearchResults
            state={searchState}
            workspace={searchWorkspace}
            onOpenSession={props.onOpenSession}
            onRetry={() => { setRetrySearch((n) => n + 1); }}
          />
        )}
        {visible.length > 0 && (
          <Command.Group heading="会话" className="cp-group">
            {visible.slice(0, 30).map((s) => (
              <Command.Item key={`${s.workspace ?? ""}|${s.id}`} value={`${s.title ?? s.id} ${s.id}`} className="cp-item" onSelect={() => props.onOpenSession(s.id, s.workspace)}>
                <span className="cp-ico" aria-hidden="true"><MessageSquare size={14} /></span>
                <span className="cp-label">{s.title ?? s.id}</span>
                <span className="cp-at num">{relativeTime(now, sessionTime(s))}</span>
              </Command.Item>
            ))}
            {/* 单会话动作（2026-10-18 补）：对**当前打开的那个会话**生效，不再让用户
                关掉面板去侧栏行内找 ⋯ 菜单。归档/删除都走 App 侧带确认卡的同一入口。 */}
            {props.onSessionAction !== undefined && props.activeSessionId !== undefined && props.activeSessionId !== null && (
              <>
                <Command.Item
                  className="cp-item"
                  value="重命名当前会话"
                  onSelect={() => { props.onSessionAction?.("rename", props.activeSessionId ?? ""); }}
                >
                  <span className="cp-ico" aria-hidden="true"><Pencil size={14} /></span>
                  <span className="cp-label">重命名当前会话</span>
                  <span className="cp-keys">F2</span>
                </Command.Item>
                <Command.Item
                  className="cp-item"
                  value="归档当前会话"
                  onSelect={() => { props.onSessionAction?.("archive", props.activeSessionId ?? ""); }}
                >
                  <span className="cp-ico" aria-hidden="true"><Archive size={14} /></span>
                  <span className="cp-label">归档当前会话</span>
                </Command.Item>
                <Command.Item
                  className="cp-item"
                  value="删除当前会话"
                  onSelect={() => { props.onSessionAction?.("delete", props.activeSessionId ?? ""); }}
                >
                  <span className="cp-ico" aria-hidden="true"><Trash2 size={14} /></span>
                  <span className="cp-label">删除当前会话</span>
                </Command.Item>
              </>
            )}
          </Command.Group>
        )}
        {props.projects.length > 0 && (
          <Command.Group heading="项目" className="cp-group">
            {props.projects.map((p) => (
              <Command.Item key={p.id} value={`${p.name} ${p.path}`} className="cp-item" onSelect={() => props.onSwitchWorkspace(p.path)}>
                <span className="cp-ico" aria-hidden="true"><Folder size={14} /></span>
                <span className="cp-label">{p.name}</span>
                <span className="cp-at num">{p.path}</span>
              </Command.Item>
            ))}
          </Command.Group>
        )}
        <Command.Group heading="设置" className="cp-group">
          {SECTIONS.map((s) => (
            // value 带「设置」前缀（2026-10-17 真机实证）：占位符承诺可搜「设置」，但条目文本全是
            // 「通用 / 记忆系统…」，输入「设置」命中 0 条——把分组语义并进 value，搜索才兑现承诺。
            <Command.Item
              key={s.id}
              value={`设置 ${s.label} ${SECTION_KEYWORDS[s.id] ?? ""}`}
              className="cp-item"
              onSelect={() => props.onOpenSettings(s.id)}
            >
              <span className="cp-ico" aria-hidden="true">{s.icon}</span>
              <span className="cp-label">{s.label}</span>
            </Command.Item>
          ))}
        </Command.Group>
      </Command.List>
      {/* 键盘可发现性（Claude 形制）：↑↓ 选择 / ⏎ 打开 / esc 关闭。纯提示，不进 a11y 树。 */}
      <div className="cp-foot" aria-hidden="true">
        <span><kbd>↑</kbd> <kbd>↓</kbd> 选择</span>
        <span><kbd>⏎</kbd> 打开</span>
        <span className="cp-foot-hint"><kbd>esc</kbd> 关闭</span>
      </div>
    </>
  );
}

export function CommandPalette(props: PaletteContentProps & { open: boolean; onClose: () => void }): React.JSX.Element {
  const { open, onClose, ...rest } = props;
  const [commandRoot, setCommandRoot] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    // cmdk 1.1.1 把额外 props 放在 Command 根，而不是外层 Dialog.Content；
    // aria-modal 必须标在 role=dialog 的节点上，辅助技术才认得到。
    const dialog = commandRoot?.parentElement;
    if (dialog?.getAttribute("role") !== "dialog") return;
    dialog.setAttribute("aria-modal", "true");
    return () => { dialog.removeAttribute("aria-modal"); };
  }, [open, commandRoot]);
  return (
    <Command.Dialog
      ref={setCommandRoot}
      open={open}
      onOpenChange={(v) => { if (!v) onClose(); }}
      label="命令面板"
      className="cp-root"
      overlayClassName="cp-scrim"
      contentClassName="cp-panel"
    >
      <PaletteContent {...rest} />
    </Command.Dialog>
  );
}
