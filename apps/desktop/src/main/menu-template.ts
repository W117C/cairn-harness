// 原生菜单栏模板（蓝本 §5.2 菜单树 → Cairn 的等价动作）。**纯数据**：只 `import type`，
// 运行时不碰 electron —— 判卷（tests/app-menu.test.ts）因此能直接遍历这张表。
// 真正的 Menu.buildFromTemplate 在 ./menu.ts 里做（那支才 import electron）。
//
// 菜单树对齐 Claude Desktop（App → File → Edit → View → Go → Window → Help），按 Cairn 的真实能力换条目：
// 不摆做不了的动作（没有多窗口 ⇒ 没有 New Window；没有 Cloud/Remote ⇒ 不设占位）。
//
// 一条纪律：**渲染层拥有键位的项一律 registerAccelerator:false**。
// accelerator 仍会显示（用户看得到快捷键），但不向系统注册——那些键的真身在渲染层 keydown：
// 它要读「本轮是否在跑」「浮层是否开着」「焦点是否在输入框」。若让系统也注册，按一次会走两条路
// （菜单 push 一次 + keydown 一次），⌘N 建两个会话这类双发事故就从这里开始。
//
// ⚠️ **但这一格在 macOS 上是空操作**（2026-10-20 独立评审追出，HIGH）：Electron 自己的 typings
// 把 `registerAccelerator` 标成 `@platform linux,win32`（apps/desktop/node_modules/electron/
// electron.d.ts 的 MenuItemConstructorOptions）⇒ macOS 上系统**照样注册**那些 accelerator，
// 键被菜单吃掉、渲染层 keydown 根本不响。
// ⇒ macOS 上真正的防线是**渲染层那道共享命令门**（src/renderer/command-gate.ts）：
// 菜单转发过来的命令与 keydown 走**同一道门**（浮层在不在 / 要不要让给输入框）——
// macOS 的菜单项 click 并不是"另一条路"，它转发到渲染层后仍然要过门。
// 这一格（registerAccelerator:false）仍然要留着：Linux/Windows 上它是防双发的唯一一道。
import type { MenuItemConstructorOptions } from "electron";
import type { MenuCommandId } from "../shared/menu-commands";

const isMac = process.platform === "darwin";

/** 菜单项的稳定 id（判卷按它核对「每条命令都真的挂进了菜单」）。 */
export const MENU_ITEM_ID_PREFIX = "cairn.cmd.";

export interface AppMenuDeps {
  /** 菜单命令 → 渲染层（经 push 通道 `onMenu`）。 */
  send: (id: MenuCommandId) => void;
  /** 「关闭窗口」：主进程自己就能做（渲染层没有窗口句柄），不给快捷键。 */
  closeWindow: () => void;
}

/** 渲染层命令项：显示快捷键、不注册（见文件头纪律）。 */
function cmd(
  id: MenuCommandId,
  label: string,
  accelerator?: string,
): MenuItemConstructorOptions {
  return {
    id: MENU_ITEM_ID_PREFIX + id,
    label,
    ...(accelerator !== undefined ? { accelerator } : {}),
    registerAccelerator: false,
    click: () => undefined, // 由 appMenuTemplate 回填（这里只为形状统一）
  };
}

/** 模板构造：`send` 在 click 里调用（每条命令一个闭包，共用同一个出口）。 */
export function appMenuTemplate(deps: AppMenuDeps): MenuItemConstructorOptions[] {
  /** 渲染层命令项：显示快捷键、不注册（见文件头纪律）。 */
  const command = (id: MenuCommandId, label: string, accelerator?: string): MenuItemConstructorOptions => ({
    id: MENU_ITEM_ID_PREFIX + id,
    label,
    ...(accelerator !== undefined ? { accelerator } : {}),
    registerAccelerator: false,
    click: () => { deps.send(id); },
  });
  return [
    // App 菜单（macOS 才有）：关于/服务/隐藏/退出全走系统 role——这些是 OS 级语义，
    // 自己重写只会丢掉「隐藏其他」「服务」这些平台约定。
    ...(isMac ? [{ role: "appMenu" as const }] : []),
    {
      label: "文件",
      submenu: [
        command("new-session", "新任务", "CmdOrCtrl+N"),
        command("open-folder", "打开文件夹…", "CmdOrCtrl+O"),
        { type: "separator" },
        command("close-session", "关闭会话", "CmdOrCtrl+W"),
        // 关闭窗口**不给快捷键**：⌘W 属于「关会话」（蓝本同款取舍），窗口关闭走红绿灯。
        { label: "关闭窗口", registerAccelerator: false, click: () => { deps.closeWindow(); } },
        { type: "separator" },
        command("export-transcript", "导出整段对话…"),
        command("compact", "压缩当前会话历史"),
      ],
    },
    {
      label: "编辑",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
        { type: "separator" },
        command("copy-transcript", "复制整段对话"),
        { type: "separator" },
        command("find", "查找…", "CmdOrCtrl+F"),
        command("find-next", "查找下一个", "CmdOrCtrl+G"),
        command("find-prev", "查找上一个", "CmdOrCtrl+Shift+G"),
      ],
    },
    {
      label: "视图",
      submenu: [
        command("palette", "命令面板…", "CmdOrCtrl+K"),
        command("toggle-sidebar", "开合侧栏", "CmdOrCtrl+B"),
        command("toggle-inspector", "开合检查器", "CmdOrCtrl+Alt+B"),
        { type: "separator" },
        command("toggle-theme", "切换主题"),
        command("cycle-perm", "切换权限档"),
        { type: "separator" },
        { role: "reload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "前往",
      submenu: [
        command("prev-session", "上一个会话", "CmdOrCtrl+Shift+["),
        command("next-session", "下一个会话", "CmdOrCtrl+Shift+]"),
        { type: "separator" },
        command("jump-top", "回到顶部", "CmdOrCtrl+Up"),
        command("jump-bottom", "回到底部", "CmdOrCtrl+Down"),
      ],
    },
    {
      label: "窗口",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        ...(isMac ? [{ type: "separator" as const }, { role: "front" as const }] : []),
      ],
    },
    {
      label: "帮助",
      role: "help",
      submenu: [
        command("cheat-sheet", "键盘快捷键", "CmdOrCtrl+/"),
        command("settings", "设置…", "CmdOrCtrl+,"),
        { type: "separator" },
        command("about", "关于 Cairn"),
      ],
    },
  ];
}
