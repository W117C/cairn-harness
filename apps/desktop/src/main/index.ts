// Electron main 装配根（M1-6）：kernel-host 单点装配 + IPC 薄映射。
// 装载通道：entry.cjs 注册 repo 根 tsx 后 require 本 TS 源——core 链零打包零漂移
// （esbuild 打包会把 agent-runner 的 ROOT 漂进 <repo>/apps，fixtures 运行时静默落空）。
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, Notification, powerSaveBlocker, safeStorage, screen, shell, webContents, type IpcMainInvokeEvent, type WebContents } from "electron";
import { clampToWorkArea, readWindowState, writeWindowState } from "./window-state";
import { bootBackgroundFor, normalizeThemePreference, resolveBootTheme, type ThemePreference } from "./boot-theme";
import { windowVibrancyOptions } from "./window-vibrancy";
import { focusedWindowViewing, notificationClickWindow, runNotificationCopy, runNotificationTarget, shouldNotifyRunSettled } from "./run-notification";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { isAbsolute, join, resolve } from "node:path";
import { homedir, tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { INVOKE_CHANNELS, PUSH_CHANNELS } from "./channels";
import { installAppMenu } from "./menu";
import { handleAttachmentThumb } from "./thumb";
import type { InvokeChannel, PushChannel } from "./channels";
// SEMA §3.5/§12：IPC_PROTOCOL_VERSION 是本文件从协议面取的唯一**值**（其余全 type import）——
// wired 表的 protocolVersion 行把它递给 renderer 比对构建期注入的期望版本。
import { IPC_PROTOCOL_VERSION, type AddProjectInput, type SessionQueueEntry, type SettingsMigrationSource } from "../../../../src/main/ipc-protocol";
// M3 终审 Critical 修复：澄清/方案两卡自 M2 起端到端死路（wired 表漏行 ⇒ renderer 调用即
// reject「No handler registered」）。与 decide 同式——main 进程 import core 出口后直调，
// 不经 kernel-host 转手（两出口本就是为 IPC 处理函数而生的单例缝，见 agent-runner 各自头注）。
import {
  handleAgentState,
  handleListSkills,
  handleSkillBody,
  handleCardAction,
  handleClarifySubmit,
  handleCompact,
  handleGoalSet,
  handlePlanDecide,
  handleScheduleDelete,
  handleScheduleRunNow,
  handleScheduleSnapshot,
  handleScheduleUpsert,
  handleSidechatAsk,
  handleSidechatCreate,
  handleSidechatPromote,
  handleSidechatState,
  resolveRunModel,
  serveScheduler,
} from "../../../../src/main/agent-runner";
import { suggestNextMessage } from "../../../../src/main/suggest-next";
import { handleMemoryDelete } from "../../../../src/main/memory-handlers";
import { runDoctorForWorkspace } from "../../../../src/main/doctor";
import { closeAllLspClients, killAllLspClientsSync, lspServerStatus } from "../../../../src/tools/lsp";
import { killAllTrackedChildren } from "../../../../src/tools/process";
import {
  getAppVersion,
  getSettings,
  handleProviderKeyDelete,
  handleProviderKeySet,
  handleProviderKeyStatus,
  handleLicenseImport,
  handleUpdateCheck,
  initBuildInfo,
  initUpdateContext,
  onboardingGroups,
  providerInfo,
  reloadSettings,
  setSettings,
  store,
} from "../../../../src/main/settings-handlers";
import {
  handleFeedbackList, handlePinSet, handlePinList,
  handleFeedbackSubmit,
  handleSessionAssignProject,
  handleSessionDelete,
  handleSessionFork,
  handleSessionRename,
  handleSessionRevert,
  handleChangeDiff,
  handleSnapshotRestore,
  handleWorkspaceListDir,
  handleWorkspaceReadText,
  handleSessionSetArchived,
  handleSessionSetPinned,
  resolveSessionRoot,
} from "../../../../src/main/session-handlers";
import { workspaceOfSessionsRoot } from "../../../../src/main/sessions";
import { getLastWorkspace } from "../../../../src/main/runner-workspace";
import { TerminalHost } from "./terminal-host";
import { BrowserHost } from "./browser-host";
import { makeBrowserAgentTools } from "./browser-agent-tools";
import { registerBrowserAgentTools } from "../../../../src/agent/browser-agent";
import type { ClarifyAnswerMap } from "../../../../src/events";
import { installProviderKeyBackend } from "../../../../src/main/provider-keys";
import { installSafeStorageBackend } from "../../../../src/agent/plugins/secrets";
import { pluginDataRootOf } from "../../../../src/agent/plugins";
import { validateUserMcpServer } from "../../../../src/agent/plugins/user-mcp";
import { McpManager } from "../../../../src/agent/plugins/mcp";
import { UserIntegrationSettings } from "../../../../src/main/user-integration-settings";
import { SubagentSettings } from "../../../../src/main/subagent-settings";
import { handleIdleTaskEnqueue, handleIdleTaskList, handleIdleTaskUpdate } from "../../../../src/main/scheduler-runtime";
import { SettingsMigration } from "./settings-migration";
import { injectStoredProviderKey } from "../../../../src/main/provider-key-inject";
import { createKernelHost, canonicalWorkspacePath, setKeepAwakeApplier } from "./kernel-host";
import {
  canonicalKnownProjectPath as canonicalKnownProjectPathIn,
  canonicalKnownRoots,
  resolveCreateParent,
  resolveKnownProjectTarget as resolveKnownProjectTargetIn,
  resolveProvidedWorkspace,
} from "./project-path-gate";
import { isAppShellUrl, shellAppPath } from "./shell-url";
import { WindowWorkspaceContext } from "./window-workspace-context";
import { ProjectRegistry } from "../../../../src/main/project-registry";
import { loadCustomProviders } from "../../../../src/main/custom-provider-store";
import { installCustomProviders } from "../../../../src/providers/registry";
import { discoverForProviderSetup, prepareCustomProvider, commitProviderSetup } from "../../../../src/main/provider-setup";
import { createProjectFolder } from "../../../../src/main/project-create";
import { createProjectFromTemplate, diagnoseProjectDirectory, templateCatalog } from "../../../../src/main/project-templates";
import { PreviewRuntime } from "../../../../src/main/project-preview";
import { exportProject } from "../../../../src/main/project-export";
import { checkProviderConnection } from "../../../../src/main/provider-connection";
import { getSearchSettings, saveSearchSettings, testSearchSettings } from "../../../../src/main/search-settings";
import { resolveEntry } from "../../../../src/main/workspace-fs";
import { createEvolveIpcHandlers } from "./evolve-ipc";
import { createPluginIpcHandlers } from "./plugin-ipc";
import { attachSmokeProbe } from "./smoke-probe";
import { readCapabilities } from "../../../../src/main/doctor";
import { gitClone, gitStatus } from "../../../../src/main/git-ops";
import { searchWorkspace } from "../../../../src/main/workspace-search";
import { saveTempFile, cleanupPasteTempFiles } from "./temp-file";
import { quitWarningMessage, restartWarningMessage, shouldWarnBeforeQuit } from "./quit-guard";
import { acquireSingleInstance } from "./single-instance";
import { rendererCrashNotice } from "./crash-recovery";
import { createAppLog, teeConsole } from "./app-log";
import { buildDiagnosticsBundle, readLogTail } from "./diagnostics-bundle";
import { readBuildInfoSync } from "../../../../src/main/build-info";
import { buildPreferencesExport, defaultPreferences, readPreferencesFile } from "../../../../src/main/preferences";
import { annotateProjectPresence, missingProjectPathError, relocateRegisteredProject } from "./project-presence";
import type { DiscoveryProtocol } from "../../../../src/providers/discovery";
import type { ProviderSaveRequest, SearchSettingsInput } from "../../../../src/main/ipc-protocol";

// M4-5 即时重注别名（providerKeySet 保存成功 → 免重启生效）：wired 表在装配段（whenReady）之前，
// 若 wired 行直写 injectStoredProviderKey 调用，会把 T1 装配守卫（provider-keys.test 次序红线：
// 「首个注入调用点须在 install 之后」）的锚位提前到装配段之前而转红。本地别名同一出口同一语义：
// 启动注入的次序锚位不动，保存路径的运行期重注照常 fire-and-forget。
const reinjectSavedProviderKey = injectStoredProviderKey;

const here = fileURLToPath(new URL(".", import.meta.url));
const distElectron = join(here, "..", "..", "dist-electron");
const brandAssets = join(here, "..", "renderer", "public", "brand");
// 开发工作树可能只有 favicon；图标资源缺失不能阻断会话与工作台启动。
const appIcon = ["cairn.png", "favicon.png"].map((name) => join(brandAssets, name)).find(existsSync);
let mainWindow: BrowserWindow | null = null;
/** 退出流程自己的崩溃（renderer 被 kill）不该弹「界面崩溃」窗；由 before-quit 置位。 */
let appQuitting = false;

// 首帧底色（2026-10-21）：在 renderer 的 CSS/React 到达前，BrowserWindow 先铺一块与
// Claude Desktop v3 的 surface-1 同值的底色——亮 #fcfcfb / 暗 #151515，避免白闪。
// settings.json 的 theme 是唯一真相：启动时把它同步给 nativeTheme，让 backgroundColor 与
// index.html 的 `prefers-color-scheme` 占位用同一判据（系统暗、应用亮时不再先闪暗底）。
// 读不到/字段非法一律回 system，不阻断启动。
const readThemePreference = (): ThemePreference => {
  try {
    const raw = JSON.parse(readFileSync(join(app.getPath("userData"), "settings.json"), "utf8")) as { theme?: unknown };
    return normalizeThemePreference(raw.theme);
  } catch {
    return "system";
  }
};
const bootBackground = (): string =>
  bootBackgroundFor(resolveBootTheme(readThemePreference(), nativeTheme.shouldUseDarkColors));
const readWindowVibrancyPreference = (): boolean => {
  try {
    const raw = JSON.parse(readFileSync(join(app.getPath("userData"), "settings.json"), "utf8")) as { windowVibrancy?: unknown };
    return raw.windowVibrancy === true;
  } catch {
    return false;
  }
};

// ---- v7 朗读宿主（§2.2 消息操作条 read aloud）----
// macOS 系统 say：无 npm 依赖、无网络、进程随应用退出清理；重复调用先停上一条（一次只念一条）。
let speakProc: { kill: () => void } | null = null;
function stopSpeakingNow(): void {
  if (speakProc !== null) {
    try { speakProc.kill(); } catch { /* 已退出 */ }
    speakProc = null;
  }
}

// ---- §2.1 完成通知：会话 run 收束且窗口整体失焦时发 OS 通知 ----
// 近似口径（如实记）：渲染层没有「你正在看哪个会话」的主进程镜像，这里用「窗口整体失焦 = 你不在看」
// 作判据——聚焦时不发（你就在跟前看）；失焦时哪怕看的是别家窗口也发（宁可多一条不丢一条）。
// 2026-10-25：通知可点击——聚焦目标窗口并经 push 通道让 renderer 打开目标会话。
// 2026-10-31：点通知先落到「已经在看目标会话」的窗口（弹窗也算），没有再回主窗。
// 决策/文案/目标/选窗在 ./run-notification 纯函数里单测；这里只留 Electron 壳。
const liveNotifications = new Set<Notification>();
/** 按窗口记录可见会话（v33 起上报；主窗/弹窗各自一格，null = 主页 / 没报过）。
 *  通知判据取「有焦点窗口正在看目标会话」——主窗看 A、弹窗看 B 时，B 收束不提醒。 */
const viewingByWindow = new Map<number, { sessionId: string | null; workspace: string | null }>();
function maybeNotifyRunSettled(input: {
  sessionId: string;
  workspace?: string;
  message?: string;
  ok: boolean;
  error?: string;
  enabled: boolean;
  /** 这一轮的会话就是当前窗口正在看的那个（同 workspace + 同 session）。 */
  viewingTarget: boolean;
}): void {
  const supported = Notification.isSupported();
  if (!shouldNotifyRunSettled({
    ...input,
    supported,
    anyWindowFocused: BrowserWindow.getAllWindows().some((w) => w.isFocused()),
  })) return;
  const copy = runNotificationCopy(input);
  const target = runNotificationTarget(input);
  try {
    const notification = new Notification({ title: copy.title, body: copy.body });
    liveNotifications.add(notification);
    notification.on("close", () => { liveNotifications.delete(notification); });
    notification.on("click", () => {
      liveNotifications.delete(notification);
      const windows = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed());
      const mainId = mainWindow !== null && !mainWindow.isDestroyed() ? mainWindow.id : null;
      const chosenId = notificationClickWindow(
        windows.map((w) => {
          const v = viewingByWindow.get(w.id);
          return {
            windowId: w.id,
            alive: true,
            focused: w.isFocused(),
            sessionId: v?.sessionId ?? null,
            workspace: v?.workspace ?? null,
          };
        }),
        target,
        mainId,
      );
      const win = windows.find((w) => w.id === chosenId) ?? null;
      if (win === null) return;
      if (process.platform === "darwin") app.focus({ steal: true });
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
      // 弹窗已在显示目标会话：带到前台即可；只有主窗上的 renderer 认识 notification-open。
      if (win.id === mainId && !win.webContents.isDestroyed()) {
        win.webContents.send(PUSH_CHANNELS.onNotificationOpen, target);
      }
    });
    notification.show();
  } catch (err) {
    console.error("[notify] 系统通知失败（不阻运行）:", err instanceof Error ? err.message : String(err));
  }
}

// CAIRN_SMOKE userData 隔离（终审 #3，data-loss 防线）：冒烟会 seed settings.json，落真实 userData
// 就是覆写用户数据——先把 userData 指到 mkdtemp 临时目录，seed 与 Electron 存储全部落隔离面。
// setPath 必须先于一切 getPath("userData")：Electron 按当时的路径惰性建目录/落盘，晚了就写进真处。
if (process.env.CAIRN_SMOKE === "1") {
  if (!process.env.CAIRN_DESKTOP_WORKSPACE) {
    // 回落 $HOME 会把冒烟会话/事件写进真实家目录——冒烟必须显式给临时工作区
    console.error("[cairn-smoke] FAIL: CAIRN_DESKTOP_WORKSPACE 未设置（冒烟拒绝回落 $HOME，请显式给临时工作区）");
    app.exit(1);
  }
  app.setPath("userData", mkdtempSync(join(tmpdir(), "cairn-smoke-userdata-")));
}

const userData = app.getPath("userData");
// 单实例闸：锁按 userData 归属，所以必须排在上面的 setPath 之后、任何启动副作用之前。
// 副进程只退出，不进入 whenReady 的装配段——同一个工作区不会被两个 serveScheduler 各跑一遍。
const primaryInstance = acquireSingleInstance({
  requestLock: () => app.requestSingleInstanceLock(),
  exit: () => app.exit(0),
  onSecond: (listener) => { app.on("second-instance", listener); },
  focusExisting: () => { focusMainWindow(); },
});
// 主进程日志：打包态从 Finder 启动时 console 没有落点，设置页却让人「对照日志」。
// 副进程已在上面退出，不会碰这里；日志失败在模块内吞掉，不阻启动。
const appLog = createAppLog({ dir: join(userData, "logs") });
teeConsole(appLog);
process.on("uncaughtExceptionMonitor", (error, origin) => {
  appLog.write("error", `未捕获异常（${origin}）：${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
});
const repoRoot = join(here, "..", "..", "..", "..");
// 首启工作区不得回落 $HOME：仓库内运行时默认落仓库根；打包分发前必须改成显式选择/要求 env。
// 打包态：.app 里的 repoRoot 在只读安装位上——缺省工作区落 userData/workspace（可写）。
// 2026-10-06 更新：首启引导屏已按用户要求删除，所以「真工作区」不再由向导添加，而是走
// 侧栏的「新建项目 / 添加已有文件夹」（空态那张 NEW PROJECT 卡）。CAIRN_SMOKE 的显式 env 优先级不变。
const workspace = process.env.CAIRN_DESKTOP_WORKSPACE
  ?? (app.isPackaged ? join(userData, "workspace") : repoRoot);
if (app.isPackaged && process.env.CAIRN_DESKTOP_WORKSPACE === undefined) {
  mkdirSync(join(userData, "workspace"), { recursive: true });
}

// 工作区由可信 IPC sender 所属窗口保存；弹窗继承打开时的选择，之后独立。
// 缺少窗口上下文时，文件/回滚/终端操作拒绝执行，不能回落到别的窗口最近跑过的项目。
const windowWorkspaces = new WindowWorkspaceContext<WebContents>(canonicalKnownProjectPath);
const workspaceContext = (): string | null => windowWorkspaces.current();
const resolveWorkspace = (): string => windowWorkspaces.require();

// 插件安装、registry 与运行时发现必须共享同一个数据根；renderer 永远不提供落点路径。
const pluginDataRoot = pluginDataRootOf(process.env, homedir());
const userIntegrations = new UserIntegrationSettings(pluginDataRoot);
const subagentSettings = new SubagentSettings();
const settingsMigration = new SettingsMigration({
  async pickFiles(source) {
    const claude = source === "claude-code";
    const result = await dialog.showOpenDialog({
      title: claude ? "选择 Claude Code 配置" : "选择 Codex 配置",
      defaultPath: join(homedir(), claude ? ".claude" : ".codex"),
      properties: ["openFile", "multiSelections", "showHiddenFiles"],
      filters: [{ name: "配置文件", extensions: claude ? ["md", "json"] : ["md", "toml", "json"] }],
    });
    return result.canceled ? null : result.filePaths;
  },
  getInstructions: async () => (await getSettings()).customInstructions,
  importInstructions: (content) => store().importCustomInstructions(content),
  listMcpNames: () => userIntegrations.listMcpNames(),
  importMcp: (servers) => userIntegrations.importMcp(servers),
});

// 自定义 provider（工作区的 `.agent/providers.json`）：与 CLI **同一条装载路径**，而且必须在
// 任何一次 run 之前装上（provider 解析、档位表、适配器 baseURL 三处都读它）。
// 配坏了不拦启动：桌面端把一个配置文件当成启动前置条件，会把用户挡在门外连界面都进不去；
// 所以这里记账（红字 + 问题清单）后继续跑，界面上照样能用别家。配好的照常生效。
const customProviders = loadCustomProviders(workspace);
if (customProviders.kind === "ok") {
  installCustomProviders(customProviders.derived);
  console.log(
    `[custom-providers] 已装 ${customProviders.derived.length} 家：`,
    customProviders.derived.map((d) => `${d.id}(${d.specs.length})`).join(", "),
  );
  for (const warning of customProviders.warnings) console.warn(`[custom-providers] ⚠️ ${warning}`);
} else if (customProviders.kind === "broken") {
  console.error(`[custom-providers] ${customProviders.path} 配置有问题（${customProviders.message}）：`);
  for (const problem of customProviders.problems) {
    console.error(`  · ${problem.where === "" ? "(顶层)" : problem.where}：${problem.message}`);
  }
}

// CAIRN_SMOKE 机器冒烟（GUI 交互留给人）：先 seed settings 再装配 host——
// initSettingsStore 在 createKernelHost 里挂存储，seed 必须赶在它前面。
// （settings 路径已随上面的 mkdtemp 与真实 userData 隔离：隔离目录恒无文件，等价每次重 seed。）
if (process.env.CAIRN_SMOKE === "1") {
  mkdirSync(userData, { recursive: true });
  const settingsPath = join(userData, "settings.json");
  let alreadyDemo = false;
  try {
    alreadyDemo = JSON.parse(readFileSync(settingsPath, "utf8")).provider === "demo";
  } catch {
    // 无文件 / 坏文件 → 重 seed
  }
  // onboarded:true 必须随 seed 落盘（M4-3 首启门）：settings 缺省 onboarded=false ⇒ 不 seed 的
  // 话向导接管主区，sessionbar/ModelPicker 探针全部落空（冒烟是「已引导的 demo 用户」场景）。
  if (!alreadyDemo) writeFileSync(settingsPath, JSON.stringify({ provider: "demo", model: "", onboarded: true }), "utf8");
  // demo 会话落临时工作区（core 侧 run 工作区覆盖的既有 env 通道），不碰仓内 fixtures 靶子
  process.env.M0B_WORKSPACE = workspace;
  // 编排器 worker 演示通道随冒烟同开（fixtures/agents 剧本就位）
  process.env.M3A_AGENTS_DEMO = "1";
}

// M3 T1 多工作区装配面：当前产品仍是单工作区运行（T3 才接工作区注册/切换 UI），
// 装配为 { workspaces: [workspace], activeWorkspace: workspace } 的单元素形态。
// 自动化保唤（2026-11-04）：powerSaveBlocker 实现在此注入——必须赶在 createKernelHost 之前
// （装配时按 settings 初值落一次；此后 setSettings({keepAwake}) 经 host 回调即时开/关）。
let wakeBlockerId: number | null = null;
setKeepAwakeApplier((on) => {
  if (on && wakeBlockerId === null) {
    wakeBlockerId = powerSaveBlocker.start("prevent-app-suspension");
  } else if (!on && wakeBlockerId !== null) {
    powerSaveBlocker.stop(wakeBlockerId);
    wakeBlockerId = null;
  }
});
initUpdateContext({ currentVersion: app.getVersion() });
initBuildInfo(readBuildInfoSync(join(app.getAppPath(), "build-info.json")));
function sendToWindow(win: BrowserWindow | null | undefined, channel: string, payload: unknown): void {
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return;
  win.webContents.send(channel, payload);
}
function broadcastToWindows(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) sendToWindow(win, channel, payload);
}

const host = createKernelHost({
  workspaces: [workspace],
  activeWorkspace: workspace,
  userDataDir: userData,
  outbox: (channel: PushChannel, payload: unknown) => {
    broadcastToWindows(PUSH_CHANNELS[channel], payload);
  },
});

// v5 terminal 窗格：PTY 宿主（推送用与 kernel host 同一广播面）。退出时 killAll 不留孤儿 shell。
const terminalHost = new TerminalHost((e) => {
  broadcastToWindows(
    PUSH_CHANNELS[e.kind === "data" ? "onTerminalData" : "onTerminalExit"],
    e.kind === "data" ? { id: e.id, data: e.data } : { id: e.id, code: e.code },
  );
});

// browser 窗格：WebContentsView 宿主；产品调用按可信 IPC sender 绑定窗口，状态只推回所属窗口。
const browserHost = new BrowserHost(
  // 仅供直接宿主调用兜底；browser IPC 始终传入调用窗口，不依赖焦点。
  () => BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null,
  (state, owner) => {
    if (owner !== undefined) {
      sendToWindow(owner, PUSH_CHANNELS.onBrowserState, state);
      return;
    }
    broadcastToWindows(PUSH_CHANNELS.onBrowserState, state);
  },
);
// 浏览器驾驶三件（2026-11-06 业主①）：进程级一次性注册；installAppTools 消费——
// CLI/headless 无此注册 ⇒ 整族不注入，模型面一个字节不付。
registerBrowserAgentTools(makeBrowserAgentTools(browserHost, () => {
  const sender = windowWorkspaces.currentRunOwner();
  return sender === null || sender.isDestroyed() ? null : BrowserWindow.fromWebContents(sender);
}));

// v6 项目预览运行时：static 走进程内静态服务，vite 起受控子进程（命令写死在 core，见其头注）。
// 状态推送与 browserHost 同一条广播面；退出时由 will-quit 全部回收（不留孤儿 dev server）。
const previewRuntime = new PreviewRuntime({}, (snapshot) => {
  broadcastToWindows(PUSH_CHANNELS.onPreviewState, snapshot);
});

// CX-01 项目注册表（M3-3 修复轮接线）：构造注入路径落 userData/projects.json（project-registry.ts:125
// 构造面 = new ProjectRegistry(filePath)）。文件不存在是空默认、结构损坏显式失败不静默覆盖；
// CAIRN_SMOKE 的 userData 已隔离到 mkdtemp，不碰真实数据。
const projectRegistry = new ProjectRegistry(join(userData, "projects.json"));

/** 用户**真的用系统对话框选过**的目录（规范路径）。
 *
 *  为什么要记这份名单（2026-10-19 独立评审追出）：`gitClone` 的落点 `parentDir` 是渲染层给的
 *  路径，而 `dest = join(parentDir, repoName)` 直接就是文件系统写入目标——URL 过了白名单、
 *  仓库名也严了字符集，**唯独 parentDir 原样照收**：
 *  `window.agent.gitClone({url:"https://x/y.git", parentDir:"/Users/me/.ssh"})` 就会把仓库
 *  克隆进 `~/.ssh/y`（连 `.git/hooks/*.sample` 一起写进去），没有审批、没有提示。
 *  界面上那一栏只能通过系统目录对话框选（AddProjectMenu 的 cloneParent），没有手输兜底
 *  ⇒ 主进程记下"用户选过哪些目录"，克隆落点只认这份名单，两边口径一致。 */
const pickedDirs = new Set<string>();

/** 已知工作区根（默认工作区 / 最近跑过的工作区 / 注册表里的项目）——规范路径去重。
 *
 *  为什么要这道门（2026-10-19 独立评审追出）：渲染层给的是**路径**，而路径在这几个通道上
 *  是**执行落点**，不是"看一眼"：
 *  · `previewStart` → 在该目录跑 `pnpm install` + `pnpm exec vite` ⇒ **vite 会加载并执行该目录的
 *    `vite.config.js`**（任意代码执行），且没有审批门；
 *  · `projectExport` → 把该目录整份拷到用户选的位置（`~/.ssh` 也拷）。
 *  同一个文件里 `setWorkspaceContext` 早就把工作区上下文限死在"已注册"面上（不校验的话
 *  `/` 就成了文件窗格/预览的边界），唯独这两条通道**绕过了那道门**——同一个信任边界，
 *  一半有门一半没有，那一半就是洞。
 *
 *  口径：**等于某个根**（项目目录本身）或**落在某个根之内**（工作区里 agent 交付的单文件
 *  交付物也要能预览——那是产品明确支持的一路，不能顺手砍掉）。根之外的路径一律拒绝。 */
async function knownProjectRoots(requireRegistry = false): Promise<string[]> {
  const roots: (string | null)[] = [workspace, getLastWorkspace()];
  try {
    for (const record of await projectRegistry.list()) roots.push(record.path);
  } catch (error) {
    if (requireRegistry) throw error;
    // 注册表读失败时只保留默认和最近工作区。
  }
  return canonicalKnownRoots(roots);
}

/** 严格相等版：路径**恰好等于**某个已知根才放行。
 *  `setWorkspaceContext` 要的就是这个：它定的是"文件窗格/预览的**根**"，
 *  落进某个子目录会让边界含糊。 */
async function canonicalKnownProjectPath(p: string): Promise<string | null> {
  return canonicalKnownProjectPathIn(p, await knownProjectRoots());
}

/** 显式 workspace → 该工作区的会话目录（**已登记根闸**）；缺省/空 = 交给 host 自行解析（唯一才认）。 */
async function explicitSessionsRoot(workspace: unknown): Promise<string | undefined> {
  if (workspace === undefined || workspace === null || workspace === "") return undefined;
  const canonical = await canonicalKnownProjectPath(String(workspace));
  if (canonical === null) throw new Error(`未注册的工作区，已拒绝：${String(workspace)}`);
  return join(canonical, ".agent", "sessions");
}

async function mutateSession<T>(
  id: string, workspace: unknown, mutate: (root: string) => Promise<T>, renamedTo?: (result: T) => string,
): Promise<T> {
  const root = await explicitSessionsRoot(workspace) ?? await resolveSessionRoot(id);
  if (root === null) throw new Error(`会话不存在: ${id}`);
  const result = await mutate(root);
  host.forgetSession(id, workspaceOfSessionsRoot(root) ?? undefined, renamedTo?.(result));
  return result;
}

/** 包含版：等于某个根**或**落在某个根之内就放行。
 *  落在根之内这一支是给"工作区里 agent 交付的单文件交付物也要能预览"留的
 *  （产品明确支持的一路，不能顺手砍掉）。软链逐段解析后再判
 *  （core 的 assertRealContainment 正是这件事：词法 relative 挡不住"工作区内软链指向外部"）。 */
async function resolveKnownProjectTarget(p: string): Promise<string | null> {
  return await resolveKnownProjectTargetIn(p, await knownProjectRoots());
}

// v2.14：桌面端调度器 stop 句柄（whenReady 里 serveScheduler 返回；will-quit 停表）。
let stopDesktopScheduler: (() => void) | null = null;

// M3 收口（重审照亮）：projects.json 存量项目启动 rehydrate。addProject 只在本次进程内
// host.addWorkspace——重启后 host.workspaces 退回装配单元素，已注册工作区的会话不经
// listSessions 出现，点该分组发消息即 createSession 白名单 throw（T3「添加工作区」跨重启断点）。
// 启动即按注册表回灌：addWorkspace 去重幂等（与装配 workspace 重叠安全）；软删除记录
// list() 默认不返回，不复活。fail-soft：ProjectRegistry 构造不抛（纯字段存储），损坏在
// 异步 load() 显式抛 ProjectRegistryCorruptError——在此捕获 console.error 不阻启动
// （projects.json 损坏时 listProjects/addProject 通道仍 fail-visible，rehydrate 缺席只影响旧分组）。
// 保留 Promise 给 IPC 面：渲染层首屏的 listSessions 必须等回灌完成再扫。
// 旧实现是裸 `void` IIFE ⇒ 首屏若抢在 list 完成前到达，另一个项目的会话不在清单里，
// 启动恢复会把它判成「不存在」并永久清 key（跨区恢复在冷启动时随机失效）。
const projectRehydrate = (async () => {
  try {
    for (const p of await projectRegistry.list()) host.addWorkspace(p.path);
  } catch (error) {
    console.error("[m3-rehydrate] 存量项目回灌失败（不阻启动）:", error);
  }
})();

// 全通道接真（B3 修复）：`wired` 收成**全键** Record<InvokeChannel, …>，不再是 Partial——
// 少一行 ⇒ tsc 当场红（比旧的 `if (handler)` 静默跳过早一个数量级）。M1 起这表漏行三连
// （getProviderInfo → submitClarify → decidePlan）：AgentApi/channels/preload 三面都齐、wired
// 独缺一行，renderer 调用即 reject「No handler registered」而被 void 吞掉 ⇒ 静默死路。
// 注册循环同步去掉 `if (handler)` 分支：表是全键，缺键是编译期错误，不存在"未接线"这个态。
// 将来真要留一条 v1 不做的通道，唯一合法出口是显式 fail-loud handler（返回
// { ok:false, error:"…（暂未实现）" }），而不是从表里删行——删行 = 编译红。
// addProject 一行仍记 M3-3 修复轮的语义：透传之外在成功后同步 host.addWorkspace(record.path)，
// 新工作区并入 host 扫描面（main 进程内直调，不经 IPC、renderer 无感知自动生效）。
const evolveHandlers = createEvolveIpcHandlers(resolveWorkspace);
const { pluginInstallJobs, ...pluginHandlers } = createPluginIpcHandlers({
  userData,
  pluginDataRoot,
  isRunning: () => host.runningCount() > 0,
  knownProjectRoots: () => knownProjectRoots(),
  workspaceContext,
});

const wired: Record<InvokeChannel, (...args: unknown[]) => unknown> = {
  // 当前调用窗口的可信工作区；不接受 renderer 自报的目录。
  searchSettingsGet: () => getSearchSettings(resolveWorkspace()),
  searchSettingsSave: (input) => saveSearchSettings(resolveWorkspace(), input as SearchSettingsInput),
  searchSettingsTest: (input) => testSearchSettings(resolveWorkspace(), input as SearchSettingsInput | undefined),
  // §2.1 完成通知的挂点：run 收束后（会话模式）窗口失焦则发系统通知；不改变 run 的任何语义。
  run: async (req) => {
    const request = req as { sessionId?: string; workspace?: unknown; message?: unknown } | null;
    const sessionId = request?.sessionId;
    const res = await host.run(req as never);
    if (typeof sessionId === "string" && sessionId !== "") {
      // 通知偏好由设置页控制；读失败按「开」处理（缺省开，与既有行为一致），不让读设置拖垮 run 应答。
      const notifyEnabled = await getSettings().then((s) => s.notifyOnComplete !== false, () => true);
      const runWorkspace = typeof request?.workspace === "string" ? request.workspace : undefined;
      const focusedIds = new Set(
        BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed() && w.isFocused()).map((w) => w.id),
      );
      const viewingTarget = focusedWindowViewing(
        [...viewingByWindow.entries()].map(([windowId, v]) => ({ windowId, focused: focusedIds.has(windowId), ...v })),
        sessionId,
        runWorkspace,
      );
      maybeNotifyRunSettled({
        sessionId,
        ...(runWorkspace !== undefined ? { workspace: runWorkspace } : {}),
        ...(typeof request?.message === "string" ? { message: request.message } : {}),
        ok: res.ok === true,
        ...(res.error !== undefined ? { error: res.error } : {}),
        enabled: notifyEnabled,
        viewingTarget,
      });
    }
    return res;
  },
  decide: (askId, approved, scope) => host.decide(askId as string, approved as boolean, scope as never),
  // M3 终审 Critical（wired 表漏行三连之三、四）：channels 表/preload/AgentApi 自 M2 起有
  // submitClarify 与 decidePlan，App.tsx（澄清卡/方案卡 onSubmit/onDecide）也早已在调，
  // wired 表却从没这两行 ⇒ renderer 调用即 reject「No handler registered」，澄清与方案
  // 两卡端到端死路。实现直调 core 出口（与 decide 同式）：handleClarifySubmit 同步返回
  // boolean（ipcMain.handle 自动包成 resolve，AgentApi 的 Promise 形状不受影响）；
  // ClarifyAnswerMap 与 ipc-protocol 的 ClarifyAnswers 同为 Record<string, string | string[]>。
  submitClarify: (callId, answers) => handleClarifySubmit(callId as string, answers as ClarifyAnswerMap),
  decidePlan: (approved, callId) => handlePlanDecide(approved as boolean, callId as string | undefined),
  // channels 表（T2）钉的键是 runCancel；KernelHost 方法名是 cancel（brief 快照里写 cancel 与表不符——映射类型红线拦下）。
  // v50：透传未知入参，host 统一校验 sessionId/workspace；目标不匹配绝不控制其他项目的 run。
  runCancel: (sessionId, workspace) => host.cancel(sessionId, workspace),
  // 插话走同一工作区校验；不在运行时 renderer 将消息保留在目标队列。
  runSteer: (sessionId, text, workspace) => host.steer(sessionId, text, workspace),
  listSessions: async () => { await projectRehydrate; return host.listSessions(); },
  // v14：跨会话用量账本（只读；面板点「全部会话」才调）。
  usageLedger: () => host.usageLedger(),
  // v25：Evolve 只读报告与人工治理动作（实现见 ./evolve-ipc.ts）。
  evolveReport: evolveHandlers.evolveReport,
  evolveSetFrozen: evolveHandlers.evolveSetFrozen,
  evolveActivate: evolveHandlers.evolveActivate,
  evolveDormant: evolveHandlers.evolveDormant,
  evolveGlobalRevoke: evolveHandlers.evolveGlobalRevoke,
  evolveGlobalSetFrozen: evolveHandlers.evolveGlobalSetFrozen,
  evolveGlobalActivate: evolveHandlers.evolveGlobalActivate,
  // v52：读 LSP 状态。只读一条：不 spawn、不写授权（授权仍走审批卡那一面）。
  lspStatus: async () => lspServerStatus(resolveWorkspace()),
  orchestrationView: address => host.orchestrationView(address as never),
  orchestrationSubmit: request => host.orchestrationSubmit(request as never),
  orchestrationControl: request => host.orchestrationControl(request as never),
  // v15：会话日志尾部（只读；会话归属由 host 解析，renderer 不传路径）。
  sessionLog: (id, tailLines) => host.sessionLog(id as string, typeof tailLines === "number" ? tailLines : undefined),
  // createSession 首参 M3 起是工作区（原 name 槽位被 M3 接口接管）；渲染层现不传 ⇒ 缺省 activeWorkspace
  createSession: (workspace) => host.createSession(workspace as string | undefined),
  openSession: (id, workspace) => host.openSession(id as string, workspace as string | undefined),
  queueGet: (sessionId, workspace) => host.queueGet(sessionId as string, workspace as string | undefined),
  queueSet: (sessionId, items, workspace) =>
    host.queueSet(sessionId as string, items as SessionQueueEntry[], workspace as string | undefined),
  // M3 小修（M1 六通道清单遗留缺口）：channels.ts 有 getProviderInfo 通道、preload 程序化桥自动
  // 透传、App.tsx 挂载即调，wired 表却从没这行 ⇒ renderer 调用即 reject「No handler registered」，
  // 模型选择器自 M2 起静默失效（providerInfo 恒 null）。实现直走 settings-handlers 的同名 read
  // model（无参异步，kernel-host 已注入 resolveProviderKind 依赖面），选择器恢复真值目录。
  getProviderInfo: () => providerInfo(),
  // v11：listProjects 收 options（recentFirst = 「最近打开」菜单序；includeRemoved = 含软删除记录）。
  listProjects: async (options) => {
    const records = await projectRegistry.list(options as { includeRemoved?: boolean; recentFirst?: boolean } | undefined);
    return await annotateProjectPresence(records, async (path) => {
      try { return (await stat(path)).isDirectory(); } catch { return false; }
    });
  },
  relocateProject: (id, path) => relocateRegisteredProject(String(id), String(path), projectRegistry, host, workspace),
  // v11：最近打开标（打开会话/切项目时 renderer 调用；未知 id 拒绝上抛）。
  touchProject: (id) => projectRegistry.touch(String(id)),
  // ③「新建项目」：建同名文件夹 → 登记 → 同步进 host 工作区面。
  // 两段失败分开报：建目录失败（名字非法/已存在/没权限）与登记失败是两回事，
  // 而且登记失败时目录**已经建好了** —— 消息里必须给出那个路径，否则用户找不到它。
  createProject: async (req) => {
    const r = req as { name?: string; parentDir?: string };
    // 批 133：parentDir 是写入落点，不是"看一眼"——只认用户选过的目录 ∪ 已知项目根。
    const parent = resolveCreateParent(r.parentDir, pickedDirs, await knownProjectRoots());
    if (!parent.ok) return { ok: false, reason: "unpicked-parent", message: parent.message };
    const made = createProjectFolder({
      name: String(r.name ?? ""),
      ...(parent.parentDir !== undefined ? { parentDir: parent.parentDir } : {}),
    });
    if (!made.ok) return { ok: false, reason: made.reason, message: made.message };
    try {
      const record = await projectRegistry.add({ name: made.name, path: made.path });
      host.addWorkspace(record.path);
      return { ok: true, name: made.name, path: record.path };
    } catch (err) {
      return {
        ok: false,
        reason: "register-failed",
        message: `文件夹已建好：${made.path}，但登记失败（${err instanceof Error ? err.message : String(err)}）——可以用「添加已有文件夹」把它加进来`,
      };
    }
  },
  // v6 模板建项：一次拿到**可运行的项目**（模板文件 + .cairn/project.json），登记后并入工作区面。
  // 两段失败分开报与 createProject 同式；区别是这里回滚由 core 服务负责（不把半个项目留给用户）。
  projectTemplates: () => Promise.resolve(templateCatalog()),
  projectCreateFromTemplate: async (req) => {
    const r = req as { name?: string; templateId?: string; parentDir?: string };
    // 批 133：与 createProject 同一条父目录闸（同形漏洞，不各写一套）。
    const parent = resolveCreateParent(r.parentDir, pickedDirs, await knownProjectRoots());
    if (!parent.ok) return { ok: false, reason: "unpicked-parent", message: parent.message };
    const made = createProjectFromTemplate({
      name: String(r.name ?? ""),
      templateId: String(r.templateId ?? ""),
      ...(parent.parentDir !== undefined ? { parentDir: parent.parentDir } : {}),
    });
    if (!made.ok) return { ok: false, reason: made.reason, message: made.message };
    try {
      const record = await projectRegistry.add({ name: made.name, path: made.path });
      host.addWorkspace(record.path);
      return { ok: true, name: made.name, path: record.path, parentDir: made.parentDir, templateId: made.templateId };
    } catch (err) {
      return {
        ok: false,
        reason: "register-failed",
        message: `项目已建好：${made.path}，但登记失败（${err instanceof Error ? err.message : String(err)}）——可以用「添加已有文件夹」把它加进来`,
      };
    }
  },
  // v6 预览运行时（宿主见 project-preview.ts；状态经 onPreviewState 推送）。
  // 预览会**在该目录跑 vite**（加载并执行它的 vite.config.js）⇒ 路径必须先过已知工作区门。
  previewStart: async (projectPath) => {
    const p = String(projectPath);
    const canonical = await resolveKnownProjectTarget(p);
    if (canonical === null) {
      return {
        projectPath: p,
        status: "failed" as const,
        stage: "spec" as const,
        message: `未注册的项目路径，已拒绝：${p}`,
        hint: "先把该文件夹添加为项目，再预览它",
      };
    }
    return await previewRuntime.start(canonical);
  },
  previewStop: (projectPath) => previewRuntime.stop(String(projectPath)),
  previewStatus: (projectPath) => Promise.resolve(previewRuntime.status(String(projectPath))),
  // v12 导入诊断（ADR 0004 §4）：只读判定，不写盘、不登记——诊断只提示不阻断。
  projectDiagnose: (projectPath) => diagnoseProjectDirectory(String(projectPath)),
  // v6 导出：位置由用户选（系统目录选择器）；取消不是错误，不弹失败条。
  projectExport: async (projectPath) => {
    // 导出源目录也是**落点**（整份拷走）⇒ 与预览同口径先过已知工作区门。
    const p = String(projectPath);
    const canonical = await resolveKnownProjectTarget(p);
    if (canonical === null) return { ok: false as const, error: `未注册的项目路径，已拒绝：${p}` };
    const picked = await dialog.showOpenDialog({ title: "选择导出位置（将在其中新建同名文件夹）", properties: ["openDirectory", "createDirectory"] });
    const destParent = picked.filePaths[0];
    if (destParent === undefined) return { ok: false, error: "已取消导出", cancelled: true };
    const r = exportProject(canonical, destParent);
    if (!r.ok) return { ok: false, error: r.message };
    return { ok: true, dest: r.dest, copiedFiles: r.copiedFiles };
  },
  // v6 连接自检：GET 模型清单（不产生 token 费用）。
  providerCheck: (provider) => checkProviderConnection({ provider: String(provider) }),
  // 斜杠菜单技能清单（2026-10-18）：显式传工作区，切项目时不吃竞态。
  listSkills: async (workspace) => {
    // 批 133：workspace 是"去哪棵树里读技能"的根；只认已登记根。空参数回落到上下文。
    const gate = resolveProvidedWorkspace(workspace, await knownProjectRoots(), workspaceContext());
    if (!gate.ok) throw new Error(gate.error);
    return await handleListSkills(gate.workspace);
  },
  // 技能正文（§8 #15）：同上按显式工作区读取。
  skillBody: async (name, workspace) => {
    const gate = resolveProvidedWorkspace(workspace, await knownProjectRoots(), workspaceContext());
    if (!gate.ok) return { ok: false, error: gate.error };
    return await handleSkillBody(String(name ?? ""), gate.workspace);
  },
  // 导出对话为 .md（2026-10-18）：原生保存面板；取消是合法结果（canceled），不是错误。
  exportPreferences: async () => {
    const settings = await getSettings();
    const payload = buildPreferencesExport(settings, getAppVersion(), new Date().toISOString());
    const name = `Cairn-preferences-${new Date().toISOString().slice(0, 10)}.json`;
    const opts = {
      title: "导出偏好备份",
      defaultPath: join(app.getPath("downloads"), name),
      filters: [{ name: "JSON", extensions: ["json"] }],
    };
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
    const r = win !== null ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
    if (r.canceled || r.filePath === undefined || r.filePath === "") return { ok: false as const, canceled: true as const };
    try {
      writeFileSync(r.filePath, JSON.stringify(payload, null, 2) + "\n", "utf8");
      return { ok: true as const, path: r.filePath };
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
    }
  },
  importPreferences: async () => {
    const opts = {
      title: "导入偏好备份",
      properties: ["openFile" as const],
      filters: [{ name: "JSON", extensions: ["json"] }],
    };
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
    const picked = win !== null ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    const source = picked.filePaths[0];
    if (picked.canceled || source === undefined || source === "") return { ok: false as const, canceled: true as const };
    return await readPreferencesFile(source);
  },
  exportDiagnostics: async (reportMarkdown, suggestedName) => {
    const rawName = String(suggestedName ?? "").trim();
    const name = rawName === "" ? "cairn-diagnostics.md" : rawName;
    const logTail = await readLogTail(join(userData, "logs", "main.log"));
    const bundle = buildDiagnosticsBundle({
      reportText: String(reportMarkdown ?? "").slice(0, 200_000),
      generatedAt: new Date().toISOString(),
      logTail,
    });
    const opts = {
      title: "导出诊断包",
      defaultPath: join(app.getPath("downloads"), name),
      filters: [{ name: "Markdown", extensions: ["md"] }],
    };
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
    const r = win !== null ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
    if (r.canceled || r.filePath === undefined || r.filePath === "") return { ok: false as const, canceled: true as const };
    try {
      writeFileSync(r.filePath, bundle, "utf8");
      return { ok: true as const, path: r.filePath };
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
    }
  },
  exportTranscript: (markdown, suggestedName) => saveMarkdownDialog("导出对话", "cairn-transcript.md", String(markdown ?? ""), String(suggestedName ?? "")),
  exportMemory: (markdown, suggestedName) => saveMarkdownDialog("导出记忆", "cairn-memory.md", String(markdown ?? ""), String(suggestedName ?? "")),
  addProject: (input) =>
    projectRegistry.add(input as AddProjectInput).then((record) => {
      host.addWorkspace(record.path);
      return record;
    }),
  // M4-5 缩面对称（addWorkspace 的逆操作）：removeProject 成功后同步 host.removeWorkspace(record.path)
  // ——被移除工作区退出扫描面（listSessions 不再出现该组）、归属表/漂移基线同步清理；该组有在跑
  // 会话 ⇒ host.removeWorkspace fail-visible throw（IPC reject 上抛 renderer，不静默缩面）。
  removeProject: async (id) => {
    // 先摘工作区（有在跑会话会 throw）再软删注册表：旧顺序先删注册表，throw 时项目已消失
    // 但扫描面还在——用户看到「移除失败」，实际上项目列表里已经没了。
    const record = await projectRegistry.get(id as string);
    host.removeWorkspace(record.path);
    return await projectRegistry.remove(id as string);
  },
  // M4-5：dialog 选目录（M3 deferred 收口，侧栏添加表单「浏览…」的后端）：非模态 showOpenDialog
  // 只选目录（openDirectory）；取消/关窗 ⇒ filePaths 空 ⇒ null——renderer 据此保留手输兜底。
  pickDirectory: async () => {
    const picked = await dialog.showOpenDialog({ properties: ["openDirectory"] });
    const dir = picked.filePaths[0];
    if (dir === undefined) return null;
    // 记下"用户真的用系统对话框选过这个目录"——gitClone 的落点门靠它（见下）。
    try { pickedDirs.add(canonicalWorkspacePath(dir)); } catch { /* 不可解析：不记（那条路本来就拒） */ }
    return dir;
  },
  // v8：dialog 选文件（附件引用「选择文件…」的后端，业主 21.56 反馈「为什么还要粘贴路径」）：
  // 非模态多选（openFile）；取消/关窗 ⇒ 空 ⇒ null（不假报空数组）——路径手输照旧兜底。
  pickFiles: async () => {
    const picked = await dialog.showOpenDialog({ properties: ["openFile", "multiSelections"] });
    return picked.filePaths.length > 0 ? picked.filePaths : null;
  },
  // v9：Tab 想下一条（业主裁 A②）：按「当前选中模型（会话覆盖 > 设置缺省）」单发一次上下文建议。
  // 不走会话归属/漂移——单发不进会话流、不落 JSONL；解析失败（模型未登记等）也分类返回，
  // renderer 原样上屏，不抛裸异常。
  suggestNext: async (input) => {
    const req = input as { model: string | null; excerpt: string };
    try {
      const settings = await getSettings();
      const selection = resolveRunModel({ provider: settings.provider, model: settings.model }, req.model ?? undefined);
      return await suggestNextMessage({ selection, excerpt: req.excerpt });
    } catch (error) {
      const brief = error instanceof Error ? error.message : String(error);
      return { ok: false as const, reason: "error" as const, message: brief, hint: `想建议失败（${brief.slice(0, 60)}）——去设置检查模型，或再按一次 Tab。` };
    }
  },
  getState: () => handleAgentState(workspaceContext()),
  getOnboarding: () => onboardingGroups(),
  getSettings: () => getSettings(),
  setSettings: async (patch) => {
    const next = await setSettings(patch as never);
    applyNativeSettings(patch as Record<string, unknown>);
    return next;
  },
  resetPreferences: async () => {
    const patch = defaultPreferences() as Record<string, unknown>;
    const next = await setSettings(patch as never);
    applyNativeSettings(patch);
    return next;
  },
  reloadSettings: async () => {
    const r = await reloadSettings();
    if (r.ok) {
      // 与 setSettings 同式：主题/窗口材质换了，原生窗口 chrome 也得跟（不等下次启动）。
      const s = await getSettings();
      nativeTheme.themeSource = s.theme;
      if (process.platform === "darwin" && mainWindow !== null) {
        mainWindow.setVibrancy(s.windowVibrancy ? "sidebar" : null);
        mainWindow.setBackgroundColor(s.windowVibrancy ? "#00000000" : bootBackground());
      }
    }
    return r;
  },
  compact: async (sessionId, workspace) => {
    const root = await explicitSessionsRoot(workspace);
    return handleCompact({ sessionId: sessionId as string | undefined, ...(root !== undefined ? { sessionsRoot: root } : {}) });
  },
  setGoal: (req) => handleGoalSet(req as never),
  cardAction: (req) => handleCardAction(req as never),
  renameSession: (oldId, newName, workspace) => mutateSession(oldId as string, workspace,
    (root) => handleSessionRename(oldId as string, newName as string, root), (result) => result.id),
  // v35：会话级模型/思考档持久化（sidecar；null = 清除回跟随全局）。
  sessionPrefsSet: (id, prefs, workspace) => host.sessionPrefsSet(id, prefs, workspace),
  deleteSession: (id, workspace) => mutateSession(id as string, workspace, async (root) => {
    const roots = (await knownProjectRoots(true)).map((project) => join(project, ".agent", "sessions"));
    return handleSessionDelete(id as string, root, roots);
  }),
  // M8 分叉（v2.15）：保留前 N 轮 → 新会话 `<id>-f<N>`；与 CLI --fork/--from 同口径（fork-cli 单源）。
  forkSession: async (id, round, unique, workspace) => handleSessionFork(id as string, round as number, unique === true, await explicitSessionsRoot(workspace)),
  // #7 文件级回滚（v2.16）：把第 N 轮主会话改过的文件还原成该轮之前的原件（源自 D7 覆盖前快照）。
  // 活动工作区上下文（desktop 专用）：空串清除；写入口只收字符串，非法值留给后续操作 fail-visible。
  setWorkspaceContext: async (path) => {
    const requested = String(path ?? "");
    // 已登记但目录不在场：报「可能被移动」并给出重新定位入口，不再说成「未注册」。
    const missing = await missingProjectPathError(requested, await projectRegistry.list().catch(() => []), async (p) => {
      try { return (await stat(p)).isDirectory(); } catch { return false; }
    });
    if (missing !== null) return { ok: false, error: missing };
    const selected = await windowWorkspaces.select(requested);
    if (selected.ok) {
      // provider registry 是进程级模块状态；切项目后必须换成**当前窗口工作区**的那一份，
      // 否则选择器里还挂着上一个项目的自定义家，保存也会继续写旧项目的 .agent/providers.json。
      const current = workspaceContext();
      const loaded = current === null ? null : loadCustomProviders(current);
      installCustomProviders(loaded?.kind === "ok" ? loaded.derived : []);
      if (loaded?.kind === "broken") console.warn(`[custom-providers] ${loaded.path} 配置有问题：${loaded.message}`);
    }
    return selected;
  },
  // v33：窗口可见会话上报（通知判据）。workspace 规范化后存，与 run 请求的工作区同口径比对；
  // 校验失败（未注册）存 null ⇒ 只按 session 比对（宁可多一条，不丢一条——与旧注释同一取舍）。
  doctor: () => runDoctorForWorkspace(workspaceContext()),
  reportViewing: async (sessionId, workspace, owner) => {
    const win = owner as BrowserWindow | null;
    if (win === null || win.isDestroyed()) return { ok: false };
    const sid = typeof sessionId === "string" && sessionId !== "" ? sessionId : null;
    const raw = typeof workspace === "string" ? workspace : "";
    // 主窗有显式工作区就规范化；弹窗自报空串 ⇒ 用继承来的窗口上下文（不信任 renderer 自报目录）。
    const ws = sid === null ? null
      : raw === "" ? windowWorkspaces.current()
      : await canonicalKnownProjectPath(raw).catch(() => null);
    viewingByWindow.set(win.id, { sessionId: sid, workspace: ws });
    return { ok: true };
  },
  revertTurn: async (id, round, workspace) =>
    handleSessionRevert(id as string, round as number, null, await explicitSessionsRoot(workspace)),
  // v4 变更审阅（diff 窗格逐 hunk）。
  changeDiff: (req) => handleChangeDiff(req as never, resolveWorkspace()),
  // v5 file 窗格（只读浏览）。
  workspaceListDir: (relPath) => handleWorkspaceListDir(relPath as string, resolveWorkspace()),
  workspaceReadText: (relPath) => handleWorkspaceReadText(relPath as string, resolveWorkspace()),
  // v7 路径动作（§2.3 右键菜单）：解析段（存在性 + 越界拒绝）在 workspace-fs（纯 Node 判卷面），
  // shell 调用留在壳。openPath 空串 = 成功（Electron 口径）。
  workspacePathAction: async (relPath, action) => {
    const ws = resolveWorkspace();
    const resolved = await resolveEntry(ws, String(relPath ?? ""));
    if (!resolved.ok) return { ok: false, error: resolved.error };
    const act = String(action);
    if (act === "abs") return { ok: true, path: resolved.abs };
    if (act === "reveal") {
      shell.showItemInFolder(resolved.abs);
      return { ok: true, path: resolved.abs };
    }
    if (act === "open") {
      const err = await shell.openPath(resolved.abs);
      return err === "" ? { ok: true, path: resolved.abs } : { ok: false, error: err };
    }
    return { ok: false, error: `未知路径动作：${act}` };
  },
  // v7 朗读（macOS say；非 darwin fail-visible 不装样子）。上限 8000 字符防超长正文卡进程。
  speakText: (text) => {
    const t = String(text ?? "").trim();
    if (t === "") return Promise.resolve({ ok: false, error: "没有可朗读的文本" });
    if (process.platform !== "darwin") return Promise.resolve({ ok: false, error: "朗读目前仅支持 macOS（系统 say）" });
    stopSpeakingNow();
    const proc = spawn("say", ["--", t.slice(0, 8000)], { stdio: "ignore" });
    speakProc = proc;
    proc.on("exit", () => { if (speakProc === proc) speakProc = null; });
    proc.on("error", (err) => {
      if (speakProc === proc) speakProc = null;
      console.error("[speak] say 启动失败:", err.message);
    });
    return Promise.resolve({ ok: true });
  },
  stopSpeaking: () => {
    stopSpeakingNow();
    return Promise.resolve({ ok: true });
  },
  // v5 terminal 窗格（PTY 宿主见 terminal-host.ts）。
  // 与 diff/文件窗格/回滚同一条工作区解析：只使用当前调用窗口的上下文。
  terminalStart: (owner) => terminalHost.start(resolveWorkspace(), process.env, owner as BrowserWindow),
  terminalWrite: (id, data) => Promise.resolve(terminalHost.write(id as string, data as string)),
  terminalResize: (id, cols, rows) => Promise.resolve(terminalHost.resize(id as string, cols as number, rows as number)),
  terminalKill: (id) => { terminalHost.kill(id as string); return Promise.resolve(); },
  // v5 窗格弹出：独立窗口（同壳参数；#pane=<kind>[&session=<id>] 路由）。
  panePopout: (kind, sessionId) => {
    const win = new BrowserWindow({
      icon: appIcon,
      width: 760,
      height: 620,
      titleBarStyle: "hiddenInset",
      backgroundColor: bootBackground(),
      webPreferences: { preload: join(distElectron, "preload.cjs"), contextIsolation: true, nodeIntegration: false },
    });
    win.on("closed", () => { viewingByWindow.delete(win.id); });
    windowWorkspaces.inherit(win.webContents);
    hardenAppWindow(win);
    const ws = workspaceContext();
    const hash = `pane=${encodeURIComponent(kind as string)}${typeof sessionId === "string" && sessionId !== "" ? `&session=${encodeURIComponent(sessionId)}` : ""}${ws !== null && ws !== "" ? `&workspace=${encodeURIComponent(ws)}` : ""}`;
    if (process.env.VITE_DEV_SERVER_URL) void win.loadURL(`${process.env.VITE_DEV_SERVER_URL}#${hash}`);
    else void win.loadFile(join(distElectron, "..", "dist", "index.html"), { hash });
    return Promise.resolve({ ok: true });
  },
  // v5 browser 窗格（WebContentsView 宿主见 browser-host.ts）。
  // owner 只由下方可信 IPC sender 解析，不能接受 renderer 自报的窗口。
  browserOpen: (id, url, owner) => Promise.resolve(browserHost.open(id as string, url as string, owner as BrowserWindow | null)),
  browserBounds: (id, rect, owner) => { browserHost.setBounds(id as string, rect as { x: number; y: number; width: number; height: number }, owner as BrowserWindow | null); return Promise.resolve(); },
  browserNav: (id, action, owner) => { browserHost.navigate(id as string, action as "back" | "forward" | "reload", owner as BrowserWindow | null); return Promise.resolve(); },
  browserClose: (id, owner) => { browserHost.close(id as string, owner as BrowserWindow | null); return Promise.resolve(); },
  // v7：清除浏览数据（keepCookies 语义对齐「Keep cookies」）+ 元素选择（§3.6 ⌘⇧S）。
  browserClearData: (id, opts, owner) => browserHost.clearData(String(id), (opts as { keepCookies?: boolean } | undefined)?.keepCookies === true, owner as BrowserWindow | null),
  browserSetAllowedHosts: (hosts) => {
    browserHost.setAllowedHosts(Array.isArray(hosts) ? (hosts as unknown[]).filter((h): h is string => typeof h === "string") : []);
    return Promise.resolve({ ok: true });
  },
  browserPickElement: (id, owner) => browserHost.pickElement(String(id), owner as BrowserWindow | null),
  // v2.16 用户反馈沉淀（赞/踩）：sidecar feedback.jsonl，append-only、不进事件流。
  submitFeedback: async (req) => handleFeedbackSubmit(req as never, await explicitSessionsRoot((req as { workspace?: unknown } | null)?.workspace)),
  listFeedback: async (sessionId, workspace) => handleFeedbackList(sessionId as string, await explicitSessionsRoot(workspace)),
  // 2026-10-20 消息置顶（销 G6）：sidecar pins.jsonl，append-only、不进事件流。
  setMessagePinned: async (req) => handlePinSet(req as never, await explicitSessionsRoot((req as { workspace?: unknown } | null)?.workspace)),
  listMessagePins: (sessionId) => handlePinList(sessionId as string),
  setSessionPinned: (sessionId, pinned) => handleSessionSetPinned(sessionId as string, pinned as boolean),
  setSessionArchived: (sessionId, archived) => handleSessionSetArchived(sessionId as string, archived as boolean),
  // §3.7 · G4 会话级 worktree 隔离：解析归属/在跑拒绝/创建合并清理全在 kernel-host 与 core 侧。
  sessionWorktree: (req) => host.sessionWorktree(req as never),
  worktreeClean: (name, workspace) => host.worktreeClean(name as string, workspace as string | undefined),
  worktreeDiff: (ref, workspace) => host.worktreeDiff(ref as string, workspace as string | undefined),
  assignSessionProject: (sessionId, projectId) => handleSessionAssignProject(sessionId as string, projectId as string | null),
  deleteMemory: (scope, topic) => handleMemoryDelete(scope as never, topic as string, scope === "project" ? resolveWorkspace() : workspaceContext()),
  pluginDecide: pluginHandlers.pluginDecide,
  pluginUserConfigSet: pluginHandlers.pluginUserConfigSet,
  marketplaceCatalog: pluginHandlers.marketplaceCatalog,
  pluginPickLocalSource: pluginHandlers.pluginPickLocalSource,
  marketplacePluginImport: pluginHandlers.marketplacePluginImport,
  marketplacePluginUpdate: pluginHandlers.marketplacePluginUpdate,
  marketplacePluginCheckUpdate: pluginHandlers.marketplacePluginCheckUpdate,
  pluginConfigureInstalled: pluginHandlers.pluginConfigureInstalled,
  marketplacePluginInstall: pluginHandlers.marketplacePluginInstall,
  marketplacePluginInstallStatus: pluginHandlers.marketplacePluginInstallStatus,
  marketplacePluginInstallCommit: pluginHandlers.marketplacePluginInstallCommit,
  marketplacePluginInstallCancel: pluginHandlers.marketplacePluginInstallCancel,
  pluginSetEnabled: pluginHandlers.pluginSetEnabled,
  pluginUninstall: pluginHandlers.pluginUninstall,
  pluginsInstalled: pluginHandlers.pluginsInstalled,
  sidechatCreate: (parentSessionId, name) => handleSidechatCreate(parentSessionId as string, name as string | undefined),
  sidechatAsk: (sidechatId, message, parentSessionId) =>
    handleSidechatAsk(sidechatId as string, message as string, { parentSessionId: parentSessionId as string | undefined }),
  sidechatPromote: (req) => handleSidechatPromote(req as never),
  sidechatState: (parentSessionId) => handleSidechatState(parentSessionId as string | undefined),
  scheduleSnapshot: () => handleScheduleSnapshot(),
  scheduleUpsert: (def, form) => handleScheduleUpsert(def, form as boolean | undefined),
  scheduleDelete: (id) => handleScheduleDelete(id as string),
  scheduleRunNow: (id) => handleScheduleRunNow(id as string),
  // M4-5 即时重注（M4-2 遗留收口）：key 保存成功后立即解密注入 provider env——免重启生效。
  // env 优先语义由注入面自带（该家 env 已在 = 那一家零行为）；fire-and-forget，失败 console.error
  // 留痕不被 void 吞（文案不含任何 key 值——明文零落盘的日志面纪律）。调用走 reinjectSavedProviderKey
  // 别名（文件头注）：装配守卫（provider-keys.test）的「首个注入调用点」锚位保持在启动装配段。
  providerKeySet: (provider, key) =>
    handleProviderKeySet(provider as string, key as string).then((r) => {
      if (r.ok) {
        void reinjectSavedProviderKey().then(
          () => undefined,
          (error) => console.error("[byok-inject] 保存后重注失败（不影响保存结果）:", error),
        );
      }
      return r;
    }),
  providerKeyDelete: (provider) => handleProviderKeyDelete(provider as string),
  providerKeyStatus: () => handleProviderKeyStatus(),
  importLicense: async () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
    const opts = {
      title: "导入许可证",
      properties: ["openFile" as const],
      filters: [{ name: "许可证", extensions: ["json"] }],
    };
    const picked = win !== null ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    const source = picked.filePaths[0];
    if (picked.canceled || source === undefined || source === "") return { canceled: true as const };
    return await handleLicenseImport(source);
  },
  // S7 自定义接口（BYO 端点）：拉取与保存都走 src/main 里那份**可离线判卷**的核心，
  // 这里只负责两件 Electron 侧的事——把钥匙存进 safeStorage（成功才写配置）、把新家装进运行期注册表。
  providerDiscover: (req) => {
    // wired 表的形参在运行时是 unknown（IPC 边界），这里按协议面收窄一次；非法值由核心层报错。
    const r = req as { baseURL: string; protocol?: DiscoveryProtocol; keyEnv: string; keyValue?: string; allowLocal?: boolean };
    return discoverForProviderSetup({
      baseURL: String(r.baseURL),
      protocol: r.protocol ?? "openai",
      keyEnv: String(r.keyEnv),
      ...(typeof r.keyValue === "string" && r.keyValue !== "" ? { keyValue: r.keyValue } : {}),
      ...(r.allowLocal === true ? { allowLocalEndpoint: true } : {}),
    });
  },
  providerSave: async (req) => {
    const r = req as ProviderSaveRequest;
    const providerId = String(r.providerId);
    // 四步顺序（2026-10-06 实测修正）：**先装 → 再存钥匙 → 后落盘 → 失败回滚**。
    // 为什么不是「先存钥匙」：钥匙面的判据是「已装上的 provider 才许存」（本仓既有判据，未知 id 拒收），
    // 所以首次添加一家时先存钥匙必然被拒 —— 用户看到的就是「点了保存没有回音」。
    // 判据是对的，错的是顺序。
    const prepared = prepareCustomProvider(resolveWorkspace(), {
      id: providerId,
      ...(r.label !== undefined ? { label: r.label } : {}),
      protocol: r.protocol,
      baseURL: String(r.baseURL),
      apiKeyEnv: String(r.apiKeyEnv),
      ...(r.allowLocalEndpoint === true ? { allowLocalEndpoint: true } : {}),
      models: r.models,
    });
    if (!prepared.ok) {
      return { ok: false, error: prepared.error, ...(prepared.problems !== undefined ? { problems: [...prepared.problems] } : {}) };
    }
    const saved = await commitProviderSetup(prepared, providerId, typeof r.keyValue === "string" ? r.keyValue : undefined);
    if (!saved.ok) return { ok: false, error: saved.error };
    return {
      ok: true,
      path: prepared.path,
      providers: [...prepared.file.providers.map((p) => p.id)],
      installed: prepared.derived.length,
      warnings: [...prepared.warnings],
    };
  },
  // 自定义供应商编辑模式的预填数据面：DerivedCustomProvider 的界面投影（不含 key 明文）。
  providerCustomList: async () => {
    const loaded = loadCustomProviders(resolveWorkspace());
    if (loaded.kind !== "ok") return { ok: true, entries: [] };
    return {
      ok: true,
      entries: loaded.derived.map((d) => ({
        id: d.id,
        label: d.label,
        protocol: d.protocol,
        baseURL: d.baseURL,
        apiKeyEnv: d.apiKeyEnv,
        modelIds: d.specs.map((sp) => sp.id),
        // 每模型的思考声明（用户自己声明的那些）：编辑表单据此回填。缺了它，改个 key 再保存
        // 就会把 `reasoningEfforts` / `reasoningDefault` 一起冲掉 —— 那是静默丢用户配置。
        models: d.specs.map((sp) => ({
          id: sp.id,
          ...(sp.reasoningEfforts !== undefined ? { reasoningEfforts: [...sp.reasoningEfforts] } : {}),
          ...(sp.reasoningDefault !== undefined ? { reasoningDefault: sp.reasoningDefault } : {}),
        })),
      })),
    };
  },
  subagentSettingsList: () => subagentSettings.list(),
  subagentSettingsRead: (file) => subagentSettings.read(file as string),
  subagentSettingsSave: (file, markdown, expectedRevision) => subagentSettings.save(file as string, markdown as string, expectedRevision as string | null),
  subagentSettingsRemove: (file, expectedRevision) => subagentSettings.remove(file as string, expectedRevision as string),
  settingsPreviewMigration: (source) => settingsMigration.preview(source as SettingsMigrationSource),
  settingsApplyMigration: (id, items) => settingsMigration.apply(id as string, items as string[]),
  idleTaskList: () => handleIdleTaskList(resolveWorkspace()),
  idleTaskEnqueue: (raw) => handleIdleTaskEnqueue(raw, resolveWorkspace()),
  idleTaskUpdate: (id, action) => handleIdleTaskUpdate(id, action, resolveWorkspace()),
  backgroundTaskList: (id, workspace) => host.backgroundTaskList(id as string, workspace as string | undefined),
  backgroundTaskStop: (id, taskId, workspace) => host.backgroundTaskStop(id as string, taskId as string, workspace as string | undefined),
  mcpUserConfig: () => userIntegrations.mcpConfig(),
  mcpUserSave: (req) => userIntegrations.mcpSave(req as Parameters<UserIntegrationSettings["mcpSave"]>[0]),
  hooksUserConfig: () => userIntegrations.hooksConfig(),
  hooksUserSave: (req) => userIntegrations.hooksSave(req as Parameters<UserIntegrationSettings["hooksSave"]>[0]),
  mcpUserProbe: async (req) => {
    const r = req as { name: string; config: unknown };
    const name = String(r.name ?? "").trim();
    if (name === "") return { ok: false, error: "缺 server 名" };
    const v = validateUserMcpServer(r.config);
    if (!v.ok) return { ok: false, error: v.error };
    // 独立 McpManager（连接即关）：真握手 + tools/list，不碰会话运行时的连接态。
    const mcp = new McpManager();
    try {
      const res = await mcp.connect("probe", name, v.config);
      if (!res.ok) return { ok: false, error: res.error ?? "连接失败" };
      return { ok: true, tools: res.tools.map((t) => t.name), toolCount: res.tools.length };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    } finally {
      await mcp.disconnectAll().catch(() => {});
    }
  },
  checkUpdate: () => handleUpdateCheck(),
  openExternal: async (url) => {
    try {
      const u = new URL(String(url));
      if (u.protocol !== "http:" && u.protocol !== "https:") return { ok: false, error: "仅允许打开 http(s) 链接" };
      await shell.openExternal(u.href);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
  // SEMA §3.5/§12：协议版本握手（同步返回 number，ipcMain.handle 自动包成 resolve）。
  protocolVersion: () => IPC_PROTOCOL_VERSION,
  // 能力在场性：搜索端点配没配。口径与 CLI --doctor 的 search 那一格同源（同一个 loadSearchConfig）。
  capabilities: async () => await readCapabilities(workspaceContext() ?? workspace, join(app.getPath("userData"), "settings.json")),
  // v11 主界面重做批（七行）——
  // git 两闸：读数先过已知项目路径门（git status 会触发 .git/config 的钩子/配置，且避免探测任意目录）；克隆 URL 白名单 + 目标已存在即拒（都在 core 模块内判）。
  gitStatus: async (path) => {
    const p = String(path);
    const canonical = await resolveKnownProjectTarget(p);
    if (canonical === null) return { ok: false as const, error: `未注册的项目路径，已拒绝：${p}` };
    return await gitStatus(canonical);
  },
  gitClone: (req) => {
    const r = req as { url?: string; parentDir?: string };
    const parentDir = String(r.parentDir ?? "");
    // 落点门：只认用户用系统对话框**真的选过**的目录（见 pickedDirs 的注释）。
    // 克隆会往那里写整个仓库（含 .git/hooks/*.sample）——渲染层给的路径不因此就可信。
    let canonical: string;
    try { canonical = canonicalWorkspacePath(parentDir); } catch {
      return Promise.resolve({ ok: false as const, error: "克隆目标目录不可解析" });
    }
    if (!pickedDirs.has(canonical)) {
      return Promise.resolve({ ok: false as const, error: `克隆目标目录未经选择，已拒绝：${parentDir}（请用「浏览…」选一个目录）` });
    }
    return gitClone(String(r.url ?? ""), canonical);
  },
  // 项目内模糊搜索（@ 引用数据面；只读文件名，不读文件内容）。
  // 2026-10-21 评审修：它同样收渲染层给的目录，必须过已登记根闸（只读名字也是泄露面）。
  workspaceSearch: async (ws, query) => {
    const gate = resolveProvidedWorkspace(ws, await knownProjectRoots(), workspaceContext());
    if (!gate.ok) throw new Error(gate.error);
    if (gate.workspace === null) throw new Error("工作区未知——先打开一个项目");
    return await searchWorkspace(gate.workspace, String(query));
  },
  // v18：会话正文全文检索（只读）。**主进程扫会话 JSONL，渲染层不碰盘**——
  // 检索是 IO 密集面，放在渲染进程会卡 UI 也会把会话目录摸进前端。
  // 工作区归属先过已登记根闸（同 workspaceSearch：渲染层给的目录必须 ∈ 已登记工作区）。
  // 结果三态由 core 给（ok / partial / unavailable），这里**原样传回**——
  // 「没量到」不许在主进程被折成空数组。
  sessionSearch: async (ws, query, options) => {
    const gate = resolveProvidedWorkspace(ws, await knownProjectRoots(), workspaceContext());
    if (!gate.ok) throw new Error(gate.error);
    if (gate.workspace === null) throw new Error("工作区未知——先打开一个项目");
    const o = options as { budgetBytes?: unknown; maxSessions?: unknown } | undefined;
    return await host.sessionSearch(gate.workspace, String(query), {
      ...(typeof o?.budgetBytes === "number" ? { budgetBytes: o.budgetBytes } : {}),
      ...(typeof o?.maxSessions === "number" ? { maxSessions: o.maxSessions } : {}),
    });
  },
  // ⌘V 粘贴落临时文件（字节帽 20MB 在核心模块内判；校验先于 electron 动态导入）。
  saveTempFile: (req) => {
    const r = req as { name?: string; bytes?: unknown };
    return saveTempFile(String(r.name ?? ""), r.bytes);
  },
  snapshotRestore: async (req) => {
    const request = req as Parameters<typeof handleSnapshotRestore>[0] & { workspace?: string };
    try {
      const root = await explicitSessionsRoot(request.workspace) ??
        (request.sessionId ? await resolveSessionRoot(request.sessionId) : undefined);
      if (root === null) return { ok: false, error: `会话不存在：${request.sessionId}` };
      return await handleSnapshotRestore(request, root === undefined ? resolveWorkspace() : null, root);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
  // Finder 显示（项目右键菜单 / 项目外附件 chip 的落点）。只显示不打开；绝对路径 + 存在性前置。
  attachmentThumb: (path) => handleAttachmentThumb(path as string),
  revealInFinder: async (path) => {
    const p = String(path ?? "");
    if (!isAbsolute(p)) return { ok: false, error: "不是绝对路径" };
    const st = await stat(p).catch(() => null);
    if (st === null) return { ok: false, error: "路径不存在" };
    shell.showItemInFolder(p);
    return { ok: true };
  },
};
// 注册循环（B3 修复）：去掉旧的 `if (handler)` **静默跳过**——那正是漏行三连的温床（renderer
// 调到「No handler registered」，被 void 吞掉、UI 无任何反馈）。wired 现为全键 Record，缺键
// 编译期即红；这里再钉一道运行时自检，堵住「用类型断言把空洞塞进表」这条侧路。
// UNWIRED 是**带理由的未接白名单**（仿 gate-manifest 的 EXEMPT_SCRIPTS）：真有一条通道 v1
// 不做，唯一合法出口是写进这个集合（每行注记理由）⇒ 注册成 fail-loud handler，绝不静默跳过。
const UNWIRED_FAIL_LOUD: ReadonlySet<InvokeChannel> = new Set([
  // 空 = 全部 39 条通道都已接真。要留白请在此逐条加键并写理由。
]);
for (const [key, channel] of Object.entries(INVOKE_CHANNELS) as [InvokeChannel, string][]) {
  const handler = wired[key];
  if (typeof handler !== "function") {
    if (UNWIRED_FAIL_LOUD.has(key)) {
      ipcMain.handle(channel, async () => ({ ok: false, error: `通道 ${channel}（${key}）暂未实现` }));
      continue;
    }
    throw new Error(`wired 表缺 handler：${key}（通道 ${channel}）——补实现，或写进 UNWIRED_FAIL_LOUD 并注记理由`);
  }
  ipcMain.handle(channel, (event, ...args: unknown[]) => {
    if (!isTrustedIpcSender(event)) {
      throw new Error(`IPC 来源不可信，已拒绝：${channel}`);
    }
    return windowWorkspaces.run(event.sender, () => {
      // 后台弹窗恢复页面时焦点可能还在主窗；视图归属取发起 IPC 的窗口。
      if (key === "reportViewing") return handler(args[0], args[1], BrowserWindow.fromWebContents(event.sender));
      if (key === "browserOpen" || key === "browserBounds" || key === "browserNav" || key === "browserClearData") {
        return handler(args[0], args[1], BrowserWindow.fromWebContents(event.sender));
      }
      if (key === "browserClose" || key === "browserPickElement") {
        return handler(args[0], BrowserWindow.fromWebContents(event.sender));
      }
      if (key === "terminalStart") {
        const owner = BrowserWindow.fromWebContents(event.sender);
        if (owner === null || owner.isDestroyed()) return { ok: false, error: "调用窗口已关闭" };
        return handler(owner); // 窗口归属只由可信 sender 提供，忽略 renderer 自报参数。
      }
      return handler(...args);
    }, key === "run");
  });
}
void webContents; // 显式留痕：推送经 BrowserWindow.getAllWindows()

/** 应用窗口的导航硬化（2026-10-17）：外链一律交给系统浏览器，绝不在带 preload 的应用
 *  窗口里加载外部页面——应用壳的 preload 暴露 window.agent（全量 IPC），把渲染层交给
 *  远程页面等于把本机能力一起交出去。只放行「应用壳自身」的导航（dist/index.html 或
 *  dev server 根）；http(s) 外链 shell.openExternal，其余协议直接丢。 */
const shellUrlOptions = { devServerUrl: process.env.VITE_DEV_SERVER_URL ?? "", appPath: shellAppPath(here) };
const isShellUrl = (raw: string): boolean => isAppShellUrl(raw, shellUrlOptions);

/** IPC 来源校验：只有应用壳页面（含 popout，同一 dist/index.html）能调 window.agent。
 *  浏览器窗格没有 preload；将来新增窗口/壳内 XSS 也不该直接拿到文件读、终端、provider key。 */
function isTrustedIpcSender(event: IpcMainInvokeEvent): boolean {
  try {
    const frameUrl = event.senderFrame?.url ?? event.sender.getURL();
    return isShellUrl(frameUrl);
  } catch {
    return false;
  }
}
function openExternalSafe(raw: string): void {
  try {
    const u = new URL(raw);
    if (u.protocol === "http:" || u.protocol === "https:") void shell.openExternal(u.href);
  } catch { /* about:blank / 非法 URL：不打开 */ }
}
function hardenAppWindow(win: BrowserWindow): void {
  const wc = win.webContents;
  wc.once("destroyed", () => windowWorkspaces.forget(wc));
  wc.setWindowOpenHandler(({ url }) => {
    openExternalSafe(url);
    return { action: "deny" };
  });
  wc.on("will-navigate", (event, url) => {
    if (isShellUrl(url)) return;
    event.preventDefault();
    openExternalSafe(url);
  });
}

const createWindow = () => {
  // 上次的窗口位置/大小（2026-10-18）：夹到当前显示器工作区（换过屏/拔过副屏时旧坐标可能不可见）。
  const statePath = join(app.getPath("userData"), "window-state.json");
  const saved = readWindowState(statePath);
  const bounds = saved === null ? null : clampToWorkArea(saved, screen.getDisplayMatching(saved).workArea);
  const vibrancy = windowVibrancyOptions(process.platform, process.env, readWindowVibrancyPreference());
  const win = new BrowserWindow({
    icon: appIcon,
    ...(bounds === null ? {} : { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }),
    ...(bounds === null ? { width: 1200, height: 800 } : {}),
    minWidth: 880,
    // 窗口位置/大小由本应用自己持久化（window-state.json）。
    // 2026-10-18 修正：此前这里写 `restorable: false`，注释说是要关掉 macOS 的 NSWindow 状态恢复
    // （系统会用 savedState 覆盖我们读回的 bounds）。但 **Electron 没有 restorable 这个选项**——
    // 它既不在 BrowserWindowConstructorOptions 也不在 BaseWindowConstructorOptions 里
    // （node_modules/electron/electron.d.ts 全文无此键），tsc 直接报 TS2353，桌面打包链是红的。
    // 真实情况：macOS 的窗口状态恢复只在应用注册了 restoration 类（NSWindowRestoration
    // protocol / Electron 的 supportsAutomaticWindowState）时才生效。本应用**从未注册**
    // （入口 entry.cjs → src/main/index.ts 无任何 restore 相关调用），系统不会替我们还原窗口，
    // 也就无所谓「覆盖」。真正防覆盖的是下面 createWindow 里 bounds 显式传入 + clampToWorkArea。
    // 因此：删掉这个不存在的键，typecheck 恢复绿；行为不变（本来就没开系统恢复）。
    titleBarStyle: "hiddenInset",
    ...(vibrancy === null ? { backgroundColor: bootBackground() } : vibrancy),
    webPreferences: {
      preload: join(distElectron, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      ...(vibrancy === null ? {} : { additionalArguments: ["--cairn-vibrancy"] }),
    },
  });
  win.on("closed", () => { viewingByWindow.delete(win.id); });
  if (saved?.maximized === true) win.maximize();
  // 拖动/缩放防抖 400ms 落盘；关闭前再写一次（正常退出一定留住最后位置）。
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  const persistBounds = (): void => {
    if (win.isDestroyed()) return;
    writeWindowState(statePath, { ...win.getNormalBounds(), ...(win.isMaximized() ? { maximized: true } : {}) });
  };
  const scheduleSave = (): void => {
    if (saveTimer !== null) clearTimeout(saveTimer);
    saveTimer = setTimeout(persistBounds, 400);
  };
  win.on("resize", scheduleSave);
  win.on("move", scheduleSave);
  win.on("close", persistBounds);
  mainWindow = win;
  win.on("closed", () => { if (mainWindow === win) mainWindow = null; });
  // 渲染层的 console 错误也进主日志：打包态没有 devtools 时，这是用户能带走的唯一现场。
  win.webContents.on("console-message", (event) => {
    if (event.level === "error") {
      appLog.write("error", `[renderer] ${event.message} (${event.sourceId}:${String(event.lineNumber)})`);
    }
  });
  hardenAppWindow(win);
  if (process.env.VITE_DEV_SERVER_URL) void win.loadURL(process.env.VITE_DEV_SERVER_URL);
  else void win.loadFile(join(distElectron, "..", "dist", "index.html"));

  // CAIRN_SMOKE：真窗口 + 真 IPC 回环的机器冒烟（实现见 ./smoke-probe.ts）。
  if (process.env.CAIRN_SMOKE === "1") attachSmokeProbe(win, { app, workspace });
};

/** 第二次启动（或 macOS 重新打开）时把主窗带回前台；窗口已被关掉则按需重建。
 *  启动竞态：首实例还没 ready 时第二次启动会先到这里，此时 whenReady 自己会建窗——
 *  这里再建一个就是两个主窗（旧实现正是无条件 createWindow）。 */
function focusMainWindow(): void {
  if (appQuitting) return;
  if (mainWindow === null || mainWindow.isDestroyed()) {
    if (app.isReady()) createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
}

/** setSettings / resetPreferences 共用：主题与窗口材质改完要同步原生 chrome。 */
function applyNativeSettings(patch: Record<string, unknown>): void {
  const theme = patch.theme;
  if (theme === "light" || theme === "dark" || theme === "system") nativeTheme.themeSource = theme;
  // 窗口材质：运行期先 best-effort 应用；透明窗口的完整材质仍以重启为准。
  const vibrancy = patch.windowVibrancy;
  if (process.platform === "darwin" && typeof vibrancy === "boolean" && mainWindow !== null) {
    mainWindow.setVibrancy(vibrancy ? "sidebar" : null);
    mainWindow.setBackgroundColor(vibrancy ? "#00000000" : bootBackground());
  }
}

/** 导出类动作共用：原生保存面板 + Markdown 落盘；取消/失败都是显式态。 */
async function saveMarkdownDialog(
  title: string,
  fallbackName: string,
  markdown: string,
  suggestedName: string,
): Promise<{ ok: boolean; path?: string; canceled?: boolean; error?: string }> {
  const raw = String(suggestedName ?? "").trim();
  const name = raw === "" ? fallbackName : raw;
  const opts = {
    title,
    defaultPath: join(app.getPath("downloads"), name),
    filters: [{ name: "Markdown", extensions: ["md"] }],
  };
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
  const r = win !== null ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
  if (r.canceled || r.filePath === undefined || r.filePath === "") return { ok: false, canceled: true };
  try {
    writeFileSync(r.filePath, String(markdown ?? ""), "utf8");
    return { ok: true, path: r.filePath };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** 「重新启动 Cairn」：有在跑会话先确认；确认后 relaunch 并绕过退出闸（不然会问两遍）。 */
function requestRestart(): void {
  const running = host.runningCount();
  if (running > 0) {
    const choice = dialog.showMessageBoxSync({
      type: "warning",
      message: restartWarningMessage(running),
      buttons: ["仍然重启", "取消"],
      defaultId: 1,
      cancelId: 1,
    });
    if (choice !== 0) return;
  }
  quitConfirmed = true;
  app.relaunch();
  app.quit();
}

app.whenReady().then(() => {
  // 副进程：锁已被别的实例持有，退出即可。return 挡在一切装配之前（菜单/调度器/BYOK/建窗）。
  if (!primaryInstance) return;
  if (process.env.CAIRN_SMOKE === "1") console.error("[cairn-smoke] app ready");
  if (process.platform === "darwin" && appIcon !== undefined) app.dock?.setIcon(appIcon);
  // 主题真相在 settings.json；ready 后先同步，再建窗（createWindow 里的 bootBackground 也读同一字段）。
  nativeTheme.themeSource = readThemePreference();
  // 应用菜单（蓝本 §5.2 菜单树）：App → 文件 → 编辑 → 视图 → 前往 → 窗口 → 帮助。
  // 模板在 ./menu-template.ts（纯数据、可判卷），这里只装 + 给一条出口：渲染层拥有键位的项
  // 经 push 通道 `onMenu` 转交，accelerator 只显示不注册（否则菜单 push 与渲染层 keydown 双发）。
  // 仍然**不含 Close Window 的 ⌘W**：那一键属于「关闭会话」，窗口关闭走红绿灯。
  // M4a 桌面端调度器接线（v2.14，§8 #18 在案缺口收口）：此前调度器长驻入口只在 CLI `--serve`，
  // 桌面端 schedule 通道全桥接、快照/CRUD 皆可调——但模块级 scheduler 恒 null ⇒ 快照恒空、
  // upsert/runNow 一律 fail-closed「调度器未初始化」（自动化面板由此成空壳）。
  // 装配即常驻：与 CLI 同式调 serveScheduler（装 automation 工具面 + init + start，幂等）；
  // 触发走 makeScheduledExecutor（触发 = 全新会话的真实代码路径，unattended 覆盖）；工作区
  // 与主装配同一处（workspace）——快照/写路径与面板读的是**同一实例**（同模块单例）。
  // 失败不阻启动（与 BYOK 注入同式 fail-visible 留痕，不静默）；退出经 will-quit 停表。
  // M4-1 BYOK 启动注入接线（存了 key 而无人读的最后一环）：provider key 密文后端由 electron 壳装配
  // （settings-handlers BYOK 段头注定死「装配由 electron 壳（index.ts）注入」——勘定实测全仓此前零调用点，
  // 不装配则 providerKeySet 恒 fail-closed 拒存、启动注入恒空转）。safeStorage 走平台原生加密，密文
  // base64 落 <userData>/provider-keys.json（明文零落盘）；safeStorage 不可用 ⇒ install 返回 false 不注入
  // 后端 ⇒ 存/取双面保持 fail-closed 拒绝，绝不静默退回明文。
  // ★ 装配点必须在 ready 之后：Electron 文档钉死 Windows/Linux 的 isEncryptionAvailable() 以 ready 事件
  // 为前提（Linux 未 ready 恒 false）——顶层装配会让后端在那些平台**永不注入**（BYOK 静默全灭）。
  // 首场 run 只可能晚于 renderer 加载（whenReady → createWindow），注入先于一切 run 的语义不受影响。
  installAppMenu({
    send: (id) => {
      const focused = BrowserWindow.getFocusedWindow();
      const target = mainWindow !== null && !mainWindow.isDestroyed()
        ? mainWindow
        : (focused ?? BrowserWindow.getAllWindows()[0] ?? null);
      sendToWindow(target, PUSH_CHANNELS.onMenu, id);
    },
    closeWindow: () => { BrowserWindow.getFocusedWindow()?.close(); },
    openLogs: () => { void shell.openPath(join(userData, "logs")); },
    openDataDir: () => { void shell.openPath(userData); },
    restart: () => { requestRestart(); },
  });
  if (process.env.CAIRN_SMOKE === "1") console.error("[cairn-smoke] initializing secure storage");
  installProviderKeyBackend(
    {
      isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
      encryptString: (plain) => safeStorage.encryptString(plain),
      decryptString: (payload) => safeStorage.decryptString(payload),
    },
    join(userData, "provider-keys.json"),
  );
  if (process.env.CAIRN_SMOKE === "1") console.error("[cairn-smoke] provider storage initialized");
  // 插件 userConfig 的敏感值同样要有后端：此前 installSafeStorageBackend 全仓零调用点 ⇒
  // getPluginSecret 恒 null、所有 sensitive 字段恒 missing（带字面占位符去连远端）。
  if (!installSafeStorageBackend(
    {
      isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
      encryptString: (plain) => safeStorage.encryptString(plain),
      decryptString: (payload) => safeStorage.decryptString(payload),
    },
    join(userData, "plugin-secrets.json"),
  )) {
    console.warn("[plugins] safeStorage 不可用：插件敏感 userConfig 将 fail-closed（拒绝存/取）");
  }
  // 存过的 key 启动即解密注入各自 provider 的 env（env 优先：该家 env 已在 = 那一家零行为，注入面自带）。
  // fire-and-forget：注入不阻启动；结果 console 一行留痕（boolean 文案，**不含任何 key 值**——
  // 明文零落盘三处纪律的日志面），失败也留痕不被 void 吞掉。CAIRN_SMOKE 的 userData 已隔离成
  // 临时目录（恒无已存 key）⇒ 冒烟路径注入恒空转，零行为。
  void injectStoredProviderKey().then(
    (injected) => console.log(`[byok-inject] 启动注入${injected ? "：有已存 key 注入 provider env" : "：无可注入 key（未存或 env 优先）"}`),
    (error) => console.error("[byok-inject] 启动注入失败（不阻启动）:", error),
  );
  void serveScheduler({
    workspace: canonicalWorkspacePath(workspace),
    isAgentBusy: () => host.runningCount() > 0,
    isIdleWorkspaceAvailable: (target) => host.hasWorkspace(target),
  }).then(
    ({ stop }) => {
      stopDesktopScheduler = stop;
      console.log("[m4a] 调度器已启动（桌面端常驻接线：快照/CRUD/触发同实例）");
    },
    (error) => console.error("[m4a] 调度器启动失败（不阻启动；面板保持 fail-visible）:", error),
  );
  createWindow();
});
app.on("window-all-closed", () => app.quit());
// 界面进程崩溃：白窗不是产品形态。给「重新载入 / 退出」两条出路；退出流程自己的 renderer
// 死亡（before-quit 已置位）不打扰用户。
app.on("render-process-gone", (_event, contents, details) => {
  // 只收窗口自己的渲染进程；内嵌 WebContentsView（浏览器窗格）不是「整窗白掉」，
  // 不归这条出口，免得为一个小窗格弹整应用级弹窗。
  const owner = BrowserWindow.fromWebContents(contents);
  if (owner === null) return;
  const notice = rendererCrashNotice(details, appQuitting);
  if (notice === null) return;
  console.error(`[renderer-crash] ${details.reason} exitCode=${details.exitCode}`);
  const options = {
    type: "error" as const,
    title: notice.title,
    message: notice.title,
    detail: notice.body,
    buttons: ["重新载入", "退出 Cairn"],
    defaultId: 0,
    cancelId: 1,
  };
  // 崩的可能是弹窗（PopoutApp），弹窗要挂在它自己的窗口上，不是恒挂主窗。
  const parent = !owner.isDestroyed()
    ? owner
    : (mainWindow !== null && !mainWindow.isDestroyed() ? mainWindow : null);
  const choice = parent !== null
    ? dialog.showMessageBoxSync(parent, options)
    : dialog.showMessageBoxSync(options);
  if (choice !== 0) { app.quit(); return; }
  if (!contents.isDestroyed()) contents.reload();
});
// §3.3 退出后果告知：有在跑会话 → 先问（默认按钮 = 取消，防误触直接中断）；确认后才走真退出。
// 未在跑（含冒烟路径）⇒ 不问，行为逐字同此前。
let quitConfirmed = false;
app.on("before-quit", () => { appQuitting = true; });
app.on("before-quit", (e) => {
  if (quitConfirmed) return;
  const running = host.runningCount();
  if (!shouldWarnBeforeQuit(running)) return;
  e.preventDefault();
  const choice = dialog.showMessageBoxSync({
    type: "warning",
    message: quitWarningMessage(running),
    buttons: ["仍然退出", "取消"],
    defaultId: 1,
    cancelId: 1,
  });
  if (choice === 0) {
    quitConfirmed = true;
    app.quit();
  } else {
    // 取消退出：before-quit 已把 appQuitting 置位，要撤回——之后真崩了仍该给重载出路。
    appQuitting = false;
    if (BrowserWindow.getAllWindows().length === 0) {
      // 取消退出且窗口已关（window-all-closed → quit → 本闸拦下）：重开主窗，
      // 不让应用停在「无窗可操作、在跑会话看不见」的悬空态。
      createWindow();
    }
  }
});
// Let the durable executor acknowledge cancellation and release its journal locks before exit.
let orchestrationClosing = false;
let orchestrationClosed = false;
app.on("before-quit", (event) => {
  if (event.defaultPrevented || orchestrationClosed) return;
  event.preventDefault();
  if (orchestrationClosing) return;
  orchestrationClosing = true;
  void Promise.all([host.orchestrationClose(), pluginInstallJobs.shutdown()]).then(() => {
    orchestrationClosed = true;
    app.quit();
  }).catch(error => {
    orchestrationClosing = false;
    appQuitting = false;
    quitConfirmed = false;
    console.error("[shutdown] background work failed to stop:", error);
    dialog.showErrorBox("后台任务尚未安全停止", String(error instanceof Error ? error.message : error));
  });
});
// 调度器随应用退出停表（清 timer；与 CLI SIGINT → stop 同语义）。
app.on("will-quit", () => {
  stopDesktopScheduler?.();
  terminalHost.killAll();
  browserHost.closeAll();
  // v7：朗读进程随应用退出回收（不停会念到退出后）。
  stopSpeakingNow();
  // v6：预览子进程必须随应用退出回收（SIGTERM 给进程组）；静态服务随进程消失，无需等待。
  void previewRuntime.stopAll();
  // LSP 与工具子进程都是 detached 进程组：异步 shutdown 在 will-quit 里等不到，必须同步杀组。
  killAllLspClientsSync();
  killAllTrackedChildren();
  void cleanupPasteTempFiles();
  void closeAllLspClients();
});
