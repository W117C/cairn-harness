// ⌘/ 快捷键速查表数据（蓝本 §3.6「查看全部」）。单一事实源：App 的弹层只消费本表；
// 表格只列**已实现**的键（不摆没接的键位当装饰——诚实口径）。
// P3-3 起分两张表（brief 九节「统一在设置里展示，tooltip 里同步显示」）：
//   · SHORTCUT_GROUPS = 完整速查（⌘/ 弹层；既有全量）；
//   · SHORTCUTS = 核心键单一事实源（设置页「快捷键」区渲染；Sidebar/命令面板 tooltip 取键）。
// 批 100：窗格族（7 个）改从 pane-shortcuts.ts 生成——键位与 App dispatch 同源，不再手抄两份。
import { PANE_SHORTCUTS } from "./pane-shortcuts";
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
    title: "会话",
    rows: [
      { keys: "⌘N", what: "新会话（回到主页）" },
      { keys: "⌘O", what: "打开文件夹…（登记为新项目）" },
      { keys: "⌘K", what: "命令面板（搜索会话/项目/设置/操作）" },
      { keys: "⌘F", what: "在对话里查找（⏎ 下一个 / ⇧⏎ 上一个）" },
      { keys: "⌘G / ⇧⌘G", what: "查找下一个 / 上一个" },
      { keys: "⌘W", what: "关闭当前会话（回主页；窗口不关）" },
      { keys: "F2", what: "重命名当前会话（点工具栏会话名亦可）" },
      { keys: "Ctrl+Tab / Ctrl+⇧+Tab", what: "下一个 / 上一个会话（可在设置里关）" },
      { keys: "⌘⇧] / ⌘⇧[", what: "下一个 / 上一个会话" },
      { keys: "⌘B", what: "开关侧栏" },
      { keys: "⌘⌥B", what: "开合检查器（右侧：改动 / 计划 / 时间线）" },
    ],
  },
  {
    title: "窗格",
    rows: [
      { keys: "⌘\\", what: "关闭最近打开的窗格" },
      ...PANE_SHORTCUTS.map((s) => ({ keys: s.keys, what: s.what })),
      { keys: "⌘⇧S", what: "浏览器：选择页面元素（结果进输入框）" },
    ],
  },
  {
    title: "视图与输入",
    rows: [
      { keys: "Ctrl+O", what: "循环视图：Normal / Thinking / Verbose" },
      { keys: "⌘⇧I", what: "模型菜单（含思考档）" },
      { keys: "⌘⇧M", what: "权限模式菜单" },
      { keys: "⌘⇧E", what: "思考档菜单" },
      { keys: "⌘⌥F", what: "专注模式（收起侧栏与检查器；再按退出）" },
      { keys: "⌘,", what: "设置" },
      { keys: "⌘/", what: "这张速查表" },
      { keys: "⌘↑ / ⌘↓", what: "回到对话顶部 / 底部（输入框聚焦时不劫持）" },
      { keys: "Tab", what: "空输入框想下一条（按上下文，填入不发送）" },
      { keys: "Enter", what: "发送；运行中 = 排队（不打断）" },
      { keys: "⌘↩", what: "运行中 = 入队并打断本轮" },
      { keys: "⌘.", what: "停止本轮生成" },
      { keys: "Esc", what: "先关浮层；决策卡在场时让路；无浮层停止本轮" },
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
  { id: "new-session", keys: "⌘N", label: "新任务" },
  { id: "open-folder", keys: "⌘O", label: "打开文件夹" },
  { id: "palette", keys: "⌘K", label: "命令面板" },
  { id: "sidebar", keys: "⌘B", label: "开合侧栏" },
  { id: "find", keys: "⌘F", label: "对话内查找" },
  { id: "inspector", keys: "⌘⌥B", label: "检查器" },
  { id: "stop", keys: "⌘.", label: "停止生成" },
  { id: "cycle-session", keys: "⌘⇧[ / ⌘⇧]", label: "切换会话" },
  { id: "settings", keys: "⌘,", label: "设置" },
  { id: "send", keys: "⏎", label: "发送" },
  { id: "newline", keys: "⇧⏎", label: "换行" },
  { id: "cheat-sheet", keys: "⌘/", label: "完整速查表" },
];

/** 表内取键（tooltip/命令面板用——键位只在这张表里改，消费面自动跟）。 */
export function keysOf(id: string): string | null {
  return SHORTCUTS.find((s) => s.id === id)?.keys ?? null;
}
