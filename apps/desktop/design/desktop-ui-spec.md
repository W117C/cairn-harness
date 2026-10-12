# Cairn 桌面前端 · 组件架构规范

> 版本 v2.6（2026-10-04）· 适用对象 `apps/desktop/`（Electron + React + Vite）· 配套可交互原型：同目录 `prototype.html`
>
> **v1.1 变更（按用户参考图改版侧栏）**：C-03 `WorkspaceSwitcher` → **`SideHeader`**（新会话按钮 / 功能菜单 /
> 任务·频道标签 / 工作区区头）；`SessionItem` 改纯文本+相对时间（仅运行/等待/出错显示状态点），选中态改灰底药丸；
> `ProjectGroup` 归属标记改**蓝色文件夹**、删除计数徽标；侧栏底色 `--side-bg`（比主区深一阶）。原型已同步。
>
> **v2 变更（三栏 + 输出优先，2026-10-04 第二轮）**：新增 **R 层 `RightPanel`**（审查 / 辅助对话，可折叠；终端·浏览器
> 无后端**不做**，见 §8 缺口台账）；事件流改「输出优先」——工具默认折叠、完成后归入 **ChangeSummaryCard**，新增
> **ThinkingRow**（浅色 · 可折叠 · 动效；内容位标注推理流未接线）与 **ActionBar**（复制/赞踩/收起/思考/分叉）；
> Composer 重构——**GoalPanel 与 ContextRow（文件夹/工作树）移出输入卡、置于上方**，新增 **AttachmentChips**、
> **SlashMenu**、**思考程度档位**（按 capability 表禁用未支持档）、**StatusStrip**。新增组件编号 C-30…C-38。
>
> **v2.2 变更（右栏 = 多标签容器，2026-10-04 三轮）**：用户澄清参考图为**右栏开始页**——右栏改为多标签容器：
> 0 标签显示开始页（快捷卡栈 ×5），点击「浏览器 / 侧边对话」开新标签、可多开/关闭；**本轮只做「浏览器」与「辅助对话」
> 两类标签**（审查移出右栏，可随时加回）；主区空态还原为「问句 + pill」口径（C-24）。浏览器标签后端为**实现前置**
> （WebContentsView），原型以标注过的演示页呈现。
>
> **v2.3 变更（设置 = 整页全覆盖，2026-10-04 四轮）**：C-26 由右侧 Sheet 改为**整页设置**
> （覆盖 side bar＋主区＋右栏，顶边贴 TitleBar；⌘, / Esc / 底部关闭）；页内左侧 7 类导航——
> **通用 / 模型与 Provider / 权限与安全 / 行为与成本 / 记忆与数据 / 插件与技能 / 关于与更新**，
> 覆盖 `AppSettings` **全部可持久化字段**（theme/telemetry/safeMode/…/planRequiredByDefault）；无字段可持久化的项（界面语言）
> 显式标注「待接入」。
>
> **v2.4 变更（四页齐备 + 细节修正，2026-10-04 五轮）**：侧栏功能菜单接入**四个整页应用**——
> **插件页 / 自动化任务页 / 技能中心页 / 记忆系统页**（与 SettingsPage 同宿主 `#appPage`，`← 返回`/Esc 关闭）；
> 右栏**封面不展示标签栏**（0 标签时整条隐藏，标签只在开物后出现）；**文件夹着色跟随「点中的对话」所在组**
> （没点到的不变色）；**删除「频道」**（侧栏仅「任务」）。（v2.5 续：「任务」标签行整行移除；门卡左侧彩色竖条移除，风险/类型改由头部 chip 承载。）
>
> **v2.6 变更（四页深度升级，2026-10-04 七轮）**：插件 / 自动化 / 技能 / 记忆四页**每页自由定制**，共用以
> 「**顶部概览统计**（仅真实字段）+ **工具条**（搜索 · 筛选 chips · 排序）+ **列表＋右侧详情抽屉**（340px，sticky）」
> 组织；抽屉承担查看与编辑（可连点切换、关闭不遮挡列表）；缺口一律「待接」显式。
> 字段核实：`memorySnapshot` **含主题全文**（main 侧逐文件读取）；`McpServerStatus` 含 plugin/state/tools/error；
> `scheduleSnapshot` 含 tasks/history/running/queued/cap/startupDone/tzNotes。
> （v2.6 续：TitleBar 阶段徽标删除；会话标题**对齐中栏居中**，随侧栏/右栏/窗口变化同步。）
> （v2.7：设置页补搜索（同义词别名）· 校验规则 · 保存回执 · `onboarded` 重跑向导。）
> （v2.8→v2.9：门卡先试三段带染底（v2.8）后回退；真实诉求 = **门卡＋输入框合计占高过大遮挡对话**。定稿：审批/计划卡**默认紧凑摘要＋详情折叠**（280→120px / 340→111px）；**输入区不做任何隐藏/删除**——曾试「极简态」被用户否决（「没说让你删除」），占高由门卡折叠解决。澄清卡保持全表单。）
> （v2.10：旁路对话加**轮次导航**——每轮时间戳分隔 + 顶部 sticky chips，点击跳转并高亮。）
> （v2.11：**中栏对话流加左侧轮次时间线**（每条 user 行 = 一轮，点击跳转 + 闪烁高亮；余量不足自动收起）；演示场景补前一轮，rail 才有跳转语义。）
> （v2.12：时间线改**线条形态**——每轮一条竖线段，悬停突起并弹出信息面板（轮数/时间/用户话/回复摘要），点击跳转整轮高亮。）
> （v2.13：**未完成项补齐**——侧栏会话搜索/状态筛选（真过滤）、会话 ⋯ 菜单四动作（重命名/固定/归档/删除，映射 `AgentApi` 桥接通道）、用户菜单跳「关于与更新」、浏览器工具条（刷新/复制可用、进退置灰）。剩余待接：工作区文件/终端/技能正文/调用历史/调度执行面——均为后端前置。）
> （v2.14：**两处后端接线落地**——① 桌面主进程常驻 `serveScheduler({ workspace })`（whenReady 启动 / will-quit 停表）：自动化面板结束「空壳」态，§8 #18 关案，反向证人入 `tests/scheduler-wiring.test.ts` ④；② `AppSettings.locale` 字段落地（zh-CN/en-US，持久化 + 白名单校验），设置页界面语言由「待接入」转正（文案翻译逐段接线）。全仓 typecheck 通过、21/21 测试绿、desktop-boundary-check 绿。）
> （v2.15：**会话五动作全接 + 分叉通道落地**——侧栏 ⋯ 菜单扩为 重命名 / 固定 / 分叉… / 归档 / 删除（前四项映射既有桥接通道）；新增 `handleSessionFork` + `AgentApi.forkSession` + `agent:sessions-fork`（与 CLI `--fork/--from` 同口径，复用 `fork-cli` 单源算术：源会话只读、目标已存在不覆盖、越界 fail-visible 不留半成品）；模型动作条分叉按钮同源接线。§8 #12 关案、#7 对话级部分收口。28/28 测试绿、全仓 typecheck 通过。）
> （v2.16：**赞踩 / 文件级回滚接线落地（接手笔 2026-10-06）**——core 沉淀链路与文件回滚先行落齐（`src/main/feedback.ts` append-only sidecar + `handleFeedbackSubmit/List`；`planTurnRevert/applyTurnRevert` + `handleSessionRevert`；判卷 `tests/feedback.test.ts` / `tests/file-revert.test.ts`），goal pause/resume 语义同批（`setGoal{pause,resume}` + `goal_paused/goal_resumed`）。本笔接 renderer：事件行**悬停动作条**（C-33 的现行切片）——终稿 assistant 行挂 复制/赞/踩（`submitFeedback` 真提交、再点撤销、`listFeedback` 点亮；live 桶行不挂，防锚错事件）；user 行挂「⟲ 还原此轮文件」（`revertTurn`，轮号 = 主会话 user_message 1-based，与 core 同口径；confirm 后执行）；回滚结果走**会话键控提示条**（`.notice-strip`，成功面不进错误条），复制失败/提交失败走 ErrorStrip。§8 #7/#8 关案、#9 core 半收口。桌面判卷 93 条绿（projections +3）。）
>
> **本文是什么**：设计与实现之间的契约。每个组件的层级归属、所处区域、可视状态、交互行为都有唯一定义；
> 组件名一经此处定义，代码、评审、验收共用同一套词汇。
>
> **与参考清单的关系**：参考清单 6 组共 29 条目（其中「Button/Input/Select/Toggle」为组合条目，内含 4 个控件），
> 本文**全部覆盖且逐条给出版本优化**。凡属本文新增的优化项，均以 `＋优化` 标注并给出理由；
> 需要内核/投影扩面的，单独归入 §3.5「V2 投影扩展建议」，不与 V1 混做。
>
> **设计纪律（从内核延伸到 UI 的 fail-visible）**：
> ① 缺数据 = 缺席，不编造（分支未知不显示假分支、时间戳缺席留空、diff 类型缺席标 unknown）；
> ② 失败必须可见，且不自动消失（错误条只由用户关闭）；
> ③ 不可知不当 0（价格不可知不折金额、demo 通道明示剧本语义）；
> ④ 看不见的 diff 等于没有审查面——DiffView 必须完整可读。

---

## 1. 区域模型与窗口适配

### 1.1 区域图（AppShell 骨架）

```
┌───────────────────────────────────────────────────────────────────────┐
│ TitleBar (W · 40px · 全宽 · 拖拽区)                                     │
│  [红绿灯 76px][侧栏开关][会话标题]        [PhaseBadge·耗时][右栏开关]    │
├───────────────┬───────────────────────────────────┬───────────────────┤
│ Sidebar (L)   │ Main (M) · 三区                    │ RightPanel (R)    │
│ 260px         │  ┌ Zone 1 · Stream ────────────┐  │ 360px · 可折叠 0   │
│ SideHeader    │  │ ErrorStrip（钉顶，可关）      │  │  审查 / 辅助对话   │
│ SideNav       │  │ EventStream 阅读列           │  │                   │
│ SidebarFooter │  │  文本行 + 思考行 + 工具行      │  │ （终端 / 浏览器     │
│ 可折叠 0      │  │  变更汇总卡 + 动作条          │  │   无后端 · 不做）   │
│               │  └──────────────────────────────┘  │                   │
│               │  ┌ Zone 2 · GateSlot（唯一）───┐  │                   │
│               │  │ Approval | Clarify | Plan    │  │                   │
│               │  └──────────────────────────────┘  │                   │
│               │  ┌ Zone 3 · Composer ──────────┐  │                   │
│               │  │ GoalPanel（条件渲染）         │  │                   │
│               │  │ ContextRow（文件夹/工作树）   │  │                   │
│               │  │ ComposerCard（附件/输入/控件）│  │                   │
│               │  │ StatusStrip（轮/步/tok/缓存） │  │                   │
│               │  └──────────────────────────────┘  │                   │
└───────────────┴───────────────────────────────────┴───────────────────┘
覆盖层：SettingsPage（整页覆盖 · v2.3）／Onboarding、EmptyState（接管 Main 三区）
```

- **W 层（TitleBar）**：窗口级 chrome。`titleBarStyle: "hiddenInset"` 已定（`apps/desktop/src/main/index.ts`），红绿灯由系统绘制，左侧预留 76px 避让位；整条 `-webkit-app-region: drag`，其中所有可点元素 `no-drag`。右端除 PhaseBadge 外新增**右栏开关**（v2）。
- **L 层（Sidebar）**：会话导航。默认 260px，可拖拽右缘调整 220–360px，可整体折叠为 0（记忆在渲染层，V1 不落 settings）。
- **M 层（Main）三区**：Stream（滚动）/ GateSlot（固定槽位）/ Composer（固定）。**GateSlot 与 Composer 不随流滚动**——它们是「需要用户动作」的常驻面。v2 起 Composer 区内含「GoalPanel → ContextRow → ComposerCard → StatusStrip」四层。
- **R 层（RightPanel · v2）**：360px，可折叠为 0；**审查 / 辅助对话**两个面板。终端与浏览器因无后端**明确不做**（§8）。
- **覆盖层**：SettingsPanel 悬浮于全窗（带 scrim）；Onboarding 与 EmptyState 接管 Main 三区（不遮挡侧栏）。

### 1.2 主区三区 × 应用状态矩阵（状态仲裁唯一表）

| 应用状态 | Zone 1 Stream | Zone 2 GateSlot | Zone 3 Composer |
|---|---|---|---|
| 首启未完成 | —（被 Onboarding 接管） | — | — |
| 无会话（新任务） | EmptyState 取代 | 空 | 启用（占位「发消息或创建任务，/ 调用指令，@ 文件或对话」） |
| 会话 · 空闲 | 历史行 | 空 | 启用 |
| 会话 · 运行中 | 流式行 + 尾随呼吸光标 | 空 | **输入禁用**（占位「会话运行中…」）· SendButton=■ |
| 会话 · 门槛（ask/clarify/plan） | 历史行 | **有且仅有一张卡** | 输入禁用（占位「等待你的决定…」）· SendButton=■ |
| 会话 · 已停止 | 历史行（含停止留痕） | 空 | 启用 |
| 会话 · 出错 | 历史行 + 错误行 | 空 | 启用；run 级失败另出 ErrorStrip |
| 设置打开 | 不变（被整页设置覆盖） | 不变 | 不变（SettingsPage 全覆盖，TitleBar 除外） |

不变式：**GateSlot 至多一张卡**；`ask > clarify > plan` 优先级（与 `deriveRunPhase` 四参口径一致）。

### 1.3 窗口尺寸与断点

| 窗口宽 | Sidebar | 阅读列 | 水平 gutter | 说明 |
|---|---|---|---|---|
| ≥1320 | 260（可拖） | 820 居中 | 32 | 完整态 |
| 1024–1320 | 240 | 流式 max 760 居中 | 24 | 默认窗口（1200×800）落此档 |
| 880–1024 | 220，**可自动折叠** | 流式 max 680 | 20 | 窄窗态；建议折叠侧栏 |
| <880 | —（不支持） | — | — | 设 `minWidth: 880, minHeight: 560` |

布局纪律（v2 原型实测教训，写死）：
- **阅读列 = `min(var(--reading), 100%)`**：`--reading` 只是上限，任何列宽档下都不允许越出所在区（门槛卡/目标面板/状态条同列收口）。
- **主区栅格必须显式 `grid-template-columns: minmax(0, 1fr)`**：隐式 `auto` 列会被某个子元素的 min-content 撑宽并越栏——三栏化后这是最先炸的地方。
- **R 层右栏 360px**：主区可用宽 = 窗口 − 侧栏 − 右栏；窄窗优先折叠右栏，再折叠侧栏。

- 默认窗口 1200×800 保持现状；建议补 `minWidth/minHeight`（当前 `BrowserWindow` 未设下限）。
- 阅读列 = Stream 内容与 ComposerCard **共用同一条中轴**（同宽同居中），形成单一视觉脊柱。
- 全屏（`fullscreen`）时 TitleBar 保持 40px（拖拽与标题仍需要），红绿灯由系统隐藏。

---

## 2. 组件层级树（自顶向下，唯一归属）

```
AppShell
├── TitleBar
│   ├── (红绿灯占位 · 系统绘制)
│   ├── SidebarToggle          — Button·ghost 变体
│   ├── SessionTitle           — 标题 + 全量 tooltip
│   └── PhaseBadge             — StatusDot(lg) + 相位文案 + 运行秒表
├── Sidebar ──────────────────────────────── [区域]
│   ├── SideHeader
│   │   ├── NewTaskButton（新会话）— 白底圆角按钮
│   │   ├── SideMenu（插件 / 自动化任务 / 技能中心 / 记忆系统 → 应用页）
│   │   └── WorkspaceSectionHead（搜索 / 筛选 / 新建工作区 + 行内表单）
│   ├── SideNav
│   │   └── ProjectGroup × N（可折叠）
│   │       └── SessionItem × N
│   │           ├── StatusDot（仅运行/等待/出错显示）
│   │           └── (⋯ 菜单 — Popover·Menu)
│   └── SidebarFooter
│       ├── SettingsEntry      — Button·ghost
│       └── UserChip           — 头像 + (Popover·Menu：关于/更新/license)
├── Main ─────────────────────────────────── [区域 · 三区]
│   ├── Zone 1 · Stream
│   │   ├── ErrorStrip（条件 · 钉顶）
│   │   └── EventStream（滚动容器 + 阅读列）
│   │       ├── UserMessage
│   │       ├── ThinkingRow（v2 · 浅色/可折叠/动效 · C-31）
│   │       ├── AgentMessage（含 live 流式态）
│   │       ├── ToolRow（默认折叠 → 完成态收进变更卡）
│   │       │   └── DiffView（展开时）
│   │       ├── ChangeSummaryCard（v2 · C-32）
│   │       ├── ActionBar（v2 · C-33）
│   │       ├── (错误行 / 决议行 — 内联行)
│   │       └── (回到最新 Pill — 内联能力)
│   ├── Zone 2 · GateSlot（至多一张）
│   └── Zone 3 · Composer
│       ├── GoalPanel（v2 · C-34）
│       ├── ContextRow（v2 · C-35：文件夹 chip + 工作树 chip）
│       ├── ComposerCard
│       │   ├── SlashMenu（v2 · C-37）
│       │   ├── AttachmentChips（v2 · C-36）
│       │   ├── 输入（textarea 自增高）
│       │   └── 控件行：附件＋ · PermissionToggle · ModelPicker(+思考档) · TokenMeter · SendButton
│       └── StatusStrip（v2 · C-38）
├── RightPanel（v2.2 · R 层 · C-30 · 多标签容器）
│   ├── StartPage（0 标签：居中标记 + 快捷卡栈 ×5）
│   ├── TabBar（标签 × N + ＋ 新建菜单；可多开/关闭）
│   ├── BrowserTab（浏览器：工具条 + URL pill + 内容区 · 原型为演示页）
│   └── SideChatTab（辅助对话：一标签 = 一个独立旁路会话）
├── EmptyState（接管 Main · 无会话时）
├── Onboarding（接管 Main · 首启）
├── SettingsPage（整页覆盖 · C-26）
├── PluginsPage（整页覆盖 · C-39）
├── AutomationPage（整页覆盖 · C-40）
├── SkillsPage（整页覆盖 · C-41）
└── MemoryPage（整页覆盖 · C-42）
```

基础原语（全树复用，不单独占位）：**Button / Input / Select / Toggle**、**Icon**、**Spinner**；
内部基座（不计数、随原语交付）：**Popover·Menu**、**Tooltip**。

---

## 3. 状态机与共享词表

### 3.1 运行相位状态机（事件驱动，唯一事实源 = 事件投影）

```
idle ──send──▶ thinking ──tool_call──▶ tool ──tool_result──▶ thinking ──┐
  ▲                │                        │                          │
  │                └────────── assistant_message（终稿）───────────────┤
  │                                                                     ▼
  ├─────────────────────────────────────────────────────────────── idle(完成)
  │   ▲
  │   │ 门槛（暂停运行，等待用户）：ask | clarify | plan ──决议──▶ 回到 thinking
  │   └─ stopped（用户打断，真值来自 run 收束 aborted）· error（注记见 §3.4）
```

- 相位集合扩展自 `deriveRunPhase`（`ask > clarify > plan > tool > thinking > idle`），增加 UI 侧派生的 `stopped`。
- `stopped` 只在「该会话被 abort 且 run 已收束」时覆盖显示（真值来自 `RunResponse.aborted`，点击打断仅是即时反馈）。

### 3.2 StatusDot 五态 × 相位映射（词表唯一）

| 词表态 | 相位来源 | 视觉 | 动效 | tooltip |
|---|---|---|---|---|
| `idle` 空闲 | 无运行 · 未打开 · stopped | 空心灰点（1px 边） | 无 | 空闲 |
| `running` 运行中 | thinking / tool | 实心橙点 | 呼吸（透明度 1→.35，1.6s） | 运行中 |
| `waiting` 等待你 | ask / clarify / plan | 实心蓝点 | 脉冲环（外环扩散 1.8s） | 等待你的决定 |
| `done` 完成 | 最近一轮干净收束 | 实心绿点 | 无 | 完成 |
| `error` 出错 | 最近一轮失败（run !ok / 事件流 error） | 实心红点 | 无 | 出错 |

＋优化（相对参考清单的三态）：新增 **waiting**——「等待你的决定」与「运行中」对用户是截然不同的注意力需求，
两者共用橙色呼吸会把审批门静默掉。判据：会话存在未决 `ask` / `clarify_requested` / `plan_proposed` ⇒ waiting。
派生规则（渲染层纯投影）：运行集（renderer 侧）> 未决门槛 > 最近轮结果；**未知一律回落 idle，不假造 done**。

a11y：颜色不单独承载语义——五态在形状/环/透明度上可辨；`prefers-reduced-motion` 下所有动效静止，
waiting 改为静态外环、running 改为高亮实心（见 §4.4）。

### 3.3 门槛互斥不变式

- GateSlot 同时至多一张卡；优先级 `ApprovalCard > ClarifyCard > PlanCard`（与现有实现同口径）。
- 门的出现/消失由事件收口：`tool_result(callId)` 收口 clarify、`plan_approved(callId)` 收口 plan、
  `approval_resolved(id)` 收口 approval；**决议后卡片收起，替换为一条安静决议行**（见各卡规格）。
- 门槛期间 Room 3 Composer 禁用；键盘焦点自动进入卡片。

### 3.4 事件 → 组件映射表（V1 可落地）

| 事件 / 通道 | 组件 | 备注 |
|---|---|---|
| `user_message` | UserMessage | `origin`（promote/goal）渲染来源徽标；`skill` 渲染技能徽标 |
| `assistant_message` / `assistant_delta` | AgentMessage | delta 未结桶 = live 行（尾部呼吸光标） |
| `tool_call` / `tool_result` | ToolRow | 终态取 `ok` / `blockedBy` / `hold` / `exitCode` / `timedOut`；diff 类展开为 DiffView |
| `error` | 内联错误行 | 消息原文；不自动消失 |
| `clarify_requested` | ClarifyCard | `questions[].options/multiSelect` |
| `plan_proposed` | PlanCard | `files[].action`、`verify.lint/test` |
| `onAsk`（IPC） | ApprovalCard | `risk` / `riskReasons` / `reason` / `tier_warning` / `sentAt` |
| `usage` | TokenMeter | 聚合 + hover 详表；`compact()` 入口 |
| run 级失败（`RunResponse !ok`、IPC reject、三卡提交失败） | ErrorStrip | 按会话键控，切会话各看各的 |
| `agent_spawned` | ToolRow（worker 变体） | V1 仅一行摘要；展开细节属 V2 |
| 其余 30 类事件 | — | 见 §3.5 |

### 3.5 V2 投影扩展建议（明确留位，不在 V1 偷做）

| 建议 | 理由 | 数据源 |
|---|---|---|
| `verify_result` 成行（验证拍行：✓/✕ + 命令 + 归因） | 验证是本 harness 的客观判据，当前 UI 完全不可见 | `VerifyResultEvent.cause/exitCode` |
| `approval_resolved` / `plan_approved` / `clarify` 收口留痕行 | 卡片收起后决议不可回溯（靠重开会话） | 对应事件 |
| worker 簇（spawn→status→result 聚合一行，展开看 progress/report） | `agent_id` 子流现被全滤，多 agent 是核心能力 | `agent_status/agent_message/agent_result`；含 `artifacts.verified/spent_usd` |
| `impact_report` / `security_report` / `compaction` 安静行 | 已落流、零 UI 面 | 对应事件 |
| 分支 chip 数据 | `ContextChips` 需要 git 分支名，IPC 无此通道 | main 侧新增 `gitBranch(workspace)` |
| 附件引用（拖入文件 → chips） | `RunRequest.attachments` 已有面 | `RunAttachmentReference` + drop 交互 |

---

## 4. 视觉系统（暖米白 · 精修）

方向：**近单色暖米白画布 + 语义着色**。色彩只承担语义（风险/错误/完成/运行/等待/diff），
装饰归留白、字重与层次。所有数值以 CSS 变量交付，明暗两套共用语义名。

### 4.1 色彩 token（含三处精修）

```css
:root {                        /* 浅色 · 暖米白 */
  /* 画布与表面 */
  --canvas:#f7f6f3; --surface:#ffffff; --surface-2:#ebe8e2; --surface-3:#e3e0da;
  --side-bg:#f2efe9;            /* ＋v1.1：侧栏底（比主区深一阶，明暗同一套语义；暗色 #262220） */
  --hairline:#e3e0da; --hairline-strong:#d9d4cb;
  --scrim:rgb(31 30 28 / .18); /* ＋优化：Sheet 遮罩（原实现无遮罩，焦点归属不清） */
  /* 文字（三阶） */
  --text-1:#1f1e1c; --text-2:#6e6960; --text-3:#756e63;
  /* ↑精修：text-3 旧值 #8f887c 对画布仅 ≈3.2:1，10–11px 小字不达标；#756e63 ≈4.6:1 */
  /* 语义色 */
  --accent:#26221c; --accent-ink:#f7f6f3;
  --ok:#23a55a; --ok-ink:#1a7f3f;
  --risk:#f5a623; --risk-ink:#9a6a00;
  --danger:#d93025; --danger-ink:#b3261e;
  --run:#e8930c;                 /* 运行中（橙·呼吸） */
  --wait:#4a6fae;                /* ＋优化：等待你（蓝·脉冲环）；waiting 与 running 必须可分 */
  /* diff 四件套（原实现缺失，DiffView 依赖） */
  --diff-add-bg:#e9f4ec; --diff-del-bg:#fcecea;
  --diff-add-ink:#1a7f3f; --diff-del-ink:#b3261e;
}
@media (prefers-color-scheme: dark) { :root {
  --canvas:#201d19; --surface:#2a2620; --surface-2:#35302a; --surface-3:#3f3931;
  --hairline:#35302a; --hairline-strong:#4a443c;
  --text-1:#ece7de; --text-2:#a29c92; --text-3:#8f887c;
  --accent:#ece7de; --accent-ink:#201d19;
  --ok-ink:#4fbe77; --risk-ink:#e0b25c; --danger-ink:#ff6b60;
  --wait:#7ea6dd;
  --diff-add-bg:#1d2f22; --diff-del-bg:#3a2320;
} }
```

规则：文字/图标用 `-ink` 变体保证对比；圆点、竖条、diff 底色用基色；同一语义不得出现第二个近色。

### 4.2 字体与排版

- UI 字体：`-apple-system, "PingFang SC"`（macOS 原生习惯，桌面应用不做异形字体实验）。
- 等宽：`ui-monospace, SFMono-Regular, Menlo`——工具行、参数、diff、token 数一律等宽。
- 字号 scale（7 级）：

| token | 值 | 用途 |
|---|---|---|
| `--fs-2xs` | 10 | 时间戳、角标（**tabular-nums**） |
| `--fs-xs` | 11 | 工具行、meta、hint |
| `--fs-sm` | 12 | 次级标签、按钮小号、菜单项描述 |
| `--fs-md` | 13 | 正文（行高 1.65） |
| `--fs-lg` | 15 | 小标题、卡片标题 |
| `--fs-xl` | 17 | 面板标题 |
| `--fs-2xl` | 22 | EmptyState/Onboarding 标题 |

- ＋优化：所有数字列（时间戳、时长、token、diff stat、行号）加 `font-variant-numeric: tabular-nums`，跳动不再横移。

### 4.3 间距 / 圆角 / 阴影

```
--s-1:2 --s-2:4 --s-3:8 --s-4:12 --s-5:16 --s-6:24 --s-7:32   （原缺 s-7，EmptyState/Onboarding 需要）
--r-sm:6 --r-md:9 --r-lg:12 --r-pill:999                       （sm/md 各 +1，收口更柔和）
--shadow-card: 0 1px 2px rgb(60 50 30 / .05), 0 1px 6px rgb(60 50 30 / .04)
--shadow-pop:  0 8px 28px rgb(60 50 30 / .14), 0 2px 8px rgb(60 50 30 / .08)   （弹层/Sheet）
--reading:820px；流式列与 ComposerCard 共用
```

### 4.4 动效（全部语义化，全部可静止）

| 名称 | 用途 | 定义 | reduced-motion |
|---|---|---|---|
| `breathe` | running 点、live 光标、时间戳呼吸 | opacity 1→.35→1，1.6s ease-in-out ∞ | 静止为全亮 |
| `pulse` | 工具行 pending、按钮 loading | opacity 1→.25→1，1s ∞（或 spinner 旋转） | 静止为全亮 |
| `pulse-ring` | waiting 点 | box-shadow 0 0 0 0 → 0 0 0 5px 透明，1.8s ∞ | 静态外环 |
| `t-fast` | hover/focus 色彩过渡 | 120ms ease | 不变 |
| `t-med` | 卡片出现/收起、Sheet 滑入 | 200ms cubic-bezier(.2,.8,.2,1) | 直接出现 |
| `reveal` | 新行进入流 | opacity+上移 4px，160ms（仅新行，不回放） | 直接出现 |

＋优化：现有 `breathe/pulse` 无 `prefers-reduced-motion` 守卫——补齐为纪律（眩晕风险）。

### 4.5 焦点与键盘总表

| 键 | 作用域 | 行为 |
|---|---|---|
| `Enter` | Composer | 发送（IME 组字中不触发）；`Shift+Enter` 换行 |
| `Cmd+Enter` | Composer | 始终发送 |
| `Cmd+.` | 运行中 | 打断本轮（等价点 ■） |
| `Cmd+N` | 全局 | 新任务（回到 EmptyState 态） |
| `Cmd+\` | 全局 | 折叠/展开侧栏 |
| `Cmd+,` | 全局 | 打开/关闭 SettingsPanel |
| `Esc` | 弹层/Sheet | 关闭最上层弹层（Focus 归还触发元素） |
| `Esc` | 门槛卡 | **不做决议**（防误触；必须显式点按或聚焦后 Enter） |
| `Tab / ⇧Tab` | 全局 | 顺序 = TitleBar → Sidebar → Stream → Gate → Composer；弹层内焦点陷阱 |
| `↑/↓` `Enter` | Menu | 导航/选中；`Esc` 关闭 |

焦点规则：门槛出现 ⇒ 焦点进卡片首个动作；澄清提交 ⇒ 焦点回 Composer；弹层关闭 ⇒ 焦点回触发器。
可见焦点环：`outline: 2px solid color-mix(in srgb, var(--accent) 45%, transparent); offset: 2px`（旧 1px 太弱）。

---

## 5. 组件规格（29 条目）

> 每条格式：**区域/层级** → **域映射** → **结构** → **状态表** → **交互** → **a11y** → **＋优化**。
> 「落地」栏给出实现落点：复用现有文件 = 精修；新文件 = 新增。

### 5.1 布局骨架（2）

#### C-01 `AppShell`
- **区域/层级**：根组件；编排 TitleBar + Sidebar + Main(三区) + 覆盖层。
- **域映射**：自身无域数据，持有全局渲染态：`activeId` / `projects` / `runningSet` / `sessionErrors`（均沿用现有实现）。
- **结构**：CSS Grid：`rows: 40px 1fr / cols: auto 1fr`；TitleBar 跨两列。
- **状态表**：

| 状态 | 触发 | 视觉 |
|---|---|---|
| booting | `getSettings` 在途 | 安静载入面（居中 cairn 标记 + 「正在载入设置…」） |
| onboarding | `needsOnboarding` | Onboarding 接管 Main |
| ready | 其余 | 正常三区 |

- **交互**：窗口拖拽（TitleBar 区域）；侧栏折叠时 Main 平滑扩展（t-med）。
- **落地**：精修 `App.tsx`（拆出布局层，转让本文件后续瘦身）。
- **＋优化**：三区「状态仲裁矩阵」（§1.2）从散落条件收成一张表；booting 面由「卡片」改为安静标记，降噪。

#### C-02 `TitleBar`
- **区域/层级**：W 层全宽 40px；AppShell 直系子。
- **域映射**：`activeId`（标题）。
- **结构**：`[红绿灯 let 76px][SidebarToggle] …〔SessionTitle：对中栏居中〕… [RightToggle]`（v2.6：PhaseBadge 已删）。
- **状态表**：

| 状态 | 视觉 |
|---|---|
| 默认 | 画布同色（不描边、不投影），标题 text-1/13 中黑，**水平居中于中栏**（left/width 随布局同步） |
| 无会话 | 标题 = `Cairn`（text-2） |
| 运行中 / 门槛 / 已停止 | **相位不进标题栏**（v2.6 用户裁定删除 PhaseBadge）——状态由侧栏 StatusDot 与对话流承担 |
| 全屏 | 红绿灯位由系统隐藏；其余不变 |

- **交互**：双击拖拽区 = 系统缩放（macOS 默认）；SidebarToggle 点击/`Cmd+\` 切换侧栏；RightToggle 切换右栏（标题随之重对齐）。
- **a11y**：标题 `title` 属性给全量（截断时）；标题 `pointer-events:none`（不挡右侧按钮）；拖拽区不含交互元素。
- **落地**：新增 `components/TitleBar.tsx`（现无此组件；`hiddenInset` 已定，补 UI 面）。
- **＋优化**：原实现无标题栏——渲染区顶部被系统红绿灯与内容争位；显式 40px chrome + 76px 避让是 `hiddenInset` 的正确配套。
  v2.6：标题改为**对齐中栏居中**（参考 ResizeObserver 观察中栏，同步 left/width；侧栏折叠、右栏开合、窗口与宽度档变化均即时重对齐）；原相位文案与秒表随 PhaseBadge 删除。

### 5.2 侧栏（6）

#### C-03 `SideHeader`
- **区域/层级**：Sidebar 顶部（固定，不随列表滚动）；含 NewTaskButton、SideMenu、WorkspaceSectionHead。
  （v1.1：替代原 `WorkspaceSwitcher`，按用户参考图改版；v2.5：标签行已整行移除。）
- **域映射**：`createSession()` + 空态聚焦（新会话）；
  `listProjects()` / `addProject()` / `pickDirectory()`（区头「新建工作区」行内表单）；
  功能菜单 → 应用页（C-39…C-42：插件 / 自动化任务 / 技能中心 / 记忆系统，均为整页覆盖）。
- **结构**：
  `[新会话按钮：白底圆角，图标+居中文字]` →
  `[功能菜单 ×4：插件 / 自动化任务 / 技能中心 / 记忆系统（图标+文字行 → 打开应用页）]` →
  `[工作区区头：标签文本 + 搜索 / 筛选 / 新建工作区 三个图标钮]` →（条件）行内新建工作区表单。
- **状态表**：

| 状态 | 视觉 |
|---|---|
| 新会话 · 默认 | `--surface` 白底、r-10、38px 高、14px/500 居中；1px 描边 + 轻投影 |
| 新会话 · hover / active | 投影加深（0 2px 8px）/ scale .99 |
| 菜单行 · 默认 / hover / on | 透明 / 墨色 5% 底 / 墨色 7% 底 |
| 标签行 | 已移除（v2.5：无第二视图，整行删除；工作区区头即列表标签） |
| 区头图标 · hover | text-3 → text-1 + 5% 底 |

- **交互**：新会话 → 进空态并聚焦 Composer；菜单行点击 → 打开对应应用页（C-39…C-42）；
  「新建工作区」→ 行内表单（路径输入 + 添加；canonical 化后置顶并设为新任务归属）；
  **搜索 / 筛选（v2.13 已落地）**：放大镜 → 行内搜索框（标题过滤，命中为空的分组整组隐藏，全空给「没有匹配」注记）；漏斗 → 状态筛选菜单（全部/运行中/等待决定/出错/已完成/空闲，按状态点过滤）；真实实现读会话索引。
- **a11y**：图标钮 `aria-label`；菜单行为 button 语义；工作区区头承担列表标题语义。
- **落地**：新增（`Sidebar.tsx` 拆分；原 WorkspaceSwitcher 方案作废）。
- **＋优化**：把最高频动作「新建任务」从隐式（直接打字）升级为显式一级按钮；插件/自动化/技能/记忆四入口
  从零 UI 面收进唯一导航区；工作区切换语义改由「蓝色文件夹 = 新任务归属」+ 区头添加承载，删掉冗余的顶部切换器。

#### C-04 `SideNav`
- **区域/层级**：Sidebar 中部，滚动容器（`ProjectGroup` 序列；「任务」标签视图）。
- **域映射**：`groupByWorkspace()` 纯函数输出（注册顺序保持、空组也列、未登记会话落「其他」哨兵组）。
- **结构**：分组直出；无底部按钮（「添加工作区」已移入区头，v1.1）。
- **状态表**：默认 / 滚动中（滚动条 8px hairline）/ 空（注册表可用但零会话：仍列空组）/ 频道视图（占位说明行）。
- **交互**：滚动；组间间距 2；「其他」组恒垫底。
- **a11y**：`<nav>` + `aria-label="会话导航"`；组可折叠状态 `aria-expanded`。
- **落地**：精修 `Sidebar.tsx`（分组纯函数不动——它是既有被测试资产）。
- **＋优化**：删除底部「＋ 添加工作区」（与区头入口重复）；缩进对齐——会话文字与组名文字同列（x=39px 口径）。

#### C-05 `ProjectGroup`
- **区域/层级**：SideNav 内；含 header + `SessionItem` 序列。**可折叠**。
- **域映射**：`workspace`（canonical path）、`sessions[]`；新任务归属 = 组上的 `data-active`（渲染态）。
- **结构**：`[文件夹图标][名称=路径末段][chevron（hover 淡入 / 折叠时常显，右侧）]` + 会话行。
- **状态表**：

| 状态 | 视觉 |
|---|---|
| 默认 | 名称 text-1/14/500；文件夹 text-3 |
| hover | 5% 底（r-8）；chevron 淡入 |
| active（点中的对话所在组） | **文件夹图标 = `--wait` 蓝**；着色跟随「点中的对话」所在组，**没点到的不变色**（v2.4）；无选中会话（空态/首启）时全部灰 |
| 折叠 | chevron 常显并右转 90°；会话行收起（200ms） |
| 「其他」哨兵 | 名称 text-2；恒垫底；无归属标记 |

- **交互**：点击 header = 折叠/展开；hover 出 `title` = 全路径。
- **a11y**：`aria-expanded`；header 为 button 语义、可聚焦。
- **落地**：精修 `Sidebar.tsx` 的分组头。
- **＋优化**：v1.1 按参考图：归属标记由左竖条改为蓝色文件夹（「这里是当前工作区」语义更直）；删除计数徽标（噪声）；
  折叠提示移右侧 hover chevron（不与名称抢位）。

#### C-06 `SessionItem`
- **区域/层级**：ProjectGroup 内（行）。
- **域映射**：`SessionInfoPayload`（id/title/pinned/mtimeMs/updatedAt + desktop 扩展 workspace）、运行集、未决门槛、
  最近轮结果（§3.2 派生）；`⋯` 菜单对应 `setSessionPinned/setSessionArchived/renameSession/deleteSession`。
- **结构**：`[注意力状态点?][标题 1 行截断][相对时间]`；hover 右侧出 `⋯`。
- **状态表**（v1.1 参考图口径）：

| 状态 | 视觉 |
|---|---|
| 默认 | 行 text-1/14；时间 text-3/12 tabular（右对齐） |
| hover | 5% 底；`⋯` 淡入（时间让位隐藏） |
| active | 灰底药丸（墨色 8% 混 `--side-bg`、r-9）；**无左竖条** |
| 运行 / 等待 / 出错 | 状态点显示（橙·呼吸 / 蓝·脉冲环 / 红）；点在标题左 10px 槽位 |
| done / idle | **不显示状态点**（参考图口径：常规会话保持安静） |
| pinned | 标题前 12px 钉形 icon（text-3）；置顶于组内 |

- **交互**：点击 = 打开会话（沿用 seq 竞态守卫）；`⋯` → 菜单：重命名（行内编辑）/ 固定 / **分叉…** / 归档 / 删除（danger，二次确认）；
  **v2.13 原型已全部落地**：重命名行内输入（Enter 提交 / Esc 取消）；固定 → 置顶该组 + 「固定」小标（菜单文案切「取消固定」）；
  归档 → 移入末尾「已归档」组（菜单文案切「还原」）；删除 → 移除行（选中态同步清空）；映射 `AgentApi` 全桥接通道（§3.2）。
  相对时间 hover 出精确时间（`title`）。
- **a11y**：列表 `role="list"`/行 button 语义；删除为 danger 菜单项 + confirm；状态点 `aria-label`（行内由行整体朗读时 `aria-hidden`）。
- **落地**：精修 `Sidebar.tsx` 的 `SessionRow` + 新增 `⋯` 菜单（通道已全桥接，见 `AgentApi`）。
- **＋优化**：v1.1 改版——选中态从「竖条+重字」改为灰底药丸；状态点只在需要注意力时出现（对齐参考图）；
  会话管理动作（重命名/固定/归档/删除，`AgentApi` 全桥接却零 UI 面）由 hover `⋯` 承载；pinned 视觉保留。

#### C-07 `StatusDot`
- **区域/层级**：原语级被复用于 SessionItem（sm 6px）与 TitleBar PhaseBadge（lg 8px）。
  **列表口径（v1.1）**：仅 running / waiting / error 三态在 SessionItem 显示；done / idle 省略（TitleBar 徽标不受此限）。
- **域映射**：§3.2 派生规则（无自身数据）。
- **结构**：单元素圆点；waiting 态带伪元素外环；列表内绝对定位在标题左 10px 槽位（不挤占文本对齐）。
- **状态表**：见 §3.2 五态表（唯一事实源；他处不复制）。
- **交互**：仅展示；挂 `title`（tooltip 词表文案）。
- **a11y**：`aria-label` 给词表文案（会话行内由行整体朗读，点本身 `aria-hidden`）。
- **落地**：精修 `styles.css` `.dot` + 派生函数抽到 `projections.ts` 旁（纯函数）。
- **＋优化**：三态 → 五态；动效补 reduced-motion；形状可辨（空心 vs 实心 vs 外环）；列表内注意力口径收敛（v1.1）。

#### C-08 `SidebarFooter`
- **区域/层级**：Sidebar 底部（不随列表滚动）。
- **域映射**：`getState().about.version / license`、`checkUpdate()`、`openExternal()`。
- **结构**：`[⚙ 设置][ⓘ 关于·更新][用户头像 chip]`；用户菜单含：版本号 / 检查更新 / license 状态。
- **状态表**：

| 状态 | 视觉 |
|---|---|
| 默认 | 上描边 hairline；文字 text-2/12；头像 20px 圆形（accent 墨底 + 反白首字） |
| license 异常 | 头像右上 4px 红点（仅 inactive/expired）；菜单内说明行 |
| 检查更新中 | 「检查更新」项右侧 `Spinner`（pulse） |
| hover | 行底 surface-2 |

- **交互**：⚙ → SettingsPanel；用户菜单：检查更新（结果四态：未配置/网络失败/已最新/有新版——全显式，fail-visible）；
  有新版 → 下载页（`openExternal`，http(s) 白名单）。
- **a11y**：菜单 `aria-haspopup`；更新结果以 `role="status"` 报读。
- **落地**：精修现有 `.settings-entry` + 新增用户菜单。
- **＋优化**：参考清单「设置＋用户」在现实现里只有设置入口；用户菜单把 `license/version/checkUpdate` 三条已有能力收进唯一归属地。

### 5.3 事件流（9）

#### C-09 `EventStream`
- **区域/层级**：Zone 1 主滚动体；含行序列 + 内联能力（回到最新 Pill）。
- **域映射**：`projectStream(events)` 行序列（纯投影，唯一事实源）；`deriveRunPhase` 决定跟滚语义。
- **结构**：滚动容器（`overflow-y: auto`，`overscroll-behavior: contain`）→ 阅读列（max 820 居中）→ 行序列；**＋轮次时间线（v2.11/2.12）**：中栏**左侧**竖排**线段** rail——**一条线段 = 一轮（用户发问 + 模型回复）**（3×13 圆角线段，垂直居中固定、不随滚动走）；**悬停 → 线段突起**（5px、accent、外环 14%）**+ 右侧弹出信息面板**（「第 n 轮 · 时间」+ 该轮用户话 + 模型回复摘要；无模型行时回退展示决议行并标注「结果：」）；**点击 → 平滑滚到该轮 + 整轮**（到下一轮之前，含思考/工具行）**闪高亮** + 线段激活（跨重渲染保留）；轮数 < 2 不显示；中栏 < 580px 整条收起。
- **状态表**：

| 状态 | 视觉/行为 |
|---|---|
| 跟随中（默认） | 运行中新行到达 → 钉底滚动；底部无 Pill |
| 用户上翻 | 暂停跟滚（视口不动）；右下浮出「↓ 回到最新」Pill（surface + shadow-pop，出现 160ms） |
| 回到最新 | 点击/新发送 → 滚回底部并恢复跟随 |
| 空会话 | 列内安静提示：「这个会话还没有事件 · 在下面派活」（text-3 居中，非 EmptyState） |
| 历史加载中 | 行区骨架条（3 条 hairline shimmer，仅 openSession 在途） |
| 轮次时间线（v2.11/2.12） | ≥2 轮显示（左侧预留 100px 槽位，正文列右移、各分区同移保持同列）；单轮隐藏；中栏 < 580px 收起；**线段形态**：悬停突起 + 弹出信息面板；点击跳转 + 整轮 flash |

- **交互**：滚轮自然滚动；`Cmd+End`/点 Pill 回底；新行进入用 `reveal`（仅新行，不重排历史）；轮次 chip 跳转（scrollIntoView + flash + 激活态；`scroll-margin-top` 避让）。
- **a11y**：`role="log"` + `aria-live="polite"`（追加行礼貌播报）；Pill 可聚焦。
- **落地**：精修 `Stream.tsx` / `.stream`。
- **＋优化**：补跟滚暂停/恢复与 Pill（长任务几乎必需）；「呼吸的时间戳」收窄为**仅未决行**时间戳呼吸（全局呼吸=噪声）；
  行节奏：逻辑行距 12，工具簇内距 4 + 左侧 1px 轨道（视觉成簇，扫读友好）。

#### C-10 `UserMessage`
- **区域/层级**：EventStream 行；序号 `seq` 排序（全序不乱）。
- **域映射**：`UserMessageEvent`（content / origin / skill）。
- **结构**：`[来源徽标?][技能徽标?] 文本` + 行尾时间戳（hover 显精确时间）。
- **状态表**：

| 状态 | 视觉 |
|---|---|
| 默认 | text-1 / 13 / 500 字重 / 行高 1.7；上边距 16（与上一条逻辑行拉开） |
| 来源徽标 | `origin.kind=promote` →「已提升」（outline chip）；goal →「自动续跑」 |
| 技能徽标 | `skill` 在场 →「技能 · <名>」chip（surface-2 底） |
| hover | 行尾显 `⧉ 复制` ghost 按钮（20ms 淡入） |

- **交互**：hover 复制全文（成功 → 按钮短暂变 ✓）。
- **a11y**：徽标 `aria-label` 展开语义（如「来自旁路对话提升」）。
- **落地**：精修现有 `.row-user`。
- **＋优化**：origin/skill 两个已落流字段当前 UI 不可见；复制是所有长对话的高频动作。

#### C-11 `AgentMessage`
- **区域/层级**：EventStream 行。
- **域映射**：`assistant_message`（终稿）/ `assistant_delta`（live 桶）。
- **结构**：`[✦ 标记][文本][live 光标?][代码块（行内能力）][时间戳]`。
- **状态表**：

| 状态 | 视觉 |
|---|---|
| 终稿 | ✦ 20% 透明；text-1/13/1.7 |
| live 流式 | 尾部呼吸光标 `▮`；时间戳用首 delta 的时刻（与行位置一致——既有口径） |
| 含代码块 | 等宽块：surface-2 底、r-md、lang 标签 10px、右上「复制」；>12 行折叠 +「展开 N 行」 |
| 长文本 | 段落间距 8；列表项悬挂缩进 16 |

- **交互**：`cmd` 类标记渲染为圆角 chip；代码块复制、行展开；链接默认在系统浏览器打开（`openExternal`，仅 http(s)）。
- **a11y**：live 行在 `role="log"` 内礼貌播报（不逐 delta 播报——桶合并后播报，防读屏风暴）。
- **落地**：精修（新增长度折叠与复制；markdown 最小子集渲染器为要实现项：段落/列表/行内码/围栏码/粗体）。
- **＋优化**：模型输出天然含 markdown，现实现纯文本直出——代码块无着色无复制，是审查体验短板。

#### C-12 `ToolRow`
- **区域/层级**：EventStream 行；连续工具行自动成**步骤簇**。
- **域映射**：`tool_call` + `tool_result`（按 callId 收口）；终态字段全用：`ok / blockedBy / hold / exitCode / timedOut`；
  duration = result.ts − call.ts；`agent_spawned` 走 worker 变体。
- **结构**：`[▸ chevron][状态字形][工具名][· 摘要(args 首参)] … [时长][时间戳]`；展开区：参数（mono）+ 结果输出（mono，max-h 240 滚动）。
- **状态表**（终态六态，全部可辨）：

| 状态 | 字形 | 视觉 | 判据 |
|---|---|---|---|
| pending | `●` 脉冲 | 字形 pulse；时长走秒 | 无 result |
| ok | `⌁` | text-3 常规；展开默认收起 | `ok:true` |
| failed | `✕` | danger-ink；摘要行仍安静（不加底色） | `ok:false` 且无 `blockedBy/hold` |
| blocked 未执行 | `⊘` | risk-ink；摘要后补「（被 <闸名> 拦下，未执行）」 | `blockedBy` 在场 |
| held 未派发 | `⏸` | risk-ink；「（被 harness 按住：<原因>）」 | `hold` 在场 |
| timeout | `⌛` | risk-ink；时长后补「· 超时」 | `timedOut:true` |

- **交互**：点击行/chevron 展开收合（`aria-expanded`）；展开显示参数与输出（输出 > 12 行折叠）；
  diff 类工具（`write_file/edit_file/apply_patch`）展开区渲染 **DiffView**；输出复制按钮。
  运行中行时长每秒自走；收口后定格为「1.2s / 1m04s」。
- **a11y**：字形均有 `aria-label`；失败/拦下文案完整（不只靠色）。
- **落地**：精修 `Stream.tsx` 工具行 + 新增展开面板。
- **＋优化**：`blockedBy/hold/timedOut/exitCode` 四种终态**已落事件、UI 零表达**——「失败」与「压根没起」在 UI 上同形
  （与内核刚修掉的形状问题同款）。时长为零 UI 面，补上。

#### C-13 `DiffView`
- **区域/层级**：ToolRow 展开区内（diff 类工具）；不独立成行。
- **域映射**：`tool_result.change`（created/modified；缺席标 unknown）、`tool_result.snapshotId`、`DiffCommentEvent`（V2 行级评论）。
- **结构**：`[文件路径 mono][动作徽标 新建/修改/删除][stat +n −m][复制 patch]` → hunks：`@@ 头` + 行（旧/新行号 gutter + `+/−/ ` 前缀 + 代码）。
- **状态表**：

| 状态 | 视觉 |
|---|---|
| 新增行 | `--diff-add-bg` 底 + `+` 前缀 + `--diff-add-ink` |
| 删除行 | `--diff-del-bg` 底 + `−` 前缀 + `--diff-del-ink` |
| 上下文行 | 透明底；行号 text-3 |
| 折叠（>40 行） | 首 40 行 + 「显示全部 N 行」 |
| 快照留痕 | 尾部脚注「覆盖前快照已保留（.agent/snapshots）」——`snapshotId` 在场才出 |
| change 未知 | 徽标显「变更」（不猜 created/modified） |

- **交互**：hunk 折叠/展开；复制 patch；V2：行 hover 出「评论」（`DiffCommentEvent` 链路已存）。
- **a11y**：着色不单独承载——`+/−` 前缀与行号并存；表格化朗读（`role="table"` 或逐行 aria）。
- **落地**：新增 `components/DiffView.tsx`（现无 diff 渲染；worker diff 在 CLI 有「整块可审查」纪律，UI 对齐它）。
- **＋优化**：参考清单「绿红着色」是最低要求；补 stat、动作徽标、快照脚注、折叠策略与色盲冗余。

#### C-14 `ApprovalCard`
- **区域/层级**：GateSlot 唯一卡（优先级最高）。
- **域映射**：`AskPayload`（askId/tool/args/reason/risk ∈ none|low|medium|high|critical/riskReasons/tier_warning/sentAt）；
  决议 `decide(askId, approved, scope ∈ once|always)`；收口 `approval_resolved`。
- **结构**：**默认紧凑 + 详情折叠**（v2.9）：`【头行：⚠ + 标题「需要你批准」+ 工具名 chip + 风险 chip + 「网络出网 · 一次性」chip + 详情 ▾】→【命令行：mono 单行省略号截断】→【动作行：允许·本次 / 拒绝 / 总是允许… + 「Esc 不做决议」】`；展开详情 → 原因行 / 风险点列表 / 网络注记全文（默认折叠；折叠高约 120px、展开约 240px）。
  （v2.8 三段带染底方案已回退——用户裁定「门卡＋输入框合计占高过大」；v2.5 左侧竖条维持移除。）
- **状态表**（v2.5：左侧风险竖条已移除，风险由头部 chip 承载）：

| 状态 | 视觉 |
|---|---|
| pending · risk low/none | 风险 chip 中性描边；⚠ 图标色随风险 |
| pending · risk medium | 风险 chip 琥珀（risk） |
| pending · risk high/critical | 风险 chip 红（danger）；标题用词不变（不渲染恐慌） |
| 网络类命令 | 命令块下注记：「批准 = 本次命令放行网络出网（一次性，不记忆）」（risk-ink） |
| tier_warning | 警告行（risk-ink）：「worker 越界请求档位，已裁到父档」+ 原文 |
| submitting | 被点按钮 loading；三键禁用 |
| resolved | 卡收起 → 安静决议行「✓ 已允许（本次）」/「✕ 已拒绝」+ scope |
| 提交失败 | 卡保持 + ErrorStrip「审批提交失败」 |

- **交互**：`[允许 · 本次]`（primary）/`[拒绝]`（secondary）/`[总是允许 ▾]`（ghost；**二次确认**：点后按钮变
  「确认总是允许？」，2.5s 无响应回退——持久提权值得一次确认）；`Esc` 不做决议；Tab 可达全部动作。
- **a11y**：`role="alertdialog"` + 标题/描述关联；风险点列表可朗读；焦点自动进卡。
- **落地**：精修 `ApprovalCard.tsx`（现实现有 shell 但无原因/风险点/网络注记渲染——`AskPayload` 字段全在）。
- **＋优化**：`riskReasons/tier_warning/reason` 三字段「审批卡必显」是内核纪律（§11.1），现 UI 未收全；
  网络一次性语义、总是允许二次确认、决议行留痕均为新增。

#### C-15 `ClarifyCard`
- **区域/层级**：GateSlot 唯一卡（次优先）。
- **域映射**：`ClarifyRequestedEvent.questions[]`（question/header/options[{label,description}]/multiSelect）；
  提交 `submitClarify(callId, answers)`（key=问题原文，value=string|string[]）；空答案语义 = 如实告知模型「未答复」。
- **结构**：`〔标题「需要你补充信息」+ wait chip〕` + 逐题块：`[header 小标签][问题文本][选项 chips（2–4，单选=radio/多选=check）][自由补充输入][跳过]` + `[提交全部]`。
  （澄清卡保持**全表单不折叠**——它本身就是输入面；门卡待决时输入区的极简态见 C-18。）
- **状态表**：

| 状态 | 视觉 |
|---|---|
| 默认 | 每题独立块，题间距 12；选项 chip 未选 = hairline 描边 |
| 已选 | chip 选中 = surface-2 底 + accent 描边 + ✓ |
| 跳过 | 该题块压暗（opacity .55）+ 标签「已跳过」；提交后计入回复数 |
| submitting | 提交钮 loading，输入禁用 |
| 提交失败 | 卡保持 + ErrorStrip（输入不丢） |
| 无选项题 | 只出自由输入（placeholder「你的答复…」） |

- **交互**：单/多选 chip 点击切换；自由输入可覆盖选项（输入优先）；提交后卡收起 → 决议行「已提交答复（3 题 · 1 题跳过）」；
  `Cmd+Enter` 提交；跳过是诚实动作——**含全部跳过的提交也允许**（UI 文案：跳过的题会如实告诉模型「未答复」，不会替你编答案）。
- **a11y**：fieldset/legend 语义（header=legend）；多选 `aria-multiselectable`；焦点落在首题。
- **落地**：精修 `ClarifyCard.tsx`（现实现已有基础表单，补 header/description/跳过/决议行）。
- **＋优化**：`header`、`options[].description`、`multiSelect` 三字段现未渲染；「跳过」与诚实文案是新增（把内核的
  「空答案不是批准」哲学翻译成人话）。

#### C-16 `PlanCard`
- **区域/层级**：GateSlot 唯一卡（最低优先）。
- **域映射**：`PlanProposedEvent.plan`（goal/files[{path,action: create|edit|delete,summary}]/approach/verify{lint,test}）；
  决议 `decidePlan(approved, callId)`；收口 `plan_approved`。
- **结构**：**默认紧凑 + 详情折叠**（v2.9）：`【头行：标题「模型提交了方案」+ wait chip + 详情 ▾】→【目标行：单行省略号截断】→【动作行：批准方案 / 拒绝 + 「3 个文件 · 验证面 pnpm lint / test」】`；展开详情 → approach 段 / 文件清单 / 验证面 chips / 后果行（折叠高约 111px、展开约 294px）。
- **状态表**：

| 状态 | 视觉 |
|---|---|
| 动作徽标 | 新建 = ok 描边 chip；修改 = hairline chip；删除 = danger 描边 chip |
| 文件多（>8） | 列表 max-h 200 滚动（内部滚） |
| verify 缺席 | 显式行：「未声明验证面」（text-3，不隐藏） |
| submitting / resolved | 同 ApprovalCard；决议行「方案已批准 · 写禁解除」/「方案被拒绝 · 等待修订」 |
| 提交失败 | 卡保持 + ErrorStrip |

- **交互**：批准 = `decidePlan(true)`（写禁解除）；拒绝 = `decidePlan(false)`（写禁维持，模型须修订重提——后果行明写）；
  `Esc` 不做决议。
- **a11y**：文件清单 `role="list"`；后果行与动作按钮 `aria-describedby` 关联。
- **落地**：精修 `PlanCard.tsx`（现实现直出 goal+files，补 approach/verify/后果行/徽标）。
- **＋优化**：`approach/verify` 两字段未渲染；「拒绝=写禁维持、模型须修订」是批准决策的关键后果，必须在按钮旁可见。

#### C-17 `ErrorStrip`
- **区域/层级**：Stream 区顶部（钉住，不随流滚动）；Scene 级唯一。
- **域映射**：`sessionErrors: Map<sessionId, message>`（按会话键控——切会话各看各的）；来源：run `!ok` / IPC reject /
  三卡提交失败 / createSession 拒绝。
- **结构**：`[danger 左竖条][⚠][消息文本（可换行）][×]`。
- **状态表**：默认（surface + shadow-card）/ hover（× 变 text-1）/ 无错误（不渲染，零占位）。
- **交互**：× 只清当前会话的错误；切会话不整条清除（键控语义）；**不自动消失**（错误需要被看见）。
- **a11y**：`role="alert"`（assertive）；× 有「关闭错误提示」标签。
- **落地**：精修 `ErrorStrip.tsx`（现实现已键控，补 a11y 与视觉统一）。
- **＋优化**：现实现消息与关闭已可；补 `role="alert"`、出现动效 `t-med`、以及「另有 N 条」折叠（V2，当前单条保最新）。

### 5.4 Composer（6）

#### C-18 `ComposerCard`
- **区域/层级**：Zone 3 主体；三行富卡（Row1 chips / Row2 输入 / Row3 控件）。
- **域映射**：发送 `run({message, mode, sessionId, model})`；disabled 判据 = `runningActive || pendingSend && 无会话`。
- **结构**：外卡：`border hairline · r-lg · surface · shadow-card`；Row2 为自增高 textarea（1–6 行后内滚）。
- **状态表**：

| 状态 | 视觉 |
|---|---|
| 默认 | placeholder「给 agent 派活…」 |
| focus-within | 边线 text-3 + 外环 3px 6% 墨色 |
| 运行中 | 整体 opacity .55；输入禁用；placeholder「会话运行中…」；SendButton=■ |
| 门槛中 | 同运行中；placeholder「等待你的决定…」；**输入区完整保留、不做任何隐藏或删除**（v2.9 修正：曾试隐控件行被用户否决——占高问题由门卡折叠解决） |
| 新建往返中 | 同运行中（防双发窗口，沿用 pendingSend 语义） |
| 发送失败 | 草稿**回填** + ErrorStrip（不丢输入） |

- **交互**：Enter 发送（IME 组字中不触发——中文输入必需）、Shift+Enter 换行、Cmd+Enter 始终发送；
  发送即清空草稿，但仅当 run 被接受；成功派活后焦点留在输入框。
  自动增高：内容 1 行→6 行，超出内滚（max-h ~40vh）。
- **a11y**：textarea 有 label（视觉隐藏「任务输入」）；Enter 发送行为在 hint 中可见（`⏎ 发送`）。
- **落地**：精修 `Composer.tsx`（现为单行 input；升级三行富卡是本规范最大的单点改动）。
- **＋优化**：单行 input → 三行富卡（chips/输入/控件三层信息各归其位）；草稿回填；IME 守卫；失败不丢字。

#### C-19 `ContextChips`
- **区域/层级**：ComposerCard Row1。
- **域映射**：项目 chip ← `activeWorkspace`（或 host 缺省）；分支 chip ← **V2：`gitBranch(workspace)`（IPC 扩展）**。
- **结构**：`[▣ 项目名][⑂ 分支名]`（chip：surface-2 底、r-pill、11px）；右侧留白。
- **状态表**：

| 状态 | 视觉 |
|---|---|
| 默认 | 名称截断（max-w 180），hover 出全量 tooltip |
| 分支不可知 | **隐藏分支 chip**（宁缺不编；V2 接上后自然出现） |
| hover | 底色加深一阶 + 「点击复制」tooltip |
| 点击（项目） | 展开工作区列表菜单（V1 与侧栏区头同源；切换只决定新任务归属） |

- **交互**：点击 chip 复制全值（短暂 ✓ 反馈）；项目 chip 可展开工作区列表切换归属（与侧栏同源）。
- **a11y**：chip 为 button 语义；复制结果 `role="status"` 播报。
- **落地**：新增（Row1 为新增行）。
- **＋优化**：参考清单「项目＋分支」中分支数据当前**不存在于任何 IPC**——本规范坚持 fail-visible 纪律：
  无数据即不显示，并把它列入 V2 扩展（§3.5），不在 UI 里编一个「main」出来。

#### C-20 `PermissionToggle`
- **区域/层级**：ComposerCard Row3 左簇第 1 位。
- **域映射**：`AppSettings.mode`（`PERMISSION_MODES = read-only|default|guided|auto`，无 plan 档）；
  面板与 Toggle **同源**（改一处两处更新，沿用现有 `getSettings/setSettings` 流）。
- **结构**：`[⛨ 档位名][▾]` 触发 + 菜单（4 项：名称 + 一行说明 + 后果注记；`auto` 项 danger 色调）。
- **状态表**：

| 状态 | 视觉 |
|---|---|
| read-only | 盾 icon；文案「只读」 |
| default | 文案「默认 · 逐次审批」 |
| guided | 文案「引导 · 按风险放行」 |
| auto | 文案「自动 · 免审批」+ **常驻 risk 小圆点**（持续提醒高危态） |
| 运行中 | 整控 disabled（口径：下一轮生效的改动不在运行中开半程口子） |
| 菜单开 | 当前项 ✓；每项下灰字说明 |

- **交互**：点选即写 `setSettings({mode})`；失败 → ErrorStrip 并保持原值（无假乐观）。
- **a11y**：listbox 菜单语义；auto 项的警告用文字前缀「⚠」+ 色（不只色）。
- **落地**：精修（现 mode 只活在 SettingsPanel 下拉里；Composer 无入口）。
- **＋优化**：权限档是**每次派活的上下文**，应该在派活现场可见可调；`auto` 的持续可见警示对齐内核
  「auto 是显式授权不是缺省」的纪律。

#### C-21 `ModelPicker`
- **区域/层级**：ComposerCard Row3 左簇第 2 位。
- **域映射**：`getProviderInfo()`（kind/provider/modelId/models[{id,model,tier,ctxWindow}]/keyConfigured）；
  选择值 = 该会话显式选择 ∪ settings 缺省（demo ⇒ null ⇒ 显示「演示」）；运行中不透传。
- **结构**：触发 `[模型短名][▾]` + 菜单：「注册档位」列表（名称 + tier 徽标 cheap/standard/strong + ctx 窗口）
  + 「演示」项 + key 状态脚注。
- **状态表**：

| 状态 | 视觉 |
|---|---|
| 默认 | 触发显示短名（截断 140） |
| demo 选中 | 显示「演示」+ 菜单项注「预录剧本 · 不产生真实调用」（诚实标注） |
| key 未配置 | 菜单顶置 fail-visible 行「<provider> 未配置 key · 去设置配置」；注册项禁用并注明 |
| 运行中 | disabled |
| 会话显式选择 | 触发上小圆点（每会话独立态，区别于全局缺省） |

- **交互**：选择 → 写入该会话选择（`selections` Map，M2-4 现状；M4 目标落 settings）；菜单键盘导航。
- **a11y**：触发 `aria-haspopup="listbox"`；tier 徽标有文字标签（不只色）。
- **落地**：精修 `ModelPicker.tsx`（现实现已有基础，补 tier/ctx/key 状态与 demo 诚实标注）。
- **＋优化**：`tier/ctxWindow` 数据已有面未显示；demo 语义标注（README 明确「预录剧本、与任务无关、台词非判卷」
  ——UI 必须承接该诚实口径）。

#### C-22 `SendButton`
- **区域/层级**：ComposerCard Row3 右端。
- **域映射**：发送 = `run()`；运行中 = `runCancel(sessionId)`（真值由收束 `aborted` 校正）。
- **结构**：单个 32px 圆形按钮，内容随态切换（Icon 原语）。
- **状态表**：

| 状态 | 视觉 | 行为 |
|---|---|---|
| 可用 | accent 底 + `↑`（accent-ink） | 提交 |
| hover/active | opacity .82 / scale .98 | — |
| 禁用（空输入/运行中/门中） | surface-2 底 + text-3 字形 | 不可点 |
| 发送往返中 | Spinner（pulse）替代字形，禁用 | 防双发 |
| 运行中（可打断） | surface 底 + hairline 描边 + `■` 墨色；hover 变 danger 边/字 | `runCancel`；本地即亮「已停止」标记，收束校正 |

- **交互**：点击等价 Enter；核心不误触——打断不 confirm（误触代价 = 本轮收束，fail-closed，不是数据损失——沿用既有裁定）。
- **a11y**：`aria-label` 随态（「发送」/「打断本轮」）；`aria-busy`。
- **落地**：新增（现无独立发送钮；发送靠 Enter，无鼠标面、无打断钮的常驻位）。
- **＋优化**：鼠标用户此前只能按 Enter；打断按钮散在 sessionbar。收进 SendButton 后「主行为」唯一化。

#### C-23 `TokenMeter`
- **区域/层级**：ComposerCard Row3 右（SendButton 左侧）。
- **域映射**：`usageAggregate(events)`（input/output/usageCount，含 `cacheRead/Write` 分列可达）；`compact()`（压缩入口）。
- **结构**：`↑128.4k ↓12.9k`（mono、tabular、11px、text-3）；hover → 浮层详表：输入/输出/命中缓存读/写/轮数 + 「压缩历史」按钮。
- **状态表**：

| 状态 | 视觉 |
|---|---|
| 默认 | 两段数字；超 4 位有效数字用 k/M 缩写 |
| 运行中 | 数字随 usage 事件跳动（tabular 不横移） |
| 预算闸在场 | `maxBudgetUsd` 有值 → 详情页尾注「本轮受 $N 上限约束」（额度来源 settings；金额折算归 V2 价表） |
| 价格不可知 | 详表注明「未折算金额（价表不可知）」——不当 0 |

- **交互**：hover/点击出详表（Popover）；「压缩历史」→ `compact()`（调模型，成功后行内提示「已压缩」；失败走 ErrorStrip）。
- **a11y**：数字带 label（「输入 token」）；详表可键盘进入。
- **落地**：精修 `TokenPanel.tsx`（现已有基础数字 + 压缩入口）。
- **＋优化**：详表分层（含缓存分列）；金额口径诚实（对齐「不可知不当 0」纪律）。

### 5.5 独立态（3）

#### C-24 `EmptyState`（v2.2：开始页快捷卡已移至右栏，此处还原为问句+pill）
- **区域/层级**：接管 Main 三区（无会话时）；Sidebar 与 Composer 不受影响（仍可直接派活）。
- **域映射**：快捷 pill 文案为静态示例任务集（填入 Composer，不直接发送）。
- **结构**：垂直居中：`[cairn 标记 42px][问句标题 22px][副题][快捷 pill ×4][次行提示]`。
- **状态表**：默认唯一（无会话即此态）；输入获得内容后不变化（仍在此态，直到发送）。
- **交互**：点 pill → 文案填入 Composer 并聚焦（**不直接发送**）；`Cmd+N` 从任意处回此态；次行提示指向右栏开始页。
- **a11y**：标题 `h1` 级；pill 为 button。
- **说明**：参考图的「开始页快捷卡」属**右栏**（C-30）；主区空态保持「居中图标＋问句＋快捷 pill」口径（原始清单要求）。

#### C-25 `Onboarding`
- **区域/层级**：接管 Main 三区（首启）；两步向导。
- **域映射**：`needsOnboarding` / `getSettings` / `providerKeySet` / `keyConfigured` / `addProject` / `pickDirectory` / `onboardingCompletePatch`。
- **结构**：居中卡 560px：`[cairn 标记][步骤条 1 模型 → 2 工作区]`；
  Step1：provider 卡片（GLM/OpenAI/Anthropic/Gemini + **演示通道**）+ key 输入（password）+「保存到钥匙串」+ key 状态；
  Step2：已注册工作区单选卡 + 添加（路径输入 + 浏览…）+ 完成。
- **状态表**：

| 状态 | 视觉 |
|---|---|
| Step1 · 未选 provider | 完成钮禁用（须显式选择） |
| Step1 · demo 选中 | 卡内注「演示通道跑预录剧本，不产生真实调用；结论请看退出码」 |
| key 保存中/失败 | 按钮 loading；失败 fail-visible（safeStorage 不可用 = fail-closed 拒绝，明说） |
| Step2 · 无工作区 | 完成钮禁用（引导添加）；添加成功自动选中 canonical 路径 |
| 完成 | 退出向导 → EmptyState（顺带重拉 providerInfo） |

- **交互**：步骤可回退；Enter 在 key 输入内提交保存；完成后不可再进（重看走设置）。
- **a11y**：步骤条 `aria-current="step"`；失败信息 `role="alert"`。
- **落地**：精修 `Onboarding.tsx`（现实现两步已有，补演示通道诚实标注与卡内验证态）。
- **＋优化**：demo 语义标注（对齐 README 三条免责）；provider 卡化（原为下拉+输入）。

#### C-26 `SettingsPage`（整页 · 全覆盖 · v2.3）
- **区域/层级**：整页覆盖层——覆盖 workspace 全宽（侧栏＋主区＋右栏），顶边贴 TitleBar 下沿（窗口红绿灯/拖拽区保持可用）。左栏页内导航 220px + 内容区。
- **页内导航（7 类）**：通用 / 模型与 Provider / 权限与安全 / 行为与成本 / 记忆与数据 / 插件与技能 / 关于与更新（＋搜索框、关闭按钮）。
- **域映射**（全部为 `AppSettings` 真实键；`SettingsStore.set()` 浅合并 layout 深合并，全字段可写）：
  - 通用：`theme`（system/light/dark，即时生效）· `locale`（**v2.14 字段已加**：zh-CN/en-US，持久化 + 白名单校验；界面文案翻译逐段接线）· `telemetry` · `onboarded`（新手引导「已完成」态 + **「重新运行向导」重跑入口**，注释口径 M4b §2.4）
  - 模型与 Provider：`provider`（demo/glm/openai/anthropic/gemini）· `providerKeyStatus/Set/Delete`（safeStorage，env 优先）· `model`（wire 名）· `workspace` + `pickDirectory`
  - 权限与安全：`mode`（4 档）· `planRequiredByDefault` · `safeMode`（off/report/gate，M3b §11.6）· 沙箱只读状态（`getState().sandbox`）· 网络策略说明
  - 行为与成本：`impactAnalysis` / `autoVerify` / `autoVerifyRepair` / `autoMemory` / `subagentTools`；`routingBandit` / `routingCascade` / `maxBudgetUsd` / `budgetPricePerMTok`；`promptCache` / `actionFusion` / `requestMetering` / `observationPack` / `evidenceReceipts` / `economicCompaction`；`scheduleConcurrencyCap`（1–8；桌面端调度器**已接线** v2.14，改动经 `updateScheduleCap` 即时生效）
  - 记忆与数据：`getState().memory`（项目层/全局层 topics）+ `deleteMemory` · `pendingExternalRefs`
  - 插件与技能：`getState().plugins`（信任开关 = `pluginDecide`）· `looseSkills.invoke` 调用名列表
  - 关于与更新：`about.version` · `license` · `updateManifestUrl` · `checkUpdate`（未配置 = 显式态）· `openExternal`
- **状态表**：

| 状态 | 视觉 |
|---|---|
| 打开 / 关闭 | 整页覆盖（隐去 workspace 三栏）；Esc / ⌘, / 关闭按钮；场景切换自动随 `S.sheet` 同步 |
| 搜索（v2.7） | 跨分区过滤行；**同义词别名**（预算/密钥/引导/更新…按概念可搜）；0 命中 → 「没有匹配的设置项」；清空回到上次所在分区 |
| 字段级保存 | 无全局保存键（SettingsStore patch 语义）；数字输入非法 → 行内红字（不静默回退）；**校验规则**：预算类 ≥0、并发上限 1–8 整数、更新端点空或 http(s)；**保存回执**：页脚「修改即保存」→ 每次变更更新「已保存 HH:MM:SS · setSettings(patch)」 |
| key 已存 / env 在场 | 「已存：<provider>」tag / 环境变量优先提示（永不显示 key 值） |
| auto 档 / 调度待接 | auto 选中常驻警示；调度项挂「待接」tag + 注记 |

- **交互**：左栏切分区；搜索过滤；开关即改（switch）+ 保存回执；主题即时生效并联动外观；检查更新两态（未配置解析 / 已最新）；记忆 topic 删除（仅用户可删）；工作区「浏览…」回填；「重新运行向导」→ 关闭设置并进入 Onboarding 两步向导。
- **a11y**：页内导航为 button 组；分区标题清晰；数字错误红字 + 文本冗余（不只颜色）。
- **落地**：重写 `SettingsPanel.tsx` → `SettingsPage.tsx`（整页态，非浮层）。
- **＋优化**：右 Sheet → **整页**（用户裁决：单独一个页面、全覆盖）；设置项从 4 组扩到 **7 分区、覆盖 AppSettings 全部可持久化字段**；无后端项显式标注（不造假设置）。
  v2.7：补**搜索（含同义词别名）· 校验规则（预算/并发/URL）· 保存回执 · `onboarded` 重跑向导**——功能面收束。

### 5.6 基础原语（3 条目 · 含 4 控件）

#### C-27 `Button / Input / Select / Toggle`（组合条目）
- **区域/层级**：全树复用原语。
- **规格**：
  - **Button**：变体 `primary`（accent 底）/ `secondary`（surface + hairline 描边）/ `ghost`（无底，text-3↔text-1）/
    `danger`（danger-ink 字 + 二次确认联动）；尺寸 `sm 24px`（卡动作、菜单）/ `md 28px`（向导）；
    状态：default / hover / active(scale .98) / focus / disabled(opacity .5) / loading(Spinner + 禁点)。
  - **Input**：单行 + textarea 变体；边线 hairline → hover hairline-strong → focus text-3 + 外环；
    **IME 组字守卫**（`compositionstart/end`，中文输入不误触提交）；错误态：danger 边线 + 行下错误文本。
  - **Select**：触发器 + Popover 菜单（自定义 listbox：↑↓ 导航 / Enter 选 / Esc 关 / 首字母定位）；
    不使用原生 `<select>`（macOS 原生外观与暖米白系统断裂）。
  - **Toggle**：28×16 开关；on = accent 底；状态 on/off/disabled/focus；用于设置页布尔项。
- **a11y**：全部原语补 `:focus-visible` 环（§4.5）；Select 用 `aria-activedescendant` 模式。
- **落地**：`styles.css` 原语层 + 轻量组件文件（不引 UI 库——保持零新增依赖）。
- **＋优化**：现原语只有 `.btn-primary/.btn-ghost` 与零散 input 样式；补齐四件套的完整状态矩阵，Select 自主掌控外观。

#### C-28 `Icon`
- **区域/层级**：原语（含在按钮、行、chip 中）。
- **规格**：内联 SVG；描边 1.5px、圆角线端；尺寸 14（行内）/16（按钮）/20（标记）；`currentColor` 着色。
  必要字形注册表（V1 全集）：`spark ✦`（agent）/ `tool ⌁` / `chevron ▸▾` / `settings ⚙` / `clock ⏱` /
  `check ✓` / `x ✕` / `blocked ⊘` / `held ⏸` / `hourglass ⌛` / `arrow-up ↑` / `stop ■` /
  `plus ＋` / `more ⋯` / `diff ▤` / `branch ⑂` / `folder ▣` / `pin` / `copy ⧉` / `shield ⛨` / `user`。
- **状态表**：默认（text-3）/ 激活（text-1）/ 语义（随语义色 `-ink` 变体）/ disabled（40%）。
- **a11y**：装饰性 `aria-hidden`；表意性由宿主元素提供 `aria-label`。
- **落地**：新增 `components/icons.tsx`（现无图标系统，字符散用）。
- **＋优化**：参考清单给出 5 个字符；生产面需要 20+ 字形且要状态着色与尺寸节奏——以注册表收口，杜绝散用字符。

#### C-29 `Spinner`
- **区域/层级**：原语（按钮 loading、工具 pending、更新检查、卡提交）。
- **规格**：两模式：
  - `breathe`：透明度呼吸（1→.35→1，1.6s）——用于**等待型**（live 光标伴生、StatusDot running）；
  - `pulse`：旋转/缩放脉冲——用于**进行型**（工具 pending、按钮 loading）。
  尺寸 12/14；`prefers-reduced-motion` 下均静止为全亮字形（以静态字形而非消失保语义）。
- **a11y**：宿主 `aria-busy="true"`；自身 `aria-hidden`。
- **落地**：`styles.css` 动画 + 小组件。
- **＋优化**：两种动效语义分工明确（参考清单「呼吸/脉冲」的落地口径唯一化）；补 reduced-motion。

---

### 5.7 v2 新增组件（9 项 · C-30…C-38）

> v2 由「三栏 + 输出优先 + 输入区重构」引入；全部已在原型实现。凡依赖未接线能力者，均在组件内**显式标注**（不造假数据）。

#### C-30 `RightPanel`（多标签容器 · v2.2）
- **区域/层级**：R 层，360px，可折叠 0（TitleBar 右栏开关）；顶部标签栏（`无打开标签` 文案 + ＋ 新建菜单）。
- **本轮范围（用户裁决）**：**只做「浏览器」与「辅助对话」两类标签**；审查/终端等暂不在右栏（审查后端最全，可随时作为标签类型加回）。
- **结构**：`0 标签 → 开始页`（居中标记 + 快捷卡栈：工作区文件 ⌘P / 新建终端 ⌃\` / 浏览器 ⌘T / 侧边对话）；`≥1 标签 → 标签栏 + 当前标签内容`。
  （v2.3 微调：移除「上下文」卡；「侧边对话」去 beta 标注——按用户裁定。）
- **状态表**：

| 状态 | 视觉/行为 |
|---|---|
| 0 标签 · 开始页 | 4 卡；**封面不展示标签栏**（整条 tabbar 隐藏，标签只在开物后出现 · v2.4）；「浏览器 / 侧边对话」点击开新标签；其余卡「待接入」标签 + 点击出注记 |
| 标签栏 | 每标签：标题 + ✕；激活态 surface-2；可多开；＋ 菜单含两类 |
| 浏览器标签 | 工具条（←/→/⟳/复制）+ URL pill + 内容区；**v2.13**：←/→ 置灰（演示无历史）、⟳ 刷新（页面淡出淡入反馈）、复制链接（剪贴板 + ✓ 反馈）；**原型为演示页（琥珀徽标注）** |
| 辅助对话标签 | sidechat 卡（消息流 + 追问 + 提升）；每标签 = 一个独立旁路会话，状态互不影响；**轮次导航（v2.10）**：顶部 sticky 轮次条（`n · HH:MM` chips，user 起一轮）+ 每轮「第 n 轮 · HH:MM」分隔线；**点击 chip → 平滑滚到该轮 + 闪高亮 + chip 激活态**；追问后新轮实时补入 |
| 关闭到 0 标签 | 回到开始页 |

- **域映射**：辅助对话 ← `sidechat*` 全通道（真实动作）；浏览器 ← **无后端**：真实实现路径 = Electron `WebContentsView`（或多开 BrowserView），或降级为 `web_fetch/web_search` 结果查看器；原型以静态演示页呈现并显式标注。
- **交互**：卡 / ＋ 开标签；标签切换；✕ 关闭（活跃标签回落到相邻）；追问/提升按标签独立存储；轮次 chip 跳转（scrollIntoView + flash 高亮，`scroll-margin-top` 避让 sticky 条）。
- **缺口注记**：浏览器标签后端为**实现前置**（主进程 WebContentsView + IPC 合约），见 §8 #2。

#### C-31 `ThinkingRow`
- **区域/层级**：EventStream 内联行；每轮可多条。
- **域映射**：**V2 待接**——推理流三层（adapter reasoning → 事件 → 投影）未接线；本组件先行立结构与动效。
- **结构**：折叠行 `[点阵图标][短语「先准备下…」][live 动画点][chevron]` → 展开体（浅色文字区 + 接线说明）。
- **状态表**：

| 状态 | 视觉 |
|---|---|
| 折叠（默认） | text-3/12px；hover 出 chevron；行底 hover 4% |
| 展开 | 浅色正文（text-3/12.5 · 行高 1.75 · 左 2px 轨）+ 注记「推理流未接线…」（risk-ink） |
| 运行中（live） | 行尾三点脉冲动画（`think-live`；reduced-motion 下静止） |

- **交互**：点击整行展开/收起（`aria-expanded`）；ActionBar 的「思考」按钮全局显隐。
- **缺口注记**：内容位**不编造推理文本**；等 adapter 接线（anthropic `thinking_delta` 现被显式跳过）。

#### C-32 `ChangeSummaryCard`
- **区域/层级**：EventStream 内联行；一轮改动一张（完成态取代逐条 ToolRow）。
- **域映射**：`tool_result.change/snapshotId`、`parsePatch`（diff stat）、worker `artifacts.files_changed`；聚合为投影扩展（§3.5）。
- **结构**：`[文件图标][已编辑 N 个文件][+add −del]` + 文件列表（前 4 行 + 「全部 N 个文件 ⌄」）。
- **状态表**：默认（4 行）/ 全展开（点「全部」后移除按钮）/ 空（不渲染）。
- **交互**：点「全部」展开余下文件行；文件行点击 → 展开对应 DiffView（落点：该文件最近一次 tool_result）。
- **缺口注记**：聚合口径属投影扩展（V2 排期），原型以静态数据演示。

#### C-33 `ActionBar`
- **区域/层级**：EventStream 内联行；附在每轮 assistant 输出之后。
- **域映射**：复制（渲染层）；赞/踩（**通道待做** §8）；收起（渲染层）；思考开关（渲染层）；分叉（**v2.15 已接**：`AgentApi.forkSession` → `agent:sessions-fork`）；用量/时间（`usage` 聚合）。
- **结构**：`[复制][👍][👎][收起工具][思考][分叉] … [用量 3.3M tok · 18:11]`。
- **状态表**：👍/👎 互斥高亮（on）；收起/思考为开关态；复制点击 → ✓ 反馈 900ms。
- **交互**：分叉 → 保留到该消息所在轮次，新会话 `<id>-f<N>`（`forkSession` · 源会话只读、字节不变）+ 决议行留痕；赞/踩点击**只做选中反馈**（无假提交）。
- **缺口注记**：赞/踩通道见 §8 台账（分叉 v2.15 已接）。

#### C-34 `GoalPanel`
- **区域/层级**：Zone 3 之首（输入卡外 · 上方）；有条件渲染（`goal_set` 在场）。
- **域映射**：`setGoal({objective,maxTurns,maxUsd,clear})` + `goal_set/goal_stopped` 事件（时长 = now − goal_set.ts）。
- **结构**：`[目标图标][「目标」][· 时长][目标文本（单行截断）][铅笔][暂停][清除]`；编辑态切换为行内输入。
- **状态表**：

| 状态 | 视觉 |
|---|---|
| 默认 | wait 9% 底 + 26% 描边；文本 text-1 单行省略 |
| 编辑中 | 文本换输入框（自动聚焦；Enter/blur 提交） |
| 暂停（需新语义） | 整体 72% 透明；图标切换 |
| 清除 | 面板消失 + 决议行「目标已清除（clear:true）· 不再自动续跑」 |

- **交互**：编辑 → `setGoal(objective)`；清除 → `setGoal(clear:true)`；暂停 → **语义待新增**（现只有 clear 停止）。
- **缺口注记**：暂停需新增 goal pause 语义（§8 台账，用户裁决「要」）。

#### C-35 `ContextRow`（文件夹 / 工作树）
- **区域/层级**：GoalPanel 之下、ComposerCard 之上（**移出输入卡**，用户参考图口径）。
- **域映射**：文件夹 ← `listProjects/addProject/pickDirectory`（canonical 化）+ `activeWorkspace`（只决定新任务归属）；工作树 ← `getState().worktree.orphans` + M3b worktree（**用户级切换语义待接**）。
- **结构**：`[▣ 文件夹名 本地]` `[⑂ 主工作树 main]` + 右侧注记；各自 Popover 菜单。
- **状态表**：默认 / hover / 菜单开（**弹层朝上展开**——位于输入卡上方，避开卡片遮挡，v2.5 修正）/ 文件夹菜单含「＋ 添加工作区…」。
- **交互**：选择工作区 → 切归属 + 决议行（不动在跑会话）；工作树菜单列出 主工作树 / worker / 孤儿（打开审查面板）+ V2 注记。
- **缺口注记**：工作树「选择/切换」为新增语义（§8 台账，用户裁决「要」）；分支 chip 仍未接线（缺 `gitBranch` 通道，宁缺不编）。

#### C-36 `AttachmentChips`
- **区域/层级**：ComposerCard 内、输入之上；有附件才显示。
- **域映射**：`RunRequest.attachments` + `RunAttachmentReference`（file/directory · ≤32 · 路径字符 ≤16k · 工作区外走审批）。
- **结构**：`[＋ 按钮（控件行）] → 菜单（文件引用…/目录引用…）`；chip = `[路径 mono][✕]`。
- **状态表**：无附件（strip 不渲染）/ 有附件（chips 换行排列）/ 移除（✕）。
- **缺口注记**：拖入取路径需补 preload 桥（`webUtils.getPathForFile`）或文件选择 dialog（现 `pickDirectory` 仅目录）——**实现前置**。

#### C-37 `SlashMenu`
- **区域/层级**：ComposerCard 内浮层（输入卡上方）；输入以 `/` 开头时出现。
- **域映射**：技能调用名 ← `PluginPanelSnapshot.looseSkills[].invoke`；插件命令 ← **快照需扩 commands 清单字段**（现只有 counts.commands）；内置：`/compact`（`compact()`）、`/goal`（`setGoal`）。
- **结构**：`[调用名 mono][说明][注记行]` 列表（↑↓/Enter/Esc 可导航）。
- **状态表**：显示（输入 `/` 且无空格）/ 隐藏（含空格、Esc、选中插入后）。
- **交互**：选中 → 注入调用名 + 空格，焦点回输入；消息文本里的 `/plugin:name` 由 main 侧 `expandPromptCommand/expandSkillInvocation` 展开（既有能力）。
- **缺口注记**：命令清单快照字段为**实现前置**（§8）。

#### C-38 `StatusStrip`
- **区域/层级**：Zone 3 最底（输入卡下方）。
- **域映射**：轮数 = `usage` 计数；步数 = `tool_call` 计数；tok/s = 输出 tok ÷ 时长（可算）；用量 = `usageAggregate`；缓存命中 = `cacheRead ÷ inputTokens`（缺席不显示，不当 0）；上下文% = 最近 `usage.inputTokens ÷ ctxWindow`——**近似口径，需标注**。
- **结构**：`[7 轮 · 96 步][· 230 tok/s] …… [16.1M tok · 缓存命中 99%][上下文 ▮▮▯ 26%]`。
- **状态表**：空闲（无 tok/s）；运行中（tok/s 在场）；空会话 / 首启（整条不渲染）。
- **缺口注记**：上下文%为近似值——实现时须在 tooltip 标注口径（不假装精确）。

### 5.8 v2.6 应用页（4 项 · C-39…C-42）

> 与 `SettingsPage` 同宿主（`#appPage` 整页覆盖，`← 返回` / Esc 关闭）；侧栏功能菜单为入口。**每页自由定制**，
> 通用件：`pgStats`（统计卡行 ×4，仅真实字段，未信任类指标可 risk 着色）· `pgToolbar`（搜索框 + 筛选 chips + 排序钮）
> · `pg-split`（列表与 `pg-drawer` 340px sticky 两栏；无选中时单栏）；列表行 = `pg-item`（选中态 = 底 hover + 描边）。

#### C-39 `PluginsPage`（插件）
- **域映射**：`getState().plugins` + `pluginDecide`。统计：已加载 / 已信任 / 未信任 / MCP 连接 x/y。
- **筛选**：全部 / 已信任 / 未信任 / 有警告；**搜索**对三段同时生效（插件、looseSkills、MCP）。
- **抽屉**：插件 → 组成（counts 六项）/ 信任开关（未信任不激活，技能与 MCP 均不挂载）/ 该插件 MCP（state/tools/error）/ toolScopes / 错误与警告；looseSkill → 调用名 / 作用 / 信任 + 正文缺口（§8 #15）。
- **缺口注记**：全部真实字段；无缺口。

#### C-40 `AutomationPage`（自动化任务）
- **域映射**：`scheduleSnapshot` + `scheduleUpsert / Delete / RunNow`。统计：任务 / 启用中 / 下一次触发 / 最近运行。
- **筛选**：全部 / 启用 / 停用 + 排序（默认 ↔ 名称）；页顶横幅改为**接线说明**（桌面端调度器已常驻接线 v2.14：快照/CRUD/触发同实例；无人值守 run 的审批仍 fail-closed）。
- **抽屉**：任务 → 启用开关 + 名称 / cron / 提示词（编辑区）/ 立即运行 / 删除 + 该任务历史；页内另设全局「运行历史（journal 投影）」与「＋ 新建任务」表单。
- **状态**：立即运行 → `scheduleRunNow`（触发 = 全新会话 · unattended）；保存 → `scheduleUpsert`；无人值守 run 的审批仍 fail-closed 当场拒绝（语义保留）。
- **缺口注记**：**执行面 v2.14 已收口**（桌面主进程常驻 `serveScheduler`；§8 #18 关案）；表单字段集仍以 `scheduleUpsert` 四 kind 白名单为准。

#### C-41 `SkillsPage`（技能中心）
- **域映射**：`getState().plugins`（`looseSkills.invoke` + 各插件 skills）+ toolScopes。统计：可用技能 / 已信任 / 未信任 / 来源数。
- **筛选**：全部 / 已信任 / 未信任 / 独立技能 + 搜索（调用名与描述）。
- **抽屉**：调用名（mono）/ 描述 / 来源 / 信任开关 / 权限联动（申报工具面）/ 指令正文（待接 · §8 #15）/ 调用历史（待接）。
- **缺口注记**：① 命令清单需扩快照一字段（§8 #14）；② 正文与调用历史各需新通道。

#### C-42 `MemoryPage`（记忆系统）
- **域映射**：`memorySnapshot`（**topics 含全文**）+ `deleteMemory`。统计：项目层 / 全局层 / 最近更新 / 待批外部引用。
- **筛选**：全部 / 项目层 / 全局层 + 排序（最近更新 ↔ 名称）+ 搜索（主题与类型）。
- **抽屉**：主题元信息（层/大小/最后修改）+ **全文**（pd-body）+ 删除（仅用户可做；删除后行消失、统计即时更新）；页内另有索引（MEMORY.md）与待批外部引用区。
- **缺口注记**：全部真实字段；无缺口（写入能力不存在，故不设新建/编辑入口）。

## 6. 落地映射与实施切片

| 切片 | 内容 | 落点 |
|---|---|---|
| S1 骨架 | AppShell 网格 / TitleBar / 视觉 token 精修 / 原语四件套 + Icon + Spinner | `App.tsx` 拆布局层；`styles.css` 重写 token 段；`components/{TitleBar,icons}.tsx` |
| S2 侧栏 | SideHeader / SideNav / ProjectGroup / SessionItem / StatusDot / SidebarFooter | `Sidebar.tsx` 精修 + 新拆分；派生函数进 `projections.ts` |
| S3 事件流 | EventStream 跟滚 / 六态 ToolRow / DiffView / User·Agent 消息精修 / ErrorStrip | `Stream.tsx` 扩 + `DiffView.tsx` 新增 |
| S4 门槛 | ApprovalCard / ClarifyCard / PlanCard 全字段 + 决议行 | 三个卡组件精修 |
| S5 Composer | ComposerCard 三行 / ContextChips / PermissionToggle / ModelPicker / SendButton / TokenMeter | `Composer.tsx` 重写 + 新子组件 |
| S6 独立态 | EmptyState / Onboarding 精修 / SettingsPanel Sheet 化 | 三个组件精修/新增 |
| S7 三栏与 v2 | RightPanel / ThinkingRow / ChangeSummaryCard / ActionBar / GoalPanel / ContextRow / AttachmentChips / SlashMenu / StatusStrip | §5.7；布局纪律见 §1.3 |
| V2 | §3.5 投影扩展（verify 行、worker 簇、决议留痕）+ §8 台账的「实现前置」通道 | 独立排期 |

纪律提醒：desktop 层走 `pnpm --filter cairn-desktop test`（独立 vitest + `desktop-boundary-check`），
`src/` 永不 import `apps/desktop/`（现有边界检查脚本会红）；本设计不引入任何新依赖。

## 7. 验收清单（可判定）

1. **门槛互斥**：任意时刻 GateSlot ≤ 1 张卡；三卡同现时优先级 = ask > clarify > plan。
2. **门槛禁用**：卡在场时 Composer 输入禁用、SendButton 不可发送、`Esc` 不产生决议。
3. **状态点**：五态各自可达；`prefers-reduced-motion: reduce` 下无任何无限动画且五态仍可辨。
4. **跟滚**：运行中用户上翻视口不动；新事件到达不跳底；点「回到最新」恢复钉底。
5. **ToolRow 终态**：`blockedBy / hold / timedOut / exitCode` 四类在 UI 有专属字形与文案（不与其他失败同形）。
6. **diff 完整**：任一 diff 类工具展开可见完整 patch（含 stat 与快照脚注；截断仅由「显示全部」触发）。
7. **错误条**：只由用户关闭；按会话键控（A 会话错误在 B 会话不可见）；`role="alert"`。
8. **草稿保护**：发送失败（IPC reject / run !ok）后草稿回填且焦点在输入框。
9. **IME**：中文拼音组字期间按 Enter 不发送。
10. **诚实口径**：分支未知不显示 chip；demo 通道有三段免责文案；价格不可知不折金额；`change` 未知不猜 created/modified。
11. **键盘**：§4.5 全表在原型与实现中可复验；焦点环处处可见；弹层焦点陷阱与归还成立。
12. **对比度**：文字均 ≥4.5:1（含修正后的 text-3 于 10–11px）；色盲冗余（+/− 前缀、字形、环）成立。
13. **输出优先**：完成态流中不出现展开的工具行；文件改动只在 ChangeSummaryCard 可见（可展开、可看逐文件 diff）。
14. **思考行**：折叠/展开可切换；live 态有动效且 reduced-motion 下静止；内容位必带「未接线」注记。
15. **三栏收口**：任意窗口宽下门槛卡 / 目标面板 / 状态条不越出主区（两条布局纪律：`min(var(--reading),100%)` + `minmax(0,1fr)`）。
16. **缺口纪律**：界面不出现无对应能力的假操作——未接线项（赞踩 / 分叉 / 暂停 / 工作树切换 / 推理文本）均有显式注记，且点击无假提交。

---

## 8. 缺口台账（能力审计 · 2026-10-04 二轮 · 已裁决）

> 来源：用户要求「每个 UI 项都必须有项目对应，没有对应的列出来由用户裁决」。下表为审计证据与裁决结果；
> **「不做」= 原型与规范均不出现该 UI（不留假占位）**；「要」= 进 UI，并同时列明必须新增的后端/通道（实现前置）。

| # | UI 项 | 项目现状（审计证据） | 裁决 |
|---|---|---|---|
| 1 | 右栏 · 终端 | 全仓无 PTY / 终端通道 | **不做** |
| 2 | 右栏 · 浏览器标签 | 无内嵌浏览器；仅 `web_fetch/web_search`（结果在 tool_result） | **已改判（v2.2）：做 UI**（多标签/多开/关闭，已实现）；**真实实现前置** = Electron `WebContentsView` 或多开视图（或降级为 web 结果查看器）；原型为标注过的演示页 |
| 3 | 右栏 · 审查 | worker diff + `diff_comment` + 合并控制塔（`card_action`）+ 孤儿扫描 | 做（v2 已实现原型）；v2.2 按裁决**暂时移出右栏**——见 #19 |
| 4 | 右栏 · 辅助对话 | `sidechat*` 全通道（M2f） | 做（C-30，已实现） |
| 5 | 思考过程文本 | adapter 未接 reasoning；anthropic `thinking_delta` 按未知跳过；无事件无投影 | **UI 先立结构+动效**；内容标注未接线（C-31） |
| 6 | 思考程度调节 | `ThinkingEffort`=off/low/medium/high（协议 ✓）；capability 表全部 `off`-only | UI 做；按 capability 显式禁用未支持档（接线后点亮） |
| 7 | 撤回 / 回滚 | 对话级 v2.15 已以**分叉**形态落地（`forkSession` 保留前 N 轮 → 新会话，源只读）；文件级：CLI `applyReverts/revertPlan`（worktree 还原）+ `snapshotId` 快照 | 对话级 ✅（分叉）；文件级 ✅ **（v2.16 已接）**：IPC `revertTurn` + renderer user 行悬停 ⟲（独立入口，**未**与分叉同挂一个「撤回」菜单——那条同挂裁决仍开放）；判卷 `tests/file-revert.test.ts` + projections 轮号口径 |
| 8 | 赞 / 踩反馈 | 无通道（C4 人类反馈沉淀未做；记忆 `feedback` 是模型侧沉淀） | ✅ **（v2.16 已接）**：沉淀链路 = `src/main/feedback.ts`（append-only sidecar，撤销=`rating:"none"`、读时取最后一条生效）+ `submitFeedback/listFeedback` 通道；renderer 动作条真提交/撤销/点亮（无假提交）；判卷 `tests/feedback.test.ts` |
| 9 | goal 暂停 | `setGoal` 只有 clear 停止，无 pause | **要**；pause/resume 语义 **core 已落（v2.16**：`setGoal{pause:true,resume:true}` + `goal_paused/goal_resumed` 事件**）**，UI 待 GoalPanel（C-34，v2 切片）接线 |
| 10 | 工作树切换 | M3b worktree = worker 隔离机制；IPC 仅 `getState().worktree.orphans` | **要**；当前只列 worker/孤儿；用户级切换语义需新增 |
| 11 | @ 对话引用 | 无通道（@ 文件可由 attachments 表达 ✓） | 缺口在案（未裁决，默认不做） |
| 12 | 分叉 IPC（**v2.15 已接**） | `handleSessionFork`（源只读 / `forkPointOf` 同源 / 目标已存在不覆盖 / scrub 目录 rename 收口）+ `AgentApi.forkSession` + `agent:sessions-fork` 通道；判卷 `tests/session-organization.test.ts`（前缀一致 + 末条 `branch_of` + 越界不留半成品） | ✅ 可用 |
| 13 | 附件拖入取路径 | attachments 协议 ✓；渲染层取不到拖入路径（需 `webUtils.getPathForFile`）或文件选择 dialog | **实现前置** |
| 14 | 插件命令清单 | 快照只有 `counts.commands`，无清单字段 | **实现前置**（扩快照一字段） |
| 15 | 上下文% | 可由 最近 `usage.inputTokens ÷ ctxWindow` 近似 | 做；实现须标注近似口径 |
| 16 | 开始页 · 工作区文件 | 无列目录/文件树 IPC（只有 `pickDirectory` 选目录） | 缺口在案（未裁决） |
| 17 | 开始页（右栏）· 新建终端 / 浏览器 | 同 #1/#2 | 开始页已落**右栏**（v2.2）；浏览器卡开标签（见 #2）；新建终端保持「待接入」 |
| 18 | 侧栏 · 自动化任务（**v2.14 已收口**） | 桌面端主进程已常驻接线：`serveScheduler({ workspace })`（whenReady；will-quit 停表）——快照/CRUD/触发同一实例，触发 = 全新会话（`makeScheduledExecutor`）；反向证人 = `tests/scheduler-wiring.test.ts` ④（摘掉调用即红） | ✅ 桌面端可用（面板不再空壳） |
| 19 | 右栏 · 审查面板 | 后端最全（worker diff + `diff_comment` + 合并控制塔 + 孤儿扫描），v2 已实现原型 | 按「本轮只做浏览器和辅助对话」**暂时移出右栏**；可随时作为标签类型加回 |