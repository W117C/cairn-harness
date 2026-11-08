// IME 组字守卫（2026-10-28）：**所有**会消费 Enter 的键盘路径共用一条判定。
//
// 为什么要有这一层：此前只有「发送」那条路径带组字守卫（`composing.current`），
// 斜杠菜单与 @mention 菜单的 Enter 分支没有 ⇒ 中文用户在拼音组字期间按 Enter，
// 菜单把**正在组字的半成品**当成「选中了第 0 项」，输入框里的字被改写成
// `/compact `（真机复现：见 PROGRESS 第 749 页的探针读数）。这不是"回车多按了一次"，
// 是**用户正在写的字被系统改掉**——最坏的一类交互缺陷。
//
// 判定口径（两条都认，任一为真 ⇒ 这次 Enter 归 IME，不给应用）：
//   ① `event.nativeEvent.isComposing` —— 浏览器在组字期间给出的标准旗；
//   ② 调用方维护的 `composing` 引用 —— compositionstart/end 事件流。
// 只有 ① 时，React 的 SyntheticKeyboardEvent 会把它透传为 `nativeEvent.isComposing`；
// 这里**同时**读合成事件自身上的 `isComposing`，因为部分 Electron/Chromium 版本
// 在 `dispatchEvent` 合成的路径上只把它挂在事件自身。
//
// 纯函数、无 IO、无时钟 ⇒ 可判卷（不靠"源码里有没有这句"自证）。
export interface CompositionKeyEventLike {
  /** 合成事件自身带的旗（部分路径只有这里有）。 */
  readonly isComposing?: boolean;
  /** 浏览器在原生事件上给的旗（标准路径）。 */
  readonly nativeEvent?: { readonly isComposing?: boolean } | null;
  /** 传统 IME 信号：组字期间的按键一律报 keyCode 229（Chromium/Safari 都如此）。 */
  readonly keyCode?: number;
}

/**
 * 这次 Enter 是不是「IME 组字途中的一次回车」。
 *
 * @param event       键盘事件（合成或原生皆可）。
 * @param composingRef 调用方维护的组字引用（compositionstart/end 驱动）；没有就传 null。
 * @returns true ⇒ 这次 Enter 归 IME，应用**不应**消费它。
 */
export function isCompositionEnter(
  event: CompositionKeyEventLike | null | undefined,
  composingRef: { readonly current: boolean } | null | undefined,
): boolean {
  if (composingRef?.current === true) return true;
  if (event === null || event === undefined) return false;
  if (event.isComposing === true) return true;
  if (event.nativeEvent?.isComposing === true) return true;
  // 传统旗：组字期间的按键 keyCode 一律是 229（含部分 Windows 输入法的候选确认）。
  return event.keyCode === 229;
}
