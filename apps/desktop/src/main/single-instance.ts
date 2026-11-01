/**
 * 单实例闸（2026-10-30）。
 *
 * 为什么产品需要这一格：第二个 Cairn 进程会完整走一遍 whenReady 装配——再起一个
 * `serveScheduler`（同一工作区的定时任务会被跑两遍）、再注入一次 BYOK、再建一份窗口状态。
 * macOS 双击 .app 时 LaunchServices 通常会把第二次启动合并到已运行实例，但 `open -n`、
 * 直接执行 `Cairn.app/Contents/MacOS/Cairn`、以及将来 Windows/Linux 的快捷方式都不受这层
 * 系统保护。产品不能把「用户只开一个」当作前提。
 *
 * 分工：本模块只做「拿锁 / 副进程退出 / 注册第二次启动的回调」三件事；焦点与建窗留给调用方
 * （主进程里是 mainWindow 与 createWindow）——纯函数便于用 fake host 判卷，不 import electron。
 */
export interface SingleInstanceHooks {
  /** Electron: `app.requestSingleInstanceLock()`。 */
  requestLock: () => boolean;
  /** 副进程退出。用 Electron `app.exit(0)`：它立刻终止，不再执行模块剩余的装配代码。
   *  `app.quit()` 只是请求退出，模块会继续求值——那会在副进程里白建一遍 host/registry。 */
  exit: () => void;
  /** 主进程注册「第二次启动」监听（Electron: `app.on("second-instance", …)`）。 */
  onSecond: (listener: () => void) => void;
  /** 第二次启动时把已有窗口带回前台；无窗时由调用方建窗。 */
  focusExisting: () => void;
}

/**
 * 返回 true = 本进程是主实例（调用方才可以进入 whenReady 的装配段）；
 * false = 已有实例在跑，本进程已请求退出，调用方必须跳过一切启动副作用。
 */
export function acquireSingleInstance(hooks: SingleInstanceHooks): boolean {
  if (!hooks.requestLock()) {
    hooks.exit();
    return false;
  }
  hooks.onSecond(() => { hooks.focusExisting(); });
  return true;
}
