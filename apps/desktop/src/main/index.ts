// Electron main 装配根（M1-6）：kernel-host 单点装配 + IPC 薄映射。
// 装载通道：entry.cjs 注册 repo 根 tsx 后 require 本 TS 源——core 链零打包零漂移
// （esbuild 打包会把 agent-runner 的 ROOT 漂进 <repo>/apps，fixtures 运行时静默落空）。
import { app, BrowserWindow, ipcMain, webContents } from "electron";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { INVOKE_CHANNELS, PUSH_CHANNELS } from "./channels";
import type { InvokeChannel, PushChannel } from "./channels";
import type { AddProjectInput } from "../../../../src/main/ipc-protocol";
// M3 终审 Critical 修复：澄清/方案两卡自 M2 起端到端死路（wired 表漏行 ⇒ renderer 调用即
// reject「No handler registered」）。与 decide 同式——main 进程 import core 出口后直调，
// 不经 kernel-host 转手（两出口本就是为 IPC 处理函数而生的单例缝，见 agent-runner 各自头注）。
import { handleClarifySubmit, handlePlanDecide } from "../../../../src/main/agent-runner";
import type { ClarifyAnswerMap } from "../../../../src/events";
import { createKernelHost } from "./kernel-host";
import { ProjectRegistry } from "../../../../src/main/project-registry";
import { providerInfo } from "../../../../src/main/settings-handlers";

const here = fileURLToPath(new URL(".", import.meta.url));
const distElectron = join(here, "..", "..", "dist-electron");

// M0_SMOKE userData 隔离（终审 #3，data-loss 防线）：冒烟会 seed settings.json，落真实 userData
// 就是覆写用户数据——先把 userData 指到 mkdtemp 临时目录，seed 与 Electron 存储全部落隔离面。
// setPath 必须先于一切 getPath("userData")：Electron 按当时的路径惰性建目录/落盘，晚了就写进真处。
if (process.env.M0_SMOKE === "1") {
  if (!process.env.M0_DESKTOP_WORKSPACE) {
    // 回落 $HOME 会把冒烟会话/事件写进真实家目录——冒烟必须显式给临时工作区
    console.error("[m0-smoke] FAIL: M0_DESKTOP_WORKSPACE 未设置（冒烟拒绝回落 $HOME，请显式给临时工作区）");
    app.exit(1);
  }
  app.setPath("userData", mkdtempSync(join(tmpdir(), "m0-smoke-userdata-")));
}

const userData = app.getPath("userData");
const workspace = process.env.M0_DESKTOP_WORKSPACE ?? app.getPath("home");

// M0_SMOKE 机器冒烟（GUI 交互留给人）：先 seed settings 再装配 host——
// initSettingsStore 在 createKernelHost 里挂存储，seed 必须赶在它前面。
// （settings 路径已随上面的 mkdtemp 与真实 userData 隔离：隔离目录恒无文件，等价每次重 seed。）
if (process.env.M0_SMOKE === "1") {
  mkdirSync(userData, { recursive: true });
  const settingsPath = join(userData, "settings.json");
  let alreadyDemo = false;
  try {
    alreadyDemo = JSON.parse(readFileSync(settingsPath, "utf8")).provider === "demo";
  } catch {
    // 无文件 / 坏文件 → 重 seed
  }
  if (!alreadyDemo) writeFileSync(settingsPath, JSON.stringify({ provider: "demo", model: "" }), "utf8");
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
// M0_SMOKE 的 userData 已隔离到 mkdtemp，不碰真实数据。
const projectRegistry = new ProjectRegistry(join(userData, "projects.json"));

// M1 切片：这六个通道接真；其余 invoke 通道 M2+ 逐个接线（channels 表已钉死清单）。
// M3-3 修复轮：补上 CX-01 三通道——M1 起 AgentApi/channels 表/preload 只有类型桥，wired 表从没这三行
// ⇒ renderer 调用即 reject「No handler registered」。listProjects/removeProject 返回值直接透传；
// addProject 透传之外在成功后同步 host.addWorkspace(record.path)：新工作区并入 host 扫描面
// （main 进程内直调，不经 IPC、renderer 无感知自动生效；canonical realpath 由 registry.add 保证）。
const wired: Partial<Record<InvokeChannel, (...args: unknown[]) => unknown>> = {
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
  addProject: (input) =>
    projectRegistry.add(input as AddProjectInput).then((record) => {
      host.addWorkspace(record.path);
      return record;
    }),
  removeProject: (id) => projectRegistry.remove(id as string),
};
for (const [key, channel] of Object.entries(INVOKE_CHANNELS) as [InvokeChannel, string][]) {
  const handler = wired[key];
  if (handler) ipcMain.handle(channel, (_e, ...args: unknown[]) => handler(...args));
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

  // M0_SMOKE：真窗口 + 真 IPC 回环的机器冒烟——window.agent 探测 → createSession → demo run
  // → 事件计数 → 自退。renderer 的 [m0-smoke] console 行经 console-message 转发进 stdout。
  if (process.env.M0_SMOKE === "1") {
    const t0 = Date.now();
    win.webContents.on("console-message", (_details, _level, message) => {
      if (message.includes("[m0-smoke]")) console.log("[renderer]", message);
    });
    win.webContents.on("did-finish-load", () => {
      const watchdog = setTimeout(() => {
        console.error("[m0-smoke] watchdog：30s 未收束，强制退出");
        app.exit(1);
      }, 30_000);
      void win.webContents
        .executeJavaScript(`(() => {
          const api = window.agent;
          window.__m0 = { events: 0, asks: 0 };
          api.onEvent((e) => { window.__m0.events++; if (window.__m0.events <= 12) console.log("[m0-smoke] event " + window.__m0.events + ": " + (e && e.type)); });
          api.onAsk((p) => { window.__m0.asks++; console.log("[m0-smoke] ask -> approve: " + p.tool); api.decide(p.askId, true); });
          return typeof api;
        })()`)
        .then(async (agentType) => {
          console.log("[m0-smoke] window.agent type:", agentType);
          const sessionId = await win.webContents.executeJavaScript(
            "window.agent.createSession().then((s) => s.id)",
          );
          console.log("[m0-smoke] session:", sessionId);
          const run = (await win.webContents.executeJavaScript(
            `window.agent.run({ message: "demo", mode: "default", sessionId: ${JSON.stringify(sessionId)} })`,
          )) as { ok: boolean; error?: string };
          console.log("[m0-smoke] run:", JSON.stringify(run));
          // 推送与 run resolve 的收尾异步：轮询计数至稳定（≤3s）再定数
          let events = -1;
          for (let i = 0; i < 15; i++) {
            await new Promise((r) => setTimeout(r, 200));
            const n = (await win.webContents.executeJavaScript("window.__m0.events")) as number;
            if (n === events) break;
            events = n;
          }
          const asks = (await win.webContents.executeJavaScript("window.__m0.asks")) as number;
          console.log("[m0-smoke] events:", events, "asks auto-approved:", asks);
          // 退出码编码判据：M0_SMOKE 是可重跑门——判据不过必须非零退（CI 可判）
          const failed: string[] = [];
          if (!run.ok) failed.push(`run ok:false${run.error ? `（${run.error}）` : ""}`);
          if (events < 1) failed.push(`事件计数 ${events} < 1`);
          if (failed.length > 0) {
            console.error("[m0-smoke] FAIL:", failed.join("；"));
            clearTimeout(watchdog);
            app.exit(1);
            return;
          }
          console.log("[m0-smoke] PASS in", Date.now() - t0, "ms");
          clearTimeout(watchdog);
          app.quit();
        })
        .catch((err: unknown) => {
          console.error("[m0-smoke] FAILED:", err instanceof Error ? err.message : String(err));
          clearTimeout(watchdog);
          app.exit(1);
        });
    });
  }
};
app.whenReady().then(createWindow);
app.on("window-all-closed", () => app.quit());
