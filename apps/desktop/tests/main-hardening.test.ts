// 桌面主进程硬化判卷（2026-10-19 独立评审追出的一组真缺陷）：
//   · `say` 参数注入（消息正文可被 prompt injection 控制）
//   · 应用壳 URL 判定被 userinfo / 任意 dist 路径绕过
//   · IPC 不校验来源
//   · 工作区上下文接受未注册路径（`/` 即整盘）
//   · 浏览器窗格权限默认全批准 / 跨站跳转绕过授权
//   · 终端 spawn 失败只发 error 不发 exit ⇒ 会话永久泄漏
// 纯函数部分直接跑；Electron 面走源码接线见证（本仓无 jsdom/Electron 测试宿主）。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isAppShellUrl } from "../src/main/shell-url";

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const app = read("../src/main/index.ts");
const browser = read("../src/main/browser-host.ts");
const terminal = read("../src/main/terminal-host.ts");

describe("应用壳 URL 判定", () => {
  const opts = { devServerUrl: "http://localhost:5173", appPath: "/repo/apps/desktop" };

  it("dev server 同源放行（含 popout 的 hash 路由）", () => {
    expect(isAppShellUrl("http://localhost:5173/", opts)).toBe(true);
    expect(isAppShellUrl("http://localhost:5173/#pane=browser", opts)).toBe(true);
    expect(isAppShellUrl("http://localhost:5173/index.html?x=1", opts)).toBe(true);
  });

  it("userinfo 前缀绕过必须拒绝（旧实现 raw.startsWith(dev) 会放行）", () => {
    expect(isAppShellUrl("http://localhost:5173@evil.com/", opts)).toBe(false);
    expect(isAppShellUrl("http://evil.com/localhost:5173/", opts)).toBe(false);
  });

  it("file: 只认应用自己的 dist/index.html", () => {
    expect(isAppShellUrl("file:///repo/apps/desktop/dist/index.html", opts)).toBe(true);
    expect(isAppShellUrl("file:///tmp/x/dist/index.html", opts)).toBe(false);
    expect(isAppShellUrl("file:///repo/apps/desktop/dist/other.html", opts)).toBe(false);
    expect(isAppShellUrl("file:///repo/apps/desktop/dist/index.html/evil", opts)).toBe(false);
  });

  it("非 http(s)/file 协议一律拒绝", () => {
    for (const u of ["data:text/html,x", "javascript:alert(1)", "https://example.com/"]) {
      expect(isAppShellUrl(u, opts)).toBe(false);
    }
  });

  it("生产（无 dev server）只认 file: 应用壳", () => {
    const prod = { devServerUrl: "", appPath: "/repo/apps/desktop" };
    expect(isAppShellUrl("http://localhost:5173/", prod)).toBe(false);
    expect(isAppShellUrl("file:///repo/apps/desktop/dist/index.html", prod)).toBe(true);
  });
});

describe("主进程接线见证", () => {
  it("say 一律以 `--` 终止选项（正文不能变成 -o<path> 覆盖文件）", () => {
    expect(app).toContain('spawn("say", ["--", t.slice(0, 8000)]');
    expect(app).not.toContain('spawn("say", [t.slice(0, 8000)]');
  });

  it("IPC handler 校验来源；壳 URL 判定收在纯函数里", () => {
    expect(app).toContain("isTrustedIpcSender(event)");
    expect(app).toContain('throw new Error(`IPC 来源不可信，已拒绝：${channel}`)');
    expect(app).toContain("isAppShellUrl(raw, shellUrlOptions)");
  });

  it("工作区上下文只接受已注册路径（`/` 不再是合法边界）", () => {
    expect(read("../src/main/window-workspace-context.ts")).toContain("未注册的工作区，已拒绝");
    expect(app).toContain("new WindowWorkspaceContext(canonicalKnownProjectPath)");
    expect(app).toContain("projectRegistry.list()");
    // 反向：旧的「任意字符串直接落地」不许回来。
    expect(app).not.toContain("workspaceContext = p === \"\" ? null : p;");
  });

  it("浏览器窗格：权限默认拒绝 + 页内跳转/重定向逐跳复查 + 未授权走授权卡", () => {
    expect(browser).toContain("setPermissionRequestHandler");
    expect(browser).toContain("setPermissionCheckHandler(() => false)");
    expect(browser).toContain('wc.on("will-navigate"');
    expect(browser).toContain('wc.on("will-redirect"');
    expect(browser).toContain("this.targetAllowed(target)");
    expect(browser).toContain("只允许 http/https");
    // 被拦下的目标要推给渲染层走既有授权卡，而不是只改标题。
    expect(browser).toContain("pending: { url: target }");
    expect(read("../src/renderer/components/PaneDock.tsx")).toContain("setPending({ url: s.pending.url, tabKey: key })");
    // popout 的浏览器视图挂到聚焦窗口，而不是恒挂 getAllWindows()[0]。
    expect(app).toContain("BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]");
  });

  it("终端 spawn 失败（ENOENT）也发 exit 并摘表（不允许永久泄漏）", () => {
    expect(terminal).toContain("finish(null)");
    expect(terminal).toContain('proc.on("close"');
    expect(terminal).toContain("this.sessions.delete(id)");
  });
});
