/** 启动时检查器的初始开合。
 *
 *  三条输入的优先级必须是**显式偏好 > 恢复内容 > 默认收起**：
 *  - 用户点过开/关（`prefSet`）⇒ 以那次选择为准，哪怕盘上还有窗格。旧实现写成
 *    `paneCount > 0 || defaultOpen`，于是「关掉检查器 → 带着窗格重载」会被强行掰开，
 *    等于把用户的显式选择当成没有。
 *  - 没点过 + 有恢复窗格 ⇒ 展开（窗格挂在宽度 0 的栏里等于没恢复）。
 *  - 没点过 + 没窗格 ⇒ 收起（brief 七的默认值）。
 */
export function initialInspectorOpen(s: {
  prefSet: boolean;
  defaultOpen: boolean;
  paneCount: number;
}): boolean {
  if (s.prefSet) return s.defaultOpen;
  return s.paneCount > 0;
}
