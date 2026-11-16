// 「这个窗口还活不活跃」的**唯一来源**（主进程）。
//
// 为什么不让渲染层读 `document.hasFocus()`：
//  · Electron 里后台窗口的 hasFocus 与 OS 焦点并不总一致（脚本启动、完全被遮挡、焦点被别的 app 拿走时都会假阴性）；
//  · 假阴性的代价是**视频永远不播**——判据会红，而且用户看到的是黑屏。
// 所以：主进程听真窗口的 focus/blur（这就是 OS 真实事件），把 `{active}` 推给渲染层；
// 渲染层的媒体门只认这一个信号 + 自己的 `document.hidden` + 系统级暂停。
export const WALLPAPER_ACTIVE_CHANNEL = "agent:wallpaper-active";

export interface ActiveWindowLike {
  on(event: "focus" | "blur", listener: () => void): unknown;
  isFocused(): boolean;
  isDestroyed?(): boolean;
}

export interface InstallActivePushInput {
  targets: readonly ActiveWindowLike[];
  channel?: string;
  send: (channel: string, payload: { active: boolean }) => void;
  onError?: (error: unknown) => void;
}

/** 挂上 focus/blur → 推送；返回卸载函数（只摘自己挂的那些）。 */
export function installActivePush(input: InstallActivePushInput): () => void {
  const channel = input.channel ?? WALLPAPER_ACTIVE_CHANNEL;
  const offs: (() => void)[] = [];
  for (const target of input.targets) {
    // 按**事件**推，而不是推 `isFocused()`：focus 事件到达时 isFocused 在某些平台还没翻转，
    // 而事件本身就是「刚获得焦点」这一事实。初始态另由调用方在 did-finish-load 时补一次。
    const push = (active: boolean): void => {
      try {
        if (target.isDestroyed?.() === true) return;
        input.send(channel, { active });
      } catch (error) {
        input.onError?.(error);
      }
    };
    const onFocus = (): void => { push(true); };
    const onBlur = (): void => { push(false); };
    target.on("focus", onFocus);
    target.on("blur", onBlur);
    offs.push(() => {
      (target as unknown as { removeListener?: (e: string, cb: () => void) => void }).removeListener?.("focus", onFocus);
      (target as unknown as { removeListener?: (e: string, cb: () => void) => void }).removeListener?.("blur", onBlur);
    });
  }
  return () => { for (const off of offs) off(); };
}
