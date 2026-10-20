// 窗格快捷键的单一事实源（批 100，接「shortcuts.ts 与 App switch 无互锁」）。
// 键位、速查表文案、dispatch 落点都从这张表来：改一处两端同时变，不会再出现
// 「表里写了、App 没接」或「App 接了、表里没写」。
import type { PaneKind } from "./components/panes";

export interface PaneShortcutSpec {
  kind: PaneKind;
  /** 速查表显示的键位。 */
  keys: string;
  /** 速查表说明。 */
  what: string;
  /** KeyboardEvent.code（物理键位，不受输入法/布局字符影响）。 */
  code: string;
  /** "cmd" = ⌘ 或 Ctrl 均可（沿用全局键门的历史口径）；"ctrl" = 只认 Ctrl（终端键 Ctrl+`）。 */
  mod: "cmd" | "ctrl";
  shift: boolean;
  alt: boolean;
}

export const PANE_SHORTCUTS: readonly PaneShortcutSpec[] = [
  { kind: "changes", keys: "⌘⇧D", what: "变更窗格（审阅本会话改动）", code: "KeyD", mod: "cmd", shift: true, alt: false },
  { kind: "plan", keys: "⌘⇧P", what: "方案窗格（计划与决议）", code: "KeyP", mod: "cmd", shift: true, alt: false },
  { kind: "tasks", keys: "⌘⇧T", what: "任务窗格（子任务进度）", code: "KeyT", mod: "cmd", shift: true, alt: false },
  { kind: "file", keys: "⌘⇧F", what: "文件窗格（工作区文件树）", code: "KeyF", mod: "cmd", shift: true, alt: false },
  { kind: "browser", keys: "⌘⇧B", what: "浏览器窗格", code: "KeyB", mod: "cmd", shift: true, alt: false },
  { kind: "terminal", keys: "Ctrl+`", what: "终端窗格", code: "Backquote", mod: "ctrl", shift: false, alt: false },
  { kind: "sidechat", keys: "⌘;", what: "旁路对话窗格（不回写主会话）", code: "Semicolon", mod: "cmd", shift: false, alt: false },
];

export interface PaneKeyMods {
  meta: boolean;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
}

/** 窗格键位展示文案（tooltip/速查表共用这一处，别在调用点手抄）。 */
export function paneShortcutKeys(kind: PaneKind): string {
  return PANE_SHORTCUTS.find((s) => s.kind === kind)?.keys ?? "";
}

/** 物理键 + 修饰键 → 要开合的窗格；不匹配（含多按了修饰键）返回 null。 */
export function paneShortcutFor(code: string, mods: PaneKeyMods): PaneKind | null {
  for (const s of PANE_SHORTCUTS) {
    if (s.code !== code || s.shift !== mods.shift || s.alt !== mods.alt) continue;
    if (s.mod === "cmd") {
      if (!(mods.meta || mods.ctrl)) continue;
    } else if (!mods.ctrl || mods.meta) {
      continue;
    }
    return s.kind;
  }
  return null;
}
