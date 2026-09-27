# DSH × OpenCode Desktop 接入 ADR

- 日期：2026-09-24
- 状态：**Proposed**（用户已确认方向；本文件只冻结架构边界，尚未开始实现）
- 决策置信度：高
- 适用范围：桌面端接入设计，不改变当前 DSH core 的运行时契约

## 1. 决策问题

能否直接复用 OpenCode 的桌面端设计和源码，同时继续使用当前 DSH 的 agent core，而不是把产品运行时切换成 OpenCode server？

## 2. 背景与约束

### 已确认的目标

- 目标是获得 OpenCode 桌面端的布局、交互、主题和主要工作流体验。
- DSH 的编排、权限、验证、记忆、sidechat、worktree 和事件日志仍然是产品内核。
- `src/` 继续保持 headless / Electron-free；桌面依赖只能存在于独立桌面层。

### 当前 DSH 事实

- 当前仓库的桌面入口、preload、renderer 已被移出，仓库规则要求保持 core-only。
- 当前服务面以 `src/main/ipc-protocol.ts` 的 `AgentApi` 和 `src/events/index.ts` 的 `AgentEvent` 为主。
- DSH 目前没有 OpenCode 兼容的 HTTP API、session API 或事件协议。
- DSH 的运行状态、会话 JSONL、审批和 provider 设置由 `src/main/` 服务装配，部分初始化逻辑需要从旧桌面入口中抽成可复用的 host。

### 上游事实（核对快照：2026-09-24）

- 上游仓库采用 MIT License。
- 本次核对的上游快照为 `anomalyco/opencode` commit `0f549842ee746e400b1f72516b0b2e292e267e2c`（2026-09-24），包版本为 `1.18.32`。
- 桌面包是 Electron，应用和会话 UI 使用 SolidJS。
- `packages/desktop` 是私有 workspace 包；`packages/app` 和 `packages/session-ui` 当前不能作为普通 npm 依赖直接安装。
- `@opencode-ai/ui` 可以在 npm 中解析，但仍应锁定版本并验证其依赖闭包。
- 上游应用深度依赖 OpenCode SDK、生成式 client、server API、session/message/file/project/worktree 接口以及实时事件流。
- 上游桌面端默认启动 OpenCode sidecar server；直接复制 UI 不会自动改为使用 DSH core。

## 3. 目标与非目标

### 目标

1. 建立独立 `desktop/` 应用边界，不污染 `src/` core。
2. 通过类型化 `DshBridge` 复用 DSH 现有运行入口。
3. 先提供可运行的垂直切片：启动、创建/打开会话、发送 prompt、流式显示、审批、取消。
4. 允许后续替换为 OpenCode 视觉组件，而不改变 DSH core 契约。
5. 保留向“完整 OpenCode 桌面 fork + 兼容服务”演进的路径。

### 非目标

- 第一阶段不追求 OpenCode 所有功能 1:1 对齐。
- 第一阶段不迁移现有 DSH 会话为 OpenCode 格式。
- 第一阶段不接入 OpenCode 的远程服务器、WSL、云端分享和账号体系。
- 不把 OpenCode SDK/server 悄悄替换为 DSH runtime。
- 不复用 OpenCode 名称、Logo 或官方品牌表达来暗示官方关联。

## 4. 方案比较与决策

| 方案 | 可行性 | 优点 | 主要问题 | 结论 |
|---|---:|---|---|---|
| A. 原样复制整个上游桌面端 | 高 | 最快得到上游完整外观 | 默认连接 OpenCode server，DSH core 不会被使用 | 拒绝 |
| B. Fork 整个上游并实现 OpenCode 兼容服务 | 中高 | 可最大程度保持 1:1 交互 | 需要实现大量 session/message/file/event 映射，跟随上游变化成本高 | 保留为后续路线 |
| C. 独立桌面壳 + DSH Bridge + 选择性复用 OpenCode UI | 高 | 保留 DSH 内核，边界清晰，可逐步逼近上游体验 | 初期不会自动获得全部 OpenCode 功能 | **默认采用** |
| D. 直接使用 OpenCode SDK/client 替换后端 | 高 | 使用官方集成面 | 实际运行的是 OpenCode engine，不是 DSH core | 当前目标不采用 |

### 决策

采用 **方案 C**。

如果后续确认必须实现上游桌面 1:1，再把方案 B 作为第二阶段：保留 `DshBridge`，新增 OpenCode-compatible compatibility server，而不是把两套 core 混成一套。

## 5. 系统边界与数据流

```text
┌─────────────────────────────────────────────┐
│ desktop/                                    │
│ Electron main                               │
│  ├─ window / menu / storage / updater      │
│  ├─ DshHost 初始化与生命周期                 │
│  └─ typed IPC handlers                      │
│                    │                        │
│             contextBridge                   │
│                    ▼                        │
│ Electron preload（只暴露白名单 API）          │
│                    │                        │
│                    ▼                        │
│ Renderer / OpenCode-inspired UI             │
│  └─ DshBridge client                        │
└────────────────────┬────────────────────────┘
                     │ typed request/event
                     ▼
┌─────────────────────────────────────────────┐
│ DSH Bridge（anti-corruption layer）           │
│  ├─ AgentApi 子集                            │
│  ├─ session/project/file 适配                │
│  ├─ AgentEvent → UI event envelope           │
│  └─ 审批/澄清/取消路由                       │
└────────────────────┬────────────────────────┘
                     ▼
┌─────────────────────────────────────────────┐
│ DSH core（保持 Electron-free）                │
│ agent loop / permissions / tools / events   │
│ sessions / memory / worktree / providers     │
└─────────────────────────────────────────────┘
```

### 信任边界

- Renderer 不直接访问 Node、文件系统、Electron 或任意 IPC channel。
- Preload 只暴露固定的 `window.dsh` 方法和事件订阅接口。
- Provider key、safeStorage、运行控制和文件系统权限只在 main/DSH host 一侧处理。
- Bridge 对所有 IPC payload 做运行时校验；TypeScript 类型不能替代边界校验。
- `src/` 不得新增 Electron import。

## 6. Bridge 合同（第一阶段）

第一阶段不复制 OpenCode 的完整 API，而是对现有 `AgentApi` 取一个明确的 UI 子集：

```ts
// 合同示意；实现时复用 src/main/ipc-protocol.ts 中的实际类型。
interface DshDesktopBridge {
  getState(): Promise<StateResponse>
  listSessions(): Promise<SessionInfoPayload[]>
  createSession(name?: string): Promise<{ id: string }>
  openSession(id: string): Promise<{ events: AgentEvent[] }>
  run(request: RunRequest): Promise<RunResponse>
  runCancel(): Promise<{ ok: boolean; error?: string }>
  decideApproval(askId: string, approved: boolean, scope?: ApprovalScope): Promise<boolean>
  submitClarify(callId: string, answers: ClarifyAnswers): Promise<boolean>
  decidePlan(approved: boolean, callId?: string): Promise<boolean>
  onEvent(listener: (event: AgentEvent) => void): () => void
  onAsk(listener: (ask: AskPayload) => void): () => void
}
```

实现时优先使用 `Pick<AgentApi, ...>` 或共享声明，避免再维护一份漂移的接口。

### 事件语义

- `openSession()` 返回历史快照，随后通过 `onEvent()` 接收 live event。
- Bridge 为事件增加 session、序号和时间戳 envelope；不修改 DSH 核心事件联合类型。
- renderer 必须按 session/event 序号去重，并区分 replay 与 live。
- assistant delta 在 renderer 侧合并且不能阻塞 main 的事件生产。
- 连接断开时重新请求 session snapshot，不依赖无限增长的事件缓存。

## 7. 上游源码策略

1. 记录上游仓库 URL、commit/release 和许可证文本。
2. 第一阶段优先锁定并评估已发布的 `@opencode-ai/ui`。
3. 只有在需要上游页面级行为时，才 vendor/fork `packages/app`、`packages/session-ui` 或 `packages/desktop`。
4. Vendor 代码放在独立目录，保留 `UPSTREAM.md`、原始 license 和本地 patch 说明。
5. 不直接跟踪上游 `dev` 分支；升级必须通过独立变更集和回归检查。
6. 任何品牌资产复用都要单独确认；MIT 代码许可不等于 OpenCode 商标许可。

## 8. 计划文件边界

以下是目标文件布局，不代表本次已经创建：

```text
desktop/
  package.json
  tsconfig.json
  electron.vite.config.ts
  src/
    main/
      index.ts              # Electron 生命周期
      dsh-host.ts           # DSH 服务初始化与关闭
      ipc.ts                # 白名单 IPC handlers
    preload/
      index.ts              # contextBridge
      types.ts
    bridge/
      contract.ts           # 共享类型
      validation.ts         # 运行时 payload 校验
    renderer/
      index.html
      main.tsx              # 桌面壳和路由
      app.tsx               # OpenCode-inspired layout
      data/dsh-bridge.ts
      styles.css
  test/
    bridge-contract.test.ts
    ipc-allowlist.test.ts
```

第一阶段不要求复制上游全部目录；只有被实际使用的组件才进入 vendor/patch 面。

## 9. 分阶段实施

### Phase 0：架构冻结

- 完成本 ADR。
- 确认 DSH core、桌面层和上游源码的责任边界。
- 不改 frozen judge、fixtures 或 core 行为。

### Phase 1：DSH host 与 Bridge 垂直切片

- 抽出可复用的 DSH host 初始化入口。
- 实现白名单 IPC 和 preload API。
- 实现 session 列表/打开、run、event、approval、cancel。
- 为 payload 校验、事件顺序和重连去重写测试。

### Phase 2：独立桌面壳

- 加入 Electron main/preload/renderer 的独立构建。
- 完成启动、窗口、加载、错误和关闭流程。
- 先用 DSH-native UI 验证真实链路，不使用假成功数据。

### Phase 3：视觉与交互逼近上游

- 引入锁定的 OpenCode UI 组件或选择性 vendor 组件。
- 对齐主题、布局、快捷键、滚动、diff、终端和文件树。
- 保持 UI 组件只能通过 Bridge 访问 DSH 数据。

### Phase 4：可选完整兼容层

只有当产品要求 1:1 上游页面和功能时，才实现 OpenCode-compatible server。该阶段单独评审，不改变 Phase 1 的 DSH-native contract。

## 10. 架构 fitness functions

| 不变量 | 检查规则 | 失败响应 | 本地检查路径 |
|---|---|---|---|
| core 无桌面依赖 | `src/**` 不出现 Electron/renderer/preload import | 阻止合并 | `node --import tsx scripts/typecheck.ts` + 静态扫描 |
| IPC 最小权限 | renderer 只能调用固定白名单 channel；无任意 channel 参数 | 阻止打包 | `desktop` bridge/IPC 测试 |
| 事件可重放 | session replay + live event 去重后顺序稳定 | 丢弃 live 数据并重新 snapshot | bridge event tests |
| 合同不漂移 | Bridge 类型与 `AgentApi` 保持可检查的派生关系 | 阻止类型发布 | 独立 desktop typecheck |
| core 回归 | DSH 原有测试和 typecheck 保持通过 | 阻止交付 | 仓库规定命令 |
| 可构建 | desktop build/package 在目标平台成功 | 不发布 | desktop build smoke |

## 11. 风险登记

| 风险 | 可能性 | 影响 | 缓解 |
|---|---:|---:|---|
| 上游 Beta 源码/API 快速变化 | 高 | 高 | 固定 commit，保留 patch 面，先用 published UI |
| 直接复制后误连 OpenCode server | 中 | 高 | 启动时验证 DSH host identity，禁止隐式 fallback |
| DSH 事件与 OpenCode 页面模型不一致 | 高 | 高 | 先做 DSH-native vertical slice，适配层集中隔离 |
| Electron renderer 越权 | 中 | 高 | contextBridge 白名单、关闭 nodeIntegration、运行时校验 |
| 会话/审批状态竞态 | 中 | 高 | 单 run 状态机、序号 envelope、取消和重连测试 |
| 原生依赖和打包体积增加 | 中 | 中 | desktop 独立 package，固定 lockfile，按平台验证 |
| 许可证/品牌误用 | 低 | 高 | 保留 MIT notice，不使用官方品牌，独立资产审查 |
| 当前工作树存在大量未提交改动 | 高 | 高 | 不 reset/stash；实现放在独立 worktree |

## 12. 可逆性与责任

- **可逆性：中高。** 第一阶段只新增独立 desktop package；如果 DSH-native 方案不适合，可删除该 package，不影响 core。
- **转向完整兼容服务的成本：高。** 一旦把页面直接绑定到 OpenCode-compatible server，升级和替换成本会显著增加，因此先用 DSH-native bridge 隔离。
- **责任：** `desktop/` 维护者负责 Electron 生命周期、preload 安全和 Bridge；DSH core 维护者继续负责 agent、权限、事件和持久化；产品维护者负责上游版本、许可证和品牌决策。
- **当前责任检查路径：** 用户确认范围；本地检查使用仓库规定的 typecheck、core Vitest，以及 desktop 独立构建。

## 13. 后续检查（最多两项）

1. 完成 Phase 1 后，验证真实 DSH run → renderer event → approval/cancel 的端到端链路。
2. 在引入任何 vendor 源码前，核对 commit、MIT notice、依赖闭包和 Electron 安全边界。

## 结论

可以直接采用 OpenCode 的设计和部分源码，但应把它作为**独立桌面层和可替换的前端实现**，而不是把上游 server 当作 DSH core 的隐式替代物。先完成 DSH-native Bridge 垂直切片，再决定是否投入完整 OpenCode compatibility server。
