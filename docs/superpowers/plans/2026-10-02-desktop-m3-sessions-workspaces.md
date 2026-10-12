# Cairn 桌面端 M3：会话库与多工作区 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 单窗多工作区驾驶舱落地：侧栏按工作区分组的会话列表与切换、跨工作区并发 run（零 core 改动，走 `RunOverrides.logPath/workspace`）、每会话取消（per-session AbortController + `RunOverrides.signal`）、外部漂移检测、agent 事件过滤，终验收锚"CLI 建会话桌面可见；并行两会话互不串流"。

**Architecture:** 全部活在 `apps/desktop/`：kernel-host 升级为多工作区运行面（会话→工作区归属表、per-session AbortController、漂移快照），renderer 消费分组侧栏与真值已停态。**core 零改动**（M3 全程白名单外无增量——M2 终审的"取消缝"经 `RunOverrides.signal/logPath/workspace` 三个既有参数化解）。唯一实测裁决点：kernel-host 自备 signal 是否打断 AskGate 门等待（Task 2 勘误窗口，附降级语义）。

**Tech Stack:** 同 M1/M2。

**Spec:** `docs/superpowers/specs/2026-10-02-desktop-shell-design.md`（§6.2 方案 A 布局、§4.1/4.2 会话库与漂移、§11 M3 行）＋M2 终审承接清单（取消缝/agent_id 过滤/onOpen 竞态/失败反馈/smoke timeout）。

## Global Constraints

- **core 零改动**：`git diff -- src/` 在本计划全程必须为空（M2 终审实查口径）；发现"必须动 core 才能编译/判卷"⇒ BLOCKED 报告，不得自行改。
- 取消语义裁定（M2 终审 Important 2 的 M3 落地）：`cancel(sessionId)` 会话级；`aborted` 以 kernel-host 响应增强字段 `aborted?: boolean`（desktop 层扩展，不动 ipc-protocol 类型）为真值传 renderer；"■ 已停止"改由真值驱动（stoppedIds 本地态保留为即时反馈，二者并存）。
- 漂移检测语义：kernel-host 对每个已打开会话记 `{size, mtimeMs}` 快照（openSession 与本端 run 收束时刷新）；run 启动前重读 stat，与快照不一致 ⇒ 拒绝该次 run（`{ok:false, error:"会话已被外部修改（CLI？），请刷新后重试"}`），不静默覆盖。
- 冻结判卷文件与夹具不碰；根门形状以当次实测为准（M2 末基线 4063+，并行会话持续漂移，如实记录）；并行会话脏文件不碰不 add（scripts/docs-check.ts、scripts/head-cert*、scripts/mutate-verify.mjs、outputs/、.vitest/ 及其后续新增）。
- 桌面测试 `pnpm --filter cairn-desktop test`；冒烟 `pnpm --filter cairn-desktop smoke`；**smoke.mjs 本任务链补 `spawnSync(…, { timeout: 45000 })`**（M2 终审 triage 项）。
- 视觉 token 只用既有 CSS 变量；分组侧栏按 spec §6.2 方案 A（分组标题=工作区名，点击切换当前工作区）。
- 提交只 add 本任务清单内文件，提交信息中文详述。

---

### Task 1: kernel-host 多工作区运行面

**Files:**
- Modify: `apps/desktop/src/main/kernel-host.ts`（主要改动）
- Test: `apps/desktop/tests/kernel-host.test.ts`（扩展）

**Interfaces:**
- Consumes: `sessions.ts` root 注入族 `listSessions(root)`/`createSession(root, …)`/`readSessionEvents(root, id)`/`sessionExists(root, id)`（src/main/sessions.ts:179/224/255/334——**注意与 session-handlers 的全局单例 handleSessionList 区分，跨工作区一律用本族**）；`RunOverrides.logPath/workspace/signal`（src/main/agent-runner.ts:1987 一带，logPath/workspace 为第一优先，实测见计划前提）；`ProjectRegistry`（src/main/project-registry.ts:125，构造注入路径）。
- Produces（KernelHost v2，后续任务消费）:

```ts
export interface KernelHostDeps {
  workspaces: string[];            // 全部已注册工作区（绝对路径）
  activeWorkspace: string;         // 当前工作区（新会话归属）
  userDataDir: string;
  outbox: (channel: "onEvent" | "onAsk" | "onAskDone", payload: unknown) => void;
}
export interface KernelHost {
  run(req: RunRequest & { workspace?: string }): Promise<RunResponse & { aborted?: boolean }>;
  decide(askId: string, approved: boolean, scope?: "once" | "session_kind" | "always"): boolean;
  cancel(sessionId: string): Promise<{ ok: boolean; error?: string }>;   // 会话级（替代无参 cancel）
  listSessions(): Promise<SessionInfoPayload[] & { workspace: string }[]>; // 全工作区合并，按 workspace 归组
  createSession(workspace?: string): Promise<{ id: string }>;            // 缺省 activeWorkspace
  openSession(id: string, workspace?: string): Promise<{ events: AgentEvent[] }>;
}
```

- 会话→工作区归属：kernel-host 内维护 `Map<sessionId, workspace>`（createSession/openSession 时登记；run 时由此取工作区，缺省 activeWorkspace）。
- run 注入：`handleAgentRun(req, { sessionId, logPath: pathOf(wsRoot(ws), sessionId), workspace: ws, signal: controller.signal })`——per-session `AbortController` 在 run 启动时建、收束时清（Map 清理）。
- 漂移检测：`Map<sessionId, {size, mtimeMs}>` 快照（openSession 与 run 收束时刷新为当时 stat）；run 启动前 stat 对比，不一致 ⇒ 拒绝（Global Constraints 文案），**快照比对只对 sessionMode 生效**。

- [ ] **Step 1: 写失败测试**（kernel-host.test.ts 扩展；沿用既有装配手法，M3A_AGENTS_DEMO 通道）

```ts
it("多工作区：A/B 两工作区各建会话，run 各落各的根，listSessions 带 workspace 归组", async () => {
  const host = createKernelHost({ workspaces: [wsA, wsB], activeWorkspace: wsA, userDataDir, outbox });
  const a = await host.createSession(wsA);
  const b = await host.createSession(wsB);
  await host.run({ message: "demo", mode: "default", sessionId: a.id });
  await host.run({ message: "demo", mode: "default", sessionId: b.id });
  expect(existsSync(join(wsA, ".agent", "sessions", `${a.id}.jsonl`))).toBe(true);
  expect(existsSync(join(wsB, ".agent", "sessions", `${b.id}.jsonl`))).toBe(true);
  const all = await host.listSessions();
  expect(all.find((s) => s.id === a.id)!.workspace).toBe(wsA);
  expect(all.find((s) => s.id === b.id)!.workspace).toBe(wsB);
}, 60_000);

it("漂移检测：会话文件被外部追加后，下一次 run 被拒且报外部修改", async () => {
  const host = createKernelHost({ workspaces: [wsA], activeWorkspace: wsA, userDataDir, outbox });
  const s = await host.createSession(wsA);
  await host.run({ message: "demo", mode: "default", sessionId: s.id });
  appendFileSync(pathOf(join(wsA, ".agent", "sessions"), s.id), JSON.stringify({ type: "user_message", content: "CLI 插的" }) + "\n");
  const res = await host.run({ message: "demo", mode: "default", sessionId: s.id });
  expect(res.ok).toBe(false);
  expect(res.error).toMatch(/外部修改/);
}, 60_000);
```

- [ ] **Step 2: 跑红** → **Step 3: 实现**（KernelHost v2 签名＋归属表＋注入＋漂移；`index.ts` 的接线同步改——`createKernelHost({ workspaces: [workspace], activeWorkspace: workspace, … })`，CAIRN_SMOKE 分支同改）→ **Step 4: 跑绿**（全量 desktop test 含 M1/M2 存量——**M2 存量测试的 host 装配调用式须按新签名更新**，属授权内断言面更新）
- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/kernel-host.ts apps/desktop/src/main/index.ts apps/desktop/tests/kernel-host.test.ts
git commit -m "桌面端 M3-1：kernel-host 多工作区运行面——RunOverrides.logPath/workspace/signal 三参注入（零 core 改动）、会话→工作区归属表、跨工作区列举/建会话走 sessions.ts root 注入族、漂移检测快照（外部改动拒绝 run 不静默覆盖）；M2 终审取消缝的运行面就位"
```

---

### Task 2: 每会话取消＋aborted 真值（含门等待勘误裁决）

**Files:**
- Modify: `apps/desktop/src/main/kernel-host.ts`
- Test: `apps/desktop/tests/approval-e2e.test.ts`（扩展）

**Interfaces:**
- Produces: `cancel(sessionId)` 只 abort 该会话的 controller；run 返回增强字段 `aborted: true` 当且仅当该会话 controller 被 abort（kernel-host 包装 `handleAgentRun` 返回值时判定 `controller.signal.aborted`）。
- **勘误窗口（本任务核心实测裁决，报告必须落结论）**：kernel-host 自备 signal 路径下，"门等待中取消"是否即时收束——勘 `AskGate` 的 abort 监听挂点（src/main/ask-gate.ts:85-90 一带）与 `agent-runner.ts:1583-1585` 一带 interactiveRunAbort 的装配关系：
  - 若 AskGate 监听的是**传入的 opts.signal**（或等价透传）⇒ signal 路径全语义（轮界+门等待+长驻工具）；
  - 若只挂 interactiveRunAbort ⇒ signal 路径取消仅轮界收束，门等待要等工具/审批返回——**降级语义如实记录**（审批等待中的取消延迟收束），不为此动 core；测试按实测语义写。

- [ ] **Step 1: 写失败测试**（approval-e2e.test.ts 扩展；夹具复用 main-approval-demo.jsonl）

```ts
it("每会话取消：取消 A 不影响 B；A 返回 aborted:true 且 onAskDone fail-closed", async () => {
  // host({workspaces:[wsA, wsB]})；A 跑 approval 夹具（M3A_MAIN_SCRIPT），B 跑 demo（M3A_AGENTS_DEMO）
  // A 的 ask 到达 → host.cancel(a.id) → await runA ⇒ aborted===true；runB 照常 ok:true
  // outbox 有 A 的 onAskDone（reason ∈ user|timeout|unattended）；B 事件不受影响
}, 60_000);
```

- [ ] **Step 2: 跑红 → Step 3: 实现**（controller map + 包装返回增强；cancel 签名改会话级）→ **Step 4: 跑绿**（M2 的 cancel 用例改按新签名——授权内更新）
- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/kernel-host.ts apps/desktop/tests/approval-e2e.test.ts
git commit -m "桌面端 M3-2：每会话取消——per-session AbortController 经 RunOverrides.signal 透传（零 core 改动）、cancel(sessionId) 会话级、run 响应 aborted 真值增强（desktop 扩展字段）；门等待打断语义按 AskGate 监听面实测裁决（报告落结论）"
```

---

### Task 3: 分组侧栏与工作区切换（方案 A）＋onOpen 竞态守卫

**Files:**
- Modify: `apps/desktop/src/renderer/App.tsx`、`components/Sidebar.tsx`、`styles.css`
- Test: `apps/desktop/tests/sidebar-groups.test.ts`（新，纯函数）

**Interfaces:**
- Consumes: Task 1 的 `listSessions()`（带 workspace）、`createSession(workspace?)`；通道表 `listProjects/addProject/removeProject`（M1 已桥，本任务接 UI）。
- Produces:
  - `groupByWorkspace(sessions, workspaces): { workspace: string; sessions: SessionInfoPayload[] }[]`——纯函数：已注册工作区全列（空组也列），会话按归属落组；**未登记工作区的会话不丢**，归入"其他"组垫底（防 listProjects 与盘上漂移时静默吞数据）。
  - 侧栏渲染：分组标题=工作区名（取路径末段），点击=切换 activeWorkspace（新任务归属；不重启任何在跑会话）；"＋ 添加工作区"入口调 addProject（文件夹选择经 renderer 的 `window.electronAPI`? **无此桥——用 `<input type="file" webkitdirectory>` 不行于 Electron 主进程选目录；裁定：M3 用文本输入路径 + addProject 的最小表单**（Electron dialog 选目录需 preload 加桥——留 M4，本任务文本输入落地，报告记明）。
  - onOpen 竞态守卫（M1 T3 deferred）：openSession 前 snapshot 一个递增 seq，回调时 `seq !== latestSeq.current` 则丢弃（防快速切换错流）。

- [ ] **Step 1: 写失败测试**（groupByWorkspace：正常分组/空组也列/未登记会话垫"其他"）
- [ ] **Step 2: 跑红 → Step 3: 实现（分组侧栏＋切换＋addProject 最小表单＋竞态守卫）→ Step 4: 三绿**（test/typecheck/build）
- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/App.tsx apps/desktop/src/renderer/components/Sidebar.tsx apps/desktop/src/renderer/styles.css apps/desktop/tests/sidebar-groups.test.ts
git commit -m "桌面端 M3-3：分组侧栏（方案 A）——groupByWorkspace 纯函数（空组也列、未登记垫'其他'不吞数据）、点击分组切 activeWorkspace（不扰在跑会话）、添加工作区最小表单（addProject 桥首接；dialog 选目录留 M4）、onOpen 竞态 seq 守卫（M1 T3 deferred 收口）"
```

---

### Task 4: agent 事件过滤＋失败反馈统一错误面

**Files:**
- Modify: `apps/desktop/src/renderer/projections.ts`、`components/Composer.tsx`、`App.tsx`
- Test: `apps/desktop/tests/projections.test.ts`（扩展）

**Interfaces:**
- Produces:
  - 投影过滤裁定：带 `agent_id` 的事件（worker 子流的 tool_call/tool_result/agent_message/agent_status/agent_result）**不进主流行、不进相位判据**；`agent_spawned`（无 agent_id，父流事实）保留为 tool 类行（summary=task 截断）。主线只讲父会话的事——M3 不做 worker 子视图（账本留 M4+）。
  - 失败反馈（M2 T5 deferred）：`send()` 的 run 返回 `!ok` 时，在会话条下方显示一条可关闭的错误条（`.error-strip`，红用既有 --risk 色阶变量或文字色 --text-1 加边框 var(--risk)）；clarify/plan 提交失败（Promise reject 或返回 false）同面提示。错误条组件 `ErrorStrip.tsx`（新，App 持有 `lastError` state，点 × 清除）。
- [ ] **Step 1: 写失败测试**（agent_id 过滤：主流无 worker tool 行、phase 不被 worker result 收口；agent_spawned 保留）
- [ ] **Step 2: 跑红 → Step 3: 实现 → Step 4: 三绿**
- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/projections.ts apps/desktop/src/renderer/components/Composer.tsx apps/desktop/src/renderer/components/ErrorStrip.tsx apps/desktop/src/renderer/App.tsx apps/desktop/src/renderer/styles.css apps/desktop/tests/projections.test.ts
git commit -m "桌面端 M3-4：agent 子流过滤（带 agent_id 事件不进主流/相位，agent_spawned 保留为父流行）＋失败反馈统一错误条（run !ok 与 clarify/plan 提交失败同面提示，可关闭）——M2 两笔 deferred 收口"
```

---

### Task 5: 已停态真值驱动＋打断按钮接线（取消缝收口）

**Files:**
- Modify: `apps/desktop/src/renderer/App.tsx`
- Test: `apps/desktop/tests/projections.test.ts` 不动（无投影改动）；验收走 Task 6 e2e + typecheck/build

**Interfaces:**
- Consumes: Task 2 的 run 响应 `aborted?: boolean`；`cancel(sessionId)` 会话级。
- Produces: `send()` 收束后 `if (res.aborted) setStoppedIds(add(activeId))`——"■ 已停止"改由**真值**驱动（M2 的本地置态降级为即时反馈：点击打断时立即置，run 收束后以响应真值校正）；打断按钮 onClick 改 `void window.agent.runCancel()` → 走 host 会话级（**通道名不变 runCancel，参数加 sessionId**——preload 程序化桥自动透传，kernel-host cancel 签名已改；ipc-protocol 的 `runCancel(): Promise<{ok, error?}>` 类型不含参——**裁定：ipc-protocol 类型补 `runCancel(sessionId?: string)` 可选参，属桥面类型同步，非 core 行为改动**（ipc-protocol.ts 是类型契约文件，desktop 消费方，M1 红线机制覆盖它；改动一行加可选参，core runner 不受影响——预检裁定，ledger 记录）。
- [ ] **Step 1: 实现（App 接线＋ipc-protocol runCancel 可选参一行）→ Step 2: 三绿** → **Step 3: Commit**

```bash
git add apps/desktop/src/renderer/App.tsx src/main/ipc-protocol.ts
git commit -m "桌面端 M3-5：已停态真值驱动——run 响应 aborted 置 stoppedIds（本地点击降级为即时反馈）、打断按钮走会话级 cancel(sessionId)；ipc-protocol runCancel 补可选 sessionId（桥面类型同步，core 零行为改动）"
```

---

### Task 6: M3 验收锚 e2e（CLI 可见性＋并行不串流）

**Files:**
- Test: `apps/desktop/tests/m3-e2e.test.ts`（新）

**Interfaces:**
- Produces: spec §11 M3 两条验收锚的机器证明：
  1. **CLI 建会话桌面可见**：直接以 fs 向 wsA 的 `.agent/sessions/` 写一个 `<id>.jsonl`（模拟 CLI 产物）→ `host.listSessions()` 含它且 workspace=wsA → `openSession` 可读。
  2. **并行两会话互不串流**：A、B 两会话同 host 并发 `run`（Promise.all，各 M3A_AGENTS_DEMO）→ 各自 JSONL 只含各自事件（行数>0 且互不含对方 sessionId 载荷——以 `session_id` 载荷字段断言每行归属）→ outbox 按 session_id 分桶后 A/B 集合不相交。
- [ ] **Step 1: 写测试 → Step 2: 跑红/绿**（若并发 run 撞 AskGate 全局串行导致一先一后——如实记录，锚仍成立（不串流≠必须真并发），报告注明）→ **Step 3: 全量 desktop test 绿**
- [ ] **Step 4: Commit**

```bash
git add apps/desktop/tests/m3-e2e.test.ts
git commit -m "桌面端 M3-6：验收锚 e2e——CLI 产物会话桌面可见可读；并行两会话分桶互不串流（session_id 载荷逐行归属断言）"
```

---

### Task 7: smoke 补超时＋M3 全量验收

**Files:**
- Modify: `apps/desktop/scripts/smoke.mjs`

**Interfaces:**
- Produces: `spawnSync(…, { timeout: 45000, … })`（M2 终审 triage 项收口；超时 ⇒ exit 1 带诊断）。
- [ ] **Step 1: 补 timeout → Step 2: 全量验收**（`pnpm --filter cairn-desktop test`、`pnpm --filter cairn-desktop smoke`、`pnpm typecheck`、`pnpm gates`（红项按并行会话归因如实记录）、根 vitest 形状）→ **Step 3: Commit**

```bash
git add apps/desktop/scripts/smoke.mjs
git commit -m "桌面端 M3-7：smoke spawnSync 补 45s 超时（load 前挂死不再无限阻塞）；M3 全量验收（test/smoke/gates/typecheck/根门形状）实测落数"
```

---

## Self-Review（已执行）

1. **Spec 覆盖**：§11 M3 四要素——sessionsRoot 同根（M1 已落，本计划 T1 的多工作区根解析是其推广）；工作区注册表→T3；并行多会话状态点→T1/T3/T6（runningSet 跨组呼吸已由 M1 集合承担，T3 分组渲染承接）；漂移检测→T1。M2 终审承接：取消缝→T2/T5；agent_id 过滤→T4；失败反馈→T4；onOpen 竞态→T3；smoke timeout→T7；aborted 位→T2/T5（desktop 扩展字段路线，core RunResponse 加位留 M4 BYOK 时随桥面一并评估——**这是对终审"两者都做"的修正裁定**：desktop 层 aborted 真值已满足"位为真值"的实质，core 类型加位推迟到有第三个消费方时）。
2. **占位扫描**：T2 门等待勘误窗口与 T3 工作区添加的 dialog 留 M4，均配了具体手段与如实记录要求；无 TBD。
3. **类型一致**：KernelHost v2 签名（cancel(sessionId)/listSessions 带 workspace/run 增强返回）在 T1 定义、T2/T5 消费同型；groupByWorkspace 在 T3 定义即用；agent_id 过滤语义 T4 单点定义。
4. **预检裁定（ledger 已记）**：ipc-protocol.ts 的 `runCancel` 补可选参属桥面类型同步（ipc-protocol 是 desktop 消费的类型契约，非 core 行为面），不违反"core 零改动"——git diff src/ 会出现 ipc-protocol.ts 一行，Global Constraints 的 core 零改动口径**修正为**"src/ 仅允许 ipc-protocol.ts 的桥面类型同步行"。
