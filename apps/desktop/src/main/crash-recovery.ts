/**
 * 界面进程崩溃的收口（2026-10-30）。
 *
 * 缺口：`app.on("render-process-gone")` 此前没有任何监听。Chromium 渲染进程被 OOM 杀掉或
 * 崩溃时，用户看到的是一个白/空窗口——没有说明、没有重载入口，只能强退重开。长会话（本仓
 * 实测 400 轮约 3.9 万 DOM 节点）正是最容易撞上这一格的场景，而「重开」本身是可恢复的：
 * 事件已按行落在磁盘上。
 *
 * 本模块只产出「要不要打扰用户 / 说什么」这一层纯判断；弹窗与重载留给主进程（可判卷、不
 * import electron）。两条克制：正常退出（clean-exit）与 App 正在退出时不弹窗——那是退出
 * 流程自己的形态，不该被读成崩溃。
 */
export interface RendererCrashDetails {
  /** Electron `RenderProcessGoneDetails.reason`：clean-exit / oom / crashed / killed / … */
  reason: string;
  /** 进程退出码；不可用时 Electron 给 0 或 -1，只在 > 0 时展示。 */
  exitCode: number;
}

export interface CrashNotice {
  title: string;
  body: string;
}

/** null = 不打扰（正常退出 / App 正在退出）。 */
export function rendererCrashNotice(
  details: RendererCrashDetails,
  appQuitting: boolean,
): CrashNotice | null {
  if (appQuitting) return null;
  if (details.reason === "clean-exit") return null;
  const code = details.exitCode > 0 ? `，退出码 ${details.exitCode}` : "";
  if (details.reason === "oom") {
    return {
      title: "界面进程内存不足",
      body: `Cairn 的界面进程因内存不足被系统结束${code}。崩溃前已经写入磁盘的会话记录不会丢；重新载入后可以继续。`,
    };
  }
  return {
    title: "界面进程已退出",
    body: `原因：${details.reason}${code}。崩溃前已经写入磁盘的会话记录不会丢；重新载入后可以继续。`,
  };
}
