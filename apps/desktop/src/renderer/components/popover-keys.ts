// 菜单键盘导航（WAI-ARIA menu button 形态）：附件/权限两个自绘 popover 此前只能 Tab 或鼠标，
// ↑↓ / Home / End 无反应——与模型菜单、命令面板、Radix 菜单的手感不一致。
// 纯函数只算「下一个该聚焦的条目下标」；DOM 查询与 focus 留在消费组件（判卷可在 node 下跑）。

/** 返回菜单内下一个可聚焦条目下标；不是导航键或无可选项时返回 null。
 *  `current < 0` = 焦点还在触发按钮上：↓ 落首项、↑ 落末项（与 Radix 一致）。
 *  ↓/↑ 环形（首↔末只差一格），Home/End 直达两端。 */
export function menuNavIndex(key: string, current: number, count: number): number | null {
  if (count <= 0) return null;
  switch (key) {
    case "Home":
      return 0;
    case "End":
      return count - 1;
    case "ArrowDown":
      return current < 0 ? 0 : (current + 1) % count;
    case "ArrowUp":
      return current < 0 ? count - 1 : (current - 1 + count) % count;
    default:
      return null;
  }
}
