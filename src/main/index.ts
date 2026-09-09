// 桌面壳入口：建窗口、接 IPC、装工具门、自检沙箱。
// M1e：settings 存储（布局/档位/主题，app data）+ 会话目录（JSONL 即会话）+ 审批徽标注入通道。
// 沙箱不可用 → 降级为无沙箱 + 写工具强制审批（agent-runner 内），renderer 以常驻警示条提示。
import { writeFile } from "node:fs/promises";
import { app, BrowserWindow, ipcMain } from "electron";
import { join } from "node:path";
import {
  handleAgentDecide,
  handleAgentRun,
  handleAgentState,
  handleClarifySubmit,
  handleCompact,
  handlePlanDecide,
  handleSessionCreate,
  handleSessionDelete,
  handleSessionList,
  handleSessionOpen,
  handleSessionRename,
  getSettings,
  setSettings,
  initSandbox,
  initSessionsDir,
  initSettingsStore,
  providerInfo,
  setAppHooks,
} from "./agent-runner";
import type { AppSettings, RunRequest } from "./ipc-protocol";

let win: BrowserWindow | null = null;

function createWindow(): void {
  win = new BrowserWindow({
    width: 1280,
    height: 832,
    title: "M1e · 桌面 Agent",
    webPreferences: {
      preload: join(app.getAppPath(), "out", "preload", "index.js"),
      // ESM preload 需要 sandbox:false；contextIsolation 仍开启，renderer 拿不到任何 Node 能力
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.on("closed", () => {
    win = null;
  });
  void win.loadFile(join(app.getAppPath(), "out", "renderer", "index.html"));

  // 交付截图钩子：M0B_SCREENSHOT=<绝对路径> 时，窗口加载后延迟自动截屏（webContents.capturePage，不依赖系统录屏权限）。
  // 不设置该环境变量时零行为；仅用于产出 docs/m0b-ui.png。
  const shotPath = process.env.M0B_SCREENSHOT;
  if (shotPath && win) {
    const delay = Number(process.env.M0B_SCREENSHOT_AFTER_MS ?? "1200");
    win.webContents.once("did-finish-load", () => {
      console.log("[m0b] will capture in", delay, "ms ->", shotPath);
      setTimeout(() => {
        void win
          ?.capturePage()
          .then((img) => writeFile(shotPath, img.toPNG()))
          .then(() => console.log("[m0b] screenshot saved:", shotPath))
          .catch((err) => console.error("[m0b] screenshot FAILED:", err));
      }, delay);
    });
  }

  // M1e 验收通道：M1E_INJECT_ASK=1 时，加载完成后延迟推送一条假审批（徽标 ≤1s 时间戳断言用）。
  // 不设置零行为；沿 M0B_SCREENSHOT / M1D_COMPACTION_DEMO 演示通道先例。
  const injectAsk = process.env.M1E_INJECT_ASK === "1";
  if (injectAsk && win) {
    const delay = Number(process.env.M1E_INJECT_ASK_DELAY_MS ?? "2500");
    win.webContents.once("did-finish-load", () => {
      setTimeout(() => {
        const sentAt = Date.now();
        console.log("[m1e] inject-ask at", sentAt);
        hooksProxy.onAsk?.({
          askId: "m1e-inject-ask",
          tool: "run_shell",
          args: { command: "echo m1e-check" },
          reason: "验收注入（M1E_INJECT_ASK）",
          risk: "none",
          sentAt,
        });
      }, delay);
    });
  }
}

/** hooks 的间接引用（createWindow 里的注入通道在 setAppHooks 之后注册，用 getter 取最新值）。 */
const hooksProxy: { onAsk?: (p: unknown) => void } = {};

function push(channel: string, payload: unknown): void {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

// M1a 流式截图钩子：M1A_STREAM_SHOT=<绝对路径> 时，流式气泡增长中途自动截屏
//（第 2 个 assistant_delta 到达后延迟 M1A_STREAM_SHOT_AFTER_MS，默认 200ms；演示节奏见 mock.ts）。
// 不设置该环境变量时零行为；仅用于产出 docs/m1a-stream.png。
const streamShotPath = process.env.M1A_STREAM_SHOT;
let streamDeltas = 0;

setAppHooks({
  onEvent: (e) => {
    push("agent:event", e);
    if (streamShotPath && e.type === "assistant_delta") {
      streamDeltas++;
      if (streamDeltas === 2) {
        const delay = Number(process.env.M1A_STREAM_SHOT_AFTER_MS ?? "200");
        setTimeout(() => {
          void win
            ?.capturePage()
            .then((img) => writeFile(streamShotPath, img.toPNG()))
            .then(() => console.log("[m1a] stream screenshot saved:", streamShotPath))
            .catch((err) => console.error("[m1a] stream screenshot FAILED:", err));
        }, delay);
      }
    }
  },
  onAsk: (p) => push("agent:ask", p),
  onAskOutcome: (p) => push("agent:ask-done", p),
});
hooksProxy.onAsk = (p) => push("agent:ask", p);

ipcMain.handle("agent:run", (_event, req: RunRequest) => handleAgentRun(req));
ipcMain.handle("agent:decide", (_event, askId: string, approved: boolean, scope?: "once" | "session_kind" | "always") =>
  handleAgentDecide(askId, approved, scope),
);
ipcMain.handle("agent:clarify", (_event, callId: string, answers: Record<string, string | string[]>) =>
  handleClarifySubmit(callId, answers),
);
ipcMain.handle("agent:plan", (_event, approved: boolean, callId?: string) => handlePlanDecide(approved, callId));
ipcMain.handle("agent:compact", (_event) => handleCompact());
ipcMain.handle("agent:state", () => handleAgentState());

// ---- M1e：settings + 会话列表 IPC ----
ipcMain.handle("agent:settings-get", () => getSettings());
ipcMain.handle("agent:settings-set", (_event, patch: Partial<AppSettings>) => setSettings(patch));
ipcMain.handle("agent:provider-info", () => providerInfo());
ipcMain.handle("agent:sessions-list", () => handleSessionList());
ipcMain.handle("agent:sessions-create", (_event, name?: string) => handleSessionCreate(name));
ipcMain.handle("agent:sessions-open", (_event, id: string) => handleSessionOpen(id));
ipcMain.handle("agent:sessions-rename", (_event, oldId: string, newName: string) => handleSessionRename(oldId, newName));
ipcMain.handle("agent:sessions-delete", (_event, id: string) => handleSessionDelete(id));

void app.whenReady().then(async () => {
  // 暴露完整 AX 树给系统辅助功能（System Events / VoiceOver 等）；必须在 ready 之后调用
  app.setAccessibilitySupportEnabled(true);
  // M1e 存储：settings 与会话目录缺省 userData；验收脚本用 M1E_SETTINGS_PATH / M1E_SESSIONS_DIR 覆盖
  initSettingsStore(process.env.M1E_SETTINGS_PATH ?? join(app.getPath("userData"), "settings.json"));
  initSessionsDir(process.env.M1E_SESSIONS_DIR ?? join(app.getPath("userData"), "sessions"));
  await initSandbox(); // 先自检沙箱，renderer 首帧 getState 即拿到结论
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
