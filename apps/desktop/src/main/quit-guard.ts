// 退出后果告知（蓝本 §3.3「退出后果告知」）的纯判据段——文案与闸判据可 headless 判卷；
// Electron 侧（before-quit → dialog）只做薄调用。
// 原文口径：「Claude 正在 {count} 个会话中工作。现在退出将中断该工作。」
// Cairn 版逐字对齐（品牌名替换）；{count} = kernel-host 的在跑 run 控制器数（per-session）。

/** 退出前的告知文案（与文档逐字同构）。 */
export function quitWarningMessage(count: number): string {
  return `Cairn 正在 ${count} 个会话中工作。现在退出将中断该工作。`;
}

/** 退出前要不要问：有在跑会话才问（0 = 直接退，不打扰）。 */
export function shouldWarnBeforeQuit(runningCount: number): boolean {
  return runningCount > 0;
}
