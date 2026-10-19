# M5 实施方案：把「结果信号」接回「策略层」

> 出具：2026-09-13。对表对象：上文讨论的 A（模型路由）/ B（编排）/ C（自我进化）三组提案。
> **v2 修订（2026-09-14，评审后）**：① 成本指标改「token 用量」代理口径（§1.3 备案 / §2.1 / §6.4）；② bandit 抽样补确定性口径——可播种 RNG，随机态显式管理（§3 步骤 9 / §5.12 / §6.3 新增第 8 条反向验证）；③ 补记 `SpawnArgs.model/tier` 与 `respawn` 重派面既有事实，恢复重派按 pin 处理（§3 步骤 8 / §7）；④ 测试基线更正为 57 files / 513 passed（I2 修正口径），并改为「以实施当日实测为准」；⑤ 全部行号锚点按当前工作区复核（forkSession 442→526 等）。
> **v3 修订（2026-09-14，评审 Follow-up 1）**：弃用全部裸行号，改为「断言标签 + 符号名」定位（§5.1 / §7）——行号易腐（agents-check N5 曾标 :892、实测 934；forkSession 曾 442→526），实施前仍以当日代码为准。
> 本文保留原始提案与决策约束；当前实施状态、验收证据和未达目标见 [`docs/m5-acceptance.md`](m5-acceptance.md)。
> **现状说明（2026-10-11）**：本文记录的是 2026-09-13 的提案状态；下文“现状/不存在/未接入”只描述当时，不代表当前代码。当前入口包括 M5a 的 `src/events/index.ts` / `scripts/gym-check.ts`、M5b 的 `src/routing/policy.ts` / `src/routing/bandit.ts` / `scripts/routing-check.ts`，以及 M5c 的 `scripts/supervisor-check.ts`。入口和门禁存在不等于 §1.3 的效果目标已达成，指标仍需基于基线实测。
> 复跑口径一律 `TERM=dumb`（`TERM=xterm-256color` 会让 vitest 输出 ANSI 序列，摘要正则假红）。
> 纪律沿用：判据冻结、三态（已证/未证/不做）、每道核心断言配一条反向验证、未在本文列的项不偷做。
>
> **读数归属提示**：本文标题里的「M5」指 2026-09-13 那份「结果信号回流」的 M5，与路线图
> `outputs/agent-capability-roadmap-2026-10-01/PLAN.md` 里 2026-10-01 的 M5/M6 **不是同一格**
> （后者 = 验证闭环加固 + 记忆跨会话学习，实现在 `src/agent/verify.ts` 与 `src/agent/memory/lessons.ts`，
> 判卷 `tests/verify-multiface.test.ts` / `tests/memory-lessons.test.ts`）。
> 那一组的口径面登记为 `replay:lessons-offline`（跑法 `node --import tsx scripts/replay/lessons-offline.ts`）
> 与 `replay:lessons-round-ab`（两轮 A/B 的可达面 + 不可达面的诚实声明）；
> 本仓另有 `replay:verify-cause-mix` 量 verify 红拍的归因构成；引用这一份时别把它们当同一个 M5。

---

## 0. 推荐路径（一句话）

**先造尺子，再改引擎。** M5a 建「反事实回放靶场 + 路由决策事件」作为可判定的地基，M5b 用靶场验收分层模型路由，M5c 才动编排自适应。顺序不可颠倒——没有靶场，路由和编排的"变好了"无法证伪。

| 期 | 内容 | 新增门 | 是否动既有断言 |
|---|---|---|---|
| M5a | 靶场骨架 + 回放跑器 + `routing_decision` 事件 | `gym-check` | 否（纯增量） |
| M5b | provider 档位表 + 路由策略 + bandit + 级联升级 | `routing-check` | 否 |
| M5c | 受限 Supervisor（闭合 gate loopback）+ Best-of-N | `supervisor-check` | **是**（stages 冻结语义，见 §5.1） |

---

## 1. 背景与目标

### 1.1 要解决的问题

提案撰写时（2026-09-13）的三条结构性事实（均已核实到当时的代码）：

1. **当时模型路由层尚未接入。** `src/providers/index.ts` 只有接口定义（`Provider.stream`），主会话硬编码 GLM（`src/main/agent-runner.ts:providerInfo` 读 `process.env.CAIRN_MODEL ?? "glm-5.2"`）。`OrchestratorOptions.modelFor`（`src/agent/orchestrator.ts` 的 `OrchestratorOptions.modelFor` 字段）只是一个可选回调，所有 worker 共用同一模型。四个适配器（openai/anthropic/gemini/glm）当时尚未接入运行时。
2. **编排天花板卡在人身上。** sequencer 零 LLM 是 M3 的正确收敛，代价是计划质量 = 人写 stages 那一刻。且 `docs/m3-acceptance.md` 九之 2 明确留位：gate 只落 verdict、不重跑——失败不触发任何系统级反应。
3. **结果信号不回流。** `verify_result`（客观判据）、`usage`（按 agent 归因）、`approval_resolved`、`card_action`、`diff_comment` 全部落流，但目前只用于投影面板和单次交互，没有一个字节回到策略层。

一句话：**执行 → 客观判据 → 结果信号 三段已通，信号不回流到策略层。**

### 1.2 为什么现在能做

四件资产已就位，组合起来是一个离线 RL 环境，而编程 agent 是极少数拥有**客观 verifier**（测试/ lint 过不过）的 agent 场景：

- append-only 事件流（`src/events/index.ts`，重放 + 逐行容错）
- `forkSession(sessionPath, eventId)`（`src/events/index.ts` 的 `forkSession` 导出）——已实现，可直接从历史会话任意事件点分叉重跑
- worktree 隔离 + 合并控制塔（M3b）
- `verify_result` + `.agent/config.json` verify 配置（`src/agent/verify.ts`）

### 1.3 预期效果（可量化，M5 结束时用靶场数字说话）

| 指标 | 基线 | 目标 | 判定方式 |
|---|---|---|---|
| 单位任务 token 用量 | M5a 步骤 5 快照 | 下降 ≥20%（明卷口径） | `gym-check` 基线对比 |
| 任务成功率 | 同上 | **不下降**（±2% 内） | 同上，降了即回退 |
| 编排失败自愈率 | 0（失败即终态） | ≥50% 的 review-fail 触发重试环 | `supervisor-check` 段 B |
| 路由可审计性 | 无 | 100% spawn 有 `routing_decision` | `routing-check` 段 A |

> **口径备案（v2）**：M5 不引入绝对价格表（§2.1），折算沿用 `budgetPricePerMTok` 单值——本表的「token 用量」指标度量的是**用量**，不是真钱成本。档位间**单价差**才是路由省钱的真实机制，要等 M6 价格表落地才可判；M5 验收表里不得把该数字表述为「成本下降 N 元」。

### 1.4 非目标（M5 不做，明确留位到 M6）

- B3 符号级冲突预测 / 自动并行分解（需 LSP 语义分析，风险高）
- B4 角色从轨迹涌现、C2 `strategy` 型记忆、C3 失败模式库、C4 人类反馈沉淀
- D1 审批最小化、D2 verify 证明产物
- 真多 provider 拨号（见 §4.3 权衡：M5 只做单 provider 多档位）
- 本地小模型推理（不引入 llama.cpp/onnx 等新依赖）

---

## 2. 前置：缺失项与默认假设

以下信息当前不足以确定，按默认假设继续；与你的预期不符请指出，我调整后重出。

| # | 缺失项 | 默认假设 | 影响 |
|---|---|---|---|
| 1 | 各 provider / 各档位的真实单价 | M5 不引入绝对价格表；路由用**相对档位**（cheap/standard/strong），折算沿用现有 `budgetPricePerMTok` 单值——故 M5 的「成本」实为 token 用量代理（§1.3 口径备案） | 若已有单价表数据源，bandit 的代价项可直接换成真钱，§1.3 指标同步升级为真钱口径 |
| 2 | 是否已有 CAIRN_API_KEY 可用环境 | **假定长期缺席**。所有学习类断言走明卷（scripted）驱动；真连段沿用 M3a 口径「缺席显式打印跳过」 | 有 key 时靶场可自动闭合 M3/M4 两个"未证"项 |
| 3 | 本地小模型可用性 | **假定无本地推理**。A3 机械卸载改用确定性算法 + 复用现有 `shape.ts`/`compaction.ts` 模板 | 若允许引依赖，可换真小模型，收益更大 |
| 4 | 是否接受新增 UI 面板 | M5 **不加任何新面板**，路由只在事件流与 check 脚本可见；设置页只加开关 | 需要可视化再单开一轮 |
| 5 | Best-of-N 默认 N | **默认 1（关闭）**，可配到 2，硬上限 3 | 成本敏感，见 §5.6 |
| 6 | 靶场 case 来源 | 初始手写 3 个 case（基于 `fixtures/todo-app` 变体），后续每次真实任务**可选**自动冻结 | 自动冻结涉及脱敏，M6 再做 |

---

## 3. 实现步骤

每步可独立合并，合并后 `pnpm gates` 必须仍全绿。步骤内「改动文件」为穷举，「要点」为实现约束。

### —— M5a：尺子与地基 ——

#### 步骤 1：新增 `routing_decision` 事件（A4）

**改动文件**：`src/events/index.ts`

- 新增接口（放在 `// ---- M3a 多 agent 编排 ----` 段之后，标注 `// ---- M5a 路由决策 ----`）：
  ```ts
  export interface RoutingDecisionEvent {
    type: "routing_decision";
    /** worker 归因（主会话路由缺省 = 主 loop）。 */
    agent_id?: string;
    /** 环角色（implement/review/test/自定义 plugin 角色名）。 */
    stage?: string;
    /** 候选档位（决策的可审计面：不是只记结果，要记"当时有哪些选择"）。 */
    candidates: { id: string; tier: string }[];
    picked: string;
    /** pinned（显式指定）/ tier-default（档位表）/ bandit（学习）/ cascade-upgrade（级联升级）/ fallback（降级）。 */
    reason: "pinned" | "tier-default" | "bandit" | "cascade-upgrade" | "fallback";
    /** 级联升级的来源档位（reason=cascade-upgrade 时必填）。 */
    from?: string;
    ts?: number;
  }
  ```
- **必须**同步三处，缺一不可：加入 `AgentEvent` 联合类型、`KNOWN_TYPES` 集合加 `"routing_decision"`（否则 `createEventLog.append` 抛「未知事件类型」）。
- 硬约束：**事件里绝不出现 key / 凭据**，只记 model id。项目有词边界密钥扫描（`\bsk-`）。

**验收**：`tests/routing-events.test.ts`（新）
- 新事件 roundtrip 无损
- `fixtures/agents/*.jsonl` 全部旧日志重放逐字不变（复用 `replay`）
- 未登记类型仍抛错（防 KNOWN_TYPES 误加导致的静默放行）

#### 步骤 2：靶场骨架（C1 基础设施）

**新建目录**：`fixtures/gym/`

```
fixtures/gym/
  index.json          # case 清单（纯数据）
  baseline.json       # 步骤 5 生成，基线快照
  cases/
    <case-id>/
      task.md         # 任务描述（喂给 agent）
      repo/           # 迷你靶子仓库（自带 .agent/config.json 的 verify 配置）
      expect.json     # 判据
      negative.json   # 反例控制（已知错误解法）
```

**`expect.json` 字段**：`{ mustPassVerify: true, mustChangeFiles: string[], mustNotChangeFiles: string[], maxTurns?: number }`

**`negative.json`**：一条已知的错误解法（例如只改测试不改源码）。**靶场必须判它失败**——这是"尺子本身有没有刻度"的唯一证明；缺了它靶场就是恒真判据，正是 `BLOCKED.md` 裁决记录里「**恒真式体检 3 命中修复**」那条批评过的东西（原文现按逐字节恢复放在 `outputs/blocked-ledger-recovered-2026-09-27/BLOCKED-ledger-1187.txt`）。

**冻结决策**：`fixtures/gym/cases/**` 与 `index.json` 登记进 `scripts/frozen-sha256.json`。理由：改 case = 改判据 = 作弊。代价：加 case 要走改冻结文件的流程（可接受，且是纪律）。

**验收**：`gym-check` 段 A
- A1 清单加载：每个 case 的 `task.md`/`expect.json`/`negative.json` 三件套齐备，缺一 fail-visible
- A2 **反例控制**：`negative.json` 必须被判失败（这条断言自己也要有反向验证，见 §6.3）
- A3 冻结 sha256 逐字一致

#### 步骤 3：反事实回放跑器

**新建**：`src/agent/gym/{case.ts,runner.ts,score.ts}` + `scripts/gym-run.ts`（CLI）

- `case.ts`：加载 + 校验 case（纯函数）
- `runner.ts`：`runCase(c, {model, forkFrom?})`
  - **模式① 从头跑**：`task.md` → 新会话 → 跑 loop → 跑 verify
  - **模式② 分叉重跑**：`forkSession(eventsPath, eventId)` 已在 `src/events/index.ts` 实现（`forkSession` 导出），直接复用；换成新策略后从分叉点续跑 —— 这就是"同一段历史，换个策略会怎样"的反事实评估
- `score.ts`：主指标 `verify 全绿 ? 1 : 0`；副指标 usage tokens / turn 数 / 改动文件数。纯函数。

**模型注入**：复用 `scriptedWorkerModel`（明卷，确定性）/ `defaultWorkerModel`（暗卷，需 key，缺席**显式打印跳过**，不静默通过）。

**临时目录纪律**：`mkdtemp(join(tmpdir(), "gym-"))` 之后**必须 realpath**——macOS `/tmp` 实为 `/private/tmp`，沙箱规则和路径比对都会静默失效（AGENTS.md 已记）。

**验收**：`gym-check` 段 B
- B1 确定性：同一 case 明卷跑两次，`score` 与 `usage` 逐字段一致
- B2 分叉：从 eventId=N 分叉后，新会话前 N 条事件与原会话逐字节一致，且原文件未被修改
- B3 暗卷缺席：无 `CAIRN_API_KEY` 时打印 skipped 并计数，**不计入 pass**

#### 步骤 4：接进门禁

**改动文件**：`package.json`（scripts）、`scripts/gate-manifest.ts`（GATES）、新建 `scripts/gym-check.ts`

- `package.json` 加：`"gym-check": "node --import tsx scripts/gym-check.ts"`
- `scripts/gate-manifest.ts` 的 `GATES` 数组加 `"gym-check"`。**不加会触发漂移护栏** `orphan-acceptance-script`（该 script 名匹配 `/-check$/`）
- `scripts/gym-check.ts` 体例仿 `scripts/agents-check.ts`：`pass`/`fail` 计数 + 段划分（A/B/C）+ 结尾打印汇总 + 非零退出码
- **注意 `scripts/assertion-health.ts` 会静态扫描这个新文件**：禁止 `|| true` 恒真式、禁止空断言 `check(x, true)`；析取式断言必须带 `// gates:disjunction-ok <理由>` 注释

**验收**：`TERM=dumb pnpm gates` → 门数 23 → 24，全绿，漂移校验 0 违规

#### 步骤 5：基线快照（M5a 的关键产出）

- 跑 `node --import tsx scripts/gym-run.ts --all --out fixtures/gym/baseline.json`
- `baseline.json` 记每个 case 的 score / tokens / turns + 汇总成功率
- **此后任何改动内核的 PR 必须对比基线**：成功率下降或成本上升超阈值 → 必须给出解释或回退

没有这一步，后面所有"改进"都是拍脑袋。

---

### —— M5b：模型路由 ——

#### 步骤 6：provider 档位表 + WorkerModel 适配

**新建**：`src/providers/registry.ts`　**改动**：`src/main/provider-keys.ts`

- `ModelSpec { id: string; provider: string; model: string; tier: "cheap"|"standard"|"strong"; ctxWindow: number }`
- **`PROVIDER_IDS = ["glm"]` 本期不改**（见 §4.3：M5 只做单 provider 多档位）。registry 预留 `provider` 字段，M6 再开白名单。
- 关键适配：`WorkerModel = (messages: GlmMessage[], tools: GlmToolSpec[]) => AsyncIterable<ModelOutput>`，而 `GlmMessage = ProviderMessage`（`src/providers/glm.ts` 的 `GlmMessage` 类型别名），`GlmToolSpec → ProviderToolSpec` 的映射照抄 `src/providers/glm.ts` 的 `unified` 映射段。
  ⇒ `toWorkerModel(spec: ModelSpec): WorkerModel` 是个十几行的薄适配器，**零侵入**。

**验收**：`tests/providers.test.ts` 扩
- 档位表 spec 解析往返；未知 id → fail-visible 报错不静默回落
- `toWorkerModel` 构造不拨号；无 key 时**调用**才失败（fail-closed）

#### 步骤 7：路由策略层（纯函数）

**新建**：`src/routing/policy.ts`

- `routeFor(input: RouteInput): RoutingDecision` —— **纯函数，无 IO，可单测**
- 输入特征：环角色、mode（read/write）、任务文本长度、预估上下文长度、显式 `args.model`（pin）
- 优先级：**pin > 档位表 > 降级链**
- V1 **只出静态档位表**，bandit 接口先留（步骤 9 启用）

**验收**：`tests/routing-policy.test.ts`
- pin 优先；无 pin 走档位；未知角色回落 standard；档位不可用（未配置）走下一档并把 `reason` 置 `"fallback"`

#### 步骤 8：接入编排器

**改动**：`src/agent/orchestrator.ts`

- 在 `spawn()` 内、模型实例化之前调用 `routeFor`，**先 `emit` `routing_decision` 再调用模型**（顺序不能反：崩溃后也能审计"当时选了谁"）
- `agent_spawned.model?: string`（`src/events/index.ts` 的 `AgentSpawnedEvent.model`，字段已存在）填选中的 model id
- 装配点即现有 `OrchestratorOptions.modelFor`（`src/agent/orchestrator.ts` 的 `OrchestratorOptions.modelFor` 字段）；缺省行为必须**逐字不变**（老路径无 `modelFor` 时仍走 `defaultWorkerModel`）
- **崩溃恢复重派（v2 补）**：`agent_result.artifacts.respawn` 已携带 `tier`/`model`（`src/events/index.ts` 的 `AgentResultEvent.artifacts.respawn`，M3c 崩溃恢复的数据源）。重派参数一律按 **pin** 处理（`reason: "pinned"`），不二次路由——「恢复 = 原决策续跑」；配一条断言：respawn 重派必须落 `routing_decision` 且 `picked === respawn.model`
- **参数面既有事实（v2 补）**：`SpawnArgs` 已有 `model`/`tier` 字段（`src/agent/orchestrator.ts` 的 `SpawnArgs` 接口，现为 `unknown` 透传）。`routeFor` 接入时对两者做收窄校验（非 string → fail-visible 拒绝），不新增字段、不改 raw 解析结构

**验收**：`routing-check` 段 A（新建 `scripts/routing-check.ts`，同样登记进 GATES）
- A1 每次 spawn 事件流恰有一条 `routing_decision`，`agent_id` 与 `agent_spawned` 匹配
- A2 pin 模型时 `reason === "pinned"` 且 `picked` 等于 pin 值
- A3 无 `modelFor` 的老路径：零 `routing_decision` 事件（零行为，不破坏既有门）

#### 步骤 9：bandit 在线学习（A1 核心）

**新建**：`src/routing/bandit.ts`（纯函数）+ 持久化到 `<appData>/routing-bandit.json`

- Thompson Sampling：`posterior = { alpha, beta }`；`selectArm(posts, rngState)` / `update(posts, arm, reward)`（纯函数；抽样随机态**显式传入、显式返回**，不碰 `Math.random()`——确定性口径见 §5.12）
- 臂 = 环角色 × 档位；`reward = verify 全绿 ? 1 : 0`，代价按 usage 折算进 beta
- **冷启动先验**：`alpha=beta=2`（不能从 1/1 起步，前几轮方差过大会乱选）；保留最小探索率下限防早熟收敛
- 持久化内容（v2 明确）：`{ seed, rngState, posteriors }`——seed 首次生成后不变，rngState 每轮推进，进程重启后轨迹连续；原子写 tmp + rename（照抄 `SettingsStore.persist`，`src/main/settings.ts`）

**改动 `src/main/settings.ts`**（三处 + 一个易漏点）：
1. `AppSettings` 加 `routingBandit: boolean`
2. `DEFAULT_SETTINGS` 加 `routingBandit: false`（**缺省零行为**）
3. `validateSettings` 加布尔校验 + 非布尔回退默认
4. **易漏**：`SettingsStore.set()` 内部有一个**手工字段白名单**（`"mode" in patch || ... || "telemetry" in patch` 的 `||` 链），新字段不加进去会被静默吞掉（patch 被 `{}` 替换）。必须把 `"routingBandit" in patch` 加进那个 `||` 链。

**验收**：`routing-check` 段 B
- B1 明卷：便宜档成功率 0.9 / 强档 0.95，200 轮后便宜档被选比例 > 0.8
- B2 **反向验证**：奖励取反 → **必须**收敛到强档（证明断言不是恒真）
- B3 开关关闭时零行为（无 bandit 文件写入、无决策差异）

#### 步骤 10：级联升级（A2）

**新建**：`src/routing/cascade.ts`

- `runCascade({ rungs, judge })`：便宜档先跑 → judge 判定 → 不过则升一级重跑，最多 `maxRungs`（默认 2）
- **judge 优先用客观判据**（verify 结果）；目标仓库无 verify 配置时 **fail-closed 不升级**（不猜、不空转放行，与 `src/agent/verify.ts` 的 fail-closed 纪律一致）
- 每次升级落一条 `routing_decision`（`reason: "cascade-upgrade"` + `from`）

**验收**：`routing-check` 段 C
- C1 便宜档必挂的剧本 → 恰好升级一次且最终成功
- C2 `maxRungs=1` → 断言不升级（防无限爬升）
- C3 无 verify 配置 → 断言不升级且落一条显式说明

---

### —— M5c：编排自适应 ——

#### 步骤 11：受限 Supervisor（B1，闭合 M3 gate loopback）

**新建**：`src/agent/supervisor.ts`

- 动作空间**封闭枚举**（这是保住可验证性的关键）：
  ```ts
  type SupervisorAction =
    | { kind: "spawn"; role: string; task: string }
    | { kind: "retry"; agent_id: string; feedback: string }
    | { kind: "accept" }
    | { kind: "escalate"; why: string }
    | { kind: "abort"; why: string };
  ```
- 决策输入：前环 `agent_result` + verdict（复用 `src/agent/sequencer.ts:parseVerdict`）+ 预算余量（复用 M3c `budgetBlocked`）+ 已用环数
- **有界性三重保险**：`maxStages`（默认 6）+ `maxBudgetUsd` + 同 `(role, task-hash)` 重复 ≥2 次强制 `escalate`（防死循环）
- V1 **纯规则实现，不调 LLM**。若后续引入 LLM，输出必须过 schema 校验 + 动作白名单，非法动作一律 `escalate`（fail-visible，不静默猜）
- 审批面改造：审批卡批准的从 stages 全表改为 `{ goal, budget, forbidden, maxStages }`。**这会碰 M3c 既有断言，见 §5.1——必须双轨**

**验收**：`supervisor-check` 段 A/B（新建脚本，登记进 GATES）
- A 封闭性：任意输入（含畸形 report）→ 输出必属枚举，非法输入 → `escalate`
- B 有界性：注入永远 fail 的环 → 第 6 环后必 `abort`，且事件流有对应 `escalate`/`abort` 记录
- B2 死循环：同 `(role, task-hash)` 第三次出现 → 强制 escalate

#### 步骤 12：Best-of-N 竞争编排（B2）

**改动**：`src/agent/orchestrator.ts`

- 新增 `spawnRace(task, n, judge)`；**N 硬上限 3**（`MAX_CONCURRENT_WORKERS = 4`，留 1 个给审查环），默认 1（关闭）
- 每个候选独立 worktree（复用 M3b `worktreePathFor`）
- judge 优先级：verify 全绿 > LLM judge > diff 规模最小
- **早停**：任一候选 verify 全绿即取消其余（复用 M3a 既有取消链，不新造机制）
- 成本闸复用 M3c `budgetBlocked`（`src/agent/orchestrator.ts`）

**验收**：`supervisor-check` 段 C/D
- C N=3 明卷（其中恰一个全绿）→ 断言选中项为全绿者
- D 早停后其余 worker 终态 `cancelled`，且 usage **严格小于**跑满的候选（断言早停真的省了钱）

#### 步骤 13：闭合 gate loopback + 更新对表

- 把 `docs/m3-acceptance.md` 九之 2「gate/loopback 重跑（M4 后再定）」从**留位**改为**已证**，证据指针指向 `supervisor-check` 段 B
- 更新 `AGENTS.md` 的「当前状态」段（新增 M5 三行 + 门数）
- 更新 `docs/m5-acceptance.md`（新建，三态对表）

---

## 4. 多路径权衡

### 4.1 靶场判据：冻结 vs 不冻结

| 方案 | 优点 | 缺点 |
|---|---|---|
| **冻结（推荐）** | 改 case = 改判据，与既有纪律一致，防自我美化 | 加 case 要走改 `frozen-sha256.json` 的流程 |
| 不冻结，只校验 | 迭代快 | 靶场会随策略改动漂移，基线对比失去意义 |

**选冻结。** 靶场的全部价值在于"尺子不动"，可变尺子等于没尺子。

### 4.2 路由学习：bandit vs 监督学习 vs 纯规则

| 方案 | 优点 | 缺点 |
|---|---|---|
| **bandit + 规则先验（推荐）** | 反馈信号免费（verify 已有）；无需训练管线；posterior 可解释可审计 | 冷启动需探索，初期可能选劣档 |
| 监督学习（从轨迹学） | 理论上界高 | 需特征工程与训练管线；样本量在单用户桌面端严重不足 |
| 纯规则表 | 确定、简单 | 不会随经验改进，等于没有"进化" |

**选 bandit。** 关键缓解：默认关闭 + 先验 α=β=2 + 最小探索率下限。

### 4.3 多 provider：真接多家 vs 单 provider 多档位 ★ 最重要的一条

| 方案 | 优点 | 缺点 |
|---|---|---|
| **单 provider 多档位（推荐）** | 零新依赖、零新 key 面、零新合规风险；`PROVIDER_IDS` 不用动；单价口径统一 | 收益上限受限于 GLM 自家档位 |
| 真接 openai/anthropic/gemini | 真正的模型路由，天花板高 | 需扩 `PROVIDER_IDS` 白名单、每家 key 的 BYOK 存储与注入（涉及 safeStorage，面更大）、各家 wire 差异与流式兼容都要验 |

**选单 provider 多档位。** 适配器已存在但从未接线，一次接四家的验证面太大；registry 的 `provider` 字段预留好，M6 开白名单时**零重构**。

### 4.4 Supervisor：LLM 驱动 vs 纯规则

| 方案 | 优点 | 缺点 |
|---|---|---|
| **纯规则 V1（推荐）** | 完全确定性、可断言、不新增模型调用（保住 M3「sequencer 零 LLM」的可验证性资产） | 自适应能力有限 |
| LLM 驱动 | 灵活 | 破坏确定性；需要 schema 约束 + 死循环防护；且无 key 环境下无法验收 |

**选纯规则 V1。** 若 M6 要上 LLM 版，动作空间枚举与有界性三重保险**原样保留**，只换决策函数实现。

---

## 5. 风险点与注意事项

### 5.1 ★ stages 冻结语义冲突（最高风险）

`docs/m3-acceptance.md` 三之 3 / `scripts/agents-check.ts` N5 断言（断言标签定位，行号按当日 grep）：「stages 在审批卡批准后冻结，sequencer 不可被模型改向」，且 N1c–N1d 断言「整链一个审批，审批卡展示 stages 全表」。

步骤 11 改审批语义会直接碰这些断言。

**处理**：**双轨，不动旧门**。
- 保留 `pipeline` 模式的既有冻结行为与全部断言（agents-check 不变红）
- Supervisor 只在新增的 `supervise` 模式生效（新增 mode，`AgentMode` 联合类型扩 `"supervise"`）
- M5c 验收时明确标注：这是**新增模式**，不是修改旧模式

### 5.2 事件类型增量兼容

`createEventLog.append` 对不在 `KNOWN_TYPES` 的类型直接抛错。新增事件必须同步三处（接口 / `AgentEvent` 联合 / `KNOWN_TYPES`）。同时 `agents-check` A 段对旧日志重放有逐字断言，任何事件 schema 的**必填字段**变更都会炸旧日志——新增字段一律可选。

### 5.3 settings 的 set() 手工白名单（静默陷阱）

`src/main/settings.ts` 的 `SettingsStore.set()` 里有一个手写的字段名 `||` 链（`"mode" in patch || ... || "telemetry" in patch`），新配置字段不加入则 `set()` 会把 patch 替换成 `{}`，**更新被静默吞掉，不报错**。这是本方案里最容易踩且最难查的坑。

### 5.4 assertion-health 静态扫描

`scripts/assertion-health.ts` 会扫描所有 check 脚本：禁 `|| true`、禁 `check(x, true)`、析取式需 `// gates:disjunction-ok <理由>`。新写的 `gym-check` / `routing-check` / `supervisor-check` 都在这个扫描面里。**特别注意 bandit 的收敛断言天然是概率性的**——必须写成"比例 > 阈值"的确定性判定（明卷下可复现），不能用"看起来收敛了"这种软断言。可复现的机制保障在步骤 9 + §5.12：可播种 RNG + 固定 seed，「同 seed 两次跑逐字段一致」本身就是一条独立断言（§6.3 第 8 条）。

### 5.5 bandit 冷启动与早熟收敛

- 前 N 轮会故意探索劣档 → 默认关闭 + 只在靶场/暗卷环境开启
- 先验 α=β=2（不是 1/1，避免首轮方差过大）
- 必须有最小探索率下限，否则一次好运就锁死在劣档

### 5.6 成本风险（Best-of-N / 级联）

- Best-of-N 是 N 倍成本；默认 N=1（关闭），硬上限 3
- 级联升级最多 2 级，且**必须有 verify 判据才升级**（无判据不猜，避免空转烧钱）
- 两者都受 M3c 现有 `maxBudgetUsd` 闸约束，不新造成本机制

### 5.7 沙箱与路径 realpath

macOS `/tmp` 实为 `/private/tmp`。靶场用 `mkdtemp(join(tmpdir(), ...))` 后**必须 realpath**，否则沙箱规则静默失效、路径比对假失败（AGENTS.md 已记此坑）。

### 5.8 凭据卫生

`routing_decision` 只记 model id，绝不记 key。词边界密钥扫描（`\bsk-`）覆盖新代码；新 check 脚本的输出也不能回显 key。

### 5.9 确定性与基线的口径分离

明卷（scripted）结果确定，暗卷（真模型）不确定。**靶场分数必须分两套基线**，不能混算，否则基线会被暗卷抖动污染，失去判别力。

### 5.10 小档位上下文窗口更小

换到便宜档可能上下文窗口更小 → 更早触发压缩。worker 压缩 ratio 现为 0.95（`WORKER_COMPACTION_CONFIG`），可能需要按档位单独配置。M5b 步骤 6 收集数据，若观察到压缩显著提前再单开一轮。

### 5.11 性能

- `gym-check` 进 `pnpm gates` 会增加全量门禁时长。控制初始 case 数 ≤3，且每个 case 的 verify 命令必须秒级（不跑重型 build）
- 若门禁时长不可接受，把 `gym-check` 移入 `EXEMPT_SCRIPTS` 并写明理由（每周手动跑），但这是下策

### 5.12 bandit 抽样的确定性口径（v2 新增）

Thompson Sampling 本身是随机的，而本项目明卷断言要求逐字段可复现——两者不对接，步骤 9 的验收必假红。裁决：**随机性必须显式管理，不许隐式**。

- `selectArm` 用接收显式 rngState 的纯函数 RNG（如 splitmix32/mulberry32），禁止直接 `Math.random()`
- seed 与 rngState 随 posteriors 一起持久化，进程重启后轨迹连续
- 明卷验收一律传固定 seed；「同 seed 两次跑逐字段一致」写成独立断言（§6.3 第 8 条），统计断言（比例 > 阈值）单独写并注明概率性质——两类断言不得混在一条里
- 不同 seed 只承诺统计性质，不承诺轨迹一致；对比基线时若 bandit 已开启，须固定 seed 重跑（§6.4）

---

## 6. 验证方式

### 6.1 第一层：门禁

```bash
TERM=dumb pnpm gates
```

- 门数：23 → 24（M5a）→ 25（M5b）→ 26（M5c）
- 全程零红 + 恒真式/析取式体检零命中 + **门清单漂移校验通过**（新增的 `*-check` 必须已登记进 `GATES`）
- 测试数只增不减（本文 v2 出具时 57 files / 513 passed / 0 skipped，I2 修正口径；**实施时以当日 `pnpm test` 实测为准**——v1 引用的 51/471 是 H1 轮前的滞后数字，勿再引用）

### 6.2 第二层：新增单测

| 文件 | 覆盖 |
|---|---|
| `tests/routing-events.test.ts` | 事件 roundtrip + 旧日志重放无损 |
| `tests/routing-policy.test.ts` | 路由优先级矩阵（pin/档位/降级） |
| `tests/gym.test.ts` | case 加载、评分纯函数、反例控制 |

vitest 配置 `tests/vitest.config.ts`：`include: ["tests/**/*.test.ts"]`、文件级并行（2026-10-18 起；共用靶子 `fixtures/todo-app` 的三支判卷改由 `tests/app-fixture-lock.ts` 跨 worker 互斥，整表实测 258.9s → 70.3s），新文件放 `tests/` 自动收纳。

### 6.3 第三层：反向验证（每条核心断言配一条"故意改坏必须变红"）

这是本项目最有价值的纪律，M5 必须沿用。至少覆盖：

| # | 故意改坏 | 预期变红的断言 |
|---|---|---|
| 1 | 把 `negative.json` 换成正确解法 | `gym-check` A2（反例控制）必须红 → 证明靶场有辨别力 |
| 2 | bandit 奖励取反 | `routing-check` B1 必须红 → 证明收敛断言非恒真 |
| 3 | `maxRungs` 改成 99 | `routing-check` C2 必须红 |
| 4 | 去掉 Supervisor 的 `maxStages` 闸 | `supervisor-check` B 必须红 |
| 5 | 早停逻辑短路（不取消其余 worker） | `supervisor-check` D 必须红 |
| 6 | `KNOWN_TYPES` 漏加新事件 | 步骤 1 单测必须红 |
| 7 | settings 白名单漏加 `routingBandit` | `routing-check` B3 或新单测必须红 |
| 8 | bandit 去掉 rngState 注入、改回 `Math.random()`（同 seed 两次跑轨迹不一致） | `routing-check` B1 确定性段必须红 → 证明随机性被显式管理（§5.12） |

### 6.4 靶场基线对比（M5b/M5c 每次改动都要做）

```bash
node --import tsx scripts/gym-run.ts --all --compare fixtures/gym/baseline.json
```

- 成功率下降 > 2% 或 token 用量上升 > 5% → 视为回退，需解释或回退改动（「成本」按 §1.3 口径备案 = 用量代理；bandit 已开启时，对比前先固定 seed 重跑，§5.12）
- 明卷与暗卷分开比对（§5.9）

### 6.5 三态口径

M5 对表里沿用：
- **已证** = 有可复跑断言
- **未证** = 断言没跑到（如无 `CAIRN_API_KEY` 的暗卷段）——**不等于通过**，必须显式打印 skipped
- **M6** = 明确留位不偷做（§1.4）

---

## 7. 附：本方案依赖的既有事实（v3 起用「断言标签 + 符号名」定位，弃用裸行号——行号易腐：agents-check N5 曾标 :892、实测 934，forkSession 曾 442→526；实施前以当日代码为准）

| 事实 | 位置（断言标签 / 符号名） |
|---|---|
| `modelFor` 挂载点 | `src/agent/orchestrator.ts`（`OrchestratorOptions.modelFor` 可选回调） |
| `WorkerModel` 签名 | `src/agent/orchestrator.ts`（`WorkerModel` 类型导出） |
| `GlmMessage = ProviderMessage`（类型别名） | `src/providers/glm.ts`（`GlmMessage` 类型别名） |
| `GlmToolSpec → ProviderToolSpec` 映射样板 | `src/providers/glm.ts`（`unified` 映射段） |
| `agent_spawned.model` 字段已存在 | `src/events/index.ts`（`AgentSpawnedEvent.model`） |
| `forkSession` 已实现 | `src/events/index.ts`（`forkSession` 导出） |
| 事件类型三处同步（接口 / `AgentEvent` 联合 / `KNOWN_TYPES` 集合） | `src/events/index.ts`（`AgentEvent` 联合 + `KNOWN_TYPES`） |
| `MAX_CONCURRENT_WORKERS = 4` | `src/agent/orchestrator.ts`（`MAX_CONCURRENT_WORKERS` 常量） |
| settings 的 set() 手工白名单 | `src/main/settings.ts`（`SettingsStore.set()` 字段白名单） |
| 原子写（tmp + rename）样板 | `src/main/settings.ts`（`SettingsStore.persist`） |
| 门清单（加门改这里） | `scripts/gate-manifest.ts`（`GATES` 数组） |
| 冻结判卷 sha256 | `scripts/frozen-sha256.json` |
| 断言体检规则（禁恒真/空断言） | `scripts/assertion-health.ts` |
| verify 配置与 fail-closed | `src/agent/verify.ts`（`runVerifyOutcome`） |
| M3 gate loopback 留位（本方案闭合） | `docs/m3-acceptance.md` 九之 2 |
| `agent_result.artifacts.respawn` 已携带 tier/model（M3c 重派数据源） | `src/events/index.ts`（`AgentResultEvent.artifacts.respawn`） |
| `SpawnArgs` 已有 model/tier 字段（unknown 透传，接入时收窄校验） | `src/agent/orchestrator.ts`（`SpawnArgs` 接口） |
| `providerInfo` 硬编码 GLM（主会话，M5 不动，留 M6） | `src/main/agent-runner.ts`（`providerInfo`） |
