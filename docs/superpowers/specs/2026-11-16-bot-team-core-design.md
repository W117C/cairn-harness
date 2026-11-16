# bot 团队协作核心 · 设计规格（Phase 4 第一篇：段 / 长文本 / 命名 / 差异点 / UI 定价）

状态：**待业主复核**（ADR 0015 仍为 Proposed；本规格只补它「§九 未决」的五个口，
不改 ADR 已裁决的任何一项——落点 A、B3、G2、P2、R1、S1、C2、L1 全部按原判）。
日期：2026-11-16（Asia/Shanghai）。
依据：`docs/adr/0015-ds-bot-benchmark.md`（裁决）、
`docs/superpowers/plans/2026-11-14-ds-bot-benchmark.md` v2.2（Q11 / Q12 / Q17 / Q18）。
参考材料（只取问题与代价）：上游 `Fei2411/DS-Bot`，Apache-2.0。
证据基线：HEAD `2bdac46a`。本文的 `path#symbol` 都在该提交的树上核过；行号会漂，符号名不会。

## 0. 一句话

五件未决口一次答清：**段是事件行号**（不是新会话文件）、**长文本先取事件内大 payload 并量帽**、
**命名从本仓既有词长出来**、**比上游强的四处写成判卷**、**UI 按面板定价**。
本规格不含实现代码；实施计划另起一篇（Phase 5），且须在 ADR 0015 获批之后。

## 1. 术语与命名（Q17）

判据（调研计划 §1.1）：每个词要么指回本仓既有词/字段，要么写明为何必须新造。
新造的只有 ADR §四 已授权的三件：**成员档案 / 发言权 / 段**。

| 上游概念（只作对照，不许沿用命名） | 本仓概念 | 落在哪个既有词或字段上 |
|---|---|---|
| bot、roster 条目 | **成员**（档案） | `src/agent/roles/user-agents.ts#UserAgentRole` 的角色面 ＋ 会话侧车 `model`/`thinking`（`src/main/session-metadata.ts#SessionMetadataRecord`）＋ `src/agent/worktree.ts#worktree`；档案本体作为事件落编排日志（ADR §五 B3） |
| `message_bot`（bot 间私信） | **成员消息** | `agent_message` 的可选字段（`kind` 现为 `progress`/`report`）＋ `requestId` 幂等（本仓既有先例） |
| room / `post_to_group` | **团队会话** | 会话事件日志本体 ＋ `session_meta.kind` 的新取值（与既有 `sidechat` 同形） |
| `part` / `segments[]` | **段** | `session_meta_update.patch` 的 `segment` 键（§2；取值是字符串序数） |
| `round` / `slot` | **轮** | 编排引擎的控制组（`race`/`gather`/`ControlGroup`，`src/orchestration/engine.ts#OrchestrationEngine`）＋ 发言权 |
| `@名字` 派活 | **派活** | 既有 worker 派活面（`src/tools/agent-lifecycle.ts#SEND_AGENT_TOOL`）＋ 任务书；不加新调度器 |
| `steward`（上下文管家） | **上下文管家** | 不是新组件：只判「就地检查点 vs 开新段」，落 `compaction` 的既有字段（ADR §五 C2） |
| `[Handoff · part N]` 交接包 | **交接包** | `user_message` 的 `origin` 通道（§3） |
| `MEMORY.md` 条目格式 | **记忆条目** | 现有四类型轴（user/feedback/project/reference）＋ 作用域键（ADR §五 S1） |
| `state.works` 派活树 | **派活链** | `agent_message` 的可选字段 ＋ 回执去重；不建第二个真源 |
| `chat-index.sqlite` | **会话检索** | `src/main/session-search.ts`（线性扫描 ＋ 字节帽），索引另案 |

**反向禁令**（可判卷）：新代码里不得出现 `message_bot` / `post_to_group` / `group_goal` /
`segments[]` / `state.json` 这些字符串；判卷用一条源码文本断言（读整个核心面，不读单文件）。

## 2. 段：分界就是事件行号（Q11 定稿）

**裁决落地：P2（事件分界），且不需要新事件种类，也不需要新字段。**

- 开新段 = 追加**一条** `session_meta_update`，`patch` 里带两个键：
  `segment`（新段序数，字符串整数，从 `"1"` 起）与 `segment_reason`
  （`user` / `steward_switch` / `compaction` 三值之一，自由字符串，读侧校验）。
- 为什么这样能成立（三条都核过）：
  1. `patch` 是 `Record<string, string>`，**缺席的键 = 不变**（`src/events/types.ts#SessionMetaUpdateEvent`）；
     ⇒ 加两个键不需要改类型面。
  2. 投影只从**有效集合**累积补丁（`src/events/projection.ts#project`）⇒ `sessionMetaPatch(events).segment`
     就是「当前段」；回退（`session_rewind`）会把分界前的段一起回滚，语义天然正确。
  3. 分界**全部**从日志本身可读：`replay()` 逐字返回每一行，凡带 `segment` 键的行就是一个分界
     ⇒ 段列表不需要别处存，也不破「事件 id = 1-based 行号」。
- **可判别信号**（spec 必须定死，否则 §4 的交接包和 §5 的 UI 都无从判）：
  只有三种发起人能开新段——用户显式请求、管家判定 `switch`、「就地检查点」被 compaction 接管。
  `segment_reason` 出现未知值 ⇒ **段仍成立**（分界存在），`reason` 记 `unknown`，不抛、不猜。
- **交接包的消息**：`user_message` ＋ `origin.kind = "handoff"`。
  这是本仓既有通道的正确用法（`UserMessageOrigin` 现有 sidechat / goal / steering 三支），
  属**既有可选字段的新取值**，不是新事件种类。代价必须写清：三条消费面要显式分支——
  `eventsForCurrentRun` 的 run 起点、「用户本轮说过话」的判据、渲染层的来源徽标。
- 判卷（可写成测试）：
  - 重放同一份日志两次 ⇒ 「第 N 段的消息集合」逐字相同；
  - 回退到分界那一行之前 ⇒ 段序数回到 `"1"`（补丁一并回滚）；
  - 造一个只有交接包的段 ⇒「用户本轮说过话」为 false；
  - `segment_reason` 写未知值 ⇒ 段成立且不抛。

## 3. 长文本：先 L1，帽从预算推，不凭感觉（Q12）

**裁决落地：L1（事件内大 payload）**，并加两条硬规则：

1. **热层截断**：进上下文的正文最多 2,000 字，另记 `length`（全文字数）。
   量纲取自本仓既有面：`src/agent/history-search.ts#HISTORY_SEARCH_MAX_EXCERPT_CHARS`
   的上限就是 2,000，不另造一把尺。
2. **全文只存一份**：全文只落事件（不复制进投影、不复制进侧车、不进 `outputs/`）；
   投影与检索一律走「热层 ＋ 全文在哪」的两段式读，不许把全文再摊一次。

- **升级触发（量到才裁，符合 ADR §九）**：出现下面任一读数时另案裁决 L2（自建内容寻址 blob）：
  单条事件 > 256 KiB，或单个会话日志 > `src/main/session-search.ts#DEFAULT_SEARCH_BUDGET_BYTES` 的一半。
  两个阈值都是**默认值**（待业主复核，见 §8），不是从上游抄的数。
- **探针（Phase 5 落成脚本，本规格只定口径）**：只读，输出
  「单行字节 p50 / p99 / max、超 256 KiB 条数、各会话日志字节数」，并打上命令与日期。
  本机现读**没有真实会话日志**（三个候选 sessions 目录都不存在）⇒ 本规格不填分布数字，
  也不拿夹具冒充真机分布。
- 判卷：一条 500 万字的消息仍能逐字重放；探针读数进 `outputs/` 证据（非 TS 文件）；
  热层截断后进提示词的字节数不随原文长度增长（改动前后同一条消息对比）。

## 4. 与上游明确不同的四处（Q18）

每行都是「上游怎么做 → 我们怎么解 → 判卷是什么」。**不以「上游这么做」为理由。**

| # | 点 | 上游怎么做 | 我们怎么解 | 判卷（断言形态） |
|---|---|---|---|---|
| 1 | **私密性强度** | 文件沙箱 ＋ 路径检查在工具钩子里；**不拦网络外联**（web 搜索/抓取/浏览器/MCP/shell 外联全放行），自承「不是系统安全边界」 | 可见性规则 ＋ **留痕式拒绝**：越权读走审批门并留 `tool_result.gate`；私密成员的网络类工具**默认拒**，要单独授权；文档明写「网络工具不是系统安全边界」 | 越权读 ⇒ deny ＋ gate 留一行，回放能查「谁在何时试图读谁」；私密成员调网络工具 ⇒ deny（除非该成员单独授权） |
| 2 | **派活总量闸** | 删掉全部总量/链长/轮数上限，**无 TTL**，自承「会一直跑到用户停下」 | `requestId` 幂等 ＋ 轮次／费用闸（既有 `usage` 账 ＋ `contract.idempotency_key`）；超预算 ⇒ 拒绝并出声，不静默降级 | 同一 `requestId` 二次投递 ⇒ 返回首次回执、执行 0 次；一轮内成员互问超预算 ⇒ 拒绝且消息可见 |
| 3 | **长文本冷存储** | 热处存前 2000 字，超 20000 字转宿主附件库（内容寻址）；踩过 6.5MB `state.json` | L1 ＋ 热层 2,000 字截断 ＋ 探针升级触发（§3）；不引新存储面 | 500 万字消息逐字重放；探针读数不超扫描预算；热层字节不随原文增长 |
| 4 | **群分叉语义** | 无（`state.json` 单份，没有分叉概念） | 群会话＝指针分叉（`{parent, boundary}`，不复制父事件）＋ 每成员子会话各自分叉；新段序数从分叉点续 | 群分叉后父事件数不变；成员子会话的 parent 指向各自父；分叉点的 `segment` 值被继承而不是重置为 `"1"` |

## 5. UI 定价：按面板给价，不按「对齐上游 104 个客户端文件」

现读体量（HEAD `2bdac46a`，测法写在表下）：

| 量 | 现读 | 与规格的关系 |
|---|---|---|
| 渲染层源文件 | 247 个 | 分层纪律的受检面（`pnpm renderer-layer-check`） |
| `App.tsx` | 17 行 | 上限 900，余量充足；新面板不许进这里 |
| 单文件上限 | 1,200 行 | **约束点**：`components/Sidebar.tsx` 已 928 行 ⇒ 成员区**必须**另开文件 |
| 渲染层 CSS 总量 | 10,213 行 | 新样式只进我们自己的层，vendor 一字节不改 |
| 窗格种类 | 9 个（`apps/desktop/src/renderer/pane-registry.ts#PaneKind`） | 团队会话＝第 10 个窗格种类，要同步改 registry／Dock／弹窗路由 |
| 对照面板：设置分段 | `components/settings/SubagentsSection.tsx` 161 行 | 成员详情／记忆面板的单段量级 |
| 对照面板：窗格本体 | `panes/WorkbenchView.tsx` 984 行、`components/PaneDock.tsx` 992 行 | 团队会话窗格的量级上界（两处都已接近 1,200 帽） |

测法：`find apps/desktop/src/renderer -name '*.ts*' | wc -l`、`wc -l` 逐文件、
`rg -l sidechat apps/desktop/src/renderer | xargs wc -l`（同族触及面 ≈ 5.5k 行）。

| 面板 | 触及文件族 | 定价（新文件数 × 上限） | 不许做的事 |
|---|---|---|---|
| 成员区（侧栏一段） | 新 `components/TeamRoster.tsx` ＋ `state/team.ts` ＋ strings | 3 文件内，**不碰 `Sidebar.tsx`**（928/1200） | 把成员列表塞进侧栏本体 |
| 团队会话窗格（群聊） | `pane-registry.ts` ＋ `PaneDock.tsx` ＋ 新 `panes/TeamPane.tsx` ＋ `state/team-thread.ts` | 4 文件；`PaneDock` 只加注册行，不长大 | 让窗格自己持有会话真相（真相在事件日志） |
| 成员详情／记忆面板 | 新 `components/settings/TeamSection.tsx` ＋ 复用记忆面板 | 2 文件 | 新造第二个记忆读数面 |
| 权限面板 | 复用既有 `PermissionsSection` | 0 新文件，只加成员维度行 | 新增权限档位 |
| 用量面板 | 复用 `UsageMeter` / 用量分段 | 0 新文件，只加成员聚合维 | 前端自己算钱 |

**总预算**：新面板族 ≤ 9 个新文件；任何一处触到 1,200 行帽就先拆，不申请放宽（`AGENTS.md` 的帽只准下调）。

## 6. 判卷清单（本规格新增的，ADR §七 之外）

| # | 判据 | 形态 |
|---|---|---|
| S1 | 段：重放两次段切片逐字相同；回退后段序数回退 | 核心测试（重放） |
| S2 | 段：`segment_reason` 未知值不阻断 | 核心测试 |
| S3 | 交接包不被当成用户发言 | 核心测试（run 起点／「说过话」判据） |
| S4 | 长文本：热层截断 ≤ 2,000 字且 `length` 记全文 | 核心测试 |
| S5 | 长文本：探针读数进证据，不超扫描预算 | 只读脚本 ＋ `outputs/` 证据 |
| S6 | 差异点 1–4：逐条断言（§4 右列） | 核心测试 ＋ gate 留痕断言 |
| S7 | 命名：新代码零上游命名 | 源码文本断言（读整个核心面，不读单文件） |
| S8 | UI：渲染层分层 ＋ 行数帽 | `pnpm renderer-layer-check` |

## 7. 不做 / 已知差距（连理由一起钉住）

- **不做**新事件种类、新存储面、新权限档、新团队编排引擎（ADR §一.4 五条不变量）。
- **不做**全文索引（`node:sqlite` 是新存储面，且中文两字词 trigram 匹配不了——上游自承）；
  先量体量（§3 探针），超帽再裁。
- **不做**上游那套「每段一个 Session 文件」：段是行号，不是文件（§2）。
- **已知差距**：热层 2,000 字的量纲取自检索面（`history-search`），不是从真实长消息分布量出来的
  ——本机没有真实会话日志，分布数字留到探针在真机跑过之后补。
- **已知差距**：`session_meta_update.patch` 只按键「最后写入生效」，所以它能给出**当前段**，
  段列表要靠扫事件（§2 第 3 条）；这不是缺陷，但读侧不许只读 patch 就宣布「段只有一段」。

## 8. 待业主复核（每条带默认值，不等答复也能开工）

| # | 问题 | 默认（不另行裁决即按此执行） |
|---|---|---|
| 1 | 段的三个 `segment_reason` 够不够？ | 够：`user` / `steward_switch` / `compaction`；未知值按 `unknown` 记，不阻断 |
| 2 | 长文本的「热层 2,000 字」与升级阈值（256 KiB / 扫描预算一半）认不认？ | 认，且两个阈值都写进探针输出，便于随时改 |
| 3 | UI 总预算「≤ 9 个新文件」够不够？ | 够；不够时先拆 `PaneDock`（992/1200）再加 |
| 4 | 私密成员的网络工具默认拒，还是默认放行＋留痕？ | **默认拒**（要单独授权才放行）；理由是上游在这一处自承「不是安全边界」，我们不做第二个同样的洞 |
