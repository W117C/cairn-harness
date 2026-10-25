# 多智能体编排平台设计（Orchestration Kernel）

状态：方向已裁决（2026-10-25），本文件待审阅，尚未实施。
代码核对起点：`f4bffa3a`（HEAD）。仓库中其它会话的未提交改动不在本设计范围内。
交付目标：P0–P4 全量（内核 + 控制面），P5 持续评测，P6 开放面留门。

## 0. 裁决记录

| # | 裁决 | 结论 |
|---|---|---|
| 1 | 主战场 | 通用 agent 平台，不把任务模型绑死在 git/worktree 上 |
| 2 | 自治边界 | 沙箱内全自动；联网写、发消息、部署等外部副作用受控；不可逆/资金动作保留闸 |
| 3 | 首版范围 | 内核 + 控制面全量（P0–P4 一次交付） |
| 4 | 规模 | 计划可含 100+ 任务；并发受执行后端与 provider 配额约束，不是 100+ 同时拨号 |
| 5 | 执行底座 | 本地优先 + 远程可插拔；100+ 靠远程 worker 扩容 |
| 6 | 完成定义 | 机器验收 + 独立只读验证者；生产者不能自证 |
| 7 | 首批领域 | 编码优先，抽象保持通用；研究/运维/数据后续接领域包 |
| 8 | 技术路线 | 自研编排内核，不引入 LangGraph/Temporal 作为主运行时 |

“全自动”在本设计中的精确定义：**R0–R2（只读、工作区写、本地执行）在沙箱、能力白名单与预算内自动；R3（外部副作用）默认通知或按策略批准；R4（不可逆/资金）默认拒绝或强制人工。** 若要放宽 R3/R4，必须另立显式“完全信任”策略并带补偿/回滚，不能靠改一个布尔开关。

## 1. 目标与边界

### 1.1 目标

1. 一个不可变的 Plan/Flow 可以描述 100+ 任务、依赖、动态派生、预算、能力与验收契约。
2. 内核按事件流确定性地调度与恢复；任何时刻都能从 JSONL 重建任务图、队列、租约、预算与合并状态。
3. 执行后端可插拔：本地 worktree/进程/容器与远程 worker 共享同一套任务语义。
4. 全自动只在沙箱与策略允许的范围内成立；人可以随时暂停、接管、取消、回滚。
5. 完成由契约与证据定义，不由 worker 的散文自述定义。
6. 编码包先打出可验证读数，但 Task/Contract/Capability/Artifact 不依赖 git。
7. 所有决策、能力使用、验证、合并、回滚可审计、可回放。

### 1.2 非目标

- 多租户 SaaS、计费、市场、组织权限（P6 之后再谈）。
- 在沙箱外执行任意不可信代码。
- 默认自动执行 R4 动作（删除、force push、支付、生产变更）。
- 用自由群聊替代任务图；写任务不做 peer-to-peer 直接通信。
- 替换现有 CLI/桌面会话、sidechat、pipeline、supervise 与既有事件协议。
- P0–P4 内实现 A2A 外部 agent 互操作；只留适配层。

### 1.3 成功度量

先量基线，再定目标，不先写“提升 X%”：

| 指标 | 口径 |
|---|---|
| verified completion rate | 通过契约且证据新鲜的完成任务 / 全部任务 |
| cost per verified task | 任务及其验证、返工、合并的总成本 |
| time-to-verified | 计划批准到契约全绿 |
| human interventions per 100 tasks | R3/R4 审批、接管、冲突处理、回滚 |
| conflict / rework rate | 写域冲突、合并失败、返工任务占比 |
| stale evidence rate | 验证后又被写盘、必须重验的比例 |
| policy violations | 越权尝试、预算越界、沙箱逃逸拦截 |
| recovery time | 崩溃/断线到恢复调度的时长 |
| replay determinism | 同一日志重放得到同一任务图与决策 |

## 2. 已核实现状

### 2.1 已有资产

| 资产 | 现状 | 证据 |
|---|---|---|
| 事件溯源 | 38 类事件，JSONL，`replay` 逐字返回，分叉是指针 | `src/events/types.ts:879`、`src/events/log.ts`、`src/events/session.ts` |
| 单任务执行 | `spawn_agent` 四档 `read/write/pipeline/supervise`，深度 1，并发 4，满即拒绝 | `src/agent/orchestrator.ts:311,399,519` |
| 工作隔离 | write worker 独立 worktree、基线提交、diff、合并控制塔、安全闸 | `src/agent/worktree.ts`、`worker-merge.ts` |
| 计划/验证 | `plan_proposed` / `plan_approved` / `verify_result` / `card_action` / `diff_comment` | `src/events/types.ts:211-213,526-577` |
| 回执证据 | `agent_result.artifacts.verified` 四态、`spent_usd`、`diff_ref` | `src/events/types.ts:490-523` |
| 权限/审批 | 六闸、L0–L4 自主性、AskGate、worker 权限 ≤ 父 | `src/agent/loop.ts:700`、`src/permissions/`、`src/main/ask-gate.ts` |
| 桌面控制面 | worker 卡片、状态/角色/证据/花费/diff/合并/拒绝 | `apps/desktop/src/renderer/components/PaneDock.tsx:755-855` |
| 恢复/预算/路由 | respawn、budgetBlocked、routing、compaction | `src/agent/orchestrator.ts`、`src/agent/recovery.ts`、`src/routing/` |

### 2.2 缺口

1. **计划不是一等对象**：`PlanProposal` 只有 goal/files/approach/verify，没有任务树、依赖、写域、每任务验收与预算。
2. **没有跨任务调度器**：现有 `depends_on` 只是单层事件触发；没有队列、背压、公平性、暂停/接管、合并队列。
3. **上下文包不结构化**：worker 拿到 task+context+记忆，没有接口契约、输入工件、写域、验收命令、证据格式的统一下发。
4. **没有独立验证者**：验证主要靠 worker 自证 + merge gate；缺少只读、独立上下文、不可由生产者兼任的 verifier。
5. **没有平台级控制面**：TasksPane 是 worker 卡片列表，不是 Plan/Flow 审批、任务 DAG、预算与干预面。
6. **没有编排评测**：没有确定性 scripted fixture 验证调度、租约、预算、策略、合并、回放。

### 2.3 硬约束

- **不新增事件种类**：ADR 0005 只允许“日志结构记录”新增事件种类；编排属于“agent 做了什么”，只能给既有事件加可选字段。
- **旧日志逐字可回放**：新增字段一律可选；缺席即旧语义。
- **IPC 版本钉**：当前 `IPC_PROTOCOL_VERSION = 20`；本设计新增通道后升到 21，同步 `mustWire`、index wired、preload 构建与版本测试。
- **core/desktop 边界**：编排内核住 `src/`，不得 import Electron/UI；控制面住 `apps/desktop/`。
- **冻结判卷**：不改旧 fixture、不弱化断言；新增行为配新判卷。
- **深度与并发旧纪律**：现有 `spawn_agent` 仍保持深度 1、并发 4、满即拒绝；新内核的队列语义只作用于 Plan/Flow 通道，不改旧通道。

结论：**扩展，不重写。** 现有 `Orchestrator` 保留为本地执行适配器；新内核负责计划、队列、租约、预算、策略、验证与合并编排。两者只通过事件与窄接口交互，避免双调度器。

## 3. 第一原则与权威

| # | 原则 | 含义 |
|---|---|---|
| P1 | 事件是唯一真值 | JSONL 是权威；索引、快照、UI、队列都是可重建投影 |
| P2 | 计划即数据 | Plan/Flow 是不可变、版本化的契约；执行是解释，不是聊天 |
| P3 | 能力由后端强制 | 工具/文件/网络/资金权限在网关与沙箱执行，不靠提示词 |
| P4 | 完成即契约 | 没有新鲜证据的“完成”不算完成；生产者不能自证 |
| P5 | 自治有界 | 风险、能力、预算、并发、时限、无进展检测共同设上限 |
| P6 | 中心协调 | worker 不直接互聊；协调经内核；共享的是工件与决策，不是整段转录 |
| P7 | 效果可逆 | 每个外部效果有幂等键与补偿/回滚；不可逆动作默认加闸 |
| P8 | 默认单 agent | 只有可并行、需隔离权限或需隔离上下文时才派生 |

### 3.1 权威表

| 层 | 谁持有权威 | 不能做什么 |
|---|---|---|
| 事件层 | JSONL + `replay()` | 不被 UI/调度器改写；不因索引损坏而丢事实 |
| 计划层 | 版本化 Plan/Flow 事件 | 不在内存里偷偷改计划；变更必须新版本 + 新事件 |
| 任务层 | Plan 的任务定义 + 事件投影 | 不用内存 Map 当任务真值 |
| 调度层 | 纯函数 `nextActions(view)` + 效果执行 | 不在投影里做 IO/时钟/随机 |
| 执行层 | 后端 + 能力网关 | worker 不继承主对话、不越权、不直接互聊 |
| 验收层 | 契约 + 机器证据 + 独立验证者 | 不用散文自证、不用 stale 证据、不让生产者当唯一裁判 |
| 控制面 | 只读投影 + 命令事件 | 不猜状态、不绕过策略、不做第二事实源 |

## 4. 领域模型

以下是概念模型，实施时落在 `src/orchestration/`，命名可按仓库规范调整，语义不变。

```ts
type PlanId = string;
type TaskId = string;
type RunId = string;
type ArtifactRef = { id: string; kind: "file" | "blob" | "json" | "url"; hash?: string };

type OrchPlan = {
  plan_id: PlanId;
  version: number;                 // 从 1 起；每次 replan +1
  parent_plan_id?: PlanId;         // replan 血缘
  goal: string;
  non_goals: string[];
  domain: "coding" | "research" | "ops" | "data" | "generic";
  flow: FlowNode;                  // 静态 DAG 与动态程序同构
  budget: Budget;                  // 计划总预算
  policy_ref: string;              // 策略快照 id
  created_by: "user" | "planner" | "policy";
};

type FlowTask = {
  task_id: TaskId;
  goal: string;
  non_goals: string[];
  agent_spec: string;              // AgentSpec id
  lane: "read" | "write" | "external";
  depends_on: TaskId[];
  write_scopes: string[];          // 文件 glob / 资源 URN
  inputs: ArtifactRef[];
  contract: Contract;
  budget: Budget;
  deadline_ms?: number;
  max_attempts: number;            // 1..5
  priority: number;                // 0..9，默认 5
};

type Contract = {
  acceptance: AcceptanceCheck[];   // 机器可执行优先
  evidence: EvidenceSpec;          // 报告必须包含的字段/工件
  effect: "none" | "workspace" | "external";
  idempotency_key?: string;        // external 必填
  rollback?: RollbackSpec;         // external/不可逆动作必填
};

type Capability = {
  tools: string[];                 // 工具名白名单
  fs_read: string[];               // 绝对根或工作区相对 glob
  fs_write: string[];              // write lane 必填
  network: string[];               // 域名白名单；"none" = 禁网
  shell: "none" | "read" | "sandboxed" | "full";
  git: "none" | "read" | "commit" | "merge";
  spend_usd: number;               // 单任务硬上限
  external_effects: "none" | "allowlist" | "unrestricted";
};

type AgentSpec = {
  agent_spec_id: string;
  role: string;
  model_tier: "cheap" | "standard" | "strong";
  capability: Capability;
  context_policy: {
    include_plan_goal: boolean;
    include_artifacts: string[];   // artifact id / tag
    max_tokens: number;
  };
  max_turns: number;
};

type Lease = {
  task_id: TaskId;
  scope: string;                   // 规范化后的写域
  mode: "exclusive" | "shared-read";
  expires_at: number;              // 事件时间 + 租期；心跳续约
};

type Run = {
  run_id: RunId;
  task_id: TaskId;
  attempt: number;
  backend: "local" | "remote";
  status: "queued" | "running" | "verifying" | "merging" | "done" | "failed" | "cancelled";
};
```

### 4.1 不变量

1. 同一 `plan_id` 内 `task_id` 唯一；依赖图无环；`depends_on` 只能引用同计划任务。
2. 并发写任务的 `write_scopes` 不得相交；相交时必须串行或拒绝，不能靠事后合并冲突兜底。
3. 每个任务必须有 `Contract`；`external` 效果必须有幂等键与回滚/补偿。
4. 每次执行产生新的 `run_id`；重试不改写旧 run 的事件。
5. 预算非负；预留、消耗、释放都可从事件重建；不允许负余额。
6. Plan 版本不可变；replan 产生新 `version` 与新事件；旧版本仍可回放。
7. 任务状态只能由事件投影得出；UI/队列不得直接改状态。

## 5. 事件映射：不新增事件种类

### 5.1 字段扩展

| 既有事件 | 新增可选字段 | 用途 |
|---|---|---|
| `plan_proposed` | `plan.plan_id/version/parent_plan_id/domain/non_goals/flow/tasks/budget/policy_ref` | 计划与 Flow 的唯一落点 |
| `plan_approved` | `plan_id/version/approved_by("user" 或 "policy")/policy_decision` | 人工或策略批准；旧 `approved` 继续有效 |
| `agent_spawned` | `plan_id/task_id/parent_task_id/lane/attempt/flow_node/capability_digest/write_scopes/contract_hash` | 任务真正开始执行；血缘与契约锚点 |
| `agent_status` | `plan_id/task_id/run_id/phase/attempt` | queued/running/verifying/merging/done/failed/cancelled |
| `agent_result` | `plan_id/task_id/run_id/contract_result("pass" / "fail" / "unverifiable")/evidence_refs/artifacts` | 任务回执与验收输入 |
| `verify_result` | `task_id/contract_id/checks[]/evidence_ref` | 机器验收明细 |
| `approval_requested` | `plan_id/task_id/policy_class("R0".."R4")/policy_reason` | 风险分级与审批归因 |
| `approval_resolved` | `plan_id/task_id/policy_class/decided_by("user" 或 "policy")` | 审批结果 |
| `card_action` | `plan_id/task_id/run_id/flow_node/payload_version` | 编排控制命令与结果（见 5.3） |
| `routing_decision` | 不变 | 模型档位归因继续沿用 |

所有新增字段可选；旧日志缺席即旧语义。`agent_spawned.task` 继续是任务文本，`task_id` 是稳定标识，两者不互相替代。

### 5.2 任务状态投影

`projectOrchestration(events)` 是纯函数，输出：

```ts
type OrchestrationView = {
  plans: Map<PlanId, PlanView>;
  tasks: Map<TaskId, TaskView>;
  queue: TaskId[];
  leases: Lease[];
  budgets: BudgetView;
  merges: MergeView[];
  anomalies: Anomaly[];
};
```

状态推导：

- 计划出现在 `plan_proposed`；批准出现在 `plan_approved`。
- 未 spawn 的任务 = `planned`；`agent_spawned` = `running`；`agent_status.phase` 覆盖后续状态；`agent_result` 是终态输入。
- `verify_result` + `agent_result.artifacts.verified` 决定 `contract_result`。
- `card_action` 的 merge/reject/rollback 决定合并视图。
- 无法解释的字段/版本 → `anomalies`，fail-visible，不猜。

### 5.3 编排控制命令

不新增事件种类，统一走 `card_action`：

```ts
type OrchestrationCardAction =
  | "approve_plan" | "reject_plan"
  | "pause_plan" | "resume_plan" | "cancel_plan"
  | "pause_task" | "resume_task" | "cancel_task" | "takeover_task"
  | "merge_task" | "reject_merge" | "rollback_task"
  | "retry_task" | "escalate_task";
```

`card_type = "orchestration"`，`payload` 使用版本化 schema（`payload_version: 1`）。请求与结果各落一条 `card_action`，结果的 `source_event_id` 指向请求；不把“已合并”只写在内存里。

### 5.4 投影索引

- P0：内存索引 + 周期性快照（JSON，记录 `last_event_id` + 视图摘要）。启动时加载快照，重放尾部；快照缺失/损坏则从零重放。
- 快照是缓存，不是真值；不得接受直接写入；删除后可重建。
- P3 若远程/100+ 需要更强查询，再评估可插拔索引后端（SQLite/列存）；仍必须可从 JSONL 重建。P0 不引入新数据库依赖。

## 6. Flow DSL

### 6.1 设计原则

- **JSON AST，不执行任意代码**：先拿到可回放、可审计、可静态检查的编排；不把 `eval` 引入内核。
- **表达式受限**：只允许字面量、引用、比较、布尔、长度、包含、工件元数据、任务状态。没有函数调用、没有 IO、没有时钟/随机。
- **每个节点可预算、可能力约束、可验收**。
- **动态但不失控**：`map/loop/branch` 的上限写进计划；运行时只能在上限内派生。
- **不可变版本**：Flow 变更 = 新 version + 新 `plan_proposed`；旧版本继续可回放。

### 6.2 节点

```ts
type FlowNode =
  | { kind: "task"; task: FlowTask }
  | { kind: "sequence"; steps: FlowNode[] }
  | { kind: "parallel"; steps: FlowNode[]; max_concurrency?: number }
  | { kind: "map"; items: Expr; body: FlowNode; max_concurrency?: number }
  | { kind: "race"; steps: FlowNode[]; judge: ContractRef }
  | { kind: "gather"; steps: FlowNode[]; strategy: "all" | "any" | "quorum"; quorum?: number }
  | { kind: "branch"; when: Expr; then: FlowNode; else?: FlowNode }
  | { kind: "loop"; while: Expr; max_iterations: number; body: FlowNode }
  | { kind: "verify"; target: Expr; contract: ContractRef }
  | { kind: "merge"; targets: Expr; policy: "serial" | "topological" }
  | { kind: "checkpoint"; label: string }
  | { kind: "escalate"; reason: Expr };
```

语义要点：

- `parallel` 只并行“就绪且租约不冲突”的任务；不是无条件同时拨号。
- `map` 的 `items` 必须来自工件或已落事件；运行期长度决定派生数量，但受 `max_concurrency` 与计划总任务上限约束。
- `race` 的 judge 必须是机器契约优先；早停取消其余任务，取消也要落事件。
- `gather` 的 `quorum` 未达成时按契约失败或升级，不静默取部分结果。
- `loop` 必须有 `max_iterations` 与无进展检测；达到上限升级。
- `merge` 默认 `serial`；`topological` 只在依赖图保证无冲突时允许。
- `escalate` 是显式人工出口，不是异常吞掉。

### 6.3 示例（编码包）

```json
{
  "kind": "sequence",
  "steps": [
    { "kind": "parallel", "max_concurrency": 8, "steps": [
      { "kind": "task", "task": { "task_id": "scout-repo", "lane": "read", "agent_spec": "repo-scout", "contract": { "acceptance": [{ "kind": "evidence", "fields": ["conclusion", "paths"] }] } } },
      { "kind": "task", "task": { "task_id": "scout-tests", "lane": "read", "agent_spec": "test-scout", "contract": { "acceptance": [{ "kind": "evidence", "fields": ["conclusion", "paths"] }] } } }
    ]},
    { "kind": "map", "items": { "ref": "scout-repo.chunks" }, "max_concurrency": 4, "body":
      { "kind": "task", "task": { "task_id": "impl-${index}", "lane": "write", "agent_spec": "implementer", "write_scopes": ["${item.scope}"], "contract": { "acceptance": [{ "kind": "command", "run": "pnpm test" }] } } }
    },
    { "kind": "merge", "targets": { "ref": "impl-*" }, "policy": "serial" }
  ]
}
```

（`${...}` 由受限表达式解析；不执行任意 JS。）

### 6.4 上限

| 限制 | 默认 | 说明 |
|---|---:|---|
| 单计划任务数 | 256 | 100+ 可用，但不无限 |
| 单任务派生深度 | 2 | 默认 1；只读子任务可到 2 |
| 单节点并发 | 8（本地）/ 可配（远程） | 受 provider/tool 配额进一步限制 |
| loop 迭代 | 8 | 必须有退出条件 |
| 任务重试 | 5 | 超过升级人工 |
| 计划版本 | 32 | 防止 replan 抖动 |
| 计划预算 | 必填 | 没有预算不许 auto 批准 |

## 7. 调度内核

### 7.1 状态机

```
planned → queued → running → verifying → merging → done
                    ↘ failed → retry/queued
                    ↘ cancelled
```

- `planned`：在已批准计划里、依赖未满足或未入队。
- `queued`：就绪但受并发/预算/租约/配额限制。
- `running`：本地或远程执行中。
- `verifying`：机器验收/独立验证中。
- `merging`：合并/发布队列中。
- `done`：契约通过 + 证据新鲜 + 策略满足。
- `failed`：可重试或升级；旧 run 事件不改写。

### 7.2 就绪判定（纯函数）

任务就绪当且仅当：

1. 依赖全部 `done`；
2. 所需租约可获取；
3. 预算预留成功；
4. 后端/模型/工具配额有槽；
5. 计划未被暂停/取消；
6. 任务自身未超 deadline。

`nextActions(view)` 返回 `{dispatch, wait, verify, merge, escalate, retry, cancel}` 的确定性列表；tie-break 按 `priority` 降序、`task_id` 升序、`plan_id` 升序。决策函数不读墙钟；deadline 用事件里的 `ts` 计算。

### 7.3 队列与背压

- **队列而不是拒绝**：新内核通道在满时排队；旧 `spawn_agent` 通道保持“满即拒绝”，两者不混。
- 每计划/每 provider/每 tool/每后端独立配额；使用令牌桶与队列深度上限。
- 准入控制：计划批准前做预算估算；超预算的计划不进入 auto 批准。
- 公平性：多计划时按权重轮转，避免一个大计划饿死其它计划。
- 背压信号：队列深度、provider 429、远程 worker 心跳、工具延迟；触发降并发/暂停派生，不丢任务。

### 7.4 租约与写冲突

- 读任务默认共享工作区；写任务必须独立 worktree/overlay/容器。
- `write_scopes` 规范化后做相交检测（复用 `src/agent/lease-conflicts.ts` 的 glob 相交与语义冲突）。
- 相交的写任务：串行；或在计划阶段就拆成依赖；不允许“先并行、后合并冲突”作为默认。
- 租约有 TTL 与心跳；崩溃后过期可回收；未过期不得被抢。
- 外部效果用 `idempotency_key` + effect lock；重试不得重复扣款/重复发布。

### 7.5 重试、无进展与升级

- 重试上限来自 Task；退避按 attempt 的确定性序列，不用随机抖动。
- 无进展检测复用 `src/agent/no-progress.ts` 的语义；连续 N 轮无新证据 → `escalate_task`。
- 同一 `(goal, contract_hash)` 重复失败 ≥3 次 → 升级人工，不再自动烧钱。
- 升级是显式 `card_action`/`approval_requested`，不是静默失败。

### 7.6 暂停、恢复、取消、接管

- `pause_plan`：停止派发新任务，运行中任务按策略继续或暂停；不丢队列。
- `resume_plan`：从投影重建队列；不重跑已完成任务。
- `cancel_plan/task`：传播取消信号；运行中任务取消落事件；worktree 清理走既有四路清理。
- `takeover_task`：人接管后，worker 只读/停止写；后续动作由人/主会话执行，仍落事件。
- kill switch：全局/计划/任务三级；立即取消 + 拒绝新派发 + 审计。

### 7.7 崩溃恢复与幂等

- 启动时重放事件；`running` 但无终态的任务标记 `interrupted`，按策略重试或升级。
- 恢复不重放副作用：provider/tool 提交带 `requestId`；合并带幂等键。
- 本地 worktree 由事件里的 `worktree/base_commit` 重建；孤儿 worktree 走既有扫描。
- 远程 worker 断线：心跳超时 → 任务重新入队或升级；worker 侧结果以幂等键去重。

### 7.8 100+ 的边界

- “100+”指**计划内任务规模**，不是同时 100+ 模型调用；并发由后端/provider 配额决定。
- 本地后端建议 8–16 并发；远程后端可配；超出配额的任务在队列等待。
- P3 提供远程 worker 协议：任务信封、能力令牌、预算、deadline、心跳、取消、工件上传/下载、结果事件回传。
- 远程 worker 不得直接写本地工作区；只能写自己的沙箱并通过工件/补丁回传。

## 8. 能力、策略与自治

### 8.1 能力强制

- `Capability` 编译成现有工具表/权限档/沙箱参数；模型只看到允许的工具。
- 工具网关做 schema 校验、参数范围、路径规范化、网络域名检查、密钥注入与脱敏。
- 写域在工具层再校验一次，不只在调度层；防止 worker 通过 shell 绕过。
- 远程 worker 使用短期能力令牌；令牌只含任务所需能力，不含全局密钥。

### 8.2 风险分级与策略

| 风险 | 例子 | 默认决策 |
|---|---|---|
| R0 | 读文件、搜索、查日志 | allow |
| R1 | 工作区写、生成工件 | allow（沙箱内） |
| R2 | 本地测试/构建/只读命令 | allow（沙箱内） |
| R3 | 联网写、发消息、提交 PR、部署 | notify 或 approve（按域策略） |
| R4 | 删除、force push、支付、生产变更 | deny 或 approve（显式策略） |

策略可配置：`allow / notify / approve / deny`；按 plan/domain/tool/domain-name 覆盖；默认最严。策略决策落 `approval_requested/resolved` 或 `card_action`。

### 8.3 全自动的边界

- auto 批准计划的条件：预算在计划上限内、能力白名单内、无 R4、R3 有显式策略、任务数/深度/并发在限内。
- auto 合并的条件：契约全绿、证据新鲜、无冲突、安全闸通过、策略允许。
- 任何一条不满足 → 通知/审批/升级，不静默降级。
- 全局预算与 burn-rate 告警；超限立即停止派发。

### 8.4 沙箱与密钥

- 本地：worktree + 现有 Seatbelt/沙箱；写任务只作用于 worktree；只读任务只读。
- 远程：容器/VM 隔离；网络按 `Capability.network`；只挂载任务工件。
- 密钥只在工具网关注入，不进入模型上下文；日志/工件脱敏。
- 工具输出视为不可信数据；提示注入不能改变能力边界。

### 8.5 审计

- 每个策略决策、能力使用、越权尝试、预算扣减、合并、回滚都有事件。
- 审计面可按 plan/task/run/agent 过滤；支持导出。
- 失败分类（MAST）从 trace 自动打标，供回归与告警。

## 9. 上下文、工件与黑板

### 9.1 Context packet

每个任务收到一个结构化包，而不是主对话：

```ts
type ContextPacket = {
  plan_goal: string;
  plan_non_goals: string[];
  task_goal: string;
  task_non_goals: string[];
  interfaces: string[];        // 必须遵守的接口/契约
  inputs: ArtifactRef[];       // 输入工件
  write_scopes: string[];
  acceptance: AcceptanceCheck[];
  evidence_format: string;
  capability_digest: string;
  budget: Budget;
  relevant_decisions: ArtifactRef[]; // 计划级决策
};
```

- 默认不继承主会话历史；需要的历史事实必须以工件/决策条目显式提供。
- 大产物落工件存储，worker 只回传引用 + ≤2k token 摘要（沿用现有 summary cap）。

### 9.2 工件存储

- 内容寻址（hash）；元数据含 kind、producer、task、created_at、sensitivity。
- 写入前脱敏；敏感工件默认不进模型上下文。
- 工件可被后续任务引用；删除受依赖保护。

### 9.3 黑板

- 计划级共享事实/决策：类型化条目 + 来源 + 时间；不是自由聊天。
- 只有 planner/授权任务可写；worker 默认只读。
- 影响他任务的决策必须落黑板/接口契约，并由依赖任务引用；这是对 Cognition「行动携带隐含决策」的结构化回答。

## 10. 验收与交付

### 10.1 契约

- `AcceptanceCheck` 类型：`command`（测试/构建/类型检查）、`schema`、`invariant`、`artifact`、`evidence`、`human`。
- 机器检查优先；没有机器检查时才由独立 verifier 判断，且必须标 `unverifiable` 风险。
- 检查在干净环境执行；记录命令、退出码、输出摘要、环境指纹。

### 10.2 独立验证者

- 只读、独立上下文、独立 agent spec；不得由生产者兼任。
- 输入：契约 + 工件 + 证据 + 必要的只读代码；不读生产者的完整转录。
- 输出：结构化 verdict（pass/fail/unverifiable）、证据引用、风险、未决。
- 机器检查存在时，verifier 只做交叉核对；不存在时才是主判据。
- verifier 自身也受预算与能力约束；不能无限重验。

### 10.3 证据状态

沿用四态：`verified / failed / stale / absent`。

- `verified`：最后一次成功写盘之后有绿拍。
- `failed`：最后拍是红的。
- `stale`：验过之后又写了盘；不得当证据，合并前必须重验。
- `absent`：没有验证拍；不能算完成。

### 10.4 合并队列（编码包）

- 默认串行；按依赖拓扑排序；同一写域不并行合并。
- 合并前：基线检查、冲突检测、契约重验、安全闸、策略检查。
- 合并后：集成验证（受影响测试/构建）；失败则回滚/回退，并创建修复任务。
- 自动合并只在 8.3 条件满足时；否则通知/审批。
- 合并结果落 `card_action` + 任务状态；worktree 清理走既有路径。

### 10.5 通用交付（非编码包）

- 工件发布 + 契约检查 + 聚合；外部效果带幂等键与补偿。
- 不可逆动作默认人工；回滚不可行时必须先审批。
- 交付物有来源/证据链；综合者不能丢来源。

### 10.6 完成定义

任务 `done` 必须同时满足：

1. `contract_result = pass`；
2. 证据 `fresh`（无 stale/absent）；
3. 策略满足（R3/R4 已决）；
4. 合并/发布成功或任务无交付物；
5. 无未决的租约/预算/审计异常。

worker 自己说“完成”只产生 `agent_result`，不产生 `done`。

## 11. 控制面

### 11.1 桌面面

1. **Plan/Flow 视图**：目标/非目标、预算、风险、Flow 图、版本；批准/拒绝/编辑为新版本。
2. **任务 DAG/看板**：`queued / running / verifying / needs you / merging / done / failed`；按 plan/domain/状态过滤；整行可点。
3. **实时 trace**：plan → task → run → agent → tool；状态、tokens、成本、延迟、证据、策略决策。
4. **预算仪表**：计划/任务/provider；burn rate；预计超限；告警。
5. **干预**：暂停/恢复/取消/接管；kill switch；R3/R4 审批；合并/拒绝/回滚/重试。
6. **回放/审计**：从事件打开任意 plan/task；分叉做实验；导出审计。
7. **空/载/错/边界**：空计划、加载、失败、权限不足、离线、陈旧证据都要有明确形态（沿用 §9 状态矩阵）。

UI 纪律沿用既有裁决：中性用色、整行热区、持久偏好优先于内容自动显出、真指针命中测试；UI 只读投影，不做第二状态源。

### 11.2 API 与 IPC

- 内核提供 headless API（本地/远程同形）：`plan.submit/approve/pause/resume/cancel`、`task.retry/takeover`、`merge.request/rollback`、`view.get/subscribe`、`audit.export`。
- 桌面 IPC 升到 v21：新增编排通道；同步 `mustWire`、index wired、preload 构建、版本钉与测试。
- 旧通道不改语义；旧会话照常打开。
- 远程控制面走同一 API；鉴权/租户留 P6。

## 12. 评测

### 12.1 确定性模拟器

- 脚本化 agent/tool：给定事件与结果，验证调度、租约、预算、策略、重试、暂停/恢复、合并、回放。
- 不依赖 API key；可在 CI 跑。
- 覆盖反例：租约冲突、预算耗尽、依赖失败、stale 证据、策略拒绝、远程断线、重复提交。

### 12.2 场景套件

| 包 | 场景 | 验收 |
|---|---|---|
| coding | 多文件修改、测试修复、重构 | 测试/类型检查 + diff + 合并 |
| research | 多来源检索、引用、综合 | 来源可追溯、交叉验证 |
| ops | runbook、幂等动作、回滚 | 幂等键、补偿、审计 |
| data | schema/ETL/采样 | schema、行数、血缘 |

### 12.3 指标与对照

- 指标见 1.3。
- A/B：单 agent 基线 vs 编排；消融：无 verifier、无租约、无 planner、无动态派生。
- 失败分类：MAST 14 模式映射到 trace 标签；每周回归。
- 真模型读数只在有 key 时跑；没有 key 时明确写“仅模拟器/判卷”，不冒充真模型收益。

## 13. 兼容与迁移

1. **旧模式保留**：`read/write/pipeline/supervise`、sidechat、CLI、桌面会话不变；新内核通过适配器调用。
2. **旧日志**：新增字段全可选；旧 JSONL 逐字可回放；旧 fixture 不改。
3. **旧 IPC**：v20 通道不删不改语义；v21 只加编排通道。
4. **旧 worktree/合并**：继续使用；合并队列在其上加串行编排，不替换安全闸。
5. **功能开关**：`orchestrationKernel` 默认 off；按 workspace 开启；先 shadow（只生成计划/视图，不执行），再只读执行，再写执行，最后 auto。
6. **无数据迁移**：不批量改写旧日志；不从旧 Orchestrator 内存迁移状态；一切从事件重建。
7. **文档**：更新 AGENTS/STATE/PROGRESS/design spec；跑 docs-check；新证据与页同笔落库。

## 14. 交付顺序与验收

### 14.1 阶段

| 阶段 | 交付 | 关键验收 |
|---|---|---|
| **P0 基座** | 领域模型、事件可选字段、纯投影、投影索引/快照、调度骨架（不执行）、flow 解析骨架、判卷 | 旧日志回放逐字不变；新投影确定性；任务状态/租约/预算可重建；无新事件种类；typecheck/core 绿 |
| **P1 执行与策略** | 本地后端适配、能力编译、策略引擎、风险分级、预算、context packet、工件存储、只读 fan-out | R0–R2 自动、R3/R4 拦截；租约冲突拒绝；预算硬停；只读 8 并发；无写副作用 |
| **P2 验收与交付** | 契约执行、独立 verifier、证据四态、合并队列、回滚/修复任务 | stale 证据必须重验；冲突串行/修复；自动合并只在策略允许时；回滚可审计 |
| **P3 动态 Flow 与 100+** | DSL 解释器、动态 spawn、await/race/map、背压、远程 worker 协议 | 100+ 任务计划可排队/调度；远程断线可恢复；无重复副作用；回放一致 |
| **P4 控制面** | Plan/Flow 视图、DAG/看板、trace、预算、干预、回放、IPC v21 | 真机交互（命中测试+真指针）；暂停/恢复/接管；无 UI 猜状态 |
| **P5 评测与治理** | 模拟器、四域场景、A/B、MAST、安全审计 | 反例全绿；失败可归因；有真实读数才报收益 |
| **P6 开放面** | SDK/API、A2A 适配、领域包扩展 | 外部 agent 互操作；权限/审计不破 |

“内核+控制面全量”= P0–P4；P5 随 P1 起持续跑；P6 留门。

### 14.2 P0 的边界（第一份实现计划的范围）

P0 **不执行任何 agent、不改任何 UI 行为**，只交付：

1. `src/orchestration/` 领域模型与不变量校验。
2. 既有事件的可选字段扩展（类型 + 落流 + 旧日志兼容）。
3. `projectOrchestration(events)` 纯函数与 `OrchestrationView`。
4. 内存索引 + 快照（可重建）与重建测试。
5. `nextActions(view)` 纯调度骨架 + 确定性 tie-break + 租约/预算判定（不真正派发）。
6. Flow AST 解析/校验骨架（不执行动态节点）。
7. 判卷：旧日志逐字回放、字段缺席兼容、投影确定性、租约冲突、预算不足、依赖环、版本递增、快照损坏回退、无新事件种类。
8. 文档：本设计 + P0 实现计划；不改 AGENTS 现态，除非 P0 落地后另开一笔。

P0 的“完成”不是“能跑多 agent”，而是**上层可以安全地长在它上面**。

## 15. 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| 全自动 + 通用 + 100+ 的爆炸半径 | 误删、误发布、超预算 | 能力网关、沙箱、R3/R4 闸、预算硬停、kill switch、审计 |
| 桌面本机承载不了 100+ | 队列堆积/超时 | 本地 8–16 并发；P3 远程后端；明确“计划规模 ≠ 同时拨号” |
| 事件量爆炸 | JSONL 过大、启动慢 | 投影快照、归档、分片；P3 可插拔索引 |
| 双调度器 | 并发/租约冲突、状态分裂 | 旧 Orchestrator 只做单任务适配器；跨任务只由新内核调度 |
| 验证成本高 | 钱和延迟 | 机器验收优先；verifier 只做兜底；预算与抽样 |
| 通用抽象过度 | 什么都不好用 | 编码包先打读数；抽象不绑 git；领域包后置 |
| 计划/DSL 不可控 | 动态派生失控 | 任务/深度/并发/loop/预算硬上限；策略与无进展检测 |
| 远程 worker 安全 | 凭据/数据泄露 | 短期能力令牌、工件脱敏、网络白名单、沙箱 |
| 旧协议破坏 | 旧会话/旧日志不可用 | 可选字段、版本钉、旧 fixture、feature flag、shadow |

## 16. 明确延后（不作为 P0 阻塞）

1. 投影索引在超大规模下的后端选型（SQLite/列存）——P3 用读数决定。
2. Flow DSL 是否允许受限 TS——先 JSON AST；有真实表达力缺口再评估。
3. 远程 worker 传输（HTTPS+SSE / WebSocket）——P3 定。
4. R3 各领域的默认策略（通知 vs 审批）——P1 按 coding pack 先定，后续领域包覆盖。
5. 研究/运维/数据领域包——P6。
6. A2A/SDK/多租户——P6。
7. 自动合并的默认阈值——P2 用读数与回滚率决定，不先拍数字。

## 17. 审阅清单

请重点确认以下五点；确认后我再写 P0 实现计划（仍不写代码）：

1. **P0 只做基座**：领域模型、事件可选字段、纯投影、索引/快照、调度骨架、判卷；不执行 agent、不改 UI 行为。
2. **不新增事件种类**：Plan/Task/verifier/merge 全部走既有事件的可选字段与 `card_action`；旧日志逐字可回放。
3. **全自动边界**：R0–R2 沙箱内自动；R3 默认通知/按策略审批；R4 默认拒绝或强制人工；自动合并只在契约+证据+策略全满足时。
4. **Flow 先 JSON AST**：不执行任意代码；动态能力靠 `map/loop/branch` + 硬上限，不靠 eval。
5. **编码包先行**：Task/Contract/Capability/Artifact 不绑 git；远程后端 P3，100+ 指计划规模而非同时拨号。
