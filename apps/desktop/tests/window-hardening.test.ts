// 应用窗口导航硬化（2026-10-17）：应用壳带 preload（window.agent 全量 IPC），外部页面绝不能
// 在应用窗口里加载。真机前的静态哨兵：主窗/弹出窗格都装 handler；外链只交 http(s) 给系统浏览器；
// 浏览器窗格的 window.open 降级为同窗格导航（不新开不受约束的 Electron 窗口）。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("应用窗口导航硬化", () => {
  const main = read("../src/main/index.ts");
  const browser = read("../src/main/browser-host.ts");

  it("主窗与弹出窗格都调用 hardenAppWindow（两处创建点）", () => {
    expect((main.match(/hardenAppWindow\(win\)/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(main).toContain("setWindowOpenHandler");
    expect(main).toContain('action: "deny"');
    expect(main).toContain('wc.on("will-navigate"');
    expect(main).toContain("isShellUrl(url)");
  });

  it("外链只放行 http(s)，file:/javascript: 不交给 shell", () => {
    expect(main).toContain('u.protocol === "http:" || u.protocol === "https:"');
    expect(main).toContain("shell.openExternal(u.href)");
  });

  it("浏览器窗格：window.open 降级为同窗格导航，其余协议拒绝", () => {
    expect(browser).toContain("setWindowOpenHandler");
    expect(browser).toContain('action: "deny"');
    expect(browser).toContain("loadURL(u.href)");
  });
});
