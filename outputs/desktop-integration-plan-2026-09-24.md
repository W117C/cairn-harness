# DSH × OpenCode Desktop 完整实施计划

- 日期：2026-09-24
- 状态：**待用户批准，尚未开始实现**
- 关联决策：[`desktop-integration-adr-2026-09-24.md`](desktop-integration-adr-2026-09-24.md)
- 目标平台：第一阶段以当前 macOS 开发环境为验收平台，架构保持跨平台
- 默认范围：保留 DSH core，采用 OpenCode-inspired UI；不把 OpenCode server 接入为隐式后端

---

## 0. 执行原则

1. **先计划、后代码。** 本计划获批前不修改 `src/`、不新增桌面实现、不引入 Electron 依赖。
2. **core 保持 headless。** `src/` 不允许 Electron、renderer、preload 或桌面构建依赖。
3. **不覆盖现有脏改动。** 当前工作区存在大量其他会话的修改；不 reset、不 stash、不清理、不恢复无关文件。
4. **不修改 frozen judge/fixtures。** 现有测试夹具只读使用。
5. **真实链路优先。** 不用静态演示数据伪造成功状态；MVP 的 run/event/approval/cancel 必须连接真实 DSH host。
6. **上游可追踪。** OpenCode 源码固定 commit，保留许可证和来源说明，不直接跟随 `dev`。
7. **接口先行。** 先冻结 DSH host、Bridge、事件 envelope 和 IPC 白名单，再写 UI。

---

## 1. 目标与完成定义

### 1.1 产品目标

提供一个独立桌面应用，吸收 OpenCode 桌面端的布局、主题、快捷键和主要交互，同时让所有 agent 行为继续由 DSH core 负责。

### 1.2 第一阶段必须完成

- Electron 应用可以独立启动、关闭和打包。
- Renderer 只能通过 preload 暴露的白名单 API 访问 DSH。
- 能读取真实项目/会话列表。
- 能创建、打开和重命名会话。
- 能提交真实 prompt，并实时显示 DSH `AgentEvent`。
- 能显示并处理审批、澄清和计划确认。
- 能取消正在运行的 turn。
- 重启后能从 DSH JSONL 恢复会话快照。
- 断线/刷新不会重复显示同一条事件。
- DSH core typecheck、Vitest 和安全门保持通过。
- macOS 开发构建可运行；不发布正式安装包。

### 1.3 第一阶段明确不做

- OpenCode 全部页面和功能 1:1 复刻。
- OpenCode 远程 server、账号、云端分享、WSL、多 server 管理。
- 把 DSH 会话迁移成 OpenCode 格式。
- 修改现有 DSH 事件联合类型或冻结判卷文件。
- 引入完整 OpenCode app/desktop 源码到 core。
- 正式签名、公证、自动更新和跨平台发布。

---

## 2. 当前基线与事实

### DSH core

- `src/agent/`：运行循环、编排、恢复、验证、压缩、记忆和多 agent 逻辑。
- `src/events/index.ts`：append-only JSONL 与 `AgentEvent`。
- `src/main/ipc-protocol.ts`：现有 `AgentApi`、run、session、审批、设置和状态协议。
- `src/main/agent-runner.ts`：真实运行入口，包含 provider、sandbox、权限和事件装配。
- `src/main/` 当前被设计为 Electron-free 的应用服务层，可被桌面 host 复用。

### OpenCode 上游

- 核对 commit：`0f549842ee746e400b1f72516b0b2e292e267e2c`。
- 核对版本：`1.18.32`。
- License：MIT。
- `packages/desktop`：Electron 私有 workspace 包。
- `packages/app` / `packages/session-ui`：深度依赖 OpenCode SDK、client、server 和事件协议。
- `@opencode-ai/ui`：npm 可解析，但需锁定版本并验证依赖闭包。
- 原样复制 UI 会默认寻找 OpenCode sidecar，不会使用 DSH core。

---

## 3. 目标架构

```text
┌─────────────────────────────────────────────┐
│ desktop/                                    │
│                                             │
│  Electron main                              │
│   ├─ BrowserWindow 生命周期                  │
│   ├─ DshHost 初始化/关闭                     │
│   ├─ 白名单 IPC                              │
│   └─ 日志/错误/窗口状态                       │
│                                             │
│  preload                                    │
│   └─ contextBridge → window.dsh              │
│                                             │
│  renderer                                   │
│   ├─ OpenCode-inspired shell                 │
│   ├─ session/project navigation              │
│   ├─ timeline / prompt / approval cards      │
│   └─ DshBridge client                        │
└──────────────────────┬──────────────────────┘
                       │ typed IPC / event envelope
                       ▼
┌─────────────────────────────────────────────┐
│ DSH Bridge                                  │
│  ├─ AgentApi 子集                            │
│  ├─ runtime payload validation               │
│  ├─ event replay/live reconciliation         │
│  └─ approval/clarify/plan/cancel routing    │
└──────────────────────┬──────────────────────┘
                       ▼
┌─────────────────────────────────────────────┐
│ DSH core                                    │
│  agent loop / permissions / tools / events   │
│  sessions / providers / worktree / memory    │
└─────────────────────────────────────────────┘
```

### 依赖方向

```text
renderer → preload → main/bridge → src/core
```

禁止：

```text
src/core → Electron
src/core → renderer/preload
renderer → Node/Electron/IPC 任意 channel
```

---

## 4. Bridge 合同

### 4.1 对外 Bridge API

不把庞大的 `AgentApi` 整体直接暴露给 renderer。`AgentApi` 仍是 DSH 内部实现合同；Bridge 对外提供一个更窄、更稳定的桌面合同：

```ts
interface DshDesktopBridge {
  capabilities(): Promise<{
    protocolVersion: 1
    durableCursor: true
    parallelInteractiveRuns: false
  }>

  listSessions(): Promise<SessionSummary[]>
  createSession(name?: string): Promise<{ id: string }>
  openSession(id: string): Promise<SessionProjection>

  /**
   * 先补发 JSONL 中 afterSeq 之后的事件，再切换到 live。
   * 返回 unsubscribe；重复订阅不得产生重复 UI 事件。
   */
  subscribe(
    sessionId: string,
    afterSeq: number,
    listener: (notification: BridgeNotification) => void,
  ): () => void

  /** 快速返回 runId；handleAgentRun 在后台完成。 */
  startRun(input: RunRequest): Promise<{ runId: string }>
  cancelRun(input: { runId: string }): Promise<{ ok: boolean; error?: string }>

  decidePermission(input: {
    askId: string
    approved: boolean
    scope?: "once" | "session_kind" | "always"
  }): Promise<{ ok: boolean }>
  submitClarify(input: {
    callId: string
    answers: Record<string, string | string[]>
  }): Promise<{ ok: boolean }>
  decidePlan(input: {
    callId: string
    approved: boolean
  }): Promise<{ ok: boolean }>
}
```

Bridge 可以在内部调用现有 `AgentApi`，但不得把 settings、provider key、scheduler、sidechat、memory 等无关职责一并暴露。`startRun` 不能等待整个 turn 结束；`handleAgentRun` 的 promise 只用于更新 run 状态和错误。

### 4.2 Durable 事件 envelope

不改 `AgentEvent` 联合类型，在 Bridge 边界增加可序列化 envelope：

```ts
interface AgentEnvelope {
  eventId: string       // dsh:<sessionId>:<seq>
  sessionId: string
  seq: number           // JSONL 1-based 行号，单调递增
  ts: number
  runId?: string
  source: "replay" | "live"
  event: AgentEvent
}
```

事件事实源是 DSH JSONL，不是内存 hook：

- hook 只作为新事件唤醒信号。
- `seq` 来自 JSONL 行号；不能用进程内回调计数冒充 durable cursor。
- `eventId`、`seq`、message ID、tool part ID 和 run ID 是不同命名空间。
- `subscribe(sessionId, afterSeq, ...)` 必须先补发持久事件，再接入 live。
- renderer 以 `(sessionId, seq)` 去重；缺口时重新拉取 projection。
- assistant delta 可以在 projection 层合并，但不能丢失 tool/approval 事件。
- 第一条 assistant delta 必须先建立 message/part，再产生增量；最终 `assistant_message` 只能校准同一正文，不能追加第二份。

### 4.3 审批与交互

- `onAsk` 只传递 UI 所需字段，不把 provider key、内部 prompt 或未脱敏秘密送出。
- 当前 DSH AskPayload 没有 session ID，因此 MVP 将审批绑定到唯一的活动 run/session。
- `decidePermission` 的 scope 仅允许 `once`、`session_kind`、`always`。
- clarify 答案按当前 `ClarifyAnswers` 合同校验。
- plan decision 必须带当前 call/session 归属，防止跨会话误操作。
- 所有 fail-closed 行为保留 DSH 原有语义，Bridge 不自动批准。
- MVP 明确限制为一个 Electron 进程、一个主窗口、一个 host、一个活动交互 run；多窗口并行 run 另行设计。

### 4.4 Session projection

Bridge 输出 DSH-native projection，而不是伪装成完整 OpenCode protocol：

- `session` 保存 id、title、status 和 durable cursor。
- `messages` 至少包含稳定 message ID、role、parentID、时间和完成状态。
- `parts` 按 message ID 保存 text/tool/plan/clarify/verification 等 UI part。
- `usage`、error、truncation 和 DSH 扩展报告作为 projection 字段或自定义 part。
- `assistant_delta` 与最终 assistant message 合并为同一 text part。
- 首版隐藏未实现的完整 snapshot diff、revert、fork 和 worker merge UI，不用空数据冒充成功。

OpenCode 兼容 gateway 只能作为后续边缘适配器，不能成为 DSH core 的第二事实源。


---

## 5. 文件变更计划

### 5.1 新增 core-safe 文件

| 路径 | 责任 | 阶段 |
|---|---|---:|
| `src/main/dsh-host.ts` | DSH 服务生命周期与 host façade | 1 |
| `src/main/runtime-paths.ts` | core root/fixture/验证路径 seam，避免依赖 bundle 所在目录 | 1 |
| `src/main/bridge-protocol.ts` | 对外 Bridge 类型、durable envelope、projection、错误类型 | 1 |
| `src/main/bridge-validation.ts` | IPC payload 和 cursor 运行时校验 | 1 |
| `tests/dsh-host.test.ts` | host 初始化、释放、并发边界 | 1 |
| `tests/bridge-protocol.test.ts` | 合同、cursor、projection 和事件序列测试 | 1 |

`dsh-host.ts` 只组合现有服务，不把 Electron API 带入 core。

### 5.2 新增 desktop 文件

```text
desktop/
  package.json
  tsconfig.json
  electron.vite.config.ts
  README.md
  UPSTREAM.md
  LICENSE
  src/
    main/
      index.ts
      dsh-host-runtime.ts
      ipc.ts
      window.ts
    preload/
      index.ts
      types.ts
    bridge/
      client.ts
      event-reducer.ts
      session-projection.ts
      durable-event-reader.ts
    renderer/
      index.html
      main.tsx
      app.tsx
      state.ts
      components/
        sidebar.tsx
        session-view.tsx
        prompt-composer.tsx
        approval-card.tsx
        event-timeline.tsx
      styles.css
  test/
    ipc-allowlist.test.ts
    event-reducer.test.ts
    renderer-smoke.test.ts
```

第一阶段不复制完整上游 `packages/app` 或 `packages/session-ui`。

### 5.3 允许修改的现有文件

| 文件/区域 | 允许变更 | 禁止变更 |
|---|---|---|
| `src/main/ipc-protocol.ts` | 仅增加可复用共享类型或导出 | 不改变既有 `AgentApi` 运行时语义 |
| `src/main/agent-runner.ts` | 只有 host 接入确有必要时做最小抽取 | 不重写 run loop、权限和 provider |
| `src/main/session-handlers.ts` | 只有初始化依赖需要显式注入时修改 | 不改变 session JSONL 格式 |
| 根 `package.json` | 最后集成阶段再增加 desktop script/workspace | 不在 Phase 1 盲目改动 |
| `AGENTS.md` | 仅在计划批准且确实需要更新 scope 文档时修改 | 不删除 core-only 约束 |

---

## 6. 分阶段执行计划

## Phase 0：基线、隔离和批准

### 任务

1. 记录当前 `git status`，确认不触碰已有脏文件。
2. 记录当前 core typecheck、Vitest 和安全门结果。
3. 创建实现用独立 worktree 或等价隔离目录；不得 reset/stash 原工作区。
4. 固定 OpenCode commit、MIT notice 和依赖版本策略。
5. 确认第一阶段目标为 macOS 开发构建。

### 产出

- 基线检查记录。
- 独立实现工作区。
- 上游来源与许可证文件。
- 本计划批准记录。

### 闸门

- 未获计划批准，不进入 Phase 1。
- 若基线已有失败，区分既有失败和本次回归，不把既有失败伪装成通过。

---

## Phase 1：DSH host 与 Bridge 垂直切片

### 目标

不引入完整 UI，先让真实 DSH 运行可以被一个 headless host 调用并被测试。

### 任务

1. 盘点旧桌面入口中仍被 `src/main/` 依赖的初始化步骤，并确认单 host 生命周期限制。
2. 抽取 `DshHost`，提供 `init()`、`dispose()`、`getState()`、session 操作和交互入口。
3. 保持现有模块级状态兼容，不在第一阶段做大规模依赖注入重构；明确拒绝同一进程多 host/并行交互 run。
4. 引入 `runtime-paths` seam，在 bundle 位于 `desktop/out` 时仍正确解析 core root、fixtures、验证命令和 routing 状态。
5. 定义窄的对外 Bridge 合同、durable cursor 和 session projection；内部可以调用 `AgentApi`，但不能把整个 `AgentApi` 暴露给 renderer。
6. 以 JSONL 为事件事实源，实现按 `afterSeq` 的 replay → live 切换；hook 只负责唤醒。
7. `startRun` 在后台启动 `handleAgentRun` 并立即返回 runId；run 结束时由 Bridge 发送 completed/failed/cancelled 状态。
8. 复用现有 `validateRunRequestEnvelope`、附件校验、session ID 校验和权限入口。
9. 为 request、response、cursor、projection 和事件 envelope 定义运行时错误。
10. 增加单元测试：初始化、释放、重入拒绝、取消、JSONL cursor、projection 重建、事件顺序、replay/live 去重。
11. 验证 host 不导入 Electron。

### 产出

- 可在 Node 环境直接创建和关闭 DSH host。
- 真实 run/event/approval/cancel 链路。
- Bridge 合同和校验测试。
- 不依赖 UI 的集成测试 harness。

### 闸门

- `src/**` 无 Electron import。
- 既有 core 测试无新增回归。
- 不允许通过 mock 成功返回掩盖未接通的调用。

---

## Phase 2：独立 Electron 壳

### 目标

建立安全的 main/preload/renderer 边界，但暂不追求 OpenCode 全量视觉。

### 任务

1. 创建独立 `desktop/package.json` 和构建配置。
2. 固定 Electron、Electron Vite、builder 和渲染器依赖版本。
3. 创建 BrowserWindow，启用：
   - `contextIsolation: true`
   - `nodeIntegration: false`
   - `sandbox: true`
   - 明确、可打包的 CommonJS preload 路径
4. 如果 Electron/Vite 组合只能可靠输出 ESM preload，先停在构建闸门，改用 sandbox-compatible CJS preload；不得静默降级为 `sandbox: false`。
5. 在 main 注册固定 IPC channel。
6. 在 preload 通过 `contextBridge.exposeInMainWorld("dsh", api)` 暴露白名单。
7. Renderer 只依赖 `window.dsh` 的类型声明。
8. 加入启动、初始化失败、host 退出、窗口关闭和 reload 状态。
9. 加入 renderer 错误和 main 日志边界。

### 产出

- 可启动的 Electron 开发窗口。
- 最小真实数据界面。
- IPC 白名单和 preload 安全测试。

### 闸门

- DevTools 中 renderer 无 `require`、`process`、`ipcRenderer` 或任意 channel 能力。
- 断开 host 时 UI 显示错误，不显示假成功。
- 关闭应用不会遗留 DSH 运行进程或锁文件。

---

## Phase 3：DSH-native 垂直 UI

### 目标

用真实 DSH 数据完成最小可用工作流，视觉先接近 OpenCode，不先复制全部页面。

### 任务

1. 实现侧栏：项目、会话列表、搜索、归档入口。
2. 实现主区：session header、timeline、prompt composer。
3. 投影 `AgentEvent`：
   - user/assistant message
   - assistant delta
   - tool call/result
   - usage
   - plan/clarify/approval
   - error
   - multi-agent 状态（只读基础视图）
4. 实现运行状态、取消、重试/重新打开的错误态。
5. 实现 approval card 和 clarify form。
6. 接入 OpenCode 风格 token、颜色、间距、字体层级和响应式布局。
7. 刷新/重开后以 session snapshot 为事实源。
8. 对长 session 做窗口化或增量渲染，避免阻塞输入。

### 产出

- 真实可用的 DSH 桌面 MVP。
- 最小 OpenCode-inspired shell。
- session/run/approval/cancel 端到端 smoke test。

### 闸门

- 不使用 demo-only 数据作为默认状态。
- 所有卡片动作都经过 Bridge。
- reload 后不重复旧事件、不丢失新事件。
- 关键操作在窗口缩放和长文本下不溢出。

---

## Phase 4：选择性复用 OpenCode UI

### 目标

在不重新绑定 OpenCode server 的前提下，逐步替换自研 UI 组件。

### 任务

1. 建立隔离依赖实验，评估 `@opencode-ai/ui` 的依赖闭包。
2. 先复用低耦合组件：按钮、图标、菜单、Tooltip、Tabs、ScrollView、主题 token。
3. 对 session-specific 组件先做适配，不直接假设其 OpenCode 数据模型兼容 DSH。
4. 无法独立消费时，只 vendor 实际使用的组件并保留来源/license/patch 记录。
5. 对每个 vendor 组件建立“上游原文件 → 本地 patch”记录。
6. 每次升级只应用一组可审查 patch。

### 产出

- OpenCode 风格组件层。
- 可追踪的 vendor/patch 清单。
- 不引入隐式 OpenCode server fallback。

### 闸门

- UI 组件不直接访问 Node/Electron。
- DSH 事件仍只从 Bridge 进入。
- 上游版本变化不会静默改变数据契约。

---

## Phase 5（可选，不在默认批准范围）：完整兼容层

只有产品确认必须实现上游 1:1 页面时，才另行批准。

### 任务

1. Fork 固定版本的 `packages/desktop`、`packages/app`、`packages/session-ui`。
2. 编写 OpenCode-compatible server 或 adapter。
3. 映射 session、message、part、file、project、worktree、provider、permission 和 event。
4. 处理 V1/V2 协议差异。
5. 做完整上游回归和品牌/许可证审查。

### 明确不与 Phase 1-4 混合

该阶段成本和耦合显著增加，不能在没有独立 ADR 和验收标准的情况下顺手实施。

---

## 7. 测试与验证矩阵

### 7.1 Core 单元/集成

| 检查 | 工具 | 通过条件 |
|---|---|---|
| 全量 core 测试 | `node node_modules/vitest/vitest.mjs run --config tests/vitest.config.ts` | 无新增失败 |
| 类型检查 | `node --import tsx scripts/typecheck.ts` | 无新增错误 |
| Bridge 合同 | Vitest | 请求、响应、事件和错误均有断言 |
| Host 生命周期 | Vitest | init/dispose、重入、取消和失败可重复 |
| 事件序列 | Vitest | replay/live 顺序、去重、缺口恢复正确 |

### 7.2 Electron 集成

| 检查 | 通过条件 |
|---|---|
| 主进程启动 | host 初始化失败时显示明确错误 |
| preload 安全 | `window.dsh` 只有白名单方法 |
| renderer 隔离 | 无 Node/Electron 全局能力 |
| 真实 run | 真实 DSH event 出现在 timeline |
| 审批 | approve/reject 状态回写一致 |
| 取消 | 当前 run 停止且 UI 状态一致 |
| reload | snapshot 恢复且不重复事件 |

### 7.3 打包 smoke

- macOS arm64 开发包。
- 应用启动/退出无残留 sidecar 或锁文件。
- renderer 静态资源加载失败能显示可诊断错误。
- 依赖安装和构建在干净目录可重复。

### 7.4 安全检查

- 外部 URL 仍经过 DSH 现有白名单校验。
- 不在 renderer 暴露 provider key、safeStorage 或任意文件读取。
- IPC channel 不接受用户提供的任意 channel 名称。
- 所有 session ID、run request、ask ID、call ID 做边界校验。
- 不记录未经脱敏的 prompt、key、authorization header。

---

## 8. 验收标准

### MVP 完成条件

- [ ] `desktop/` 可独立安装、typecheck、build、启动。
- [ ] DSH host 能在无 UI 情况下运行真实 turn。
- [ ] Renderer 只能通过 `window.dsh` 访问 DSH。
- [ ] 会话创建、打开、发送、取消、审批链路可重复。
- [ ] 事件 replay/live 无重复、无明显丢失。
- [ ] reload/restart 后会话可恢复。
- [ ] 现有 core 全量测试和 typecheck 无新增回归。
- [ ] 无 `src/**` Electron import。
- [ ] 上游来源、MIT notice 和本地修改范围有记录。
- [ ] 失败状态可见，不用 mock 数据掩盖。

### 暂不作为 MVP 验收

- 上游所有快捷键和菜单 1:1。
- OpenCode 远程 server。
- WSL/多 server。
- 正式公证和自动更新。
- 完整 OpenCode session-ui 复刻。

---

## 9. 发布、迁移与回滚

### 发布策略

1. 先以开发模式/内部构建运行。
2. 绑定现有 DSH 用户数据和 JSONL，不改变数据格式。
3. 观察启动、run、审批、取消和崩溃日志。
4. 通过后再生成 macOS 安装包。
5. 跨平台发布另立任务，逐平台验证原生依赖。

### 迁移策略

- 第一阶段不迁移数据。
- 不修改已有 session JSONL。
- 不删除旧桌面文件或用户数据；当前工作区的删除状态由现有变更负责，本计划不重置。
- 若未来引入 OpenCode compatibility server，必须先做只读导入和双写备份方案。

### 回滚策略

- 删除/禁用独立 `desktop/` package 即可回到 core-only。
- DSH host 和 Bridge 变更保持可回滚的小提交。
- 上游升级失败时回退固定 commit，不临时切到 `dev`。
- 任何需要修改 core 事件格式的方案都视为高风险，不能作为普通 UI 修复处理。

---

## 10. 风险与应对

| 风险 | 触发信号 | 应对 |
|---|---|---|
| 上游 API 漂移 | vendor 编译或类型突然失败 | 固定 commit；先使用已发布 UI；升级单独变更 |
| host 初始化遗漏 | 桌面启动后 provider/session 不可用 | 建立 host 初始化 checklist 和集成测试 |
| renderer 越权 | DevTools 出现 Node/IPC 能力 | 静态扫描 + contextBridge 白名单测试 |
| 事件竞态 | reload/取消后出现重复或错序 | sequence envelope、snapshot reconcile、缺口重拉 |
| 既有脏改动冲突 | 修改涉及用户正在改的文件 | 独立 worktree；不 reset/stash；先停在隔离边界 |
| 许可证/品牌问题 | vendor 引入未记录资产 | 保留 notice，禁止官方品牌复用，单独审查 |
| 依赖体积/原生模块失败 | 打包或跨平台安装失败 | 独立 package、锁定版本、逐平台 smoke |

---

## 11. 实施顺序与并行边界

```text
P0 基线/批准
  ↓
P1 DSH host + Bridge（串行）
  ↓
P2 Electron shell（串行）
  ↓
P3 DSH-native UI（可在 P2 完成后串行）
  ↓
P4 OpenCode UI 增量复用
  ↓
P5 完整兼容层（可选、独立批准）
```

第一阶段不允许多个 agent 同时修改：

- `src/main/dsh-host.ts`
- `src/main/bridge-*`
- `desktop/src/main/*`
- `desktop/src/preload/*`

可以并行的只读工作：

- 上游 UI 依赖评估
- 测试用例设计
- 许可证和依赖清单
- 视觉 token 对比

---

## 12. 需要批准的范围决策

请在开始实现前确认以下默认项：

1. **后端：** 保留 DSH core，不使用 OpenCode server 作为默认后端。
2. **范围：** 先做 DSH-native 垂直 MVP，不做完整 1:1 上游复刻。
3. **平台：** 先验收 macOS 开发构建，跨平台发布后置。
4. **源码：** 先使用固定版本的可发布 UI；只有必要时才 vendor 上游 app/desktop。
5. **工作区：** 在隔离 worktree/目录实施，不覆盖当前工作区已有改动。
6. **品牌：** 不使用 OpenCode 官方 Logo、名称或暗示官方关联。

批准后，执行顺序为：**Phase 0 基线 → Phase 1 host/Bridge → Phase 2 Electron shell → Phase 3 真实 UI**。在每个 Phase 完成闸门后再进入下一阶段。

---

## 13. 计划产物

- 架构决策：[`desktop-integration-adr-2026-09-24.md`](desktop-integration-adr-2026-09-24.md)
- 完整实施计划：本文件
- 下一阶段产物：基线报告、变更文件清单、测试报告和可运行构建
