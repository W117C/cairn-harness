// 命令动作的**统一前置门**——键盘路径与原生菜单路径共用这一份。
//
// 为什么必须是**一份**（2026-10-20 独立评审追出，HIGH）：macOS 上 `registerAccelerator:false`
// 是**空操作**（Electron 自己的 typings 标着 `@platform linux,win32`——见
// apps/desktop/node_modules/electron/electron.d.ts 的 `MenuItemConstructorOptions.registerAccelerator`）。
// 后果：那把菜单里的「渲染层拥有键位」的项**照样被系统注册**⇒ macOS 把键交给菜单、
// 渲染层的 keydown **根本不响**⇒ 菜单转发过来的命令**绕过了 keydown 那道浮层门**。
//
// 两个实测出来的形状：
//  ① 确认卡（「删除会话确认」）开着时按 ⌘W ⇒ 会话被关掉回到主页，**而那张卡还开着**
//     （模态面本该挡住一切——keydown 路径有这道门，菜单路径没有）。
//  ② ⌘↑/⌘↓ 在输入框里**让给文本编辑**（移动光标；keydown 路径显式不劫持），
//     菜单路径没有这道判断 ⇒ 在输入框里按 ⌘↑ 变成"滚动转录"而不是"移动光标"。
//
// 两条入口、两套判断 = 迟早漂 ⇒ 收成**一个**门（本模块）。读法也一并收在这里：
// 「浮层在不在」与「焦点在不在可编辑元素」各只有一处读法。
//
// **判据形状**：判断是**纯函数**（`commandAllowed`），DOM 读法单独一只（`readGateInput`，
// DOM 可注入 ⇒ 桌面端那套 node 环境的 vitest 也能真跑它，不必装 jsdom）。

/** 焦点是否落在可编辑元素上（输入框／文本域／contenteditable）。
 *  2026-10-20 从 App.tsx 搬到这里：它同时管着**菜单路径要不要让给文本编辑**——
 *  两处各写一份判法就会漂（keydown 路径让了、菜单路径没让 = 同一个键两种行为）。 */
export function isEditableTarget(target: EventTarget | null): boolean {
  // `Element` 在非浏览器环境（桌面端那套 node 环境 vitest）不存在 ⇒ 先问它在不在。
  return typeof Element !== "undefined" && target instanceof Element
    && target.closest("input, textarea, [contenteditable='true'], [contenteditable='']") !== null;
}

/** 菜单命令 id 里「会移动光标」的那几个：焦点在输入框时**让给文本编辑**（不劫持）。
 *  与 keydown 路径的 ⌘↑/⌘↓ 同一条口径（那边判的是 `!isEditableTarget(e.target)`）。
 *  ⚠️ 这张表是**判据面**：新增一个"移动光标"型命令而忘了登记 ⇒ 菜单路径会劫持输入框的按键。 */
export const CARET_YIELDING_COMMANDS: ReadonlySet<string> = new Set(["jump-top", "jump-bottom"]);

/** 门的输入：三项事实，**只有读法一处**（`readGateInput`）。 */
export interface GateInput {
  /** 命令面板是否开着。 */
  paletteOpen: boolean;
  /** 模态面在场？（标记是 `data-modal-surface="true"`，渲染层每个真正的模态面都带它） */
  modalSurfaceOpen: boolean;
  /** 焦点在可编辑元素上？ */
  editableTarget: boolean;
}

/** 门要读的那一小块 DOM（可注入 ⇒ 判卷不必装 jsdom）。 */
export interface GateDom {
  querySelector(selectors: string): unknown;
  activeElement: unknown;
}

/** 从 DOM 读当前状态（**唯一读法**）。DOM 缺席（node 环境）⇒ 读成"没有浮层、没有编辑焦点"。 */
export function readGateInput(paletteOpen: boolean, dom?: GateDom): GateInput {
  const d = dom ?? (globalThis as { document?: GateDom }).document;
  if (d === undefined) return { paletteOpen, modalSurfaceOpen: false, editableTarget: false };
  return {
    paletteOpen,
    modalSurfaceOpen: d.querySelector('[data-modal-surface="true"]') !== null,
    editableTarget: isEditableTarget(d.activeElement as EventTarget | null),
  };
}

/** 浮层在不在（键盘路径只需要这一条：它的逐命令让位判断在各自的 case 里）。 */
export function overlayBlocked(input: GateInput): boolean {
  return input.modalSurfaceOpen || input.paletteOpen;
}

/** 这条命令此刻**该不该动作**（纯函数）。
 *
 *  @param id 菜单命令 id（键盘路径传一个不可能命中的 id：键盘路径自己按 case 分派）。
 *  @param input 三项事实（`readGateInput` 的产物）。
 */
export function commandAllowed(id: string, input: GateInput): boolean {
  // ① 浮层优先：模态面在 / 命令面板开着 ⇒ 一律不动作（与 keydown 路径同一条）。
  if (overlayBlocked(input)) return false;
  // ② 移动光标的命令在输入框里让给文本编辑（与 keydown 的 ⌘↑/⌘↓ 同一条）。
  if (CARET_YIELDING_COMMANDS.has(id) && input.editableTarget) return false;
  return true;
}
