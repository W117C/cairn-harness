// 系统休眠 / 锁屏 ⇒ 暂停视频壁纸的装配判卷（设计规格 §6「系统休眠」行）。
//
// 为什么判卷走注入面：`powerMonitor` 的真事件测不了（真休眠会把宿主一起睡掉）。
// 所以「谁在什么事件上推什么载荷」写成纯装配，这里用假事件源 + 假窗口判它；
// 真机上的那一行只接 Electron 的真对象，不写第二套逻辑。
import { describe, expect, it } from "vitest";
import { installSuspendPause, type SuspendSource, type SuspendTarget } from "../src/main/wallpaper-suspend";

type FakeSource = SuspendSource & { emit: (event: "suspend" | "resume" | "lock-screen" | "unlock-screen") => void };

function fakeSource(): FakeSource {
  const listeners = new Map<string, (() => void)[]>();
  return {
    on(event, listener) {
      const list = listeners.get(event) ?? [];
      list.push(listener);
      listeners.set(event, list);
    },
    emit(event) {
      for (const listener of listeners.get(event) ?? []) listener();
    },
  };
}

function fakeTarget(opts: { destroyed?: boolean; wcDestroyed?: boolean; fail?: boolean } = {}) {
  const sent: { channel: string; payload: unknown }[] = [];
  const target: SuspendTarget = {
    isDestroyed: () => opts.destroyed === true,
    webContents: {
      isDestroyed: () => opts.wcDestroyed === true,
      send: (channel, payload) => {
        if (opts.fail === true) throw new Error("renderer gone");
        sent.push({ channel, payload });
      },
    },
  };
  return { target, sent };
}

describe("壁纸的系统级暂停", () => {
  it("suspend / lock-screen ⇒ paused:true；resume / unlock-screen ⇒ paused:false", () => {
    const source = fakeSource();
    const { target, sent } = fakeTarget();
    installSuspendPause({ source, targets: () => [target], channel: "agent:wallpaper-suspend" });
    source.emit("suspend");
    source.emit("lock-screen");
    source.emit("resume");
    source.emit("unlock-screen");
    expect(sent).toEqual([
      { channel: "agent:wallpaper-suspend", payload: { paused: true, reason: "suspend" } },
      { channel: "agent:wallpaper-suspend", payload: { paused: true, reason: "lock-screen" } },
      { channel: "agent:wallpaper-suspend", payload: { paused: false, reason: "resume" } },
      { channel: "agent:wallpaper-suspend", payload: { paused: false, reason: "unlock-screen" } },
    ]);
  });

  it("已销毁的窗口跳过（不往死窗口推）", () => {
    const source = fakeSource();
    const dead = fakeTarget({ destroyed: true });
    const deadWc = fakeTarget({ wcDestroyed: true });
    const alive = fakeTarget();
    installSuspendPause({ source, targets: () => [dead.target, deadWc.target, alive.target], channel: "c" });
    source.emit("suspend");
    expect(dead.sent).toEqual([]);
    expect(deadWc.sent).toEqual([]);
    expect(alive.sent).toHaveLength(1);
  });

  it("一个窗口推送失败不拖垮其它窗口（错误走出口，不静默）", () => {
    const source = fakeSource();
    const broken = fakeTarget({ fail: true });
    const ok = fakeTarget();
    const errors: unknown[] = [];
    installSuspendPause({
      source,
      targets: () => [broken.target, ok.target],
      channel: "c",
      onError: (error) => errors.push(error),
    });
    source.emit("lock-screen");
    expect(errors).toHaveLength(1);
    expect(ok.sent).toHaveLength(1);
  });

  it("多窗口：每个存活窗口都收到同一份载荷", () => {
    const source = fakeSource();
    const a = fakeTarget();
    const b = fakeTarget();
    installSuspendPause({ source, targets: () => [a.target, b.target], channel: "c" });
    source.emit("suspend");
    expect(a.sent).toEqual(b.sent);
    expect(a.sent).toHaveLength(1);
  });
});
