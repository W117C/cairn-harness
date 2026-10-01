# m0 桌面端 M1：壳与桥面（纵向切片）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 可跑的 Electron 驾驶舱第一版：窗口壳 + 全通道 preload 桥 + kernel-host 装配点 + 会话列表 + composer 派活 + 事件流渲染 + 审批卡最小可用，demo provider 全链路 headless 判卷绿。

**Architecture:** 内核直嵌主进程（方案 A）。`kernel-host.ts` 是 electron-free 装配点（`createKernelHost(deps)` 纯函数装配，headless 可判卷；Electron main 只做 BrowserWindow + ipcMain 薄映射——这条缝就是 spec §3.2 预留的 utilityProcess 升级缝）。`AgentApi`（`src/main/ipc-protocol.ts`）是唯一类型真值源，通道名表用映射类型钉死完整性（删通道 typecheck 红）。

**Tech Stack:** Electron ^38、electron-builder ^26（M5 才用）、React 18、Vite、TypeScript strict、vitest。全部依赖收在 `apps/desktop` 包内，根 package.json 零新增。

**Spec:** `docs/superpowers/specs/2026-10-02-desktop-shell-design.md`（§3 总体架构、§3.3 桥面、§4.1 会话库、§5 安全、§6 视觉与交互、§11 M1 验收锚）

## Global Constraints

- Node ≥ 20.3（根 engines 已声明）；本仓一律 pnpm。
- **core 门全不动**：根 `pnpm typecheck`、`pnpm test`（vitest 必须带 `--config tests/vitest.config.ts`）、gates、docs-check 原样绿；冻结判卷文件与夹具不碰。
- 依赖只进 `apps/desktop/package.json`；`src/` 与根 package.json 零新增依赖。
- 依赖方向单向：`apps/desktop → src`；`src/` 内禁止任何对 `apps/desktop` 或 electron/react 的 import。
- 会话根按工作区解析：`<workspace>/.agent/sessions`（与 `src/cli.ts:933` 同根）。
- 桌面端测试一律带自己的 config 跑：`pnpm --filter m0-desktop test`（内部 `vitest run --config vitest.config.ts`）。
- `scripts/docs-check.ts` 当前有其他会话的未提交改动——**本计划不碰该文件**；单向依赖扫描落在新文件 `scripts/desktop-boundary-check.ts`。
- 工作树有并行会话：提交只 add 本计划清单内的文件，提交信息用中文详述（仓库惯例）。
- Mimosa hook 对 spawn 行 Edit 可能假阳：遇拦截拆小编辑重试（既有绕行惯例）。
- macOS 先行；本计划不签公、不打包 dmg（M5）。

---

### Task 1: 桌面包骨架（workspace + Electron 最小窗口）

**Files:**
- Modify: `pnpm-workspace.yaml`（加 `packages` 字段与 electron 构建白名单）
- Create: `apps/desktop/package.json`
- Create: `apps/desktop/tsconfig.json`
- Create: `apps/desktop/vite.config.ts`
- Create: `apps/desktop/src/main/index.ts`（最小 BrowserWindow）
- Create: `apps/desktop/src/renderer/index.html` + `apps/desktop/src/renderer/main.tsx`（最小挂载）
- Create: `apps/desktop/.gitignore`（dist/）

**Interfaces:**
- Produces: 包名 `m0-desktop`；后续任务经 `pnpm --filter m0-desktop …` 调用；`src/main/index.ts` 为 Electron 入口（package.json `main` 字段指向其编译产物 `dist-electron/index.js`）。

- [ ] **Step 1: pnpm-workspace.yaml 加 packages 与构建白名单**

现有内容只有 `allowBuilds`/`onlyBuiltDependencies`。改为（保留原有键）：

```yaml
packages:
  - apps/*
allowBuilds:
  electron: true
  electron-winstaller: set this to true or false
  esbuild: true
onlyBuiltDependencies:
  - esbuild
```

- [ ] **Step 2: 写 apps/desktop/package.json**

```json
{
  "name": "m0-desktop",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "dist-electron/index.js",
  "scripts": {
    "dev": "vite & sleep 2 && electron .",
    "build": "vite build && tsc -p tsconfig.json --noEmit",
    "test": "vitest run --config vitest.config.ts",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@types/react": "^18.3.12",
    "@types/react-dom": "^18.3.1",
    "@vitejs/plugin-react": "^5.0.0",
    "electron": "^38.0.0",
    "typescript": "^5.9.3",
    "vite": "^7.0.0",
    "vitest": "^5.0.0"
  }
}
```

- [ ] **Step 3: 写 tsconfig / vite.config / 最小入口**

`apps/desktop/tsconfig.json`（strict；jsx react-jsx；类型引根仓源码）：

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "jsx": "react-jsx",
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["node", "vitest/globals"],
    "paths": { "@core/*": ["../../src/*"] }
  },
  "include": ["src", "tests", "../../src/main/ipc-protocol.ts", "../../src/events/index.ts"]
}
```

`apps/desktop/vite.config.ts`：

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "src/renderer",
  plugins: [react()],
  build: { outDir: "../../dist", emptyOutDir: true },
});
```

`apps/desktop/src/main/index.ts`（最小窗口；dev 走 vite 5173，prod 走 dist/index.html）：

```ts
import { app, BrowserWindow } from "electron";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const createWindow = () => {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    titleBarStyle: "hiddenInset",
    webPreferences: { preload: join(here, "preload.js"), contextIsolation: true, nodeIntegration: false },
  });
  if (process.env.VITE_DEV_SERVER_URL) void win.loadURL(process.env.VITE_DEV_SERVER_URL);
  else void win.loadFile(join(here, "../dist/index.html"));
};
app.whenReady().then(createWindow);
app.on("window-all-closed", () => app.quit());
```

`apps/desktop/src/renderer/index.html`：

```html
<!doctype html>
<html lang="zh-CN">
  <head><meta charset="UTF-8" /><title>m0</title></head>
  <body><div id="root"></div><script type="module" src="./main.tsx"></script></body>
</html>
```

`apps/desktop/src/renderer/main.tsx`：

```tsx
import { createRoot } from "react-dom/client";
createRoot(document.getElementById("root")!).render(<div id="app-shell">m0 驾驶舱</div>);
```

`apps/desktop/.gitignore`：

```
dist/
dist-electron/
node_modules/
```

- [ ] **Step 4: 安装并验证构建**

```bash
pnpm install
pnpm --filter m0-desktop typecheck
pnpm --filter m0-desktop build
```

Expected: 全绿（electron 二进制随 postinstall 下载）。

- [ ] **Step 5: 根仓门不受影响**

```bash
pnpm typecheck && node node_modules/vitest/vitest.mjs run --config tests/vitest.config.ts
```

Expected: 与开工前同样绿。

- [ ] **Step 6: Commit**

```bash
git add pnpm-workspace.yaml apps/desktop
git commit -m "桌面端 M1-1：apps/desktop 包骨架入 workspace——Electron38 最小窗口（hiddenInset/ContextIsolation 预留 preload）、React18+Vite7 renderer 挂载、strict tsconfig 引根仓类型、electron 构建白名单；根门不受影响"
```

---

### Task 2: 通道名表 channels.ts（完整性红线）

**Files:**
- Create: `apps/desktop/src/main/channels.ts`
- Test: `apps/desktop/tests/channels.test.ts`
- Create: `apps/desktop/vitest.config.ts`

**Interfaces:**
- Consumes: `AgentApi`（`src/main/ipc-protocol.ts`，type-only）。
- Produces: `INVOKE_CHANNELS: { [K in InvokeChannel]: string }`、`PUSH_CHANNELS = { onEvent; onAsk; onAskDone }`。**缺任何一个 invoke 通道 ⇒ typecheck 红**——这就是"删桥必红"的桥面版。

- [ ] **Step 1: 写 vitest.config.ts**

```ts
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"], environment: "node" } });
```

- [ ] **Step 2: 写失败测试**

`apps/desktop/tests/channels.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import type { AgentApi } from "../../../src/main/ipc-protocol";
import { INVOKE_CHANNELS, PUSH_CHANNELS } from "../src/main/channels";

describe("通道名表完整性", () => {
  it("invoke 通道覆盖 AgentApi 全部非推送键", () => {
    const pushKeys = ["onEvent", "onAsk", "onAskDone"] as const;
    const expected = (Object.keys({} as AgentApi) as (keyof AgentApi)[]).filter(
      (k) => !pushKeys.includes(k as (typeof pushKeys)[number]),
    );
    for (const key of expected) expect(INVOKE_CHANNELS[key as keyof typeof INVOKE_CHANNELS]).toBeTruthy();
  });
  it("推送通道恰为三条", () => {
    expect(Object.keys(PUSH_CHANNELS).sort()).toEqual(["onAsk", "onAskDone", "onEvent"]);
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `pnpm --filter m0-desktop test`
Expected: FAIL（channels.ts 不存在）。

- [ ] **Step 4: 写 channels.ts**

```ts
// 桥面通道名唯一事实源。INVOKE_CHANNELS 的映射类型是完整性红线：
// AgentApi 新增方法而这里不加行 ⇒ typecheck 红（ipc-protocol 删键同理）。
import type { AgentApi } from "../../../src/main/ipc-protocol";

export type PushChannel = "onEvent" | "onAsk" | "onAskDone";
export type InvokeChannel = Exclude<keyof AgentApi, PushChannel>;

export const PUSH_CHANNELS: { [K in PushChannel]: string } = {
  onEvent: "agent:event",
  onAsk: "agent:ask",
  onAskDone: "agent:ask-done",
};

export const INVOKE_CHANNELS: { [K in InvokeChannel]: string } = {
  run: "agent:run",
  decide: "agent:decide",
  submitClarify: "agent:clarify-submit",
  decidePlan: "agent:plan-decide",
  setGoal: "agent:goal-set",
  runCancel: "agent:run-cancel",
  compact: "agent:compact",
  getState: "agent:state",
  getProviderInfo: "agent:provider-info",
  getOnboarding: "agent:onboarding",
  getSettings: "agent:settings-get",
  setSettings: "agent:settings-set",
  listSessions: "agent:sessions-list",
  createSession: "agent:sessions-create",
  openSession: "agent:sessions-open",
  renameSession: "agent:sessions-rename",
  deleteSession: "agent:sessions-delete",
  listProjects: "agent:projects-list",
  addProject: "agent:projects-add",
  removeProject: "agent:projects-remove",
  setSessionPinned: "agent:session-pin",
  setSessionArchived: "agent:session-archive",
  assignSessionProject: "agent:session-assign",
  deleteMemory: "agent:memory-delete",
  pluginDecide: "agent:plugin-decide",
  sidechatCreate: "agent:sidechat-create",
  sidechatAsk: "agent:sidechat-ask",
  sidechatPromote: "agent:sidechat-promote",
  sidechatState: "agent:sidechat-state",
  cardAction: "agent:card-action",
  scheduleSnapshot: "agent:schedule-snapshot",
  scheduleUpsert: "agent:schedule-upsert",
  scheduleDelete: "agent:schedule-delete",
  scheduleRunNow: "agent:schedule-run-now",
  providerKeySet: "agent:provider-key-set",
  providerKeyDelete: "agent:provider-key-delete",
  providerKeyStatus: "agent:provider-key-status",
  checkUpdate: "agent:check-update",
  openExternal: "agent:open-external",
};
```

- [ ] **Step 5: 跑测试与 typecheck 确认绿**

Run: `pnpm --filter m0-desktop test && pnpm --filter m0-desktop typecheck`
Expected: PASS。若 typecheck 报 `INVOKE_CHANNELS` 缺键，缺哪个补哪个——这正是红线在工作。

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/main/channels.ts apps/desktop/tests/channels.test.ts apps/desktop/vitest.config.ts
git commit -m "桌面端 M1-2：桥面通道名表唯一事实源——INVOKE_CHANNELS 映射类型钉死 AgentApi 全部 invoke 键（41 通道）＋三条推送通道，缺行 typecheck 红；vitest 桌面独立 config"
```

---

### Task 3: kernel-host 装配点（electron-free，headless 可判卷）

**Files:**
- Create: `apps/desktop/src/main/kernel-host.ts`
- Test: `apps/desktop/tests/kernel-host.test.ts`

**Interfaces:**
- Consumes（全部已存在的 core 出口）: `handleAgentRun(req, over)`、`handleAgentDecide(askId, approved, scope?)`、`setAppHooks(h)`、`installAppTools()`、`initMemoryHome(dir)`（均 `src/main/agent-runner.ts`）；`initSessionsDir(dir)`（`src/main/session-handlers.ts`）；`SettingsStore`（`src/main/settings.ts`）、`setSettingsHostDeps`（`src/main/settings-handlers.ts`——装配前先读它的形参面，typecheck 会强制对齐）。
- Produces: `createKernelHost(deps: KernelHostDeps): KernelHost`，其中：

```ts
export interface KernelHostDeps {
  workspace: string;                       // 当前工作区绝对路径
  userDataDir: string;                     // app userData（settings/日志）
  outbox: (channel: "onEvent" | "onAsk" | "onAskDone", payload: unknown) => void;
}
export interface KernelHost {
  run(req: RunRequest): Promise<RunResponse>;
  decide(askId: string, approved: boolean, scope?: "once" | "session_kind" | "always"): boolean;
  cancel(): Promise<{ ok: boolean; error?: string }>;
  listSessions(): Promise<SessionInfoPayload[]>;
  createSession(name?: string): Promise<{ id: string }>;
  openSession(id: string): Promise<{ events: AgentEvent[] }>;
}
```

- [ ] **Step 1: 摸清 runner 出口名（防错引）**

Run: `grep -n "^export" "src/main/agent-runner.ts" | sed -n '25,60p'`
Expected: 能看到导出块（约 2780–2800 行）里含 `handleAgentRun`、`handleAgentDecide`、会话/取消处理器。**以 typecheck 为准**：下面代码若引用了不存在的出口名，按导出块的实际名字改（本步就是给执行者的勘误窗口）。

- [ ] **Step 2: 写失败测试**

`apps/desktop/tests/kernel-host.test.ts`：

```ts
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createKernelHost } from "../src/main/kernel-host";

const dir = mkdtempSync(join(tmpdir(), "m0-host-"));
const workspace = join(dir, "ws");
const userData = join(dir, "userData");
mkdirSync(workspace, { recursive: true });
// seed settings：provider=demo ⇒ 不拨号不花钱（spec §3.2 / agent-runner resolveRunModel）
mkdirSync(userData, { recursive: true });
writeFileSync(join(userData, "settings.json"), JSON.stringify({ provider: "demo", model: "" }));
process.env.M3A_AGENTS_DEMO = "1"; // 脚本化主模型：fixtures/agents/main-demo.jsonl，确定性

const host = createKernelHost({
  workspace,
  userDataDir: userData,
  outbox: (channel, payload) => outbox.push([channel, payload] as const),
});
const outbox: readonly (readonly [string, unknown])[] = [];

describe("kernel-host 纵向装配", () => {
  it("run：demo 全链路落事件、会话 JSONL 落 <ws>/.agent/sessions", async () => {
    const created = await host.createSession();
    const res = await host.run({ message: "跑一遍 demo", mode: "default", sessionId: created.id });
    expect(res.ok).toBe(true);
    const events = outbox.filter(([ch]) => ch === "onEvent");
    expect(events.length).toBeGreaterThan(0);
    expect(existsSync(join(workspace, ".agent", "sessions", `${created.id}.jsonl`))).toBe(true);
  }, 60_000);

  it("decide：未知 askId fail-closed 返回 false", async () => {
    expect(host.decide("no-such-ask", true)).toBe(false);
  });

  it("openSession：能读回刚落的会话", async () => {
    const sessions = await host.listSessions();
    expect(sessions.length).toBeGreaterThan(0);
    const opened = await host.openSession(sessions[0]!.id);
    expect(opened.events.length).toBeGreaterThan(0);
  });
});
```

注意：测试文件顶部补 `import { mkdirSync } from "node:fs";`；`outbox` 声明要挪到 `host` 之前（`const outbox: … = []` 提前）。

- [ ] **Step 3: 跑测试确认失败**

Run: `pnpm --filter m0-desktop test`
Expected: FAIL（kernel-host.ts 不存在）。

- [ ] **Step 4: 写 kernel-host.ts**

```ts
// kernel-host：内核装配单点（spec §3.2 预留 C 缝）。electron-free——
// headless 判卷直接 import；Electron main / 未来 utilityProcess 宿主都只消费本文件出口。
import { join } from "node:path";
import type { AgentEvent } from "../../../src/events";
import type { RunRequest, RunResponse, SessionInfoPayload } from "../../../src/main/ipc-protocol";
import {
  handleAgentDecide,
  handleAgentRun,
  handleRunCancel,
  initMemoryHome,
  installAppTools,
  listSessionInfos,
  openSessionEvents,
  setAppHooks,
} from "../../../src/main/agent-runner";
import { initSessionsDir } from "../../../src/main/session-handlers";
import { SettingsStore } from "../../../src/main/settings";
import { setSettingsHostDeps } from "../../../src/main/settings-handlers";

export interface KernelHostDeps {
  workspace: string;
  userDataDir: string;
  outbox: (channel: "onEvent" | "onAsk" | "onAskDone", payload: unknown) => void;
}

export interface KernelHost {
  run(req: RunRequest): Promise<RunResponse>;
  decide(askId: string, approved: boolean, scope?: "once" | "session_kind" | "always"): boolean;
  cancel(): Promise<{ ok: boolean; error?: string }>;
  listSessions(): Promise<SessionInfoPayload[]>;
  createSession(name?: string): Promise<{ id: string }>;
  openSession(id: string): Promise<{ events: AgentEvent[] }>;
}

let installed = false;

export function createKernelHost(deps: KernelHostDeps): KernelHost {
  // 会话根按工作区解析（spec §4.1）：与 CLI 同根 <ws>/.agent/sessions
  initSessionsDir(join(deps.workspace, ".agent", "sessions"));
  initMemoryHome(join(deps.userDataDir, "memory"));
  setSettingsHostDeps({ store: new SettingsStore(join(deps.userDataDir, "settings.json")) } as never);
  if (!installed) {
    installAppTools();
    installed = true;
  }
  setAppHooks({
    onEvent: (e) => deps.outbox("onEvent", e),
    onAsk: (p) => deps.outbox("onAsk", p),
    onAskOutcome: (p) => deps.outbox("onAskDone", p),
  });

  return {
    run: (req) => handleAgentRun(req),
    decide: (askId, approved, scope) => handleAgentDecide(askId, approved, scope),
    cancel: () => handleRunCancel(),
    listSessions: () => listSessionInfos(),
    createSession: (name) => handleCreateSession(name),
    openSession: (id) => openSessionEvents(id),
  };
}
```

写的时候以 Step 1 勘到的实际出口为准：`handleRunCancel / listSessionInfos / openSessionEvents / createSession` 若名字不同（或会话创建走 `createSession(dir, name)` from `src/main/sessions.ts`），就地用真实出口与局部小包装实现同签名；`setSettingsHostDeps` 的形参面以 `settings-handlers.ts` 实际定义为准（typecheck 强制），`as never` 占位只许在形参面核对后改成真实形状。

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm --filter m0-desktop test`
Expected: 3 个用例 PASS（demo 通道不拨号；60s 上限内完成）。

- [ ] **Step 6: 根门不受影响**

```bash
pnpm typecheck && node node_modules/vitest/vitest.mjs run --config tests/vitest.config.ts
```

Expected: 绿。若根 typecheck 红——说明 `apps/desktop` 代码被根 tsconfig 扫到或 `src/` 反向引用了桌面层，**回改桌面侧**（禁改根 tsconfig include 来"修"）。

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/main/kernel-host.ts apps/desktop/tests/kernel-host.test.ts
git commit -m "桌面端 M1-3：kernel-host 装配点（electron-free）——initSessionsDir 按 <ws>/.agent/sessions 同根 CLI、SettingsStore 挂 userData、setAppHooks 三通道进 outbox、handleAgentRun/Decide 直调；demo 脚本通道 headless 判卷 3 例（事件落 outbox＋会话 JSONL 同根＋未知 askId fail-closed）"
```

---

### Task 4: preload 桥面（全通道程序化桥接）

**Files:**
- Create: `apps/desktop/src/preload/index.ts`
- Create: `apps/desktop/tsconfig.preload.json`（CommonJS 产物，Electron preload 需要 cjs）

**Interfaces:**
- Consumes: `INVOKE_CHANNELS`/`PUSH_CHANNELS`（Task 2）、Electron `contextBridge`。
- Produces: `window.agent: AgentApi`（与 `src/main/ipc-protocol.ts` 同型）。invoke 方法经 `Object.fromEntries` 程序化生成（通道表类型已钉完整性）；三条推送通道用 `ipcRenderer.on` 包装并返回退订函数。

- [ ] **Step 1: 写 preload/index.ts**

```ts
// preload 桥：invoke 通道程序化生成——通道表的映射类型已钉死完整性，
// 这里不逐通道抄第二份（抄了就有漂移面）。推送三通道显式包装（要退订语义）。
import { contextBridge, ipcRenderer } from "electron";
import type { AgentApi } from "../../../src/main/ipc-protocol";
import { INVOKE_CHANNELS, PUSH_CHANNELS } from "../main/channels";

const invokeApi = Object.fromEntries(
  Object.entries(INVOKE_CHANNELS).map(([key, channel]) => [
    key,
    (...args: unknown[]) => ipcRenderer.invoke(channel, ...args),
  ]),
);

const pushApi = {
  onEvent: (cb: (e: unknown) => void) => subscribe(PUSH_CHANNELS.onEvent, cb),
  onAsk: (cb: (p: unknown) => void) => subscribe(PUSH_CHANNELS.onAsk, cb),
  onAskDone: (cb: (p: unknown) => void) => subscribe(PUSH_CHANNELS.onAskDone, cb),
};

function subscribe(channel: string, cb: (v: unknown) => void): () => void {
  const listener = (_e: Electron.IpcRendererEvent, value: unknown) => cb(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api = { ...invokeApi, ...pushApi } as unknown as AgentApi;
contextBridge.exposeInMainWorld("agent", api);
```

- [ ] **Step 2: preload 单独 tsconfig（cjs）**

`apps/desktop/tsconfig.preload.json`：

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": { "module": "CommonJS", "moduleResolution": "Node", "outDir": "dist-electron", "noEmit": false },
  "include": ["src/preload", "src/main/channels.ts", "../../src/main/ipc-protocol.ts"]
}
```

`apps/desktop/package.json` 的 `build` 脚本追加 preload 编译：`"build": "vite build && tsc -p tsconfig.preload.json && tsc -p tsconfig.json --noEmit"`。

- [ ] **Step 3: 验证**

```bash
pnpm --filter m0-desktop typecheck
pnpm --filter m0-desktop build
```

Expected: 绿；`dist-electron/preload/index.js` 产出。

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/preload apps/desktop/tsconfig.preload.json apps/desktop/package.json
git commit -m "桌面端 M1-4：preload 全通道桥——invoke 经通道表程序化生成（零第二份清单）、推送三通道带退订语义、contextBridge 暴露 window.agent: AgentApi；preload 走 cjs 独立 tsconfig"
```

---

### Task 5: renderer 纵向切片（Codex 基因静态版）

**Files:**
- Create: `apps/desktop/src/renderer/projections.ts`（纯函数投影）
- Create: `apps/desktop/src/renderer/App.tsx`、`components/Sidebar.tsx`、`components/Stream.tsx`、`components/Composer.tsx`、`components/ApprovalCard.tsx`、`styles.css`
- Modify: `apps/desktop/src/renderer/main.tsx`（挂 App）
- Test: `apps/desktop/tests/projections.test.ts`

**Interfaces:**
- Consumes: `window.agent: AgentApi`（Task 4）；`AgentEvent`/`AskPayload`（ipc-protocol）。
- Produces（后续任务的判卷面）:

```ts
// projections.ts —— 全部纯函数（spec §3.4：UI 状态 = AgentEvent[] 的纯投影）
export type StreamRow =
  | { kind: "user"; text: string; seq: number }
  | { kind: "assistant"; text: string; seq: number }
  | { kind: "tool"; tool: string; summary: string; seq: number };

export function projectStream(events: readonly AgentEvent[]): StreamRow[];
export type RunPhase = "idle" | "thinking" | "tool" | "ask";
export function deriveRunPhase(events: readonly AgentEvent[], pendingAsk: boolean): RunPhase;
```

- [ ] **Step 1: 写投影失败测试**

`apps/desktop/tests/projections.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { deriveRunPhase, projectStream } from "../src/renderer/projections";
import type { AgentEvent } from "../../../src/main/ipc-protocol";

const ev = (partial: Record<string, unknown>) => partial as AgentEvent;

describe("projectStream", () => {
  it("user_message 与 assistant_message 成行，tool 调用成行", () => {
    const rows = projectStream([
      ev({ type: "user_message", content: "跑 bench" }),
      ev({ type: "tool_call", tool: "run_shell", args: { command: "pnpm bench" } }),
      ev({ type: "assistant_message", content: "全绿" }),
    ]);
    expect(rows.map((r) => r.kind)).toEqual(["user", "tool", "assistant"]);
    expect(rows[2]!.kind === "assistant" && rows[2]!.text).toBe("全绿");
  });
  it("assistant_delta 聚合进当前 assistant 行（不逐 delta 成行）", () => {
    const rows = projectStream([
      ev({ type: "assistant_delta", callId: "c1", text: "你" }),
      ev({ type: "assistant_delta", callId: "c1", text: "好" }),
      ev({ type: "assistant_message", content: "你好" }),
    ]);
    expect(rows.filter((r) => r.kind === "assistant")).toHaveLength(1);
  });
});

describe("deriveRunPhase", () => {
  it("空流=idle；delta 流=thinking；tool 在前=tool；待批=ask", () => {
    expect(deriveRunPhase([], false)).toBe("idle");
    expect(deriveRunPhase([ev({ type: "assistant_delta", callId: "c", text: "x" })], false)).toBe("thinking");
    expect(deriveRunPhase([ev({ type: "tool_call", tool: "run_shell", args: {} })], false)).toBe("tool");
    expect(deriveRunPhase([], true)).toBe("ask");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter m0-desktop test`
Expected: FAIL（projections.ts 不存在）。**事件类型名以 `src/events/index.ts` 的 `AGENT_EVENT_TYPES` 联合为准**（已核实含 `user_message`/`assistant_message`/`assistant_delta`；`tool_call` 若实际名不同——如 `tool_result`/分立的 call 与 result——按真实事件名改投影与测试，改的是测试对形状的假设，不是事件面）。

- [ ] **Step 3: 写 projections.ts**

```ts
import type { AgentEvent } from "../../../src/main/ipc-protocol";

export type StreamRow =
  | { kind: "user"; text: string; seq: number }
  | { kind: "assistant"; text: string; seq: number }
  | { kind: "tool"; tool: string; summary: string; seq: number };

const summarize = (args: Record<string, unknown>): string => {
  const first = args.command ?? args.path ?? args.file ?? "";
  return typeof first === "string" && first ? first : JSON.stringify(args).slice(0, 80);
};

export function projectStream(events: readonly AgentEvent[]): StreamRow[] {
  const rows: StreamRow[] = [];
  for (let seq = 0; seq < events.length; seq++) {
    const e = events[seq]! as AgentEvent & Record<string, unknown>;
    switch (e.type) {
      case "user_message": rows.push({ kind: "user", text: String(e.content), seq }); break;
      case "assistant_message": rows.push({ kind: "assistant", text: String(e.content), seq }); break;
      case "assistant_delta": break; // 聚合面：终稿由 assistant_message 成行（v0.1）
      case "tool_call": rows.push({ kind: "tool", tool: String(e.tool), summary: summarize((e.args ?? {}) as Record<string, unknown>), seq }); break;
      default: break; // 其余事件类型 M2 扩投影时逐型接管
    }
  }
  return rows;
}

export type RunPhase = "idle" | "thinking" | "tool" | "ask";

export function deriveRunPhase(events: readonly AgentEvent[], pendingAsk: boolean): RunPhase {
  if (pendingAsk) return "ask";
  for (let i = events.length - 1; i >= 0; i--) {
    const t = (events[i]! as AgentEvent & { type: string }).type;
    if (t === "assistant_delta") return "thinking";
    if (t.startsWith("tool")) return "tool";
  }
  return "idle";
}
```

- [ ] **Step 4: 跑投影测试确认绿**

Run: `pnpm --filter m0-desktop test`
Expected: PASS。

- [ ] **Step 5: 写组件（Codex 基因静态版，浅色 token）**

`apps/desktop/src/renderer/styles.css`（语义 token 取 spec §6.1 浅色列）：

```css
:root {
  --canvas: #ffffff; --surface: #f7f7f8; --hairline: #ececec;
  --text-1: #0d0d0d; --text-2: #6e6e73; --text-3: #8f8f8f;
  --accent: #0d0d0d; --accent-ink: #ffffff; --risk: #f5a623;
}
* { box-sizing: border-box; }
body { margin: 0; font: 13px/1.6 -apple-system, "PingFang SC", sans-serif; color: var(--text-1); background: var(--canvas); }
.shell { display: flex; height: 100vh; }
.sidebar { width: 240px; background: var(--surface); border-right: 1px solid var(--hairline); padding: 12px 8px; display: flex; flex-direction: column; }
.sidebar .group-title { font-size: 10px; letter-spacing: .04em; color: var(--text-3); margin: 8px 6px 4px; }
.sidebar .session { display: flex; align-items: center; gap: 6px; padding: 5px 7px; border-radius: 6px; cursor: pointer; }
.sidebar .session.active { background: var(--hairline); }
.dot { width: 6px; height: 6px; border-radius: 50%; background: var(--text-3); flex-shrink: 0; }
.dot.breathe { animation: breathe 1.6s ease-in-out infinite; }
@keyframes breathe { 50% { opacity: .3; } }
.main { flex: 1; display: flex; flex-direction: column; min-width: 0; }
.sessionbar { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--hairline); }
.sessionbar .meta { margin-left: auto; font-size: 11px; color: var(--text-3); }
.stream { flex: 1; overflow-y: auto; padding: 12px 16px; display: flex; flex-direction: column; gap: 9px; }
.row-user { font-weight: 500; }
.row-tool { display: flex; gap: 6px; color: var(--text-2); font-family: ui-monospace, SFMono-Regular, monospace; font-size: 11px; }
.row-tool .summary { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.composer { padding: 10px 12px; }
.composer .box { border: 1px solid var(--hairline); border-radius: 12px; padding: 8px 12px; display: flex; }
.composer input { flex: 1; border: 0; outline: 0; font: inherit; color: var(--text-1); background: transparent; }
.composer .hint { background: var(--surface); border-radius: 5px; padding: 1px 6px; font-size: 10px; color: var(--text-3); }
.card-approval { border: 1px solid var(--hairline); border-left: 3px solid var(--risk); border-radius: 9px; padding: 9px 11px; }
.card-approval .cmd { font-family: ui-monospace, SFMono-Regular, monospace; font-size: 11px; color: var(--text-2); margin: 3px 0 7px; }
.card-approval .actions { display: flex; gap: 8px; align-items: center; }
.btn-primary { background: var(--accent); color: var(--accent-ink); border: 0; border-radius: 7px; padding: 3px 12px; font: inherit; cursor: pointer; }
.btn-ghost { background: transparent; color: var(--text-3); border: 0; font: inherit; cursor: pointer; }
```

`components/Sidebar.tsx`：

```tsx
import type { SessionInfoPayload } from "../../../src/main/ipc-protocol";

export function Sidebar(props: { sessions: SessionInfoPayload[]; activeId: string | null; running: Set<string>; onOpen: (id: string) => void }) {
  return (
    <aside className="sidebar">
      <div className="group-title">M0 · 工作区</div>
      {props.sessions.map((s) => (
        <div key={s.id} className={"session" + (s.id === props.activeId ? " active" : "")} onClick={() => props.onOpen(s.id)}>
          <span className={"dot" + (props.running.has(s.id) ? " breathe" : "")} />
          <span>{s.title ?? s.id}</span>
        </div>
      ))}
    </aside>
  );
}
```

`components/ApprovalCard.tsx`：

```tsx
import type { AskPayload } from "../../../src/main/ipc-protocol";

export function ApprovalCard(props: { ask: AskPayload; onDecide: (approved: boolean, scope?: "once" | "session_kind" | "always") => void }) {
  return (
    <div className="card-approval">
      <div style={{ fontWeight: 600 }}>允许 {props.ask.tool}？{props.ask.risk ? ` · 风险：${props.ask.risk}` : ""}</div>
      <div className="cmd">{JSON.stringify(props.ask.args)}</div>
      <div className="actions">
        <button className="btn-primary" onClick={() => props.onDecide(true)}>允许</button>
        <button className="btn-ghost" onClick={() => props.onDecide(false)}>拒绝</button>
        <button className="btn-ghost" style={{ marginLeft: "auto" }} onClick={() => props.onDecide(true, "always")}>总是允许</button>
      </div>
    </div>
  );
}
```

`components/Stream.tsx`：

```tsx
import type { StreamRow } from "../projections";

export function Stream(props: { rows: StreamRow[] }) {
  return (
    <div className="stream">
      {props.rows.map((r, i) =>
        r.kind === "user" ? <div key={i} className="row-user">{r.text}</div>
        : r.kind === "tool" ? <div key={i} className="row-tool"><span>⌁</span><span>{r.tool}</span><span className="summary">· {r.summary}</span></div>
        : <div key={i}>{r.text}</div>,
      )}
    </div>
  );
}
```

`components/Composer.tsx`：

```tsx
import { useState } from "react";

export function Composer(props: { onSend: (text: string) => void; disabled?: boolean }) {
  const [text, setText] = useState("");
  return (
    <div className="composer">
      <div className="box">
        <input
          value={text}
          placeholder={props.disabled ? "会话运行中，输入将排队追加…" : "给 agent 派活…"}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && text.trim()) { props.onSend(text.trim()); setText(""); }
          }}
        />
        <span className="hint">⏎</span>
      </div>
    </div>
  );
}
```

`App.tsx`：

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentEvent, AskPayload, SessionInfoPayload } from "../../../src/main/ipc-protocol";
import { deriveRunPhase, projectStream } from "./projections";
import { Sidebar } from "./components/Sidebar";
import { Stream } from "./components/Stream";
import { Composer } from "./components/Composer";
import { ApprovalCard } from "./components/ApprovalCard";

declare global { interface Window { agent: import("../../../src/main/ipc-protocol").AgentApi } }

export function App() {
  const [sessions, setSessions] = useState<SessionInfoPayload[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [ask, setAsk] = useState<AskPayload | null>(null);
  const [running, setRunning] = useState(false);
  const runningSet = useRef(new Set<string>());
  const [, force] = useState(0);

  useEffect(() => {
    void window.agent.listSessions().then(setSessions);
    const offEvent = window.agent.onEvent((e) => {
      setEvents((prev) => [...prev, e as AgentEvent]);
      const sid = (e as { session_id?: string }).session_id;
      if (sid) { runningSet.current.add(sid); force((n) => n + 1); }
    });
    const offAsk = window.agent.onAsk((p) => setAsk(p as AskPayload));
    const offDone = window.agent.onAskDone(() => setAsk(null));
    return () => { offEvent(); offAsk(); offDone(); };
  }, []);

  const send = useCallback(async (text: string) => {
    const id = activeId ?? (await window.agent.createSession()).id;
    setActiveId(id);
    setRunning(true);
    try { await window.agent.run({ message: text, mode: "default", sessionId: id }); }
    finally { runningSet.current.delete(id); setRunning(false); force((n) => n + 1); }
  }, [activeId]);

  const phase = deriveRunPhase(events, ask !== null);

  return (
    <div className="shell">
      <Sidebar sessions={sessions} activeId={activeId} running={runningSet.current} onOpen={(id) => {
        setActiveId(id);
        void window.agent.openSession(id).then((r) => setEvents(r.events));
      }} />
      <div className="main">
        <div className="sessionbar">
          <span style={{ fontWeight: 600 }}>{activeId ?? "m0"}</span>
          <span style={{ fontSize: 11, color: "var(--text-3)" }}>
            {phase === "ask" ? "● 等待审批" : phase === "thinking" ? "● 思考中" : phase === "tool" ? "● 执行工具" : "○ 就绪"}
          </span>
        </div>
        <Stream rows={projectStream(events)} />
        {ask && <div style={{ padding: "0 16px" }}><ApprovalCard ask={ask} onDecide={(approved, scope) => { void window.agent.decide(ask.askId, approved, scope); }} /></div>}
        <Composer onSend={(t) => void send(t)} disabled={running} />
      </div>
    </div>
  );
}
```

`main.tsx` 换成挂 App + 引 styles.css：

```tsx
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(<App />);
```

- [ ] **Step 6: typecheck + build**

```bash
pnpm --filter m0-desktop typecheck && pnpm --filter m0-desktop build
```

Expected: 绿（`window.agent` 的 declare global 与 AgentApi 对齐；若 preload 未编译进 dev 流程属预期——Task 6 手工冒烟时先跑一次 `tsc -p tsconfig.preload.json`）。

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/renderer
git commit -m "桌面端 M1-5：renderer 纵向切片（Codex 基因静态版）——投影纯函数 projectStream/deriveRunPhase 先行判卷、侧栏分组会话（状态点呼吸）、事件流三行型、审批卡（风险竖条/允许/拒绝/总是允许）、composer ⏎ 派活；浅色语义 token 落 CSS 变量"
```

---

### Task 6: 手工冒烟（真窗口跑通一次 demo 会话）

**Files:**
- Modify: `apps/desktop/src/main/index.ts`（接 kernel-host + ipcMain 映射）

**Interfaces:**
- Consumes: `createKernelHost`（Task 3）、`INVOKE_CHANNELS`/`PUSH_CHANNELS`（Task 2）。

- [ ] **Step 1: main 进程接 host（薄映射）**

`apps/desktop/src/main/index.ts` 在 createWindow 前加：

```ts
import { ipcMain, webContents } from "electron";
import { INVOKE_CHANNELS, PUSH_CHANNELS } from "./channels";
import { createKernelHost } from "./kernel-host";
import type { InvokeChannel, PushChannel } from "./channels";

const userData = app.getPath("userData");
const workspace = process.env.M0_DESKTOP_WORKSPACE ?? app.getPath("home");
const host = createKernelHost({
  workspace,
  userDataDir: userData,
  outbox: (channel: PushChannel, payload: unknown) => {
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send(PUSH_CHANNELS[channel], payload);
  },
});

// M1 切片：这六个通道接真；其余 invoke 通道 M2+ 逐个接线（channels 表已钉死清单）
const wired: Partial<Record<InvokeChannel, (...args: unknown[]) => unknown>> = {
  run: (req) => host.run(req as never),
  decide: (askId, approved, scope) => host.decide(askId as string, approved as boolean, scope as never),
  cancel: () => host.cancel(),
  listSessions: () => host.listSessions(),
  createSession: (name) => host.createSession(name as string | undefined),
  openSession: (id) => host.openSession(id as string),
};
for (const [key, channel] of Object.entries(INVOKE_CHANNELS) as [InvokeChannel, string][]) {
  const handler = wired[key];
  if (handler) ipcMain.handle(channel, (_e, ...args: unknown[]) => handler(...args));
}
void webContents; // 显式留痕：推送经 BrowserWindow.getAllWindows()
```

注意：`BrowserWindow` 已在文件顶部 import；`wired` 键名与 `KernelHost` 方法一一对应。

- [ ] **Step 2: 编译并冒烟**

```bash
pnpm --filter m0-desktop build
cd apps/desktop && pnpm exec electron .
```

Expected: 窗口出现（Codex 基因浅色壳）；在 composer 输入任意文本回车：侧栏出现新会话、事件流逐步出 user/assistant/tool 行、状态条在思考中/执行工具间切换；无控制台红错。**审批卡路径**：把工作区切到一个会触发写工具的任务（如"在 /tmp/m0-smoke 目录创建一个文件"），出现审批卡点"允许"继续——demo 剧本若无写工具则本步记"待真模型轮验证"，不算失败。

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/main/index.ts
git commit -m "桌面端 M1-6：Electron main 接 kernel-host 薄映射——六通道接线（run/decide/cancel/sessions 三件）、outbox 经 webContents 广播三推送通道、工作区根 M0_DESKTOP_WORKSPACE 可覆盖；真窗口冒烟通过"
```

---

### Task 7: 纪律门（单向依赖扫描 + AGENTS.md 改写）

**Files:**
- Create: `scripts/desktop-boundary-check.ts`（新文件，不碰其他会话手上的 docs-check.ts）
- Modify: `AGENTS.md`
- Modify: `apps/desktop/package.json`（test 脚本串接边界检查）

**Interfaces:**
- Produces: `node --import tsx scripts/desktop-boundary-check.ts` 退出码 0/1；`AGENTS.md` 分层规则文本。

- [ ] **Step 1: 写失败场景（先证扫描器能抓反向依赖）**

在 `src/` 临时放一个反向 import（`echo 'import "../../apps/desktop/src/main/channels";' > src/__boundary_probe__.ts`），跑扫描器（下一步创建）应红，删探针后应绿。这个"先红后绿"进验收记录。

- [ ] **Step 2: 写 desktop-boundary-check.ts**

```ts
// 桌面端单向依赖纪律（spec §8）：apps/desktop → src 允许；src → apps/desktop 即红。
// src 内 UI/Electron import 本就违反 core-only 纪律，一并扫（AGENTS.md 双向条款的机器面）。
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const violations: string[] = [];

function walk(dir: string, visit: (file: string) => void): void {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) { if (name !== "node_modules" && name !== "dist" && name !== "dist-electron") walk(p, visit); }
    else if (/\.(ts|tsx|mts)$/.test(name)) visit(p);
  }
}

walk(join(ROOT, "src"), (file) => {
  const text = readFileSync(file, "utf8");
  if (/(from\s+["']|import\s+["']).*(apps\/desktop|electron)["']/.test(text)) {
    violations.push(`${relative(ROOT, file)}: src 不得 import apps/desktop 或 electron`);
  }
});

if (violations.length > 0) {
  console.error("desktop-boundary-check 红线：\n" + violations.join("\n"));
  process.exit(1);
}
console.log("desktop-boundary-check: 绿（src 无反向依赖、无 UI import）");
```

- [ ] **Step 3: 跑先红后绿**

```bash
echo 'import "../../apps/desktop/src/main/channels";' > src/__boundary_probe__.ts
node --import tsx scripts/desktop-boundary-check.ts; echo "exit=$?"
rm src/__boundary_probe__.ts
node --import tsx scripts/desktop-boundary-check.ts
```

Expected: 第一次 exit=1（抓到探针），第二次绿。

- [ ] **Step 4: AGENTS.md 改写（保留其余条款原样）**

把"## Working rules"中"Do not reintroduce Electron…"一条替换为：

```markdown
- Desktop layer lives in `apps/desktop/` only. It may import from `src/` (typed via
  `src/main/ipc-protocol.ts`); `src/` must never import from `apps/desktop/`, Electron, or any UI
  module. `scripts/desktop-boundary-check.ts` enforces this.
- Run desktop tests with `pnpm --filter m0-desktop test` (own vitest config); root gates never
  scan `apps/`.
```

- [ ] **Step 5: 串接与全量验证**

`apps/desktop/package.json` test 脚本改为 `"test": "vitest run --config vitest.config.ts && node --import tsx ../../scripts/desktop-boundary-check.ts"`，然后：

```bash
pnpm --filter m0-desktop test
pnpm typecheck && node node_modules/vitest/vitest.mjs run --config tests/vitest.config.ts
```

Expected: 桌面测试+边界检查绿；根 typecheck/test 依旧绿（根 vitest 不扫 apps/——include 只含 tests/**，若意外扫到，修根 config 的 include 明确排除而非缩小）。

- [ ] **Step 6: Commit**

```bash
git add scripts/desktop-boundary-check.ts AGENTS.md apps/desktop/package.json
git commit -m "桌面端 M1-7：单向依赖纪律机器面——desktop-boundary-check（src→apps/desktop 或 electron 即红，先红后绿验证）＋AGENTS.md core-only 条款改写为分层规则（桌面端只能经 apps/desktop 引入）；根门范围声明（root vitest 不扫 apps/）"
```

---

## Self-Review（已执行）

1. **Spec 覆盖**：§3.1 目录/依赖单向→Task 1/7；§3.2 kernel-host 缝→Task 3；§3.3 桥面红线→Task 2/4；§4.1 会话根同 CLI→Task 3（`initSessionsDir(join(workspace, ".agent", "sessions"))`）；§5 审批卡最小可用→Task 5/6；§6.2/6.3 静态切片（分组侧栏/状态点/审批卡/composer/思考态文案）→Task 5；§11 M1 验收锚（AgentApi 全表 typecheck 红=Task 2 红线；handleAgentRun 直调判卷绿=Task 3）→全覆盖。§6.3 动效/时间戳/模型选择、多工作区注册表属 M2/M3，不在本计划（里程碑边界与 spec §11 一致）。
2. **占位扫描**：Task 3/5 有两处"以实际出口/事件名为准"的勘误窗口——均配了具体勘误手段（grep 导出块、typecheck 强制、`AGENT_EVENT_TYPES` 联合），非 TBD；无其他占位。
3. **类型一致**：`KernelHost.run/decide/cancel/listSessions/createSession/openSession` 在 Task 3 定义、Task 6 `wired` 一一对应；`StreamRow`/`RunPhase` 在 Task 5 定义并即所用；`InvokeChannel`/`PushChannel` Task 2 定义、Task 4/6 复用同型。
