// 菜单键盘导航（WAI-ARIA menu button 形态）：附件/权限两个自绘 popover 此前只能 Tab 或鼠标，
// ↑↓ / Home / End 无反应——与模型菜单、命令面板、Radix 菜单的手感不一致。
// 纯函数只算「下一个该聚焦的条目下标」；DOM 查询与 focus 留在消费组件（判卷可在 node 下跑）。

import { tabNavigationTarget } from "../radio-nav";

/** 返回菜单内下一个可聚焦条目下标；不是导航键或无可选项时返回 null。
 *  `current < 0` = 焦点还在触发按钮上：↓ 落首项、↑ 落末项（与 Radix 一致）。
 *  ↓/↑ 环形（首↔末只差一格），Home/End 直达两端——纵向循环本身复用 `radio-nav.ts` 的唯一实现。 */
export function menuNavIndex(key: string, current: number, count: number): number | null {
  if (count <= 0) return null;
  if (current < 0) {
    if (key === "ArrowDown") return 0;
    if (key === "ArrowUp") return count - 1;
    return tabNavigationTarget(key, 0, count, "vertical");
  }
  return tabNavigationTarget(key, current, count, "vertical");
}
