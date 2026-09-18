import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, it, vi } from "vitest";

it("renderer sends the active session ID through the run IPC API", async () => {
  const source = readFileSync(new URL("../src/renderer/app.js", import.meta.url), "utf8");
  // Execute the production send handler with its UI dependencies stubbed.
  const start = source.indexOf("  send = async function () {");
  const end = source.indexOf("  selectSession = async function", start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  const run = vi.fn(async () => ({ ok: true }));
  const context = {
    send: undefined as undefined | (() => Promise<void>),
    // send 的设置加载/防重复发送依赖；本测试保持默认宿主工作区回落。
    sending: false,
    settingsReady: Promise.resolve(),
    workspaceSaving: false,
    workspaceDirty: false,
    workspaceError: '',
    configuredWorkspace: null,
    promptInput: { value: "continue this session" },
    real: { id: "existing-session", running: false },
    api: { run },
    permMode: { id: "default" },
    PERM_MAP: { default: "default" },
    activeFileDoc: null,
    openView: vi.fn(),
    finalizePending: vi.fn(),
    appendUser: vi.fn(),
    ensureAi: vi.fn(),
    setRunning: vi.fn(),
    syncRunButton: vi.fn(),
    runControl: { isRunning: () => false, cancel: null as (() => void) | null },
    toast: vi.fn(),
    // 生产 send 体自 2026-09-17 P0 起还会叫这两个：底栏同步与会话列表重载。
    // 桩面必须与生产依赖同步——漏一个就让整段被 try/catch 吞掉，断言退化成「一次都没调」。
    syncStatusbar: vi.fn(),
    loadSessions: vi.fn(async () => {}),
  };
  runInNewContext(source.slice(start, end), context);
  await context.send!();
  expect(run).toHaveBeenCalledExactlyOnceWith({
    message: "continue this session", mode: "default", sessionId: "existing-session",
  });
});
