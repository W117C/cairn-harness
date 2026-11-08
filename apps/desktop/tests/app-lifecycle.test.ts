// 应用生命周期判卷（2026-10-30）：单实例闸 + 界面进程崩溃的收口。
//
// 两件都是「产品在真实桌面上跑」才暴露的形态，而且都能用纯函数判：
//   ① 第二个进程必须退出，不进入 whenReady 的装配段（否则同一工作区两个调度器）；
//   ② 渲染进程崩溃要给「重新载入 / 退出」，正常退出与退出流程自己的 kill 不打扰。
// Electron 面沿用本仓 `main-hardening` 的做法：源码接线见证（本仓无 Electron 测试宿主）。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { acquireSingleInstance, type SingleInstanceHooks } from "../src/main/single-instance";
import { rendererCrashNotice } from "../src/main/crash-recovery";

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const appSource = read("../src/main/index.ts");

function fakeHooks(lock: boolean): { hooks: SingleInstanceHooks; calls: { exit: number; focus: number; listeners: (() => void)[] } } {
  const calls = { exit: 0, focus: 0, listeners: [] as (() => void)[] };
  return {
    calls,
    hooks: {
      requestLock: () => lock,
      exit: () => { calls.exit += 1; },
      onSecond: (listener) => { calls.listeners.push(listener); },
      focusExisting: () => { calls.focus += 1; },
    },
  };
}

describe("单实例闸", () => {
  it("拿不到锁：副进程只退出，不注册第二次启动监听", () => {
    const { hooks, calls } = fakeHooks(false);
    expect(acquireSingleInstance(hooks)).toBe(false);
    expect(calls.exit).toBe(1);
    expect(calls.listeners).toHaveLength(0);
    expect(calls.focus).toBe(0);
  });

  it("拿到锁：注册且只注册一个监听；第二次启动把已有窗口带回前台", () => {
    const { hooks, calls } = fakeHooks(true);
    expect(acquireSingleInstance(hooks)).toBe(true);
    expect(calls.exit).toBe(0);
    expect(calls.listeners).toHaveLength(1);
    calls.listeners[0]?.();
    expect(calls.focus).toBe(1);
  });
});

describe("界面进程崩溃的提示", () => {
  it("正常退出与 App 正在退出都不打扰用户", () => {
    expect(rendererCrashNotice({ reason: "clean-exit", exitCode: 0 }, false)).toBeNull();
    expect(rendererCrashNotice({ reason: "oom", exitCode: 0 }, true)).toBeNull();
    expect(rendererCrashNotice({ reason: "crashed", exitCode: 1 }, true)).toBeNull();
  });

  it("OOM 有独立文案；退出码只在为正时出现", () => {
    const oom = rendererCrashNotice({ reason: "oom", exitCode: 137 }, false);
    expect(oom?.title).toBe("界面进程内存不足");
    expect(oom?.body).toContain("退出码 137");
    const noCode = rendererCrashNotice({ reason: "oom", exitCode: 0 }, false);
    expect(noCode?.body).not.toContain("退出码");
  });

  it("其他崩溃保留 Electron 给的 reason，并说明磁盘上的记录还在", () => {
    const notice = rendererCrashNotice({ reason: "crashed", exitCode: 0 }, false);
    expect(notice?.title).toBe("界面进程已退出");
    expect(notice?.body).toContain("crashed");
    expect(notice?.body).toContain("崩溃前已经写入磁盘的会话记录不会丢");
  });
});

describe("主进程接线见证", () => {
  it("单实例闸排在 whenReady 之前，副进程的 return 挡在装配段最前", () => {
    const lockAt = appSource.indexOf("acquireSingleInstance({");
    const readyAt = appSource.indexOf("app.whenReady().then(() => {");
    expect(lockAt).toBeGreaterThan(-1);
    expect(readyAt).toBeGreaterThan(-1);
    expect(lockAt).toBeLessThan(readyAt);
    const body = appSource.slice(readyAt, readyAt + 400);
    expect(body).toContain("if (!primaryInstance) return;");
    // 副进程用 app.exit(0) 立刻终止：app.quit() 会让模块继续求值、白建一遍 host。
    expect(appSource).toContain("exit: () => app.exit(0)");
  });

  it("第二次启动的落点是主窗：最小化恢复、隐藏显示、再聚焦；无窗则重建", () => {
    expect(appSource).toContain("function focusMainWindow(): void {");
    expect(appSource).toContain("if (mainWindow.isMinimized()) mainWindow.restore();");
    expect(appSource).toContain("if (!mainWindow.isVisible()) mainWindow.show();");
    expect(appSource).toContain("mainWindow.focus();");
    // 启动竞态：ready 之前的第二次启动不许抢先建出第二个主窗。
    expect(appSource).toContain("if (app.isReady()) createWindow();");
  });

  it("渲染进程退出事件有监听，且只在未退出时弹「重新载入 / 退出」", () => {
    expect(appSource).toContain('app.on("render-process-gone"');
    expect(appSource).toContain("rendererCrashNotice(details, appQuitting)");
    expect(appSource).toContain('buttons: ["重新载入", "退出 Cairn"]');
    expect(appSource).toContain("contents.reload()");
    expect(appSource).toContain('app.on("before-quit", () => { appQuitting = true; });');
    // 弹窗崩溃时弹窗挂在它自己的窗口上（PopoutApp 也是 BrowserWindow）。
    expect(appSource).toContain("BrowserWindow.fromWebContents(contents)");
  });
});
