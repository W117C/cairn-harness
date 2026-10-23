// Electron main 装配根（M1-6）：kernel-host 单点装配 + IPC 薄映射。
// 装载通道：entry.cjs 注册 repo 根 tsx 后 require 本 TS 源——core 链零打包零漂移
// （esbuild 打包会把 agent-runner 的 ROOT 漂进 <repo>/apps，fixtures 运行时静默落空）。
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, Notification, safeStorage, screen, shell, webContents, type IpcMainInvokeEvent } from "electron";
import { clampToWorkArea, readWindowState, writeWindowState } from "./window-state";
import { bootBackgroundFor, normalizeThemePreference, resolveBootTheme, type ThemePreference } from "./boot-theme";
import { windowVibrancyOptions } from "./window-vibrancy";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { isAbsolute, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { INVOKE_CHANNELS, PUSH_CHANNELS } from "./channels";
import { installAppMenu } from "./menu";
import { handleAttachmentThumb } from "./thumb";
import type { InvokeChannel, PushChannel } from "./channels";
// SEMA §3.5/§12：IPC_PROTOCOL_VERSION 是本文件从协议面取的唯一**值**（其余全 type import）——
// wired 表的 protocolVersion 行把它递给 renderer 比对构建期注入的期望版本。
import { IPC_PROTOCOL_VERSION, type AddProjectInput, type SessionQueueEntry } from "../../../../src/main/ipc-protocol";
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
  handlePluginDecide,
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
import { closeAllLspClients, killAllLspClientsSync } from "../../../../src/tools/lsp";
import { killAllTrackedChildren } from "../../../../src/tools/process";
import {
  getSettings,
  handleProviderKeyDelete,
  handleProviderKeySet,
  handleProviderKeyStatus,
  handleUpdateCheck,
  onboardingGroups,
  providerInfo,
  setSettings,
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
} from "../../../../src/main/session-handlers";
import { getLastWorkspace } from "../../../../src/main/runner-workspace";
import { TerminalHost } from "./terminal-host";
import { BrowserHost } from "./browser-host";
import type { ClarifyAnswerMap } from "../../../../src/events";
import { installProviderKeyBackend } from "../../../../src/main/provider-keys";
import { installSafeStorageBackend } from "../../../../src/agent/plugins/secrets";
import { currentPluginRuntime } from "../../../../src/agent/plugins";
import { injectStoredProviderKey } from "../../../../src/main/provider-key-inject";
import { createKernelHost, canonicalWorkspacePath } from "./kernel-host";
import {
  canonicalKnownProjectPath as canonicalKnownProjectPathIn,
  canonicalKnownRoots,
  resolveCreateParent,
  resolveKnownProjectTarget as resolveKnownProjectTargetIn,
  resolveProvidedWorkspace,
} from "./project-path-gate";
import { isAppShellUrl } from "./shell-url";
import { WindowWorkspaceContext } from "./window-workspace-context";
import { ProjectRegistry } from "../../../../src/main/project-registry";
import { loadCustomProviders } from "../../../../src/main/custom-provider-store";
import { installCustomProviders, installedCustomProviders } from "../../../../src/providers/registry";
import { discoverForProviderSetup, prepareCustomProvider, commitCustomProvider } from "../../../../src/main/provider-setup";
import { createProjectFolder } from "../../../../src/main/project-create";
import { createProjectFromTemplate, diagnoseProjectDirectory, templateCatalog } from "../../../../src/main/project-templates";
import { PreviewRuntime } from "../../../../src/main/project-preview";
import { exportProject } from "../../../../src/main/project-export";
import { checkProviderConnection } from "../../../../src/main/provider-connection";
import { resolveEntry } from "../../../../src/main/workspace-fs";
import { readCapabilities } from "../../../../src/main/doctor";
import { gitClone, gitStatus } from "../../../../src/main/git-ops";
import { searchWorkspace } from "../../../../src/main/workspace-search";
import { saveTempFile, cleanupPasteTempFiles } from "./temp-file";
import { quitWarningMessage, shouldWarnBeforeQuit } from "./quit-guard";
import type { DiscoveryProtocol } from "../../../../src/providers/discovery";
import type { ProviderSaveRequest } from "../../../../src/main/ipc-protocol";

// M4-5 即时重注别名（providerKeySet 保存成功 → 免重启生效）：wired 表在装配段（whenReady）之前，
// 若 wired 行直写 injectStoredProviderKey 调用，会把 T1 装配守卫（provider-keys.test 次序红线：
// 「首个注入调用点须在 install 之后」）的锚位提前到装配段之前而转红。本地别名同一出口同一语义：
// 启动注入的次序锚位不动，保存路径的运行期重注照常 fire-and-forget。
const reinjectSavedProviderKey = injectStoredProviderKey;

const here = fileURLToPath(new URL(".", import.meta.url));
const distElectron = join(here, "..", "..", "dist-electron");
let mainWindow: BrowserWindow | null = null;

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
function maybeNotifyRunSettled(sessionId: string, ok: boolean, error?: string): void {
  if (Notification.isSupported() === false) return;
  if (BrowserWindow.getAllWindows().some((w) => w.isFocused())) return;
  const title = ok ? "Cairn · 会话完成" : "Cairn · 会话未完成";
  const body = ok ? `会话「${sessionId}」本轮已收束。` : `会话「${sessionId}」本轮未完成：${error ?? "未知原因"}`;
  try {
    new Notification({ title, body }).show();
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
const windowWorkspaces = new WindowWorkspaceContext(canonicalKnownProjectPath);
const workspaceContext = (): string | null => windowWorkspaces.current();
const resolveWorkspace = (): string => windowWorkspaces.require();

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
const host = createKernelHost({
  workspaces: [workspace],
  activeWorkspace: workspace,
  userDataDir: userData,
  outbox: (channel: PushChannel, payload: unknown) => {
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send(PUSH_CHANNELS[channel], payload);
  },
});

// v5 terminal 窗格：PTY 宿主（推送用与 kernel host 同一广播面）。退出时 killAll 不留孤儿 shell。
const terminalHost = new TerminalHost((e) => {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(
      PUSH_CHANNELS[e.kind === "data" ? "onTerminalData" : "onTerminalExit"],
      e.kind === "data" ? { id: e.id, data: e.data } : { id: e.id, code: e.code },
    );
  }
});

// browser 窗格：WebContentsView 宿主；产品调用按可信 IPC sender 绑定窗口。
const browserHost = new BrowserHost(
  // 仅供直接宿主调用兜底；browserOpen IPC 始终传入调用窗口，不依赖焦点。
  () => BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null,
  (state) => {
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send(PUSH_CHANNELS.onBrowserState, state);
  },
);

// v6 项目预览运行时：static 走进程内静态服务，vite 起受控子进程（命令写死在 core，见其头注）。
// 状态推送与 browserHost 同一条广播面；退出时由 will-quit 全部回收（不留孤儿 dev server）。
const previewRuntime = new PreviewRuntime({}, (snapshot) => {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(PUSH_CHANNELS.onPreviewState, snapshot);
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
async function knownProjectRoots(): Promise<string[]> {
  const roots: (string | null)[] = [workspace, getLastWorkspace()];
  try {
    for (const record of await projectRegistry.list()) roots.push(record.path);
  } catch { /* 注册表读失败：按默认/最近工作区判，绝不因此放宽为任意路径 */ }
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
const wired: Record<InvokeChannel, (...args: unknown[]) => unknown> = {
  // §2.1 完成通知的挂点：run 收束后（会话模式）窗口失焦则发系统通知；不改变 run 的任何语义。
  run: async (req) => {
    const sessionId = (req as { sessionId?: string } | null)?.sessionId;
    const res = await host.run(req as never);
    if (typeof sessionId === "string" && sessionId !== "") {
      maybeNotifyRunSettled(sessionId, res.ok === true, res.error);
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
  // M3-5 接线：renderer 打断按钮真实传 sessionId（ipc-protocol runCancel(sessionId?) 可选参，preload
  // 程序化桥自动透传）⇒ 会话级取消（T2 per-session controller）。渲染层不传 ⇒ undefined 直进
  // host.cancel ⇒ {ok:false,"会话不在运行"} 的 fail-visible 语义保留（兼容无参调用）。
  // cast 定案（typecheck 实测 TS2345）：wired 表形参是 (...args: unknown[]) 的上下文 unknown，
  // host.cancel 形参必选 string ⇒ 直传必红；此洗参是 wired 表房式（同 decide/createSession），
  // 非 T5 遗留——传参语义已是真实可选参透传，cast 只发生在类型面。
  runCancel: (sessionId) => host.cancel(sessionId as string),
  // 第 9 点·轮中插话：host.steer 只在会话真在跑时返回 ok（否则 fail-visible，渲染层转「入队」）。
  // 洗参与 runCancel 同一条房式（wired 表形参上下文是 unknown；cast 只发生在类型面）。
  runSteer: (sessionId, text) => host.steer(sessionId as string, text as string),
  listSessions: async () => { await projectRehydrate; return host.listSessions(); },
  // v14：跨会话用量账本（只读；面板点「全部会话」才调）。
  usageLedger: () => host.usageLedger(),
  // v15：会话日志尾部（只读；会话归属由 host 解析，renderer 不传路径）。
  sessionLog: (id, tailLines) => host.sessionLog(id as string, typeof tailLines === "number" ? tailLines : undefined),
  // createSession 首参 M3 起是工作区（原 name 槽位被 M3 接口接管）；渲染层现不传 ⇒ 缺省 activeWorkspace
  createSession: (workspace) => host.createSession(workspace as string | undefined),
  openSession: (id, workspace) => host.openSession(id as string, workspace as string | undefined),
  queueGet: (sessionId) => host.queueGet(sessionId as string),
  queueSet: (sessionId, items) => host.queueSet(sessionId as string, items as SessionQueueEntry[]),
  // M3 小修（M1 六通道清单遗留缺口）：channels.ts 有 getProviderInfo 通道、preload 程序化桥自动
  // 透传、App.tsx 挂载即调，wired 表却从没这行 ⇒ renderer 调用即 reject「No handler registered」，
  // 模型选择器自 M2 起静默失效（providerInfo 恒 null）。实现直走 settings-handlers 的同名 read
  // model（无参异步，kernel-host 已注入 resolveProviderKind 依赖面），选择器恢复真值目录。
  getProviderInfo: () => providerInfo(),
  // v11：listProjects 收 options（recentFirst = 「最近打开」菜单序；includeRemoved = 含软删除记录）。
  listProjects: (options) => projectRegistry.list(options as { includeRemoved?: boolean; recentFirst?: boolean } | undefined),
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
  exportTranscript: async (markdown, suggestedName) => {
    const raw = String(suggestedName ?? "").trim();
    const name = raw === "" ? "cairn-transcript.md" : raw;
    const opts = {
      title: "导出对话",
      defaultPath: join(app.getPath("downloads"), name),
      filters: [{ name: "Markdown", extensions: ["md"] }],
    };
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
    const r = win !== null ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
    if (r.canceled || r.filePath === undefined || r.filePath === "") return { ok: false as const, canceled: true as const };
    try {
      writeFileSync(r.filePath, String(markdown ?? ""), "utf8");
      return { ok: true as const, path: r.filePath };
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
    }
  },
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
    // 主题切到 light/dark/system 时同步原生窗口 chrome；下次启动的 bootBackground 也读同一字段。
    const theme = (patch as { theme?: unknown }).theme;
    if (theme === "light" || theme === "dark" || theme === "system") nativeTheme.themeSource = theme;
    // 窗口材质：运行期先 best-effort 应用；透明窗口的完整材质仍以重启为准。
    const vibrancy = (patch as { windowVibrancy?: unknown }).windowVibrancy;
    if (process.platform === "darwin" && typeof vibrancy === "boolean" && mainWindow !== null) {
      mainWindow.setVibrancy(vibrancy ? "sidebar" : null);
      mainWindow.setBackgroundColor(vibrancy ? "#00000000" : bootBackground());
    }
    return next;
  },
  compact: async (sessionId, workspace) => {
    const root = await explicitSessionsRoot(workspace);
    return handleCompact({ sessionId: sessionId as string | undefined, ...(root !== undefined ? { sessionsRoot: root } : {}) });
  },
  setGoal: (req) => handleGoalSet(req as never),
  cardAction: (req) => handleCardAction(req as never),
  renameSession: async (oldId, newName, workspace) => handleSessionRename(oldId as string, newName as string, await explicitSessionsRoot(workspace)),
  deleteSession: async (id, workspace) => handleSessionDelete(id as string, await explicitSessionsRoot(workspace)),
  // M8 分叉（v2.15）：保留前 N 轮 → 新会话 `<id>-f<N>`；与 CLI --fork/--from 同口径（fork-cli 单源）。
  forkSession: async (id, round, unique, workspace) => handleSessionFork(id as string, round as number, unique === true, await explicitSessionsRoot(workspace)),
  // #7 文件级回滚（v2.16）：把第 N 轮主会话改过的文件还原成该轮之前的原件（源自 D7 覆盖前快照）。
  // 活动工作区上下文（desktop 专用）：空串清除；写入口只收字符串，非法值留给后续操作 fail-visible。
  setWorkspaceContext: (path) => windowWorkspaces.select(String(path ?? "")),
  revertTurn: async (id, round, workspace) => handleSessionRevert(id as string, round as number, resolveWorkspace(), await explicitSessionsRoot(workspace)),
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
      width: 760,
      height: 620,
      titleBarStyle: "hiddenInset",
      backgroundColor: bootBackground(),
      webPreferences: { preload: join(distElectron, "preload.cjs"), contextIsolation: true, nodeIntegration: false },
    });
    windowWorkspaces.inherit(win.webContents);
    hardenAppWindow(win);
    const hash = `pane=${encodeURIComponent(kind as string)}${typeof sessionId === "string" && sessionId !== "" ? `&session=${encodeURIComponent(sessionId)}` : ""}`;
    if (process.env.VITE_DEV_SERVER_URL) void win.loadURL(`${process.env.VITE_DEV_SERVER_URL}#${hash}`);
    else void win.loadFile(join(distElectron, "..", "dist", "index.html"), { hash });
    return Promise.resolve({ ok: true });
  },
  // v5 browser 窗格（WebContentsView 宿主见 browser-host.ts）。
  // owner 只由下方可信 IPC sender 解析，不能接受 renderer 自报的窗口。
  browserOpen: (id, url, owner) => Promise.resolve(browserHost.open(id as string, url as string, owner as BrowserWindow | null)),
  browserBounds: (id, rect) => { browserHost.setBounds(id as string, rect as { x: number; y: number; width: number; height: number }); return Promise.resolve(); },
  browserNav: (id, action) => { browserHost.navigate(id as string, action as "back" | "forward" | "reload"); return Promise.resolve(); },
  browserClose: (id) => { browserHost.close(id as string); return Promise.resolve(); },
  // v7：清除浏览数据（keepCookies 语义对齐「Keep cookies」）+ 元素选择（§3.6 ⌘⇧S）。
  browserClearData: (id, opts) => browserHost.clearData(String(id), (opts as { keepCookies?: boolean } | undefined)?.keepCookies === true),
  browserSetAllowedHosts: (hosts) => {
    browserHost.setAllowedHosts(Array.isArray(hosts) ? (hosts as unknown[]).filter((h): h is string => typeof h === "string") : []);
    return Promise.resolve({ ok: true });
  },
  browserPickElement: (id) => browserHost.pickElement(String(id)),
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
  pluginDecide: async (plugin, trusted, workspace) => {
    const gate = resolveProvidedWorkspace(workspace, await knownProjectRoots(), workspaceContext());
    if (!gate.ok) return { ok: false };
    return await handlePluginDecide(plugin as string, trusted as boolean, gate.workspace);
  },
  pluginUserConfigSet: (plugin, values) => {
    const rt = currentPluginRuntime();
    if (rt === null) return Promise.resolve({ ok: false, error: "插件运行时未装载（先跑一场会话）" });
    return rt.setUserConfig(String(plugin), (values ?? {}) as Record<string, unknown>);
  },
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
    const prepared = prepareCustomProvider(workspace, {
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
    const previous = installedCustomProviders();
    installCustomProviders(prepared.derived); // ① 先装上（内存态，可回滚）
    if (typeof r.keyValue === "string" && r.keyValue !== "") {
      const keyed = await handleProviderKeySet(providerId, r.keyValue);
      if (!keyed.ok) {
        installCustomProviders(previous); // ② 钥匙存不进 ⇒ 整体失败，注册表回滚，配置文件一个字都没写
        return { ok: false, error: keyed.error ?? "key 保存失败" };
      }
    }
    const wrote = await commitCustomProvider(prepared); // ③ 落盘
    if (!wrote.ok) {
      installCustomProviders(previous);
      return { ok: false, error: wrote.error };
    }
    // ④ 钥匙解密注入 env（与 providerKeySet 同一条注入面，免重启生效）
    void reinjectSavedProviderKey().then(
      () => undefined,
      (error) => console.error("[byok-inject] 自定义 provider 保存后重注失败（不影响保存结果）:", error),
    );
    return {
      ok: true,
      path: prepared.path,
      providers: [...prepared.file.providers.map((p) => p.id)],
      installed: prepared.derived.length,
      warnings: [...prepared.warnings],
    };
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
  // git 两闸：读数无副作用；克隆 URL 白名单 + 目标已存在即拒（都在 core 模块内判）。
  gitStatus: (path) => gitStatus(String(path)),
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
  // 快照还原（检查器「撤销此文件改动」；工作区口径与 changeDiff 同——最近一次 run 的工作区）。
  snapshotRestore: (req) => handleSnapshotRestore(req as { path?: string; snapshotId?: string }, resolveWorkspace()),
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
      if (key === "browserOpen") return handler(args[0], args[1], BrowserWindow.fromWebContents(event.sender));
      if (key === "terminalStart") {
        const owner = BrowserWindow.fromWebContents(event.sender);
        if (owner === null || owner.isDestroyed()) return { ok: false, error: "调用窗口已关闭" };
        return handler(owner); // 窗口归属只由可信 sender 提供，忽略 renderer 自报参数。
      }
      return handler(...args);
    });
  });
}
void webContents; // 显式留痕：推送经 BrowserWindow.getAllWindows()

/** 应用窗口的导航硬化（2026-10-17）：外链一律交给系统浏览器，绝不在带 preload 的应用
 *  窗口里加载外部页面——应用壳的 preload 暴露 window.agent（全量 IPC），把渲染层交给
 *  远程页面等于把本机能力一起交出去。只放行「应用壳自身」的导航（dist/index.html 或
 *  dev server 根）；http(s) 外链 shell.openExternal，其余协议直接丢。 */
const shellUrlOptions = { devServerUrl: process.env.VITE_DEV_SERVER_URL ?? "", appPath: app.getAppPath() };
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
  hardenAppWindow(win);
  if (process.env.VITE_DEV_SERVER_URL) void win.loadURL(process.env.VITE_DEV_SERVER_URL);
  else void win.loadFile(join(distElectron, "..", "dist", "index.html"));

  // CAIRN_SMOKE：真窗口 + 真 IPC 回环的机器冒烟——window.agent 探测 → createSession → demo run
  // → 事件计数 → 自退。renderer 的 [cairn-smoke] console 行经 console-message 转发进 stdout。
  if (process.env.CAIRN_SMOKE === "1") {
    const t0 = Date.now();
    win.webContents.on("console-message", (event) => {
      if (event.message.includes("[cairn-smoke]")) console.log("[renderer]", event.message);
    });
    win.webContents.on("did-finish-load", () => {
      const watchdog = setTimeout(() => {
        console.error("[cairn-smoke] watchdog：30s 未收束，强制退出");
        app.exit(1);
      }, 30_000);
      void win.webContents
        .executeJavaScript(`(() => {
          const api = window.agent;
          window.__cairn = { events: 0, asks: 0 };
          api.onEvent((e) => { window.__cairn.events++; if (window.__cairn.events <= 12) console.log("[cairn-smoke] event " + window.__cairn.events + ": " + (e && e.type)); });
          api.onAsk((p) => { window.__cairn.asks++; console.log("[cairn-smoke] ask -> approve: " + p.tool); api.decide(p.askId, true); });
          return typeof api;
        })()`)
        .then(async (agentType) => {
          console.log("[cairn-smoke] window.agent type:", agentType);
          const sessionId = await win.webContents.executeJavaScript(
            "window.agent.createSession().then((s) => s.id)",
          );
          console.log("[cairn-smoke] session:", sessionId);
          const queueProbe = (await win.webContents.executeJavaScript(
            `(async () => {
               await window.agent.queueSet(${JSON.stringify(sessionId)}, [{ text: "恢复探针", attachments: [] }]);
               const read = await window.agent.queueGet(${JSON.stringify(sessionId)});
               await window.agent.queueSet(${JSON.stringify(sessionId)}, []);
               const cleared = await window.agent.queueGet(${JSON.stringify(sessionId)});
               return { read, cleared };
             })()`,
          )) as { read?: { items?: { text?: string }[] }; cleared?: { items?: unknown[] } };
          console.log("[cairn-smoke] queue probe:", JSON.stringify(queueProbe));
          const chainFailed: string[] = [];
          // v6 产品链探针（第一批第 6/9 条的可执行判据）：模板建项 → 起预览 → main 侧抓真页面
          // → 停预览。项目落 CAIRN_SMOKE 的隔离工作区（绝不碰用户家目录）；这条链同时被
          // 打包后的二进制复跑（package.mjs 出来的 Cairn.app + CAIRN_SMOKE=1）。
          const made = (await win.webContents.executeJavaScript(
            `window.agent.projectCreateFromTemplate({ name: "smoke-project", templateId: "static-site", parentDir: ${JSON.stringify(workspace)} })`,
          )) as { ok: boolean; path?: string; message?: string };
          const started = made.ok && typeof made.path === "string"
            ? ((await win.webContents.executeJavaScript(
                `window.agent.previewStart(${JSON.stringify(made.path)})`,
              )) as { status?: string; url?: string; stage?: string; message?: string })
            : undefined;
          let chainPageOk = false;
          let chainPageError = "";
          if (started?.status === "ready" && typeof started.url === "string") {
            try {
              const res = await fetch(started.url);
              const html = await res.text();
              chainPageOk = res.ok && html.length > 0;
            } catch (err) {
              chainPageOk = false;
              chainPageError = err instanceof Error ? err.message : String(err);
            }
          }
          const stopped = made.ok && typeof made.path === "string"
            ? ((await win.webContents.executeJavaScript(
                `window.agent.previewStop(${JSON.stringify(made.path)})`,
              )) as { status?: string })
            : undefined;
          console.log(
            "[cairn-smoke] product chain:",
            JSON.stringify({
              created: made.ok === true,
              preview: started?.status,
              stage: started?.stage,
              pageOk: chainPageOk,
              pageError: chainPageError || undefined,
              stopped: stopped?.status,
            }),
          );
          if (made.ok !== true) chainFailed.push(`模板建项失败：${made.message ?? "未知"}`);
          else if (started?.status !== "ready") chainFailed.push(`预览未就绪：${started?.status ?? "未知"} ${started?.message ?? ""}`);
          else if (!chainPageOk) chainFailed.push(`预览页面抓取失败：${started.url ?? ""}${chainPageError !== "" ? `（${chainPageError}）` : ""}`);
          else if (stopped?.status !== "stopped") chainFailed.push(`预览停止回执异常：${stopped?.status ?? "未知"}`);
          // S7/②：**空闲态**的模型选择交互判据（必须在 run 之前 —— 跑起来之后
          // 输入框与选择器本来就该禁用，那时测不出"点得动"）。
          // C-31 思考行的真 DOM 探针（用户实测：以前它连点都点不开）
          const thinkProbe = (await win.webContents.executeJavaScript(
            `(() => {
               const rows = [...document.querySelectorAll(".row.think")];
               const first = rows[0];
               if (!first) return { rows: 0 };
               const before = first.className;
               first.click();
               const after = first.className;
               return { rows: rows.length, before, after, clickable: before !== after,
                        hasElapsed: !!first.querySelector(".think-elapsed") };
             })()`,
          )) as { rows: number; before?: string; after?: string; clickable?: boolean; hasElapsed?: boolean };
          console.log("[cairn-smoke] think row:", JSON.stringify(thinkProbe));
          const idlePicker = (await win.webContents.executeJavaScript(
            `(async () => {
               const trig = document.querySelector('[aria-label="模型选择"]');
               if (!trig) return { found: false };
               const before = trig.getAttribute("title");
               const disabledBefore = trig.disabled === true;
               trig.click();
               await new Promise((r) => setTimeout(r, 120));
               const menu = document.querySelector('.mp-pop');
               const opts = menu ? [...menu.querySelectorAll('[role="option"]')] : [];
               const enabled = opts.filter((o) => !o.disabled);
               const pickTarget = enabled.find((o) => (o.textContent || "").indexOf("演示") < 0);
               let after = null;
               if (pickTarget) {
                 pickTarget.click();
                 // 等待要够：选择走 setSettings（IPC 往返）+ 再拉一次 getProviderInfo，200ms 会误判成"没反应"
                 for (let i = 0; i < 8 && after === null; i++) {
                   await new Promise((r) => setTimeout(r, 150));
                   const now = trig.getAttribute("title");
                   if (now !== before) after = now;
                 }
                 after = after ?? trig.getAttribute("title");
               }
               return {
                 found: true, disabledBefore, opened: !!menu, options: opts.length, enabled: enabled.length,
                 before, after, switched: after !== null && after !== before,
                 pick: pickTarget ? (pickTarget.textContent || "").slice(0, 30) : null,
                 saved: await window.agent.getSettings().then((x) => x.provider + "|" + x.model).catch((e) => "ERR:" + String(e)),
                 errStrip: (() => { const d = document.querySelector(".error-strip"); return d ? (d.textContent || "").slice(0, 160) : null; })(),
               };
             })()`,
          )) as { found: boolean; disabledBefore?: boolean; opened?: boolean; options?: number; enabled?: number; before?: string | null; after?: string | null; switched?: boolean; pick?: string | null };
          console.log("[cairn-smoke] idle picker:", JSON.stringify(idlePicker));
          const run = (await win.webContents.executeJavaScript(
            `window.agent.run({ message: "demo", mode: "default", sessionId: ${JSON.stringify(sessionId)} })`,
          )) as { ok: boolean; error?: string };
          console.log("[cairn-smoke] run:", JSON.stringify(run));
          // 推送与 run resolve 的收尾异步：轮询计数至稳定（≤3s）再定数
          let events = -1;
          for (let i = 0; i < 15; i++) {
            await new Promise((r) => setTimeout(r, 200));
            const n = (await win.webContents.executeJavaScript("window.__cairn.events")) as number;
            if (n === events) break;
            events = n;
          }
          const asks = (await win.webContents.executeJavaScript("window.__cairn.asks")) as number;
          console.log("[cairn-smoke] events:", events, "asks auto-approved:", asks);
          // 侧栏条目计数探针（**必须排在 run 之后**）：会话清单的事件驱动同步要等这条 run 的
          // 第一条事件带出未知 session_id 才补刷 ⇒ 排在 run 前面量到的恒是 0（第一版就是这么量错的）。
          // 量到之后**用真点击**激活它：点击走 App.onOpen → openSession(id) → activate(id)
          // ⇒ 会话条的 ModelPicker 才渲染（下一格探针量的就是它）。
          // 只点「文本含本会话 id」的那一行（不回落第一行：点错会话会让后续探针验到别人身上），
          // 且点到即 break，不连点去冲撞 openSession 的 seq 竞态守卫。
          let sidebarRows = 0;
          let sidebarClicked = false;
          let listed = -1;
          let sidebarText = "";
          for (let i = 0; i < 15; i++) {
            await new Promise((r) => setTimeout(r, 200));
            const probe = (await win.webContents.executeJavaScript(
              `(async () => {
                 // v5 组件栈重写把侧栏根类名从 .sidebar 改成 .side（aside.side）：探针跟着界面走，
                 // 否则冒烟恒报"侧栏 0 行"——那是探针过期，不是产品没渲染（本轮实测定位）。
                 const rows = [...document.querySelectorAll(".side .session")];
                 const t = rows.find((r) => r.getAttribute("data-session-id") === ${JSON.stringify(sessionId)});
                 if (t) t.click();
                 let listed = -1;
                 try { listed = (await window.agent.listSessions()).length; } catch { listed = -2; }
                 const aside = document.querySelector(".side");
                 return { rows: rows.length, clicked: !!t, listed, text: (aside && aside.textContent) || "" };
               })()`,
            )) as { rows: number; clicked: boolean; listed: number; text: string };
            sidebarRows = probe.rows;
            sidebarClicked = probe.clicked;
            listed = probe.listed;
            sidebarText = probe.text;
            if (probe.clicked) break;
          }
          // 诊断三元：桥返回几条（listed）/ 侧栏画了几行（rows）/ 侧栏真文字（text）——
          // 这三者把「清单没回来」「渲染没画出来」「类名对不上」三种成因分开。
          console.log("[cairn-smoke] ui sidebar rows:", sidebarRows, "clicked:", sidebarClicked, "listSessions:", listed, "text:", JSON.stringify(sidebarText));
          // B3 收口（评审原话「CAIRN_SMOKE 测不到」）：再验 renderer 真渲染面的两处——
          //   ① 侧栏条目计数：新建会话必须真的出现在侧栏（桥通 ≠ UI 现），已在上面用真点击激活；
          //   ② ModelPicker 描述：选择器在场且带 title 描述（demo 态写明「冻结剧本，非真实模型」）。
          // 探针等 React 渲染落定（与事件计数同式轮询 ≤3s），不靠固定 sleep。
          let pickerTitle: string | null = null;
          for (let i = 0; i < 15; i++) {
            await new Promise((r) => setTimeout(r, 200));
            // C-21 重写后触发条是 button（原为原生 select）。这里不只读 title，
            // 还**真的点一下**并报告 DOM 发生了什么 —— 用户实测「点了没反应」这类问题
            // 只能靠真交互暴露（渲染判卷看不到点击后的状态）。
            const pickerProbe = (await win.webContents.executeJavaScript(
              `(async () => {
                 const trig = document.querySelector('[aria-label="模型选择"]');
                 if (!trig) return { found: false, title: null, options: -1, expanded: null, picked: null };
                 const before = trig.getAttribute("title");
                 const rect = trig.getBoundingClientRect();
                 const cs = getComputedStyle(trig);
                 const diag = {
                   count: document.querySelectorAll('[aria-label="模型选择"]').length,
                   tag: trig.tagName,
                   cls: trig.className,
                   disabledAttr: trig.hasAttribute("disabled"),
                   disabledProp: trig.disabled === true,
                   rect: [Math.round(rect.width), Math.round(rect.height), Math.round(rect.top)],
                   pointerEvents: cs.pointerEvents,
                   visible: cs.visibility + "/" + cs.display,
                 };
                 trig.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
                 trig.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
                 trig.click();
                 await new Promise((r) => setTimeout(r, 120));
                 const menu = document.querySelector('.mp-pop');
                 const opts = menu ? [...menu.querySelectorAll('[role="option"]')] : [];
                 const enabled = opts.filter((o) => !o.disabled);
                 const picked = enabled.find((o) => (o.textContent || "").indexOf("演示") < 0);
                 let afterTitle = null;
                 if (picked) { picked.click(); await new Promise((r) => setTimeout(r, 120)); afterTitle = trig.getAttribute("title"); }
                 return {
                   found: true,
                   diag,
                   title: before,
                   expanded: trig.getAttribute("aria-expanded"),
                   menuVisible: !!menu,
                   options: opts.length,
                   enabledOptions: enabled.length,
                   pickedLabel: picked ? (picked.textContent || "").slice(0, 40) : null,
                   afterTitle,
                 };
               })()`,
            )) as Record<string, unknown>;
            console.log("[cairn-smoke] picker probe:", JSON.stringify(pickerProbe));
            pickerTitle = (pickerProbe.title as string | null) ?? null;
            if (pickerTitle) break;
          }
          console.log("[cairn-smoke] ui picker title:", pickerTitle);
          // 退出码编码判据：CAIRN_SMOKE 是可重跑门——判据不过必须非零退（CI 可判）
          const failed: string[] = [];
          failed.push(...chainFailed);
          if (!run.ok) failed.push(`run ok:false${run.error ? `（${run.error}）` : ""}`);
          if (events < 1) failed.push(`事件计数 ${events} < 1`);
          if (queueProbe.read?.items?.[0]?.text !== "恢复探针" || queueProbe.cleared?.items?.length !== 0) {
            failed.push(`发送队列 IPC 往返失败：${JSON.stringify(queueProbe)}`);
          }
          if (!sidebarClicked) failed.push(`侧栏未定位到会话 ${sessionId} 的条目行（真点击路径没走通）`);
          if (sidebarRows < 1) failed.push(`侧栏条目计数 ${sidebarRows} < 1（新建会话没出现在侧栏）`);
          if (!pickerTitle || !pickerTitle.startsWith("模型：")) {
            failed.push(`ModelPicker 描述缺席或不合规：${JSON.stringify(pickerTitle)}`);
          }
          if (failed.length > 0) {
            console.error("[cairn-smoke] FAIL:", failed.join("；"));
            clearTimeout(watchdog);
            app.exit(1);
            return;
          }
          console.log("[cairn-smoke] PASS in", Date.now() - t0, "ms");
          clearTimeout(watchdog);
          app.quit();
        })
        .catch((err: unknown) => {
          console.error("[cairn-smoke] FAILED:", err instanceof Error ? err.message : String(err));
          clearTimeout(watchdog);
          app.exit(1);
        });
    });
  }
};
app.whenReady().then(() => {
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
      for (const win of BrowserWindow.getAllWindows()) win.webContents.send(PUSH_CHANNELS.onMenu, id);
    },
    closeWindow: () => { BrowserWindow.getFocusedWindow()?.close(); },
  });
  installProviderKeyBackend(
    {
      isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
      encryptString: (plain) => safeStorage.encryptString(plain),
      decryptString: (payload) => safeStorage.decryptString(payload),
    },
    join(userData, "provider-keys.json"),
  );
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
  void serveScheduler({ workspace }).then(
    ({ stop }) => {
      stopDesktopScheduler = stop;
      console.log("[m4a] 调度器已启动（桌面端常驻接线：快照/CRUD/触发同实例）");
    },
    (error) => console.error("[m4a] 调度器启动失败（不阻启动；面板保持 fail-visible）:", error),
  );
  createWindow();
});
app.on("window-all-closed", () => app.quit());
// §3.3 退出后果告知：有在跑会话 → 先问（默认按钮 = 取消，防误触直接中断）；确认后才走真退出。
// 未在跑（含冒烟路径）⇒ 不问，行为逐字同此前。
let quitConfirmed = false;
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
  } else if (BrowserWindow.getAllWindows().length === 0) {
    // 取消退出且窗口已关（window-all-closed → quit → 本闸拦下）：重开主窗，
    // 不让应用停在「无窗可操作、在跑会话看不见」的悬空态。
    createWindow();
  }
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
