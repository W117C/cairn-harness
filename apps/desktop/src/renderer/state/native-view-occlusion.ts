// 原生视图让位（2026-11-16 第 1261 页）。
//
// 浏览器窗格不是 DOM：它是一张 WebContentsView，永远画在渲染层之上——z-index 再高也盖不过它。
// 因此**任何要出现在它上面的渲染层浮层**都得先让原生视图收成零矩形：命令面板、模态面、
// 拖放蒙层、标题栏下拉菜单（它们从 38px 的工具栏往下伸进窗格区）。
//
// 判据收在这里，不让每个浮层各写一遍「我要遮住原生视图」：持有者用计数而不是布尔，
// 因为浮层会叠着开（命令面板里点开会话日志、设置页里开自定义模型表单），最后一个持有者
// 释放才恢复；恢复由视图宿主（BrowserPane）自己做（按容器矩形重新贴合）。
import { useEffect, useSyncExternalStore } from "react";

let holders = 0;
const listeners = new Set<(hidden: boolean) => void>();

function emit(): void {
  const hidden = holders > 0;
  for (const listener of listeners) listener(hidden);
}

/** 持有一份「原生视图让位」，返回释放函数。重复调用释放函数安全（StrictMode 双跑不会漏账）。 */
export function holdNativeViewHidden(): () => void {
  holders += 1;
  if (holders === 1) emit();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holders -= 1;
    if (holders === 0) emit();
  };
}

/** 此刻是否有渲染层浮层要求原生视图让位。 */
export function nativeViewHidden(): boolean {
  return holders > 0;
}

/** 订阅让位状态变化（视图宿主用；回调收到的是变化后的值）。 */
export function subscribeNativeViewHidden(listener: (hidden: boolean) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** 浮层组件用：`active` 为真期间原生视图让位。 */
export function useNativeViewOcclusion(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    return holdNativeViewHidden();
  }, [active]);
}

/** 视图宿主用：渲染期读到与 store 一致的值（不在渲染期改状态）。 */
export function useNativeViewHidden(): boolean {
  return useSyncExternalStore((listener) => subscribeNativeViewHidden(listener), nativeViewHidden);
}
