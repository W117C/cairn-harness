// 窗格登记表（Phase 2 · 批 2.3 配套搬移）。
//
// 为什么从 components/panes.ts 搬出来：**state/** 不许 import components/**（分层契约 I2），
// 而「窗格是哪几种、叫什么、怎么重排」是**数据与纯函数**，不是组件——它住在 components/ 只是
// 历史偶然。搬到这里之后：state 层拿窗格类型/登记表不用越过组件层，组件层照旧从
// components/panes.ts 转出（导出面一字未改，调用点零改动）。
export type PaneKind = "changes" | "plan" | "tasks" | "file" | "terminal" | "browser" | "sidechat" | "plugins";

export const PANE_META: Record<PaneKind, { label: string }> = {
  changes: { label: "变更" },
  plan: { label: "方案" },
  tasks: { label: "任务" },
  file: { label: "文件" },
  terminal: { label: "终端" },
  browser: { label: "浏览器" },
  sidechat: { label: "旁路" },
  plugins: { label: "插件" },
};

/** 顶栏 ⋮ 菜单的列表面（App 消费；保持与 PaneKind 同集）。 */
export const PANE_OPENABLE: readonly PaneKind[] = ["changes", "plan", "tasks", "file", "terminal", "browser", "sidechat", "plugins"];

/** 窗格重排（拖标题栏换位，蓝本 §3.4）：把 from 位的元素移动到 to 位，其余相对次序不变。
 *  越界/同位原样返回（不抛、不吞——与 send-queue 的越界口径一致）。 */
export function movePane<T>(items: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return [...items];
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return next;
}

/** ⌘\ 「关闭最近打开的窗格」该关哪一个（2026-10-18 修）：
 *  旧实现直接 `tabs.slice(0, -1)`——数组尾项。追加开的顺序确实如此，但数组顺序是可变的
 *  （拖标题栏换位 / ⌥↑⌥↓ 都走 movePane 重排），重排之后尾项就不再是「最近打开」的那个，
 *  文档承诺与实行为两件事。而空数组时 slice(0,-1) 还是空数组，键被 preventDefault 吃掉，
 *  按了没反应。
 *  解法：App 另记一条打开顺序（openOrder，只增不重排），这里从后往前找第一个仍在场的窗格。
 *  没记/openOrder 为空 ⇒ 退化为数组尾（旧行为，仍是「最后一项」这个合理猜测）。
 *  全部不在场（已被逐个关掉）⇒ null，让调用方知道「无可关」，别静默吞键。 */
export function lastOpenedPane<T>(tabs: readonly T[], openOrder?: readonly T[]): T | null {
  if (tabs.length === 0) return null;
  if (openOrder === undefined || openOrder.length === 0) return tabs[tabs.length - 1] ?? null;
  for (let i = openOrder.length - 1; i >= 0; i--) {
    const candidate = openOrder[i];
    if (candidate !== undefined && tabs.includes(candidate)) return candidate;
  }
  return tabs[tabs.length - 1] ?? null;
}
