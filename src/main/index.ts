// 桌面壳入口：建窗口、接 IPC、装工具门、自检沙箱。
// M1e：settings 存储（布局/档位/主题，app data）+ 会话目录（JSONL 即会话）+ 审批徽标注入通道。
// 沙箱不可用 → 降级为无沙箱 + 写工具强制审批（agent-runner 内），renderer 以常驻警示条提示。
import { writeFile } from "node:fs/promises";
import { app, BrowserWindow, ipcMain, safeStorage, shell } from "electron";
import { join } from "node:path";
import {
  handleAgentDecide,
  handleAgentRun,
  handleAgentState,
  handleCardAction,
  handleClarifySubmit,
  handleCompact,
  handlePlanDecide,
  handleSessionCreate,
  handleSessionDelete,
  handleSessionList,
  handleSessionOpen,
  handleSessionRename,
  handleMemoryDelete,
  handlePluginDecide,
  handleSidechatCreate,
  handleSidechatAsk,
  handleSidechatPromote,
  handleSidechatState,
  getSettings,
  setSettings,
  initSandbox,
  initSessionsDir,
  initSettingsStore,
  initMemoryHome,
  initScheduler,
  startScheduler,
  stopScheduler,
  handleScheduleSnapshot,
  handleScheduleUpsert,
  handleScheduleDelete,
  handleScheduleRunNow,
  providerInfo,
  setAppHooks,
  handleProviderKeySet,
  handleProviderKeyDelete,
  handleProviderKeyStatus,
  handleLicenseStatus,
  handleUpdateCheck,
  initLicenseStore,
  initUpdateContext,
  injectStoredProviderKey,
} from "./agent-runner";
import type { AppSettings, RunRequest } from "./ipc-protocol";
import { installSafeStorageBackend } from "../agent/plugins/secrets";
import { installProviderKeyBackend } from "./provider-keys";
import { isSafeExternalUrl } from "./updater";

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

// M2g 收口修复：renderer 传入的 sessionId 此前在 IPC 边界被丢弃（over 未传），UI run 永远走
// tmp 日志、会话 JSONL 恒空、重放/提升归因全断。现按 RunOverrides 转交（与 preload 类型一致）。
// H2（审查 D-5）：IPC 边界枚举白名单——renderer 不可信，未知 mode 不许落入比声明更宽的执行路径。
const RUN_MODES: ReadonlySet<string> = new Set(["read-only", "default", "auto"]);
ipcMain.handle("agent:run", (_event, req: RunRequest & { sessionId?: string }) => {
  if (req && typeof req === "object" && req.mode !== undefined && !RUN_MODES.has(req.mode)) {
    return Promise.resolve({
      ok: false,
      error: "agent:run: 未知 mode " + JSON.stringify(req.mode) + "（允许 read-only | default | auto）",
    } satisfies { ok: boolean; error: string });
  }
  return handleAgentRun(req, req.sessionId !== undefined ? { sessionId: req.sessionId } : {});
});
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
// M2d：记忆删除（仅用户经记忆面板；模型无删除权）。preload 暴露待白名单轮接线（M1d compact 同款先例）。
ipcMain.handle("agent:memory-delete", (_event, scope: "project" | "global", topic: string) => handleMemoryDelete(scope, topic));
// M2e：插件信任卡决议（M2g 补挂：此前 handlePluginDecide 已就绪但**从未注册**通道——
// 即「主进程就绪、preload 未接线」的背面还有一层「连 handler 都没挂」。本轮一并清账。）
ipcMain.handle("plugin:decide", (_event, plugin: string, trusted: boolean) => handlePluginDecide(plugin, trusted));
// M2f：辅助对话（sidechat）+ /promote。M2g 起 preload 已接线，通道可用。
ipcMain.handle("agent:sidechat-create", (_event, parentSessionId: string, name?: string) => handleSidechatCreate(parentSessionId, name));
ipcMain.handle("agent:sidechat-ask", (_event, sidechatId: string, message: string, parentSessionId?: string) =>
  handleSidechatAsk(sidechatId, message, parentSessionId !== undefined ? { parentSessionId } : {}),
);
ipcMain.handle(
  "agent:sidechat-promote",
  (_event, req: { sidechatId: string; parentSessionId: string; sourceEventIds: number[]; note?: string }) =>
    handleSidechatPromote(req),
);
ipcMain.handle("agent:sidechat-state", (_event, parentSessionId?: string) => handleSidechatState(parentSessionId));
// M3a：card_action 回写协议（worker 审批应答 / agent 取消——审批与 turn 解耦的事件流入口）
ipcMain.handle("agent:card-action", (_event, req: Parameters<typeof handleCardAction>[0]) => handleCardAction(req));
// M4a：定时任务（schedule 面板）——快照 / 创建或更新 / 删除 / 手动立即触发（§12.2.6）
ipcMain.handle("agent:schedule-snapshot", () => handleScheduleSnapshot());
ipcMain.handle("agent:schedule-upsert", (_event, def: unknown, form?: boolean) => handleScheduleUpsert(def, form ?? true));
ipcMain.handle("agent:schedule-delete", (_event, id: string) => handleScheduleDelete(id));
ipcMain.handle("agent:schedule-run-now", (_event, id: string) => handleScheduleRunNow(id));
// M4b：BYOK key（safeStorage）/ license / 更新检查（§2.1/§2.2/§2.3）。
// openExternal 仅放行 http(s)（防 manifest 注入 file:/自定义协议）。
ipcMain.handle("agent:provider-key-set", (_event, provider: string, key: string) => handleProviderKeySet(provider, key));
ipcMain.handle("agent:provider-key-delete", (_event, provider: string) => handleProviderKeyDelete(provider));
ipcMain.handle("agent:provider-key-status", () => handleProviderKeyStatus());
ipcMain.handle("agent:license-status", () => handleLicenseStatus());
ipcMain.handle("agent:update-check", () => handleUpdateCheck());
ipcMain.handle("agent:update-open", async (_event, url: string) => {
  if (typeof url !== "string" || !isSafeExternalUrl(url)) {
    return { ok: false, error: "URL 非法或非 http(s)（拒绝打开）" };
  }
  await shell.openExternal(url);
  return { ok: true };
});

void app.whenReady().then(async () => {
  // 暴露完整 AX 树给系统辅助功能（System Events / VoiceOver 等）；必须在 ready 之后调用
  app.setAccessibilitySupportEnabled(true);
  // M1e 存储：settings 与会话目录缺省 userData；验收脚本用 M1E_SETTINGS_PATH / M1E_SESSIONS_DIR 覆盖
  initSettingsStore(process.env.M1E_SETTINGS_PATH ?? join(app.getPath("userData"), "settings.json"));
  initSessionsDir(process.env.M1E_SESSIONS_DIR ?? join(app.getPath("userData"), "sessions"));
  // M4a：定时任务调度器（shell 生命周期 = app 生命周期；数据目录可 M4A_DATA_DIR 覆盖供验收）。
  // 启动抖动缺省 1-3 分钟（M4A_JITTER_MS 覆盖，0 = 立即判定，验收/演示用）。
  initScheduler({
    dataDir: process.env.M4A_DATA_DIR ?? join(app.getPath("userData"), "automations"),
    sessionsDir: process.env.M1E_SESSIONS_DIR ?? join(app.getPath("userData"), "sessions"),
    ...(process.env.M0B_WORKSPACE ? { workspace: process.env.M0B_WORKSPACE } : {}),
    ...(process.env.M4A_JITTER_MS !== undefined ? { jitterMs: () => Number(process.env.M4A_JITTER_MS ?? "0") } : {}),
  });
  void startScheduler();
  // M2d：全局记忆层 = 应用数据目录下的 memory/（可配 M2D_MEMORY_HOME，测试用临时目录）
  initMemoryHome(process.env.M2D_MEMORY_HOME ?? join(app.getPath("userData"), "memory"));
  // M2g §9.11-2：插件 userConfig 的 sensitive 值走 safeStorage（平台原生加密）。
  // 不可用时**不注入后端** → putPluginSecret 走 fail-closed 拒存（绝不静默退回明文）。
  const secretsOk = installSafeStorageBackend(
    {
      isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
      encryptString: (s: string) => safeStorage.encryptString(s),
      decryptString: (b: Buffer) => safeStorage.decryptString(b),
    },
    join(app.getPath("userData"), "plugin-secrets.json"),
  );
  if (!secretsOk) console.warn("[secrets] safeStorage 不可用 → 插件敏感配置拒存（fail-closed）");
  // M4b §2.1：provider key（BYOK）同款 safeStorage 装配——不可用不注入后端（设置页拒存 + 显式提示，不落明文）。
  // 可用时启动即解密注入 provider 配置（env 优先：M0_API_KEY 已在 = 零行为；进程内，不进日志/事件流）。
  const providerKeysOk = installProviderKeyBackend(
    {
      isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
      encryptString: (s: string) => safeStorage.encryptString(s),
      decryptString: (b: Buffer) => safeStorage.decryptString(b),
    },
    join(app.getPath("userData"), "provider-keys.json"),
  );
  if (!providerKeysOk) console.warn("[provider-keys] safeStorage 不可用 → provider key 拒存（fail-closed）");
  else await injectStoredProviderKey();
  // M4b §2.2/§2.3：license 文件（未激活不阻断）+ 更新检查上下文（当前版本）。
  initLicenseStore(join(app.getPath("userData"), "license.json"));
  initUpdateContext({ currentVersion: app.getVersion() });
  await initSandbox(); // 先自检沙箱，renderer 首帧 getState 即拿到结论
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
// M4a：关闭 app 即停调度（§12.3.1 决策 #18：不做系统级常驻，错过由补跑闸兜底）
app.on("will-quit", () => {
  stopScheduler();
});
