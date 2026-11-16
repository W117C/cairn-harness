// 主进程的「活跃信号」判卷：focus/blur 都推、销毁后不推、卸载摘干净。
import { describe, expect, it, vi } from "vitest";
import { installActivePush, WALLPAPER_ACTIVE_CHANNEL } from "../src/main/wallpaper-active";

function fakeWindow(focused: boolean) {
  const listeners: Record<string, (() => void)[]> = { focus: [], blur: [] };
  return {
    state: { focused, destroyed: false },
    on(event: "focus" | "blur", cb: () => void) { listeners[event].push(cb); },
    removeListener(event: "focus" | "blur", cb: () => void) {
      listeners[event] = listeners[event].filter((x) => x !== cb);
    },
    isFocused() { return this.state.focused; },
    isDestroyed() { return this.state.destroyed; },
    emit(event: "focus" | "blur") { for (const cb of [...listeners[event]]) cb(); },
    count(event: "focus" | "blur") { return listeners[event].length; },
  };
}

describe("活跃信号推送", () => {
  it("blur 推 false、focus 推 true（按事件推，不依赖 isFocused 的翻转时机）", () => {
    const win = fakeWindow(true);
    const send = vi.fn();
    installActivePush({ targets: [win], send });
    win.state.focused = true; win.emit("blur");   // 即使 isFocused 还是 true，blur 事件就代表失焦
    win.state.focused = false; win.emit("focus"); // 反过来也一样
    expect(send.mock.calls).toEqual([
      [WALLPAPER_ACTIVE_CHANNEL, { active: false }],
      [WALLPAPER_ACTIVE_CHANNEL, { active: true }],
    ]);
  });

  it("窗口已销毁 ⇒ 不推（不往死窗口写）", () => {
    const win = fakeWindow(false);
    const send = vi.fn();
    installActivePush({ targets: [win], send });
    win.state.destroyed = true;
    win.emit("blur");
    expect(send).not.toHaveBeenCalled();
  });

  it("卸载后不再推；一个窗口抛错不影响另一个", () => {
    const a = fakeWindow(true);
    const b = fakeWindow(false);
    const send = vi.fn((_ch: string, payload: { active: boolean }) => {
      if (payload.active === true) throw new Error("boom");
    });
    const off = installActivePush({ targets: [a, b], send, onError: vi.fn() });
    a.emit("focus"); // 抛错但被吞
    b.emit("blur");
    expect(send).toHaveBeenCalledTimes(2);
    off();
    expect(a.count("focus")).toBe(0);
    a.emit("focus");
    expect(send).toHaveBeenCalledTimes(2);
  });
});
