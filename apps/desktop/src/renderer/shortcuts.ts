// ⌘/ 快捷键速查表数据（蓝本 §3.6「查看全部」）。单一事实源：App 的弹层只消费本表；
// 表格只列**已实现**的键（不摆没接的键位当装饰——诚实口径）。
// P3-3 起分两张表（brief 九节「统一在设置里展示，tooltip 里同步显示」）：
//   · SHORTCUT_GROUPS = 完整速查（⌘/ 弹层；既有全量）；
//   · SHORTCUTS = 核心键单一事实源（设置页「快捷键」区渲染；Sidebar/命令面板 tooltip 取键）。
// 批 100：窗格族（7 个）改从 pane-shortcuts.ts 生成——键位与 App dispatch 同源，不再手抄两份。
import { PANE_SHORTCUTS } from "./pane-shortcuts";
import { STR } from "./strings";
export interface ShortcutRow {
  keys: string;
  what: string;
}

export interface ShortcutGroup {
  title: string;
  rows: readonly ShortcutRow[];
}

export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = [
  {
    title: STR.shortcutTable.session,
    rows: [
      { keys: "⌘N", what: STR.shortcutTable.newSession },
      { keys: "⌘O", what: STR.shortcutTable.openFolder },
      { keys: "⌘K", what: STR.shortcutTable.palette },
      { keys: "⌘F", what: STR.shortcutTable.find },
      { keys: "⌘G / ⇧⌘G", what: STR.shortcutTable.findNext },
      { keys: "⌘W", what: STR.shortcutTable.closeSession },
      { keys: "F2", what: STR.shortcutTable.rename },
      { keys: "Ctrl+Tab / Ctrl+⇧+Tab", what: STR.shortcutTable.cycleTab },
      { keys: "⌘⇧] / ⌘⇧[", what: STR.shortcutTable.cycleSession },
      { keys: "⌘B", what: STR.shortcutTable.sidebar },
      { keys: "⌘⌥B", what: STR.shortcutTable.pluginSidebar },
      { keys: "⌘⌥I", what: STR.shortcutTable.inspector },
      { keys: "⌘⌥M", what: STR.shortcutTable.pluginOverlay },
    ],
  },
  {
    title: STR.shortcutTable.pane,
    rows: [
      { keys: "⌘\\", what: STR.shortcutTable.closePane },
      ...PANE_SHORTCUTS.map((s) => ({ keys: s.keys, what: s.what })),
      { keys: "⌘⇧S", what: STR.shortcutTable.browserSelect },
    ],
  },
  {
    title: STR.shortcutTable.viewInput,
    rows: [
      { keys: "Ctrl+O", what: STR.shortcutTable.cycleView },
      { keys: "⌘⇧I", what: STR.shortcutTable.modelMenu },
      { keys: "⌘⇧M", what: STR.shortcutTable.permissionMenu },
      { keys: "⌘⇧E", what: STR.shortcutTable.thinkingMenu },
      { keys: "⌘⌥F", what: STR.shortcutTable.focusMode },
      { keys: "⌘,", what: STR.shortcutTable.settings },
      { keys: "⌘/", what: STR.shortcutTable.cheatSheet },
      { keys: "⌘↑ / ⌘↓", what: STR.shortcutTable.scrollEdge },
      { keys: "Tab", what: STR.shortcutTable.suggest },
      { keys: "Enter", what: STR.shortcutTable.send },
      { keys: "⌘↩", what: STR.shortcutTable.sendInterrupt },
      { keys: "⌘.", what: STR.shortcutTable.stop },
      { keys: "Esc", what: STR.shortcutTable.esc },
    ],
  },
];

/** 核心快捷键（brief 九节 7 项 + ⏎/⇧⏎ 两行；P3-3 单一事实源）。 */
export interface ShortcutSpec {
  id: string;
  keys: string;
  label: string;
}

export const SHORTCUTS: readonly ShortcutSpec[] = [
  { id: "new-session", keys: "⌘N", label: STR.shortcut.newTask },
  { id: "open-folder", keys: "⌘O", label: STR.shortcut.openFolder },
  { id: "palette", keys: "⌘K", label: STR.shortcut.palette },
  { id: "sidebar", keys: "⌘B", label: STR.shortcut.sidebar },
  { id: "find", keys: "⌘F", label: STR.shortcut.find },
  { id: "rename", keys: "F2", label: STR.shortcut.rename },
  { id: "inspector", keys: "⌘⌥I", label: STR.shortcut.inspector },
  { id: "stop", keys: "⌘.", label: STR.shortcut.stop },
  // 2026-11-02：与 SHORTCUT_GROUPS（防漂见证）统一键序；两表此前写法相反。
  { id: "cycle-session", keys: "⌘⇧] / ⌘⇧[", label: STR.shortcut.cycleSession },
  { id: "settings", keys: "⌘,", label: STR.shortcut.settings },
  { id: "send", keys: "⏎", label: STR.shortcut.send },
  { id: "newline", keys: "⇧⏎", label: STR.shortcut.newline },
  { id: "cheat-sheet", keys: "⌘/", label: STR.shortcut.cheatSheet },
];

/** 表内取键（tooltip/命令面板用——键位只在这张表里改，消费面自动跟）。 */
export function keysOf(id: string): string | null {
  return SHORTCUTS.find((s) => s.id === id)?.keys ?? null;
}
