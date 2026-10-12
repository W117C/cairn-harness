// Electron main 装配根（M1-6）：kernel-host 单点装配 + IPC 薄映射。
// 装载通道：entry.cjs 注册 repo 根 tsx 后 require 本 TS 源——core 链零打包零漂移
// （esbuild 打包会把 agent-runner 的 ROOT 漂进 <repo>/apps，fixtures 运行时静默落空）。
import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell, webContents } from "electron";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { INVOKE_CHANNELS, PUSH_CHANNELS } from "./channels";
import type { InvokeChannel, PushChannel } from "./channels";
// SEMA §3.5/§12：IPC_PROTOCOL_VERSION 是本文件从协议面取的唯一**值**（其余全 type import）——
// wired 表的 protocolVersion 行把它递给 renderer 比对构建期注入的期望版本。
import { IPC_PROTOCOL_VERSION, type AddProjectInput } from "../../../../src/main/ipc-protocol";
// M3 终审 Critical 修复：澄清/方案两卡自 M2 起端到端死路（wired 表漏行 ⇒ renderer 调用即
// reject「No handler registered」）。与 decide 同式——main 进程 import core 出口后直调，
// 不经 kernel-host 转手（两出口本就是为 IPC 处理函数而生的单例缝，见 agent-runner 各自头注）。
import {
  handleAgentState,
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
  serveScheduler,
} from "../../../../src/main/agent-runner";
import { handleMemoryDelete } from "../../../../src/main/memory-handlers";
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
  handleFeedbackList,
  handleFeedbackSubmit,
  handleSessionAssignProject,
  handleSessionDelete,
  handleSessionFork,
  handleSessionRename,
  handleSessionRevert,
  handleSessionSetArchived,
  handleSessionSetPinned,
} from "../../../../src/main/session-handlers";
import type { ClarifyAnswerMap } from "../../../../src/events";
import { installProviderKeyBackend } from "../../../../src/main/provider-keys";
import { injectStoredProviderKey } from "../../../../src/main/provider-key-inject";
import { createKernelHost } from "./kernel-host";
import { ProjectRegistry } from "../../../../src/main/project-registry";
import { loadCustomProviders } from "../../../../src/main/custom-provider-store";
import { installCustomProviders, installedCustomProviders } from "../../../../src/providers/registry";
import { discoverForProviderSetup, prepareCustomProvider, commitCustomProvider } from "../../../../src/main/provider-setup";
import { createProjectFolder } from "../../../../src/main/project-create";
import type { DiscoveryProtocol } from "../../../../src/providers/discovery";
import type { ProviderSaveRequest } from "../../../../src/main/ipc-protocol";

// M4-5 即时重注别名（providerKeySet 保存成功 → 免重启生效）：wired 表在装配段（whenReady）之前，
// 若 wired 行直写 injectStoredProviderKey 调用，会把 T1 装配守卫（provider-keys.test 次序红线：
// 「首个注入调用点须在 install 之后」）的锚位提前到装配段之前而转红。本地别名同一出口同一语义：
// 启动注入的次序锚位不动，保存路径的运行期重注照常 fire-and-forget。
const reinjectSavedProviderKey = injectStoredProviderKey;

const here = fileURLToPath(new URL(".", import.meta.url));
const distElectron = join(here, "..", "..", "dist-electron");

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

// CX-01 项目注册表（M3-3 修复轮接线）：构造注入路径落 userData/projects.json（project-registry.ts:125
// 构造面 = new ProjectRegistry(filePath)）。文件不存在是空默认、结构损坏显式失败不静默覆盖；
// CAIRN_SMOKE 的 userData 已隔离到 mkdtemp，不碰真实数据。
const projectRegistry = new ProjectRegistry(join(userData, "projects.json"));

// v2.14：桌面端调度器 stop 句柄（whenReady 里 serveScheduler 返回；will-quit 停表）。
let stopDesktopScheduler: (() => void) | null = null;

// M3 收口（重审照亮）：projects.json 存量项目启动 rehydrate。addProject 只在本次进程内
// host.addWorkspace——重启后 host.workspaces 退回装配单元素，已注册工作区的会话不经
// listSessions 出现，点该分组发消息即 createSession 白名单 throw（T3「添加工作区」跨重启断点）。
// 启动即按注册表回灌：addWorkspace 去重幂等（与装配 workspace 重叠安全）；软删除记录
// list() 默认不返回，不复活。fail-soft：ProjectRegistry 构造不抛（纯字段存储），损坏在
// 异步 load() 显式抛 ProjectRegistryCorruptError——在此捕获 console.error 不阻启动
// （projects.json 损坏时 listProjects/addProject 通道仍 fail-visible，rehydrate 缺席只影响旧分组）。
void (async () => {
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
  run: (req) => host.run(req as never),
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
  listSessions: () => host.listSessions(),
  // createSession 首参 M3 起是工作区（原 name 槽位被 M3 接口接管）；渲染层现不传 ⇒ 缺省 activeWorkspace
  createSession: (workspace) => host.createSession(workspace as string | undefined),
  openSession: (id) => host.openSession(id as string),
  // M3 小修（M1 六通道清单遗留缺口）：channels.ts 有 getProviderInfo 通道、preload 程序化桥自动
  // 透传、App.tsx 挂载即调，wired 表却从没这行 ⇒ renderer 调用即 reject「No handler registered」，
  // 模型选择器自 M2 起静默失效（providerInfo 恒 null）。实现直走 settings-handlers 的同名 read
  // model（无参异步，kernel-host 已注入 resolveProviderKind 依赖面），选择器恢复真值目录。
  getProviderInfo: () => providerInfo(),
  listProjects: () => projectRegistry.list(),
  // ③「新建项目」：建同名文件夹 → 登记 → 同步进 host 工作区面。
  // 两段失败分开报：建目录失败（名字非法/已存在/没权限）与登记失败是两回事，
  // 而且登记失败时目录**已经建好了** —— 消息里必须给出那个路径，否则用户找不到它。
  createProject: async (req) => {
    const r = req as { name?: string; parentDir?: string };
    const made = createProjectFolder({
      name: String(r.name ?? ""),
      ...(typeof r.parentDir === "string" && r.parentDir !== "" ? { parentDir: r.parentDir } : {}),
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
  addProject: (input) =>
    projectRegistry.add(input as AddProjectInput).then((record) => {
      host.addWorkspace(record.path);
      return record;
    }),
  // M4-5 缩面对称（addWorkspace 的逆操作）：removeProject 成功后同步 host.removeWorkspace(record.path)
  // ——被移除工作区退出扫描面（listSessions 不再出现该组）、归属表/漂移基线同步清理；该组有在跑
  // 会话 ⇒ host.removeWorkspace fail-visible throw（IPC reject 上抛 renderer，不静默缩面）。
  removeProject: (id) =>
    projectRegistry.remove(id as string).then((record) => {
      host.removeWorkspace(record.path);
      return record;
    }),
  // M4-5：dialog 选目录（M3 deferred 收口，侧栏添加表单「浏览…」的后端）：非模态 showOpenDialog
  // 只选目录（openDirectory）；取消/关窗 ⇒ filePaths 空 ⇒ null——renderer 据此保留手输兜底。
  pickDirectory: async () => {
    const picked = await dialog.showOpenDialog({ properties: ["openDirectory"] });
    return picked.filePaths[0] ?? null;
  },
  getState: () => handleAgentState(),
  getOnboarding: () => onboardingGroups(),
  getSettings: () => getSettings(),
  setSettings: (patch) => setSettings(patch as never),
  compact: (req) => handleCompact(req as never),
  setGoal: (req) => handleGoalSet(req as never),
  cardAction: (req) => handleCardAction(req as never),
  renameSession: (oldId, newName) => handleSessionRename(oldId as string, newName as string),
  deleteSession: (id) => handleSessionDelete(id as string),
  // M8 分叉（v2.15）：保留前 N 轮 → 新会话 `<id>-f<N>`；与 CLI --fork/--from 同口径（fork-cli 单源）。
  forkSession: (id, round) => handleSessionFork(id as string, round as number),
  // #7 文件级回滚（v2.16）：把第 N 轮主会话改过的文件还原成该轮之前的原件（源自 D7 覆盖前快照）。
  revertTurn: (id, round) => handleSessionRevert(id as string, round as number),
  // v2.16 用户反馈沉淀（赞/踩）：sidecar feedback.jsonl，append-only、不进事件流。
  submitFeedback: (req) => handleFeedbackSubmit(req as never),
  listFeedback: (sessionId) => handleFeedbackList(sessionId as string),
  setSessionPinned: (sessionId, pinned) => handleSessionSetPinned(sessionId as string, pinned as boolean),
  setSessionArchived: (sessionId, archived) => handleSessionSetArchived(sessionId as string, archived as boolean),
  assignSessionProject: (sessionId, projectId) => handleSessionAssignProject(sessionId as string, projectId as string | null),
  deleteMemory: (scope, topic) => handleMemoryDelete(scope as never, topic as string),
  pluginDecide: (plugin, trusted) => handlePluginDecide(plugin as string, trusted as boolean),
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
  ipcMain.handle(channel, (_e, ...args: unknown[]) => handler(...args));
}
void webContents; // 显式留痕：推送经 BrowserWindow.getAllWindows()

const createWindow = () => {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    titleBarStyle: "hiddenInset",
    webPreferences: { preload: join(distElectron, "preload.cjs"), contextIsolation: true, nodeIntegration: false },
  });
  if (process.env.VITE_DEV_SERVER_URL) void win.loadURL(process.env.VITE_DEV_SERVER_URL);
  else void win.loadFile(join(distElectron, "..", "dist", "index.html"));

  // CAIRN_SMOKE：真窗口 + 真 IPC 回环的机器冒烟——window.agent 探测 → createSession → demo run
  // → 事件计数 → 自退。renderer 的 [cairn-smoke] console 行经 console-message 转发进 stdout。
  if (process.env.CAIRN_SMOKE === "1") {
    const t0 = Date.now();
    win.webContents.on("console-message", (_details, _level, message) => {
      if (message.includes("[cairn-smoke]")) console.log("[renderer]", message);
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
                 const rows = [...document.querySelectorAll(".sidebar .session")];
                 const t = rows.find((r) => (r.textContent || "").includes(${JSON.stringify(sessionId)}));
                 if (t) t.click();
                 let listed = -1;
                 try { listed = (await window.agent.listSessions()).length; } catch { listed = -2; }
                 const aside = document.querySelector(".sidebar");
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
          if (!run.ok) failed.push(`run ok:false${run.error ? `（${run.error}）` : ""}`);
          if (events < 1) failed.push(`事件计数 ${events} < 1`);
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
  installProviderKeyBackend(
    {
      isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
      encryptString: (plain) => safeStorage.encryptString(plain),
      decryptString: (payload) => safeStorage.decryptString(payload),
    },
    join(userData, "provider-keys.json"),
  );
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
// 调度器随应用退出停表（清 timer；与 CLI SIGINT → stop 同语义）。
app.on("will-quit", () => stopDesktopScheduler?.());
