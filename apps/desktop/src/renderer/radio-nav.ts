// 组内键盘契约的唯一实现：单选组（radio group）与水平/垂直 tablist 共用。
//
// 2026-11-16（第 1257 页）：模板网格早就有这套行为，设置面的主题 / 字号 / 尺寸 / 权限档四组没有——
// 同样的 role="radiogroup" + role="radio" 外观，方向键完全无反应，Tab 还要逐颗经过。
// 随后同一类缺陷出现在浏览器标签条与供应商列表（role="tab" 外观、无 roving tabindex）。
// 纯函数（方向 → 目标下标）在 node 环境可直接跑；DOM 焦点留给接线侧，helper 不碰 document。
import type { KeyboardEvent } from "react";

/** 组内下标落点（tablist / 标签条）：沿组轴循环，Home / End 到首尾，其余键 null。
 *  轴由 `orientation` 决定——垂直 tablist 的 ↑/↓ 才是换页，水平组的 ↑/↓ 是滚动语义，
 *  反过来劫持会让人滚不动页面。这是全应用唯一一份「组内下标」算法：单选组、检查器、
 *  窗格标签、浏览器标签、供应商列表共用。 */
export function tabNavigationTarget(
  key: string,
  index: number,
  count: number,
  orientation: "horizontal" | "vertical" = "horizontal",
): number | null {
  if (count <= 0 || index < 0 || index >= count) return null;
  const forward = orientation === "vertical" ? "ArrowDown" : "ArrowRight";
  const backward = orientation === "vertical" ? "ArrowUp" : "ArrowLeft";
  if (key === forward) return (index + 1) % count;
  if (key === backward) return (index - 1 + count) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}

/** 单选组两个轴都参与（↑/↓ = ←/→），水平语义委托 `tabNavigationTarget`。 */
export function radioNavigationTarget(key: string, current: number, count: number): number | null {
  if (count <= 0) return null;
  // 没有选中项时（current 越界）从第一颗起算，方向键仍然可用。
  const at = current >= 0 && current < count ? current : 0;
  if (key === "ArrowDown") return (at + 1) % count;
  if (key === "ArrowUp") return (at - 1 + count) % count;
  return tabNavigationTarget(key, at, count);
}

/** 把一次方向键落到组内第 next 颗 radio：吃掉按键、选中、焦点搬过去。 */
export function applyRadioNavigation(
  e: KeyboardEvent<HTMLButtonElement>,
  current: number,
  count: number,
  onSelect: (index: number) => void,
): void {
  const next = radioNavigationTarget(e.key, current, count);
  if (next === null) return;
  e.preventDefault();
  onSelect(next);
  e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
}
