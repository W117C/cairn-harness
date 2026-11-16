# ADR 0015：bot 团队协作核心（自研）——调研裁决与落点

- **状态**：**Accepted**（2026-11-16 转正）。放行依据：业主 2026-11-16 10:43（Asia/Shanghai）的指令
  「把bot和壁纸都全部做完，并且做到行业最高的水平」——该指令要求落实现，故本 ADR 从 Proposed 转 Accepted；
  落点仍按本文的裁决执行（形态 A、B3、G2、P2、R1、S1、C2、L1），实现进度见
  `docs/superpowers/specs/2026-11-16-bot-team-core-design.md` §9。
- **日期**：2026-11-15（Asia/Shanghai）
- **依据**：`docs/superpowers/plans/2026-11-14-ds-bot-benchmark.md` v2.2；业主 2026-11-14 裁决
  「范围＝bot 团队协作核心；定位＝自研；落点由差距表裁决」
- **证据基线**：HEAD `8d552446`。本文的 `path#symbol` 都在该提交的树上核过；行号会漂，符号名不会。
- **参考材料**：上游 `Fei2411/DS-Bot`（Apache-2.0）。本文只取「它解决了什么问题、用了什么机制、
  付了什么代价」，不复制代码、命名、数据结构、文案与界面。

## 一、裁决摘要

1. **落点＝形态 A（核心内建）**。团队本体住 `src/`，桌面只做投影与操作；不扩插件面、不做桌面先行。
2. **骨架＝成员档案 ＋ 成员线程 ＋ 团队会话**。三件新增最小件：成员档案可写可版本化、成员会话归属标记、
   发言权规则＋共享流投影；其余全部挂在既有件上。
3. **数据模型**：bot 实体取 B3（registry＝投影）；群聊取 G2（群会话＋成员子会话）；段取 P2（事件分界，
   用既有 `session_meta_update.patch` 的键承载）；@ 路由取 R1（事件为真＋投影）；记忆作用域取 S1
   （扩展现有类型轴）；上下文管家取 C2（与 compaction 并存）；长文本先取 L1（事件大 payload），
   L2 只在量到上限后另案。
4. **五条不变量**：不新增事件种类；不新增第三存储面；不新增权限档；不新建团队编排引擎；不沿用上游命名。
5. **非目标**：不在本 ADR 写实现；不承诺 UI 全量对齐上游 104 个客户端文件；不把网络工具当安全边界。

## 二、本仓现状复核（12 面，HEAD `8d552446`）

| # | 能力面 | 现状 | 证据（path#symbol） | 差距 |
|---|---|---|---|---|
| M1 | 长期存活成员 / roster / 主成员 | 部分：角色只读加载，无 roster、无成员实体、无高权限主成员 | `src/agent/roles/user-agents.ts#UserAgentRole`、`src/agent/local-agent-runtime.ts#LocalAgentRuntime` | 大 |
| M2 | 成员↔成员消息 | 部分：`send_agent` 是父→已派 worker 的线程通道，非对等互聊；无 request_id 幂等回执树 | `src/tools/agent-lifecycle.ts#SEND_AGENT_TOOL`、`src/agent/local-agent-runtime.ts#LocalAgentRuntime` | 中 |
| M3 | 群聊（成员/管理员/轮次/[PASS]/多@并行） | 无：全仓无群聊实体；`ControlGroup` 是竞速/法定人数控制组，语义无关 | `src/orchestration/engine.ts#OrchestrationEngine` | 大 |
| M4 | @接力 / 隐藏会话 | 部分：交接靠任务书＋progress/summary；`@` 在本仓是文件引用，不是成员引用 | `src/agent/orchestrator-types.ts`、`src/agent/sidechat.ts#sidechat` | 大 |
| M5 | 每成员工作目录 | 部分：write worker 有独立 git worktree；无群统一目录 | `src/agent/worktree.ts#worktree` | 小 |
| M6 | 每成员权限档 | 部分：档位是会话/worker 级，单调继承已实现；五档与上游三档不是一一对应 | `src/permissions/modes.ts#PermissionMode`、`src/agent/worker-report.ts#clampTier` | 中 |
| M7 | 私密成员 | 无：记忆只有项目层与全局层（按工作区分，不按成员分） | `src/agent/memory/store.ts#projectMemoryDir`、`#globalMemoryDir` | 中大 |
| M8 | 三档记忆作用域 | 部分：常驻/沉淀/整理/检索/写五件套已有；缺增量读、三档作用域、额度、冻结快照 | `src/agent/memory/store.ts`、`inject.ts`、`distill.ts`、`consolidate.ts`、`retrieval.ts`、`src/tools/remember.ts#remember` | 中大 |
| M9 | 上下文管家 | 部分：阈值＋摘要压缩；无段/交接包、无小模型二值判定 | `src/agent/compaction.ts#shouldCompact` | 中 |
| M10 | 全文索引 | 部分：线性扫描＋字节帽；无 SQLite/FTS5 | `src/main/session-search.ts#searchSessions`、`src/agent/history-search.ts#searchHistory` | 中 |
| M11 | 用量按成员 | 部分：事件级 agent_id→模型归因；聚合桶只到 (day, model) | `src/agent/usage-attribution.ts`、`src/main/usage-analytics.ts#UsageLedgerBucketPayload` | 小 |
| M12 | 密钥按成员授权 | 部分：provider/plugin 粒度＋safeStorage＋注入＋脱敏；无成员申请/授权卡片 | `src/agent/plugins/secrets.ts#getPluginSecret`、`src/main/provider-key-inject.ts`、`src/events/redact.ts#redactSecrets` | 中 |

**可直接复用的承载件**（复核过）：`src/events/types.ts#session_meta_update`（自由键值补丁通道）、
`src/events/projection.ts#sessionMetaPatch`、`src/agent/agent-thread-projector.ts#projectAgentThreads`、
`src/events/session.ts#forkSessionPointer`、`src/main/sessions.ts#sidechats`（独立文件组范式）、
`src/main/session-mutation-lock.ts#withSessionMutation`、`src/agent/worker-tool-table.ts#buildWorkerToolTable`
（深度恒 1）、`src/orchestration/store.ts#createEventLog`、`src/orchestration/project.ts#projectOrchestration`。

## 三、为什么是形态 A

**硬约束（有证据）**：

1. **插件面是封闭的声明式扩展**：插件只能贡献 skill / prompt command / agent role / hook / MCP / LSP；
   **不能**提供自定义 UI 面板、前端路由、后台常驻任务、自定义 API 路由。证据：
   `src/agent/plugins/types.ts`、`src/agent/plugins/hooks.ts`、`apps/desktop/src/renderer/pane-registry.ts#PaneKind`、
   `apps/desktop/src/main/channels.ts`。上游「插件自带 36k 行客户端 UI ＋ 注入 sessionController」照搬不了。
2. **事件种类封闭**：`src/events/types.ts#AgentEvent` 是联合类型，新增种类只允许日志结构控制记录
   （ADR 0005）。成员实体、群成员、@ 路由不能靠新事件种类承载。
3. **核心边界**：`src/` 不得 import Electron/UI（`scripts/desktop-boundary-check.ts`）。群调度器、记忆作用域、
   权限档必须住核心，UI 只做投影与操作。
4. **渲染层分层与行帽**：`state/` → `derived/` → `components/`+`panes/` → `App.tsx`；单文件 ≤1200、
   `App.tsx` ≤900（`pnpm renderer-layer-check`）。团队面板必须按这个骨架切。

**落点对照（代价来自调研计划 §五与 §3.4 的实测体量）**：

| 维度 | A 核心内建 | B 扩插件面 | C 桌面先行 | D 不做 |
|---|---|---|---|---|
| 与四条铁律 | 一致 | 一致（但插件面本身要改） | 不冲突（语义薄） | — |
| 触及面 | 核心＋桌面 | 插件机制＋核心＋桌面 | 桌面 | 无 |
| 能否达成 M1–M12 | 全部 | 全部（若插件面扩得够） | 仅 M2/M5/M6 表层 | 无 |
| 上游可照搬比例 | 高（规则层） | 中 | 低 | — |
| 架构裁决需求 | 中（记忆/段语义） | **高**（插件面边界） | 低 | — |
| 回滚成本 | 中 | 高 | 低 | — |

- **B 已因「自研」定位出局**（调研计划 §五）：扩插件面是产品级架构裁决，与 bot 团队本身无关。
- **C 是只有皮没有骨**：它做的正是「可见的团队视图，底层仍是现有编排」，在自研定位下等于自建一个假团队。
- **D 的唯一理由只能是产品定位不合**，不能是成本高——本仓既有件已覆盖大部分机制。

## 四、骨架与三件新增最小件

| 层 | 是什么 | 挂靠的既有件 | 新增最小件 |
|---|---|---|---|
| 成员档案 | 名字/角色/模型/思考强度/能力/权限档/记忆作用域/工作目录 | `UserAgentRole`＋`PermissionMode`＋会话侧车 `model`/`thinking`＋`worktree` | ① 档案的可写与可版本化（现在只读） |
| 成员线程 | 跨轮次存活的 thread＋自己的会话（可分段） | `thread_id`＋`LocalAgentRuntime`＋sidechat 独立文件组 | ② 成员会话的归属标记（`session_meta.kind`/补丁通道） |
| 团队会话 | 共享可见对话流＋一轮发言秩序＋阶段验收 | `OrchestrationEngine` 的 race/gather/ControlGroup＋`AcceptanceCheck` | ③ 发言权规则＋共享流投影 |

**不新增**：团队引擎（复用编排引擎）、权限档（复用五档）、事件种类（复用可选字段）、第三存储面
（成员档案落编排事件日志，共享流落会话事件日志）。

## 五、数据模型裁决（Q1–Q16 的落点）

| 机制 | 裁决 | 承载 | 理由 |
|---|---|---|---|
| M1 成员实体 | **B3：registry＝投影** | 档案写编排事件日志；投影可重建 | B1/B3 都过四条铁律；B3 让「可写档案」不必造新存储面，但必须钉「可重建」判卷 |
| M2 成员消息 | `agent_message` 的可选字段＋`requestId` 幂等 | 既有事件＋`submission-ledger` 先例 | 不新增事件种类；幂等键已有全仓先例 |
| M3 群聊 | **G2：群会话＋成员子会话** | 群共享流落群会话；每成员在自己的子会话干活 | G3 需要额外的「承载事件」；G2 与 sidechat 文件组同形 |
| M4 @ 路由 | **R1：事件为真＋投影** | `agent_message`/补丁通道 | R2 独立索引文件破重放；R1 与 agent-thread 投影同范式 |
| M5 成员目录 | worktree（write）扩展到 read | `src/agent/worktree.ts` | 越出团队工作区走审批门；不新造目录模型 |
| M6 成员权限 | 成员 ≤ 团队 ≤ 用户；只有人能改 | `PermissionMode`＋`clampTier`＋`ask-gate` | 权限单调继承已有；不给工具参数改档 |
| M7 私密成员 | 可见性规则＋**留痕式拒绝** | 记忆作用域＋权限规则＋gate 留痕 | 比上游强：上游自承网络工具不拦、不是系统边界；我们明确写出边界 |
| M8 记忆作用域 | **S1：扩展现有类型轴** | 团队/成员/群 × 现有 user/feedback/project/reference | S2 三档替换要重写检索层；S1 复用五件套，配额与冻结另加 |
| M9 上下文管家 | **C2：与 compaction 并存** | 管家只判「就地检查点 vs 开新段」；compaction 兜底 | 不替换已验证的压缩链；段先取 P2（`session_meta_update.patch` 的键），不可判别时回退 P1 |
| M10 全文检索 | 先线性扫描；索引另案 | `session-search`/`history-search` | `node:sqlite` 是新存储面；先量体量，超帽再裁 |
| M11 用量按成员 | 聚合桶加成员维 | `usage-attribution`＋`usage-analytics` | 事件已带 agent_id；只加维度 |
| M12 密钥 | 成员申请卡＋按成员授权 | `card_action`＋`safeStorage`＋`provider-key-inject` | 不新增事件种类；掩码与注入已有 |

## 六、权限、隐私与审计（比上游更强的四处）

1. **权限单调继承**：成员档 ≤ 团队档 ≤ 用户档；改档只走审批门，成员不能改自己的档（上游是「只有人能改」，
   我们用 `clampTier` 把「不能宽于父」变成机制）。
2. **私密性留痕**：可见性拒绝走 gate 留痕（`tool_result.gate`），事后可回放「谁在什么时候试图读谁」；
   上游的私密是文件沙箱，且自承不拦网络工具。**我们明确写：网络工具不是系统安全边界**，私密成员若要用
   网络工具，必须单独授权。
3. **派活总量闸**：上游自承 bot 互问无 TTL；我们用既有 `requestId`＋轮次/费用闸，把「无界互问」变成
   有界（Q18 差异点之一）。
4. **长文本冷存储**：上游踩过 6.5MB `state.json`；我们先取 L1 并量帽，L2 另案（Q18 差异点之二）。

## 七、判卷（J1–J6 与每机制验收）

- **J1/J2**：12 面逐项有 `path#symbol` 证据（本 ADR §二）。
- **J3**：落点 A 的裁决与三案对照（§三）。
- **J4**：每条建议的实现都要有断言形态；示例：
  - 成员档案重建：重放同一份编排日志两次 ⇒ 投影逐字相同；
  - 群分叉：群会话分叉后成员子会话各自按指针分叉，不拷贝父事件；
  - 权限：成员档试图宽于团队档 ⇒ `clampTier` 裁剪并出声；
  - 记忆冻结：冻结前后提示词逐字节不变（前缀缓存判据）；
  - @ 路由：同一消息两次投递 ⇒ 同一 `requestId` 返回首次回执，不重复执行。
- **J5**：结论进本 ADR、台账一页、原始证据进 `outputs/`（非 TS）。
- **J6**：每个候选数据模型写明与四条铁律的相容性（调研计划 §4.9 已给矩阵；本文 §五按矩阵落点）。

## 八、风险

| # | 风险 | 缓解 |
|---|---|---|
| R1 | 插件面边界被误读为「可以扩」 | 本 ADR 明确 B 出局；扩插件面另立架构裁决 |
| R2 | 事件种类封闭 vs 运行期簿记 | 能投影就别造事件；跨重启必须续等的状态走既有事件可选字段（Q13） |
| R3 | 权限规则链最长前缀未决 | bot 团队若引入新档位语义会踩同一条未决 ⇒ 两批串行，不并行改权限链 |
| R4 | UI 工作量 | 按调研计划 §五的定价，只做真要做的面板；复用渲染层 20k 行 components 的余量 |
| R5 | 记忆作用域迁移 | S1 扩展而非重写；先加 scope 轴与配额，再谈检索层 |
| R6 | 长文本 | L1 先量帽；L2 需要新存储面，另案裁决 |

## 九、未决（留给 Phase 4 spec）

- **Q11 段**：本 ADR 取 P2（事件分界），承载走 `session_meta_update.patch` 的键；若 spec 发现
  没有可判别信号，回退 P1（新会话文件，sidechat 范式）。
- **Q12 长文本**：先 L1；L2 的 blob 目录需要新存储面裁决，不在本 ADR 授权。
- **Q17 命名**：词表从本仓既有词长出来（成员档案/成员线程/团队会话/发言权/段），spec 给出
  「上游概念 → 本仓概念 → 落在哪个既有词」的对照表。
- **Q18 差异点**：至少覆盖①私密性强度②派活总量闸③长文本冷存储④群分叉语义；spec 逐条写
  「上游怎么做 → 我们怎么解 → 判卷是什么」。
- **UI 定价**：上游 104 个客户端文件是上限，不是承诺；spec 按本仓渲染层实际余量逐面板定价。

## 十、后果

- **核心**：新增成员档案投影、成员会话归属、发言权仲裁、段信号；改 `session_meta` 补丁通道的读取面；
  记忆加 scope 轴；用量桶加成员维。
- **桌面**：团队侧栏/群聊/成员详情/记忆面板/权限面板/用量面板，按渲染层分层与行帽切。
- **判卷**：新增核心与桌面测试；冻结面只在 spec 阶段按「人的动作」登记，不在本 ADR 改冻结表。
- **回滚**：形态 A 的回滚成本中等；所有新增语义都挂在既有事件可选字段上，回滚时投影忽略未知键即可。

## 十一、参考

- **Phase 4 第一篇（§九 五个未决口的答法）**：`docs/superpowers/specs/2026-11-16-bot-team-core-design.md`
  （待业主复核；本 ADR 的裁决一项未改）
- `docs/superpowers/plans/2026-11-14-ds-bot-benchmark.md`（v2.2；J1–J6、Q1–Q18、§4.9 矩阵）
- `docs/adr/0005-log-structural-records.md`（事件种类封闭）
- `docs/adr/0008-conversation-rail.md`（渲染层 rail 判据）
- 上游 `Fei2411/DS-Bot`（Apache-2.0，仅参考）
- 原始证据：`outputs/ds-bot-benchmark-2026-11-14/REPORT.md`（12 面命中复核、平台约束、文件数读数）
