// 键盘可达性（a11y）公件：把 `role="button"` 的自绘元素补上「Enter / Space 激活」语义。
//
// 为什么需要它：原生 <button> 白送这两键，而自绘的 div[role=button] 只有 onClick——
// tabIndex={0} 让键盘用户「能聚焦」，聚焦后按 Enter 却没反应。这是「看得见摸不着」的缺口：
// 鼠标用户一切正常，纯键盘用户被静默挡在门外。真机实证过（2026-10-18）：插件/定时/记忆三页的
// 列表项全部如此，而 Sidebar 会话行、Stream 思考行各自手写了同样的判断——四份重复实现。
//
// 口径与原生一致（WAI-ARIA button 模式）：
//   · Enter / Space 都激活；Space 另需 preventDefault，否则页面会滚动；
//   · 只在「目标就是宿主自身」时处理——行内若有真 button（如「…」），
//     它的 Enter/Space 冒泡上来不能顺带触发外层（否则一次按键做两件事）。
//   · 不碰 modifier 组合（⌘Enter / ⇧Enter 属于应用快捷键，不当作激活）。
//
// 用法：onKeyDown={(e) => { if (activates(e)) { e.preventDefault(); run(); } }}
export function activates(e: { key: string; target: unknown; currentTarget: unknown }): boolean {
  if (e.target !== e.currentTarget) return false;
  return e.key === "Enter" || e.key === " ";
}
