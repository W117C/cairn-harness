// 命令面板（P3-3 · brief 八）：⌘K 或侧栏搜索钮打开；可搜 会话 / 项目 / 设置页 / 常用操作；
// 键盘优先（cmdk 默认 ↑↓/⏎；Esc 由 Radix Dialog 收）。操作条目全部复用 App 既有能力（不另起炉灶）。
// 键位提示从 SHORTCUTS 表取（keysOf——单一事实源，防漂移）。
// 技能分组：现无插件/技能数据面（preload 未暴露任何 plugin/skill 键）⇒ **不摆空组**；
// 接上数据面后再并入（P3 汇报已注明）。
import { Command } from "cmdk";
import { useNow } from "../useNow";
import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import { relativeTime } from "../projections";
import { sessionTime, type WorkspaceSession } from "../sessions-view";
import { keysOf } from "../shortcuts";
import { SECTIONS, type SectionId } from "./settings-nav";

export type PaletteAction = "new-session" | "open-folder" | "new-project" | "toggle-theme" | "cycle-perm" | "toggle-inspector" | "copy-transcript" | "export-transcript" | "find-in-session" | "compact" | "toggle-sidebar";

/** 操作组条目表（shortcutId 从 SHORTCUTS 取键位——表里改键，这里自动跟）。 */
const OPS: readonly { id: PaletteAction; label: string; shortcutId?: string }[] = [
  { id: "new-session", label: "新任务", shortcutId: "new-session" },
  { id: "open-folder", label: "打开文件夹", shortcutId: "open-folder" },
  { id: "new-project", label: "添加项目" },
  { id: "toggle-theme", label: "切换主题" },
  { id: "cycle-perm", label: "切换权限档" },
  { id: "toggle-sidebar", label: "开合侧栏", shortcutId: "sidebar" },
  { id: "toggle-inspector", label: "开合检查器", shortcutId: "inspector" },
  { id: "copy-transcript", label: "复制整段对话" },
  { id: "find-in-session", label: "在当前会话中查找", shortcutId: "find" },
  { id: "compact", label: "压缩当前会话历史" },
  { id: "export-transcript", label: "导出整段对话（Markdown 文件）" },
];

export interface PaletteContentProps {
  sessions: readonly WorkspaceSession[];
  projects: readonly { id: string; name: string; path: string }[];
  onOpenSession: (id: string) => void;
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
  return (
    <>
      {/* 搜索行（2026-10-17）：图标 + 吃满面板宽度的输入框。此前 .cp-input 不设宽，实测 186px，
          占位符被截半句；行容器补图标后与 Claude 命令面板同形。 */}
      <div className="cp-search">
        <Search size={14} className="cp-search-ico" aria-hidden="true" />
        <Command.Input className="cp-input" placeholder="搜索会话、项目、设置与常用操作…" autoFocus />
      </div>
      <Command.List className="cp-list">
        <Command.Empty className="cp-empty">没有匹配的结果</Command.Empty>
        <Command.Group heading="操作" className="cp-group">
          {OPS.map((op) => {
            const k = op.shortcutId !== undefined ? keysOf(op.shortcutId) : null;
            return (
              <Command.Item key={op.id} className="cp-item" onSelect={() => props.onAction(op.id)}>
                <span className="cp-label">{op.label}</span>
                {k !== null && <span className="cp-keys">{k}</span>}
              </Command.Item>
            );
          })}
        </Command.Group>
        {visible.length > 0 && (
          <Command.Group heading="会话" className="cp-group">
            {visible.slice(0, 30).map((s) => (
              <Command.Item key={s.id} className="cp-item" onSelect={() => props.onOpenSession(s.id)}>
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
                  <span className="cp-label">重命名当前会话</span>
                  <span className="cp-keys">F2</span>
                </Command.Item>
                <Command.Item
                  className="cp-item"
                  value="归档当前会话"
                  onSelect={() => { props.onSessionAction?.("archive", props.activeSessionId ?? ""); }}
                >
                  <span className="cp-label">归档当前会话</span>
                </Command.Item>
                <Command.Item
                  className="cp-item"
                  value="删除当前会话"
                  onSelect={() => { props.onSessionAction?.("delete", props.activeSessionId ?? ""); }}
                >
                  <span className="cp-label">删除当前会话</span>
                </Command.Item>
              </>
            )}
          </Command.Group>
        )}
        {props.projects.length > 0 && (
          <Command.Group heading="项目" className="cp-group">
            {props.projects.map((p) => (
              <Command.Item key={p.id} className="cp-item" onSelect={() => props.onSwitchWorkspace(p.path)}>
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
            <Command.Item key={s.id} value={`设置 ${s.label}`} className="cp-item" onSelect={() => props.onOpenSettings(s.id)}>
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
