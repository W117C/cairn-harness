// 原生菜单栏命令 id（蓝本 §5.2 菜单树 ↔ 渲染层动作）的唯一事实源。
//
// 为什么单独一只文件、而不是复用命令面板的 `PaletteAction`：
// ① 两边 id 集合并不同——菜单多出「关闭会话 / 查找下一个 / 查找上一个 / 速查表 / 上一个会话 /
//    下一个会话 / 回到顶部 / 到底部」这些命令面板不列的项；
// ② 面板 id 与它的 UI 文案/分组绑在一起（`OPS` 表），把两套硬凑成一套，往后加一条得同时改两处语义。
//
// 放 `shared/` 是因为两侧都要 import：菜单在 main 侧建（Electron Menu），动作却在渲染层
// （键位、焦点、浮层、状态都在那儿）。main 只发 id，渲染层用 `Record<MenuCommandId, …>` 接——
// 少接一条 = typecheck 红，不需要「菜单点了没反应」这种运行时才发现的对账。
// 数组形式（而非纯类型）是为了让判卷能**运行时**遍历这张表：纯类型在测试里读不到。
export const MENU_COMMAND_IDS = [
  "new-session",
  "open-folder",
  "close-session",
  "export-transcript",
  "compact",
  "find",
  "find-next",
  "find-prev",
  "palette",
  "toggle-sidebar",
  "toggle-inspector",
  "toggle-theme",
  "cycle-perm",
  "copy-transcript",
  "prev-session",
  "next-session",
  "jump-top",
  "jump-bottom",
  "settings",
  "cheat-sheet",
  "about",
] as const;

export type MenuCommandId = (typeof MENU_COMMAND_IDS)[number];
