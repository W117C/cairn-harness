// 系统休眠 / 锁屏 ⇒ 暂停视频壁纸（设计规格 §6 的「系统休眠」那一行）。
//
// 为什么这条要单独一个模块：`powerMonitor` 的事件**测不了**（真休眠要真合盖 / `pmset sleepnow`，
// 在自动化里既不可控也会把宿主的会话一起睡掉）。所以把「谁在什么事件上推什么载荷」写成纯装配，
// 用注入的事件源判卷；真机上它接的是 Electron 的 `powerMonitor`，一行都不会多。
//
// 口径（与 §6 的表一致）：
//  · suspend / lock-screen ⇒ `{ paused: true }`
//  · resume  / unlock-screen ⇒ `{ paused: false }`
// resume 一并恢复：解锁后窗口会重新拿到焦点，按理说渲染层自己也会续播；但把它写成显式信号，
// 是为了让「锁屏期间暂停」不是一条只能靠副作用恢复的单向门。
import type { WallpaperSuspendPayload } from "../../../../src/main/ipc-protocol";

/** `powerMonitor` 里本模块用到的那一角（注入面，判卷给假的）。 */
export interface SuspendSource {
  on(event: "suspend" | "resume" | "lock-screen" | "unlock-screen", listener: () => void): void;
}

/** 推送目标：窗口的 webContents（只要它还有 `send` 且没被销毁）。 */
export interface SuspendTarget {
  isDestroyed(): boolean;
  webContents: { isDestroyed(): boolean; send(channel: string, payload: WallpaperSuspendPayload): void };
}

export interface InstallSuspendPauseOptions {
  source: SuspendSource;
  targets: () => readonly SuspendTarget[];
  channel: string;
  /** 判卷用：错误出口（生产是 console.error，不静默吞掉推送失败）。 */
  onError?: (error: unknown) => void;
}

const EVENTS: { event: "suspend" | "resume" | "lock-screen" | "unlock-screen"; paused: boolean }[] = [
  { event: "suspend", paused: true },
  { event: "lock-screen", paused: true },
  { event: "resume", paused: false },
  { event: "unlock-screen", paused: false },
];

/**
 * 挂上四个事件。返回卸载函数（测试用；生产不需要）。
 * 单个窗口推送失败不影响其它窗口——这条要判卷里看得见（一个坏窗口不该拖垮全窗）。
 */
export function installSuspendPause(options: InstallSuspendPauseOptions): () => void {
  const onError = options.onError ?? (() => undefined);
  const handlers: (() => void)[] = [];
  for (const { event, paused } of EVENTS) {
    const handler = (): void => {
      for (const target of options.targets()) {
        if (target.isDestroyed() || target.webContents.isDestroyed()) continue;
        try {
          target.webContents.send(options.channel, { paused, reason: event });
        } catch (error) {
          onError(error);
        }
      }
    };
    options.source.on(event, handler);
    handlers.push(handler);
  }
  return () => {
    // 注入面没有 `off`：卸载只是把引用丢掉（判卷用一次性假源，不需要真解绑）。
    handlers.length = 0;
  };
}
