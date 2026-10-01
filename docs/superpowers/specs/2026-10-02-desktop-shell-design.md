# m0 桌面端（驾驶舱）设计

- 日期：2026-10-02
- 状态：需求逐题澄清（13 项决定）＋设计 §1–§6 逐节过审＋视觉/布局 mockup 确认，本文为定稿
- 范围：v1（macOS 内测版）
- 配套物料：视觉方向与布局稿在 `.superpowers/brainstorm/93811-1790876920/content/`（visual-style-v2.html、layout.html）

## 0. 一句话

给 m0 事件溯源 agent 内核做一个 Electron 驾驶舱：人在里面派活、看事件流、批权限、打断；内核直嵌主进程，会话库与 CLI 同根共享。

## 1. 背景与定位

m0 是事件溯源的 agent 内核：每步落 JSONL 事件，可重放、分叉、审计；当前为 core-only 纯 CLI（无 UI、无构建步骤）。旧 Electron 桌面层（渲染层＋preload 共 209 文件、约 5.4 万行）已在 `69fbb0d` 整体移除；`src/main/` 服务层保留且被 core runner 引用。

本次设计是 AGENTS.md 所说"新的明确请求"：桌面端回归。与旧版的关系是**全新设计**，旧版只当两类素材：

1. **判卷基线形状**：旧版判过的 UI 投影测试（审批卡、截断标注、会话六态筛选等）是验收素材；
2. **教训**：旧 renderer 是 4462 行单文件 vanilla JS ＋ 2442 行 index.html，无组件边界、无构建链，养不动——这是它被移除的技术原因之一，新 renderer 必须换组件模型＋类型贯通。

## 2. 需求底账（已确认的 13 项决定）

| # | 决定点 | 结论 |
|---|--------|------|
| 1 | 与旧桌面版关系 | 全新设计，旧版只当素材 |
| 2 | 核心使命 | 驾驶舱：驱动 agent 干活（主驾驶界面） |
| 3 | 目标用户 | 面向公众的产品 |
| 4 | 桌面壳技术栈 | Electron |
| 5 | v1 功能范围 | 最小可信驾驶舱（见 §6.4 不做清单） |
| 6 | 平台 | macOS 先行（universal），Win/Linux 后置 |
| 7 | 模型凭据 | BYOK＋服务商预设，Keychain 存储 |
| 8 | 发布门槛 | 内测先发，签名/公证/更新器/上报挂点预留 |
| 9 | 代码归属 | 同仓分层（apps/desktop），AGENTS.md 改写 |
| 10 | 工作区模型 | 单窗多工作区 |
| 11 | 并行模型 | 多会话并行 |
| 12 | 会话存储 | 与 CLI 共享会话库＋写入互斥 |
| 13 | 视觉基调 | Codex 基因（近单色、状态点、composer 主角），明暗两态同一语义 token，默认跟随系统 |

## 3. 总体架构

### 3.1 目录与依赖方向

```
src/                 ← core-only 纪律延续：禁 UI/Electron import
  main/              ← 服务层留原地（core runner 亦引用，不动）
apps/desktop/
  main/              ← Electron 主进程壳：窗口/菜单/生命周期
  kernel-host.ts     ← ★ 预留缝：内核装配单点（见 3.2）
  preload/           ← contextBridge：AgentApi 逐通道桥进 window.agent
  renderer/          ← React 18 + Vite + TypeScript strict
```

依赖方向单向：`apps/desktop → src`，core 永远不感知桌面层。`pnpm-workspace.yaml` 增加 `packages: ["apps/*"]`，`apps/desktop` 自带 package.json（electron、electron-builder、react 等依赖全部收在桌面包内，根 package.json 不新增运行时依赖）。

### 3.2 进程模型：A 起步＋预留 C 缝

**v1（方案 A）**：Electron 主进程直嵌内核跑会话循环。`src/main/agent-runner.ts` 头注"同一入口不经 UI 也可直调（ipc:check）"即接缝——`handleAgentRun` 等 main 服务就是 `AgentApi` 的后端实现，v1 零新协议。多会话并行在同一事件循环内并发（agent 循环 I/O 密集：等 LLM 流、等子进程），不做每会话线程/进程。

**崩溃语义**：内核崩溃会带倒主进程＝窗口进程。可接受，因为会话真值在磁盘 JSONL，重启后按事件流重放即恢复（`recovery.ts` 语义现成）。

**预留 C 缝（升级方向，v1 不实现）**：内核装配收拢在 `apps/desktop/main/kernel-host.ts` 单点——它负责实例化 runner/门/调度器并对外暴露同一组服务接口。未来若需窗口/内核崩溃隔离，把该文件改为 utilityProcess 宿主装载，装配点之外零改动。

**否决案（记录在案）**：每会话子进程跑 m0 CLI——今天的 CLI 不是长驻交互服务，审批/打断/澄清都要新发明控制协议，协议发明的成本不低于隔离收益。

### 3.3 IPC 桥面＝现成契约

`src/main/ipc-protocol.ts` 的 `AgentApi`（run/decide/onEvent/onAsk/runCancel/listSessions/createSession/openSession/projects 系/providerKeySet 系/getSettings/checkUpdate/openExternal 等 40＋通道）是唯一类型真值源。preload 逐通道桥接，沿用既有红线：**删桥接行 typecheck 必红**（optional 收紧为必选的既有做法不变）。

### 3.4 前端形态

- React 18 ＋ Vite ＋ TS strict；组件承载 `AgentEvent` 载荷面（审批卡/澄清表单/方案门等）。
- **UI 状态 ＝ `AgentEvent[]` 的纯投影**（吸收旧版 `projections.ts` 的正确直觉并强化）：投影函数全部纯函数、vitest 直测不挂 DOM。历史会话 `openSession` 全量读 JSONL 走同一投影；运行中会话经 `onEvent` 增量累加后进同一投影。
- 明暗两态用同一组语义 token（§6.1），`prefers-color-scheme` 跟随系统。

## 4. 数据面

### 4.1 会话库共享

`src/main/sessions.ts` 本就是 root 由调用方注入的 electron-free 设计。桌面端**按工作区解析**：

```
sessionsRoot = <workspace>/.agent/sessions
```

与 CLI 同根同约定（`src/cli.ts:933`）。**弃用当年 userData 全局会话根**。效果：

- CLI 跑的会话出现在桌面历史里，桌面建的会话 CLI 可 fork/replay；
- `session-metadata.json`（pin/归档/标题，`src/main/session-handlers.ts:32`）随 sessionsRoot 落盘，两端互通；CLI 只扫 `*.jsonl`，sidecar 文件对它不可见、无害。

### 4.2 写入互斥（三层，边界如实声明）

1. **桌面端内部**：每会话互斥，同一会话不允许第二个 runLoop，重入直接拒绝并提示；
2. **外部漂移检测**：openSession 快照行数/字节，追加前重读比对，被外部（CLI）改过则拒绝写入、提示刷新；
3. **硬锁（O_EXCL lock 文件）**：**预留挂点，v1 不实现**——CLI 侧今天没有锁，v1 不改 CLI 语义。

已知限制：CLI 与桌面端同时写同一会话在 v1 只靠漂移检测兜底（后写方被拒并提示），不是硬互斥。硬锁作为后续项需要 CLI 同步接入才成立。

### 4.3 全局层（userData）

| 内容 | 载体 |
|------|------|
| 应用设置（主题跟随/语言/默认权限档/更新通道） | settings.json（`src/main/settings.ts` 服务不动） |
| 最近工作区列表 | project-registry（`src/main/project-registry.ts`） |
| BYOK key | safeStorage→Keychain（`providerKeySet` 已 fail-closed，不可用即拒绝、不落明文） |
| license 状态 | license.ts（呈现层保留） |
| 崩溃日志 | userData/logs（§7） |

## 5. 安全与权限

- **门在主进程，渲染层只是呈现端**（旧版验证过的正确形状）：内核 runLoop 固定 auto 档，真门是 `agent-runner.ts` 工具包装里的 `AskGate`（复用 `src/permissions` 裁决表）。`onAsk` 送审批卡载荷（tool/args/reason/risk/riskReasons/sentAt），用户决定走 `decide(askId, approved, scope)`。
- **scope 三档 `once / session_kind / always` 直接沉淀进既有权限规则文件**——"总是允许"就是产品化的权限规则入口，不新发明。
- 澄清门（`submitClarify`）与方案门（`decidePlan`）同走卡片系统。
- **沙箱**：桌面端不新发明沙箱，只消费 `StateResponse.sandbox` 状态面；不可用 → 写工具强制逐条审批（agent-runner 既有语义）＋引导文案。
- **渲染层隔离**：contextIsolation 开、nodeIntegration 关、CSP 只许本地资源、无远程内容；`openExternal` 只放行 http(s) 白名单（AgentApi 既有约束）。
- **打断**：`runCancel()`，沿 runLoop 轮界/门等待/长驻工具透传（语义现成）。
- **无人值守** fail-closed（`AskOutcomePayload.unattended`）语义保留，v1 不做对应 UI。

## 6. v1 界面规格（Codex 基因）

### 6.1 视觉语言

近单色、克制、状态靠圆点呼吸；**彩色的唯一职责是风险与错误标注**。

| 语义 token | 浅色 | 深色 |
|-----------|------|------|
| canvas（主区背景） | #ffffff | #1a1a1a |
| surface（侧栏/卡片） | #f7f7f8 | #212121 |
| hairline | #ececec | #2c2c2e |
| text-primary / secondary / tertiary | #0d0d0d / #6e6e73 / #8f8f8f | #ececec / #98989d / #8f8f8f |
| accent（主按钮/激活项） | 黑底白字 #0d0d0d | 白底黑字 #ececec |
| status.working（呼吸圆点） | #8f8f8f | #98989d |
| status.done（圆点） | #0d0d0d | #ececec |
| status.error（圆点） | #e02e2a | #ff453a |
| risk-accent（审批卡左竖条） | #f5a623（按 risk 分级换色） | 同左 |
| diff add / remove | #1a7f37 / #cf222e | 同左 |
| 字体 | -apple-system / PingFang SC；代码 ui-monospace | 同左 |

### 6.2 布局（方案 A：按工作区分组的会话列表，已 mockup 确认）

- **左栏**：顶部"m0 ＋ 新任务"；主体为**按工作区分组**的会话列表——分组标题即工作区名（点击展开/收起），组内会话行带状态圆点（灰呼吸=运行中/完成/红=出错），所有工作区的并行会话同列；左下角"工作区管理 · 设置"入口。
- **主区**：顶部会话条（标题＋状态＋tokens·cost 安静次级文字）；中部事件流时间线（用户消息、折叠工具行、内联 diff、审批/澄清/方案卡）；底部常驻 **composer**（大圆角输入框，⏎ 派活）。
- **不做第二栏**：v1 主区永远只有一条时间线，diff 点 ⌄ 内联展开。

### 6.3 交互规则

- **多会话并行**：后台会话事件落盘不丢，列表圆点呼吸，点回即接上；不需要 tab。
- **审批卡**：事件流中唯一的"重"元素——risk 左竖条＋工具名＋命令＋三键（允许/拒绝/总是允许）；"总是允许"展开 scope 选择（session_kind/always）。
- **composer 运行中**：输入变为"排队追加指令"，随下一轮进流。
- **打断**：会话条上的"打断"动作（运行中可见）。
- **新建会话**：composer 空态即新建入口；"＋ 新任务"聚焦 composer。
- 工作区添加：本地文件夹选择器，加入即注册进 project-registry 并在左栏成组。

### 6.4 v1 明确不做（挂点已备）

回放/分叉 UI、时间线回放器、自动化/scheduler 面板、sidechat、记忆/插件面板、七组新手引导向导、Windows/Linux、autoUpdater 自动更新、崩溃上传、license 发放。对应数据面（schedule/sidechat/memory/plugins/onboarding 通道）已在 AgentApi 桥面类型里活着，后置只补 UI。

## 7. 产品化外围（内测先发、挂点预留）

| 事项 | v1 内测形态 | 预留挂点 |
|------|------------|----------|
| 打包 | electron-builder，dmg（universal） | appId/产品名占位（§12） |
| 签名公证 | 自签/ad-hoc＋信任步骤文档 | afterSign 钩子位＋entitlements 脚本位 |
| 更新 | checkUpdate 四显式态＋打开下载页（已有） | autoUpdater 挂点不实现 |
| 崩溃 | 本地崩溃日志（userData/logs，main/renderer 双进程） | 上报接口留位 |
| license | 状态面照常呈现（引导横幅），不发 key | license.ts 服务不动 |
| 首启 | 两步最小引导：选工作区 → BYOK 设置 | getOnboarding 数据面已桥，向导 UI 后置 |

## 8. 测试与验收

- **core 门全不动**：typecheck / test / gates / docs-check 原样；冻结判卷文件与夹具不碰。
- **renderer 判卷**：投影纯函数 vitest 直测（事件流→UI 状态映射），基线形状取自旧版判过的测试素材（审批卡、截断标注、会话筛选）；组件测试按需轻量。
- **桌面 e2e 不经 UI**：验收脚本直调 `handleAgentRun`（既有 ipc:check 模式），mock provider（`createMockProvider`）全链路判卷。
- **单向依赖钉死**：docs-check 扩展——`apps/desktop → src` 允许；`src → apps/desktop` 或 src 内出现 UI/Electron import 即红。vitest config 声明门范围：core 测试不扫 apps/。

## 9. AGENTS.md 改写

"core-only"章节改写为分层规则：

- `src/` 禁 UI/Electron import（原有纪律延续）；
- 桌面端代码住 `apps/desktop/`，有自己的构建链与依赖，不进 core 测试门；
- "不要重新引入 Electron"条款替换为"桌面端只能经 `apps/desktop` 引入，不得回填 `src/`"。

## 10. 已知限制与风险

| 风险 | 缓解 |
|------|------|
| 主进程崩溃带倒 UI | 事件溯源：JSONL 落盘即真值，重启重放恢复；kernel-host 缝预留 utilityProcess 升级 |
| CLI 与桌面端并发写同会话无硬互斥 | v1 漂移检测兜底（后写方被拒）；硬锁列为后续项（需 CLI 同步接入） |
| universal 打包体积 | v1 不优化；electron-builder 常规压缩，内测可接受 |
| React 依赖进公开产品供应链 | 依赖收在 apps/desktop 包内，锁版本；core 零新增依赖不变 |

## 11. 里程碑（v1 内测）

| 里程碑 | 内容 | 验收锚 |
|--------|------|--------|
| M1 壳与桥面 | apps/desktop 骨架、preload 全通道桥接、kernel-host 装配点、mock provider 打通 run | AgentApi 全表 typecheck 红；handleAgentRun 直调判卷绿 |
| M2 驾驶舱主区 | 事件流投影纯函数、审批/澄清/方案卡、composer、runCancel、tokens·cost | 投影判卷绿；mock 全链路审批→执行→打断 |
| M3 会话库与多工作区 | sessionsRoot 同根接线、工作区注册表、并行多会话状态点、漂移检测 | CLI 建会话桌面可见；并行两会话互不串流 |
| M4 BYOK 与首启 | 服务商预设＋Keychain、两步首启、设置页默认权限档 | BYOK fail-closed 路径判卷绿 |
| M5 内测打包 | dmg universal、自签、崩溃日志、checkUpdate 接线、内测分发文档 | 裸机安装可跑通首启两步＋一次真会话 |

## 12. 待定项

- **产品名**：暂用 m0；appId 与分发名占位（`com.m0.desktop` 待定），M5 前定稿。
