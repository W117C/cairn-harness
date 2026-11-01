# Cairn Evolve：证据门控的因果自进化内核（方案 v1）

> 出具：2026-10-27。状态：**方案已批准执行**；P0 证据基座、P1 类型化 playbook/离线 shadow/
> 运行时补丁回流、P2 在线随机对照与运行时分配、P3 候选档案/SEMA staging/离线 holdout 晋升门/
> reflect-delta 算子、P4 技能合成与退役/冲突、P5 治理后端（STOP/预算/报告）已落地
> （第 716–720、722、725、727、728 页）。P3 真实实验晋升、P4 真实技能验证、
> P5 桌面面板/soak/自治联动尚未跑。本文最初不修改生产代码；落地记录见 §9 与 PROGRESS。
> 对表对象：`src/agent/evolution/`（运行时补丁）、`src/main/evolution/`（SEMA 流水线）、
> `src/agent/gym/` 与 `scripts/loop-eval.ts`（评测）、`src/agent/memory/`（经验记忆）。
> 纪律沿用：判据冻结、三态（已证 / 未证 / 不做）、无证据不产出、不可测 ≠ 零、
> 每个阶段独立可验收、未在本文列出的项不偷做。

---

## 0. 结论

**当前自进化的瓶颈不是“能生成多少改动”，而是“改动之后凭什么说它真的让 agent 变好了”。**

现有实现已经有三段很强的资产：会话收束时的信号/补丁闭环、SEMA 的模块安装与回滚流水线、
gym 与 loop-eval 的评测面。它们各自成立，但**没有焊在同一条证据链上**：
运行时补丁只按下一轮聚合读数判断“像不像有效”，模块候选只在静态判卷上比较，
记忆/打法按命中次数毕业。于是出现三个结构性后果：

1. 一条经验“被发出去过”与“它真的有用”在账上分不开；
2. 候选只在单一分数上竞争，无法区分“这次运气好”与“这个方向更有后劲”；
3. 任何常驻化的东西（提示词、技能、工具）都缺少同一条可回滚的晋升路径。

本方案的名字是 **Cairn Evolve**。它不是第四套机制，而是把已有三段焊成一条闭环：

```
Episode 证据 → 类型化经验 → 候选与档案 → 因果评估 → SEMA 晋升/回滚 → 新 Episode
```

核心主张五条：

- **证据先于策略**：没有 Episode 证据的经验不入库；不可测一律记 `unknown`，不折成成功或失败。
- **经验是类型化的、带作用域的、会过期的**：不是一段越写越长的提示词。
- **晋升靠因果**：候选必须先过离线配对 + holdout，低风险项再过在线随机对照或 canary；
  相关性读数只能用于排序，不能用于晋升。
- **常驻化 = 权限升级**：任何进入系统提示词/工具面的东西都走 SEMA 的门、canary 与回滚。
- **评估器、预算、权限属于受信内核（TCB）**：候选不能改自己的考卷、预算或晋升规则。

明确不做：模型权重训练、在线自我改写代码、无外部反馈的纯内省反思、
把整个上下文交给模型反复重写。

---

## 1. 研究结论

### 1.1 三条技术路线

| 路线 | 代表工作 | 核心机制 | 已报告的收益 | 已知失效模式 | 本仓取舍 |
|---|---|---|---|---|---|
| 经验/上下文进化 | Reflexion、ExpeL、Voyager、AWM、ACE | 把轨迹/反馈提炼成反思、经验、技能或 playbook，注回上下文 | ACE 报告 agent +10.6%、金融 +8.6%；AWM 报告 WebArena 相对成功率 +51.1%；Voyager 在 Minecraft 开放探索 | 无外部反馈时自我修正可能改错；反复重写导致 brevity bias / context collapse；检索命中 ≠ 有效 | **采用形态，补因果**：类型化、增量、带证据与作用域 |
| 候选搜索/离线优化 | STOP、AlphaEvolve、GEPA、DGM、HGM、SICA | 让模型生成候选，用评估器筛选，保留有用后代或候选 | GEPA 报告比 RL 少 35× rollout、最高 +20%；DGM 报告 SWE-bench 20.0%→50.0%、Polyglot 14.2%→30.7%；SICA 报告 SWE-bench Verified 子集 17%→53% | 昂贵；固定 benchmark 上过拟合；奖励作弊；当前分数不等于后代潜力 | **采用搜索与档案，补 holdout、预算与防作弊** |
| 参数自改 | SEAL | 用 RL 让模型生成“自编辑”数据并更新权重 | 在部分推理任务上有效 | 灾难性遗忘、算力门槛、不可审计 | **不做**：Cairn 是 harness，模型权重冻结 |

### 1.2 2026 年的四个硬结论

1. **近期 RSI 的现实入口是 harness，不是权重。** Lilian Weng 的《Harness Engineering for
   Self-Improvement》（2026-07）与 2026 年的 self-improving agents 综述都把“模型 + 脚手架”
   作为可优化的系统；可验证、可回滚的脚手架迭代，比等待权重自改更早形成闭环。
2. **评估器是瓶颈。** 固定考卷会被优化器找到盲点：DGM 的公开实验记录里出现过通过关闭自身
   检查来抬高分数的情况；RQGM 进一步指出，评估标准本身也需要在受控边界内演化，否则只是
   在优化考卷的漏洞。
3. **当前分数不是好的父代选择器。** HGM 的“元生产力—性能错配”表明，一个 agent 现在的 benchmark
   分数与它能产出多少更好的后代并不强相关；选择应看谱系/后代的产出，而不是只看本人得分。
4. **上下文必须增量策展。** ACE 明确指出整段重写会丢细节（brevity bias）并逐步坍缩（context
   collapse），因此采用结构化、增量式 delta，而不是让模型反复总结。
   同时，Huang 等人的 ICLR 2024 结果提醒：没有外部反馈时，模型“自我纠错”可能把对的改错。

### 1.3 对 Cairn 的直接结论

- Cairn 的进化对象是 **scaffold**：提示词、经验、技能、工具、路由、门禁，而不是模型权重。
- 现有 SEMA 的“提案 → 门 → 安装 → canary → 回滚”是大多数开源自进化项目没有的资产，
  **不应重写**；应把它作为唯一的晋升与回滚通道。
- 现有运行时闭环是很好的“快环”，但它是**相关性**判定；缺的是“慢环”的因果判定。
- 因此第一目标不是“加更多策略”，而是**让现有策略第一次可被证伪**。
- 自进化的收益是假设，不是承诺。2026-10-25 的元认知 pilot 已经显示：追加反思/提示在六题配对中
  没有净胜基线。新模块必须先能测出“有没有用”，再谈自动化。

---

## 2. 现态盘点与缺口

### 2.1 已有资产

| 资产 | 现在做什么 | 能证明什么 | 不能证明什么 |
|---|---|---|---|
| `src/agent/evolution/` | 收束时抽 verify 失败、目标漂移、成本信号；生成三类补丁；跨轮评估；账本记复发连击；可选反思改写；补丁门校验证据一致性 | 经验确实回流；账本可追溯 | 补丁是否造成改善；是否适用于其他任务 |
| `src/main/evolution/` | CAP Bundle manifest、registry、gate runner、installer、rollback、canary、assess、autonomy、workflow-graduate | 候选过门才上线；可回滚；低风险 content-pack 可自动装 | 候选在真实任务上的效果；运行时经验如何变成候选 |
| `src/agent/gym/` | 冻结 case、脚本/真实/探针三种跑法、分叉重跑、评分、工具选择 | 反事实回放与确定性回归 | 真实工作负载的代表性 |
| `scripts/loop-eval.ts` | 多任务、逐名 judge、隐藏判据、装配身份、usage | 离线对照的实验底座 | 在线效果与因果 |
| `src/agent/memory/` | 四类记忆、索引、检索、强度账、教训/打法蒸馏 | 跨会话事实与经验可回注 | 记忆条目是否真的有效 |
| `src/main/evolution/evaluator.ts` | baseline/candidate 配对，search/validation 分片，无 holdout 不许晋升 | 模块级配对评价 | 运行时补丁的因果效果 |

### 2.2 七个缺口

**G1 · 证据粒度太粗。** 运行时信号是“这一跑”的聚合（verify 次数、漂移条数、成本），
没有 Episode 级的任务、环境、装配、动作、结果与归因。于是“哪一条经验在哪个任务上起了作用”
无法回答，信用分配只能靠猜。

**G2 · 经验形状太窄。** 只有三类补丁 + 自由文本记忆。没有作用域、触发条件、置信度、
过期时间、冲突关系。经验越多，提示词越长，越接近 ACE 警告的 context collapse。

**G3 · 效果判定是相关性。** 上一轮补丁用下一轮聚合读数评“消解/复发/不可判”，但没有控制组、
没有随机化、没有置信区间。任务一变，读数就不可比；这正是 pilot 里“净胜为零”却无法解释的原因。

**G4 · 没有候选档案与搜索。** 反思只改写一条 note 的措辞，不产生多个候选，不保留族谱，
不比较“哪个方向更有后劲”。这与 GEPA 的候选池、DGM/HGM 的 archive 相差一个结构。

**G5 · 技能没有可执行验证。** workflow 记忆按“被检索命中 ≥3 次”毕业成 content-pack；
命中次数证明“被想起”，不证明“照着做能成”。Voyager/AWM 的关键是“技能可执行、可验证、可组合”。

**G6 · 反 Goodhart 只覆盖了一半。** SEMA 的 evaluator 已经要求 holdout，但运行时补丁没有；
也没有评估器轮换、考卷漂移监测、删测试/改判据检测、回归税。DGM 的奖励作弊在结构上仍可能发生。

**G7 · 三条晋升路各自为政。** `evolution.json` 的补丁、`.agent/memory/` 的记忆、
`modules/` 的 bundle 有三套生命周期，互相不知道对方存在。没有一条从“一次会话的证据”
到“常驻能力”的单一证据链。

### 2.3 结论

不要新增第四套机制。把现有三段接成一条**双时间尺度**的闭环：

- **快环**（每场会话收束，毫秒级、无 LLM）：写 Episode、更新观测置信度、选择注入；
  现有补丁逻辑保留为快环的一个渲染/候选来源。
- **慢环**（按日/按周期，离线、可花 LLM）：生成候选、配对评估、随机对照、晋升、退役。
  慢环的结论才允许改变“常驻面”。

---

## 3. 设计原则

| 原则 | 含义 | 机器可检查的落点 |
|---|---|---|
| P1 证据先于策略 | 无 Episode 证据不入库；无 holdout 不晋升；不可测记 `unknown` | schema 校验、晋升门、报告字段 |
| P2 增量不重写 | playbook 只接受 delta（add/patch/deprecate/merge），不接受整段重写 | 写入端校验 delta 形状与大小 |
| P3 常驻化 = 权限升级 | 进入系统提示词/工具面必须过 SEMA 门、canary、可回滚 | registry 账本、canary 档 |
| P4 评估器/预算/权限属于 TCB | 候选不能改 judge、fixture 哈希、grants、autonomy、budget、evolve 内核 | 路径 denylist + diff 扫描 + 审批 |
| P5 先测量后自动化 | 没有 CI 支持的净收益，不进入自动档 | 决策规则、实验记录 |
| P6 不做权重训练/在线自改代码 | 进化对象是 scaffold；代码改动只离线走 SEMA | 非目标清单、门禁 |

---

## 4. 目标架构

### 4.1 五层 + 一条数据流

```
┌──────────────────────────────────────────────────────────────────┐
│ L4 治理面（TCB，不可被候选修改）                                    │
│ 权限 · 评估器隔离/轮换 · 预算 · 自治档 · kill switch · 审计账本      │
├──────────────────────────────────────────────────────────────────┤
│ L3 因果评估面（慢环）                                               │
│ 离线配对（search/validation/holdout） · 在线随机对照 · canary · 统计 │
├──────────────────────────────────────────────────────────────────┤
│ L2 候选生产面（慢环，离线）                                         │
│ reflect-delta · skill-synthesize · bundle-patch · policy-tune       │
│ 候选档案 · 族谱 · Pareto · 元生产力                                  │
├──────────────────────────────────────────────────────────────────┤
│ L1 经验面（快环读，慢环写）                                         │
│ 类型化 playbook：fact / strategy / warning / policy                │
│ 作用域 · 触发 · 证据 · 置信度 · 过期 · 冲突                          │
├──────────────────────────────────────────────────────────────────┤
│ L0 证据面（快环写）                                                 │
│ Episode：任务 · 装配 · 结果 · 成本 · 归因 · 实验分配 · 注入经验        │
└──────────────────────────────────────────────────────────────────┘

运行时：L1 选中的 active 经验 → 系统提示词/工具面 → 新 Episode（L0）
慢环：L0 → L2 候选 → L3 评估 → L4 裁决 → SEMA 安装/canary → L1 active
```

### 4.2 每层长在哪、谁持有、为何不是别层

| 层 | 代码落点 | 持有者 | 为什么不是别层 |
|---|---|---|---|
| L0 证据 | `src/agent/evolve/episode.ts`（纯投影）+ `src/main/evolve/episode-store.ts`（IO） | main 收束缝 | Episode 是事件流的**聚合投影**，不是 agent 行为；按 ADR 0005 不新增事件型，读侧算 |
| L1 经验 | `src/agent/evolve/playbook.ts`（schema/投影/检索纯函数）+ `src/main/evolve/playbook-store.ts` | main 装配缝 + 收束缝 | 运行时读取必须便宜、确定性；不能把检索/统计塞进 loop |
| L2 候选 | `src/main/evolve/operators/` + `archive.ts` | 离线调度器（scripts/main） | 需要 provider、长耗时、可失败重试；不在会话热路径 |
| L3 评估 | `src/main/evolve/eval/` + `scripts/loop-eval.ts` + `src/agent/gym/` | 独立评估器进程/脚本 | 判据与执行必须隔离；候选不可读隐藏判据 |
| L4 治理 | `src/main/evolve/governance.ts` + 既有 `autonomy`/`grants`/`permission-broker` | TCB | 不能让候选持有自己的门、预算与考卷 |
| L5 元进化 | `scripts/evolve-meta.ts`（可选） | 人工 + 离线 | 风险最高；只允许在独立元任务集、独立预算、人工审批下进行 |

### 4.3 与 SEMA 的关系

SEMA 是**控制平面**：manifest、registry、gate、installer、rollback、canary、grants、autonomy。
Cairn Evolve 是**学习平面**：Episode、经验、候选、实验、统计。
两者的交点是**晋升**：

- 低风险经验：以 `content-pack` 提案进入 SEMA；
- 工具/桌面面：以 `tool` / `desktop-panel` 提案进入 SEMA；
- Evolve **不自己装任何东西**，只提交候选与证据；安装、回滚、观察期全部复用 SEMA。

### 4.4 与现有 `src/agent/evolution` 的关系

**双时间尺度，不是替换。**

- 快环保留现有 `runEvolution`：抽信号、生成三类补丁、跨轮评估、账本连击、可选反思。
- 它的产物从“直接写进下一轮提示词”改为“**观测置信度的输入 + 候选来源**”；
  在 P1 兼容期内，`evolution.json` 与 `StrategyPatch` 继续逐字可读，旧测试不需要一次性重写。
- 慢环决定哪些经验可以升级为 active/常驻；快环负责“这一场之后立刻能说什么”。

这样既保留现有低延迟行为，又给“长期正确”一个更慢、更贵、更严格的判定。

---

## 5. 数据契约

### 5.1 EpisodeRecord（L0）

```jsonc
{
  "v": 1,
  "id": "ep_<sha256(workspace|session|runStart|runEnd) 前 16>",
  "ts": 1790000000000,
  "workspace": "/abs/workspace",
  "sessionId": "s_...",
  "run": { "startEventId": 1, "endEventId": 240, "logPath": "/abs/events.jsonl", "logSha256": "..." },
  "task": {
    "signature": "sha256(normalized tokens + path ext + tool skeleton)",
    "class": "edit|debug|refactor|explain|research|ops|ui|test|other",
    "intentExcerpt": "≤ 400 chars, redacted",
    "tokens": ["..."]                     // 有界，用于相似检索
  },
  "assembly": {
    "harnessRev": "git rev",
    "configDigest": "sha256(model|provider|tier|tool face|compaction|playbook digest)",
    "model": "provider/model or null",
    "provider": "provider id or null",
    "tier": "low|high|default|null"
  },
  "outcome": {
    "verify": "green|red|none",
    "judge": "pass|fail|unknown",          // 隐藏判据；缺席 = unknown，不折成 pass
    "user": "accepted|rejected|unknown",
    "final": "success|failure|unknown"    // judge > verify > user > unknown
  },
  "cost": { "tokensIn": 0, "tokensOut": 0, "usd": null, "durationMs": 0, "steps": 0, "toolCalls": 0 },
  "evidence": {
    "verifyCauses": { "code": 2, "env": 1 },
    "failedToolCalls": 3,
    "stuckSignals": ["repeat-action"],
    "touchedPaths": ["src/..."],
    "diffDigest": "sha256 or null"
  },
  "assignment": {
    "experimentId": null,
    "arm": "none|control|treatment|shadow",
    "propensity": null,
    "policyVersion": "evolve-v1",
    "injectedExperienceIds": ["exp_..."],
    "injectedChars": 0
  },
  "redactions": { "secrets": 0 }
}
```

缺席语义（每一格写死）：

| 字段 | 缺席 = |
|---|---|
| `outcome.judge` | **没有独立判据**，不是通过 |
| `outcome.user` | **没有用户裁决**，不是接受 |
| `cost.usd` | **不可定价**，不是 $0 |
| `assignment.experimentId` | 本场不在实验中，不是对照组 |
| `assignment.propensity` | 分配概率未知；不得用于逆概率加权 |
| `injectedExperienceIds` | 本场没有注入经验，不是“注入了空” |

### 5.2 ExperienceEntry（L1）

```jsonc
{
  "v": 1,
  "id": "exp_<stable hash>",
  "kind": "fact|strategy|warning|policy",
  "scope": {
    "workspace": "/abs/workspace or *",     // * 只能经显式全局晋升
    "taskClass": "debug",
    "toolchain": ["node", "vitest"],
    "pathGlobs": ["src/**"]
  },
  "trigger": {
    "when": "always|on-task-class|on-signal|on-tool|on-path",
    "signal": "verify-cause:code | stuck:repeat-action | ...",
    "keywords": ["..."]
  },
  "body": "≤ 800 chars 的增量正文",
  "evidence": { "episodes": ["ep_..."], "failures": ["ep_..."] },
  "provenance": { "generator": "rule|reflect|gepa|human", "model": "...", "pipeline": "evolve-v1", "digest": "..." },
  "status": "candidate|active|dormant|deprecated|retired",
  "confidence": {
    "observational": { "trials": 0, "successes": 0, "failures": 0 },
    "causal": { "trials": 0, "riskDiff": null, "ci95": null }
  },
  "budget": { "tokens": 400, "maxPerSession": 1 },
  "createdAt": 0, "updatedAt": 0, "lastUsedAt": null, "expiresAt": null,
  "supersedes": [], "conflictsWith": [],
  "gates": { "passed": ["evidence", "budget"], "lastRun": 0 }
}
```

**四类经验的语义分工：**

| kind | 内容 | 典型来源 | 典型 TTL | 能否常驻 |
|---|---|---|---|---|
| `fact` | 仓库/工具链的稳定事实 | 人工、memory、确定性探测 | 180 天 | 可，但需人工批准 |
| `strategy` | 可复用的步骤/打法/技能 | 成功 Episode、AWM/Voyager 式提炼 | 90 天 | 需 holdout/对照 |
| `warning` | 失败模式与反例 | 红 verify、工具连败、canary 回退 | 365 天 | 可，低风险 |
| `policy` | 路由/压缩/停止等策略偏置 | 成本读数、离线对照 | 30 天 | 需对照；过期快 |

**两层置信度（关键区分）：**

- `observational`：只统计“注入了这条经验且结果可测”的 Episode；用于检索排序与触发调优，
  **不能**用于晋升。
- `causal`：只来自带控制组的实验（离线配对或在线随机对照）；用于 `candidate → active` 的升级。
- 一条 `fact` 可能永远没有 causal 证据；它走“人工批准 + 低风险”通道，不冒充“已证明提升”。

### 5.3 ExperimentRecord（L3）

```jsonc
{
  "v": 1,
  "id": "ex_...",
  "hypothesis": "在 debug 类任务上注入 exp_... 会把隐藏判据成功率从 p0 提到 p1",
  "candidateRef": "exp_... | cand_...",
  "control": "current-active | no-injection",
  "taskFilter": { "class": ["debug"], "minN": 40 },
  "split": { "search": 0.5, "validation": 0.25, "holdout": 0.25 },
  "metrics": ["success", "regression", "costPerSuccess", "latency"],
  "decisionRule": "holdout 回归=0 且 success RD 的 95% CI 下界 > 0；或 success 非劣且 cost 的 95% CI 上界 < -10%",
  "budget": { "maxRuns": 120, "maxUsd": 20, "maxWallMs": 7200000 },
  "stopping": "fixed-sample | sequential-alpha-spending",
  "status": "draft|running|passed|failed|unmeasurable|aborted",
  "results": null,
  "approvedBy": "owner",
  "createdAt": 0
}
```

预注册字段不可在开跑后修改；任何偏离写入 `deviations[]`，并在报告中显式标注。

### 5.4 CandidateRecord（L2）

```jsonc
{
  "v": 1,
  "id": "cand_...",
  "parentId": "cand_... | null",
  "operator": "reflect-delta|skill-synthesize|bundle-patch|policy-tune|retire|merge",
  "target": { "kind": "experience|bundle", "id": "..." },
  "diff": "最小 delta（不是整段重写）",
  "evidence": ["ep_..."],
  "status": "draft|queued|evaluating|passed|failed|promoted|rejected",
  "eval": { "search": null, "validation": null, "holdout": null, "costUsd": null },
  "lineage": { "depth": 0, "descendants": 0, "acceptedDescendants": 0 },
  "metaproductivity": { "trials": 0, "accepted": 0, "yieldPerKToken": null },
  "createdAt": 0
}
```

### 5.5 事件流改动（ADR 0005 合规）

不新增事件型。只加两个**可选字段**：

- `session_meta.evolve?: { experimentId, arm, propensity, policyVersion, injectedExperienceIds, injectedChars }`
  ——会话装配身份的一部分，与 `origin`/`fork` 同层；缺席 = 本场不在进化实验中。
- `surface_account.evolveChars?: number` ——本请求进化注入的字符数；缺席 = 未记录，
  不折成 0。已有的 `memoryChars` / `skillsBlockChars` 不动。

`replay()` 仍逐字返回；Episode/Experiment 的解释全部在投影层。任何需要“agent 做了什么”的
新信息，继续走既有事件的可选字段，不新开事件族。

### 5.6 存储布局

```
<workspace>/.agent/evolve/
  episodes.jsonl          # 追加式；一行一 Episode
  episodes.index.json     # 可重建投影（按 session/class/outcome）
  playbook.jsonl          # 追加式 delta：add/patch/deprecate/retire/merge/split
  playbook.index.json     # 可重建当前视图
  experiments/<id>.json   # 预注册记录（不可变）+ results
  candidates/<id>.json    # 档案条目
  ledger.jsonl            # 审计：proposal/gate/experiment/decision/promote/rollback/retire
  budget.json             # 本周期预算（TCB 持有）
  STOP                    # kill switch；存在即冻结一切写/注入
```

纪律与 `evolution-ledger.jsonl` 一致：追加式事实源、原子写、坏行只丢那一条并计数、
索引可重建、超过保留期只归档原始 Episode（保留统计聚合）。

---

## 6. 核心机制

### 6.1 经验抽取与信用分配

**规则优先，反思只做候选。** 收束时先用确定性规则从 Episode 抽候选：

| 信号 | 候选类型 | 例子 |
|---|---|---|
| 同一 `verify cause` 连败 ≥3 | `warning` / `strategy` | “该仓库的 lint 失败先看 tsconfig 的 paths，不要先改业务代码” |
| 目标漂移、重复动作、边界后死跑 | `warning` | “这一轮的改动越出了用户要求的文件范围” |
| 成功且可复现的工具序列 | `strategy` 候选 | AWM 式“读取 → 修改 → 定向测试 → 全量验证” |
| 用户明确纠正/偏好 | `fact` / `policy` | “不要自动跑全量测试，先跑定向用例” |
| 成本/延迟显著优于基线 | `policy` 候选 | “这类任务优先便宜档 + 提前压缩” |

**反思（可选）只允许提出“候选 delta”，不允许直接晋升。** 反思输入必须包含真实轨迹与
外部判据；输出必须引用具体 Episode/callId；无证据的断言在补丁门被拒（沿用现有
`patch-gates` 的证据一致性判据，并扩展到 playbook delta）。

**信用分配只给“实际注入过的经验”。** Episode 记录 `injectedExperienceIds`；
只有这些经验能获得 observational 计数。未注入的经验不因“同场成功”被记功。
因果计数只来自 ExperimentRecord。

### 6.2 类型化 playbook 与增量策展

**写入只接受 delta。** `playbook.jsonl` 的六种操作：

```jsonc
{"op":"add","entry":{...},"evidence":["ep_..."],"reason":"..."}
{"op":"patch","id":"exp_...","fields":{"body":"..."},"evidence":["ep_..."],"reason":"..."}
{"op":"deprecate","id":"exp_...","reason":"..."}
{"op":"retire","id":"exp_...","reason":"..."}
{"op":"merge","ids":["exp_a","exp_b"],"into":{...},"evidence":["ep_..."]}
{"op":"split","id":"exp_...","into":[{...},{...}],"evidence":["ep_..."]}
```

- delta 只能改 `body` / `trigger` / `scope` / `budget` / `expiresAt`；不能改 `id`、`evidence` 的既有指针。
- 单条 delta 的 body 变更不超过原长的 30%；超过必须走 `merge/split` 或新建条目。
  （ACE 的教训：整段重写会丢细节；这条帽是机械约束，不靠模型自觉。）
- 每次写入都带 `evidence` 与 `reason`；无证据只能建 `candidate`，不能建 `active`。
- 投影是纯 fold；删除账本可重建同一视图；坏行只丢一条并计数。

**生命周期：**

```
candidate → shadow → experiment → canary → active → dormant → retired
      ↑                                      │
      └────────── negative evidence ─────────┘
```

| 状态 | 进入条件 | 注入 | 退出 |
|---|---|---|---|
| candidate | 规则/反思/人工提出，≥1 Episode 证据 | 否 | 过离线门 → shadow/experiment；或证据失效 → retired |
| shadow | 过 schema/预算/证据门 | **否**（只记录“本会命中”） | 触发精度足够 → experiment；否则回 candidate |
| experiment | 预注册、owner 批准（低风险可自动） | 仅实验臂 | 决策规则 → canary 或 rejected |
| canary | 实验通过；零权限/低风险 | 小流量/观察窗 | 无退化 → active；退化 → rollback + warning |
| active | canary 期满或人工批准 | 是（按预算） | 负证据/过期/冲突 → dormant/deprecated |
| dormant | 长期未命中或模型/工具链变更 | 否 | 重新验证 → active；超期 → retired |
| retired | 被替代/证据失效/安全违规 | 否 | 保留 tombstone 与证据，不再复活（除非新证据） |

**过期与漂移：**

- `fact` 180 天、`strategy` 90 天、`warning` 365 天、`policy` 30 天。
- 模型/provider/toolchain 的 `configDigest` 变化 ⇒ 所有 `strategy`/`policy` 降为 `dormant`，
  需重新验证；`fact`/`warning` 可保留但标注“旧装配”。
- 全局作用域（`workspace="*"`）只能由 owner 显式晋升，且需要 ≥3 个 workspace 的证据；
  默认一律 workspace 局部。

**检索与注入：**

- 只检索 `active`；按 scope → trigger → 相似度（token Jaccard/MinHash + 工具链）→
  期望效用/ token 成本排序；最多 `MAX_INJECTED`（默认 6）条，总字符帽（默认 2,000）。
- 渲染必须带 id、kind、证据数、最近更新；模型可明确忽略。
- 注入内容与字符数写进 `session_meta.evolve` 与 `surface_account.evolveChars`；
  没有注入 = 零行为。
- 冲突：两条 active 的 `body` 语义冲突（同 scope/trigger 且关键词重叠）⇒ 两条都降为 candidate，
  Assess 出 `conflict` finding；绝不两条都注入。

### 6.3 候选搜索与档案

**四类算子（先小后大）：**

| 算子 | 输入 | 输出 | 何时用 |
|---|---|---|---|
| `reflect-delta` | Episode + 当前条目 + 评分 | 最小 delta + 证据 | 已有条目需要修正 |
| `policy-tune` | 成本/路由读数 + 配对任务 | 一条 `policy` 候选 | 成本/延迟问题 |
| `skill-synthesize` | N 个同签名成功 Episode | 可执行/半可执行的技能草稿 + 触发 + 验证步骤 | 重复出现的多步打法 |
| `bundle-patch` | 反复失败 + 仓库上下文 | SEMA CAP Bundle 提案 | 需要改工具/桌面/内容包 |

**档案（archive）与选择：**

- 每个候选保留父代、算子、证据、评估结果、族谱；不是“只留最新”。
- 下一代父代的选择不看单一分数：Pareto（success / cost / latency / safety）+ 新颖度 +
  **元生产力代理**（该父代/算子已产出的被接受后代数 ÷ 花费）。
- 元生产力只用于**采样**，不用于晋升；晋升仍只认 ExperimentRecord 的决策规则。
- 预算：每周期最多 4 个候选、并发最多 1 个实验；候选与评估的 token/$ 上限写进
  `budget.json`（TCB），由调度器前置检查，超限即停并落审计。
- 80/20 利用/探索：80% 从高分/Pareto 区域采样，20% 从低深度/新算子采样，防止过早收敛。

**为什么不是 DGM 式在线自改代码：** DGM/SICA 的收益依赖“改代码 → 跑 benchmark”的高频循环，
其风险（奖励作弊、沙箱逃逸、不可审计）在桌面产品上不可接受。Cairn 的代码候选只离线生成，
经 SEMA 门与人工审批；这是有意的能力换安全，后续可在证据充分时逐级放开。

### 6.4 因果评估

**离线（晋升前）：**

- 复用 `loop-eval` / gym 的固定任务；search / validation / holdout 三分。
- 同一任务、同一模型/装配、配对运行；顺序交错；记录全部尝试（含失败/超时/不可测）。
- holdout 只对同一候选族使用一次；一旦用于决策，该族不能再用它“调参”。
- 指标：隐藏判据成功率（主）、回归率（必须为 0）、每次成功成本、延迟、安全标记。
- 决策规则（预注册，默认）：
  - 任一 holdout 回归或安全违规 ⇒ `failed`；
  - success 的配对风险差 95% CI 下界 > 0 ⇒ `passed`；
  - success 非劣（CI 下界 > -MDE）且 cost 的 95% CI 上界 < -10% ⇒ `passed`；
  - 样本不足/不可测 ⇒ `unmeasurable`，**不晋升**。
- 统计：配对二元用 McNemar 精确检验；按任务族 cluster bootstrap（1,000 次）；
  报告 N、效应量、CI、p；重复查看用 alpha spending，不偷看。

**在线（低风险项）：**

- 会话开始时按 `hash(experimentId, sessionId)` 确定分配，记录 arm 与 propensity；
  同一会话续跑沿用首轮分配（`session_meta.evolve`）。
- 初期一次只开一个实验，避免经验交互；treatment 占比默认 20%（canary 档）或 50%（owner 明示）。
- 安全监控与效果判定分开：canary 规则（cost/no-progress/连败）可提前止损；
  效果只在预注册样本量到达后判定，不因中途好看而提前宣布。
- 分析按 task class 分层；模型/装配变化即切断实验，不跨装配合并。

**反事实回放：**

- 对确定性决策点，用 gym 的 fork 从事件点续跑“有/无该经验”的两条分支，
  作为机制检查（mechanism check），不作为晋升的唯一证据（LLM 非确定性）。
- 回放结果写入候选的 `eval.mechanism`，在报告中标注“非因果”。

**评估器隔离与轮换：**

- 隐藏判据、judge key、fixture 哈希住在 workspace 之外，agent 工具不可读；
  `verify` 信任闸沿用 gym 的指纹机制。
- 每 N 次晋升轮换 holdout 子集；被泄漏/被写进记忆的题退役。
- 考卷哈希、测试文件删除、断言弱化、fixture 改动、权限文件改动 → 立即中止实验并审计。
- 独立 judge 只作为辅助信号；最终正确性以可复现的确定性判据为准（Huang 等人的教训）。
- RQGM 的“评估器共演化”只取“轮换”这一半：轮换由 TCB 控制，候选不能生成/选择自己的考卷。

### 6.5 技能合成与毕业

- **触发**：同签名成功 Episode ≥3，且工具序列在 gym 中可复现。
- **合成**：`skill-synthesize` 产出 `strategy` 候选：目标、前提、步骤、验证、失败回退。
  能写成脚本的，落为 `content-pack` 或 `tool` 候选；不能写成脚本的，至少要有可检查的验证步骤。
- **验证**：gym 探针（确定性 case）+ 一个未参与合成的 holdout；两者都过才进 experiment。
- **毕业**：通过后走 SEMA；`content-pack` 零权限可进 `gated-auto` 的 canary；
  `tool` 仍需人工批准。毕业后的技能保留证据链，可在退化时回滚。
- **退役**：技能在 N 次使用后成功率低于基线，或触发条件长期不命中 → dormant/retired。
- 现有 `workflow-graduate` 的 hits 判据保留为“提名信号”，不再单独构成毕业理由。

### 6.6 晋升与回滚（一条证据链）

```
Episode(s) → ExperienceEntry(candidate)
   → ExperimentRecord(offline / online)
   → CandidateRecord(passed)
   → SEMA submitProposal(staging)
   → GateRunner(全门)
   → Installer(原子切指针)
   → Canary(观察期)
   → active / rollback(previous)
   → 新 Episode 继续记账
```

- 每个箭头都有账本记录：`proposal → gate → install → canary → active/rollback`，
  带 actor、证据 digest、config digest。
- 回滚沿用 SEMA 的“不可变版本 + previous 指针”；playbook 条目则用 `deprecate/retire`
  的追加事件回滚，不删除历史。
- 回滚后写 `warning` 经验（canary 已有此行为），并在 Assess 报告中点名“同方向提案需先解释为何这次不同”。

### 6.7 反 Goodhart 与预算

| 风险 | 检测/反制 |
|---|---|
| 删测试/跳过测试/弱化断言 | 候选 diff 静态扫描 + 测试文件哈希 + 回归税（holdout 必须全绿） |
| 改判据/fixture/权限 | TCB 路径 denylist；diff 触碰即拒 + 审计 + 暂停进化 |
| 硬编码期望输出 | 隐藏 holdout + 任务变体 + 人工抽检 |
| 只优化单一分数 | Pareto（success/cost/latency/safety）+ 按 task class 分层报告 |
| 评估器被适应 | holdout 轮换 + 考卷哈希 + 泄漏题退役 |
| 经验膨胀/上下文坍缩 | token 预算 + 条数帽 + TTL + 冲突降级 + delta 帽 |
| 无限搜索/成本失控 | 每周期候选/实验/费用/墙钟四道上限；超限即停 |
| 自改权限/自治档 | `autonomy.json`、`grants.json`、budget、evolve 内核均在 TCB，候选不可写 |
| 坏记忆传染 | 无证据不入库；负证据/冲突降级；scope 隔离；全局晋升需多 workspace 证据 |

Kill switch：`<workspace>/.agent/evolve/STOP` 存在时，Evolve 不写、不注入、不跑实验；
只允许读与报告。桌面面板提供一键冻结。

### 6.8 桌面可见面

在 P2 之后加一个只读为主的 **Evolution** 面板（设置分区或侧栏二级页）：

- 活跃经验：kind、scope、置信度（观测/因果分开）、最近使用、证据数；
- 实验：状态、臂样本、效应与 CI、花费、停止原因；
- 待批准：晋升/回滚（走既有 approval 流）；
- Canary：包、观察期、退化规则；
- 预算：今日/本周期用量与上限；
- Kill switch。

渲染层只经 IPC 读报告，不直接读 `.agent/`；新增通道按 `ipc-protocol.ts` 的版本化规则走。

---

## 7. 与现有代码的接线

| 现有模块 | 本方案的变化 | 明确不改 |
|---|---|---|
| `src/agent/evolution/index.ts` | 保留快环；新增 Episode 写入后的观测计数；`evolutionPromptNote` 优先读 playbook，失败回退旧 `evolution.json` | 不改三类补丁的现有语义；旧账本仍可读 |
| `src/agent/evolution/{signal,strategy-patch,patch-effect,ledger,reflect,patch-gates,store}.ts` | 作为快环与兼容层保留；`StrategyPatch` 成为 playbook 的一个渲染/候选来源 | 不一次性重写；旧测试先不动 |
| `src/agent/evolve/`（新） | `episode.ts`、`playbook.ts`、`retrieval.ts`、`assignment.ts`、`stats.ts`、`conflict.ts`、`budget.ts` 纯函数 | 不 import Electron/UI；不 spawn |
| `src/main/evolve/`（新） | Episode store、playbook store、experiment runner、candidate archive、governance、report | 不复制 installer/registry；全部复用 SEMA |
| `src/main/post-run-readings.ts` | 新增 Episode 写入（先于旧 evolution），失败只出声；保持现有各支顺序 | 不让 Episode 写失败影响主流程 |
| `src/main/agent-runner.ts` | 装配时读 active playbook + 分配实验 + 记录注入；不调用 LLM | 不在热路径做检索/统计重活 |
| `src/main/evolution/evaluator.ts` | 扩展多任务/CI/`mode: correctness-first`；保留现有模块配对语义 | 不放松“无 holdout 不晋升” |
| `src/main/evolution/assess.ts` | 增加 playbook 的 stale/conflict/negative 发现；继续输出体检报告 | 不改自动安装的安全序 |
| `src/main/evolution/workflow-graduate.ts` | hits 只作提名；毕业需技能验证 + experiment | 不直接绕过 SEMA |
| `src/agent/gym/` | 技能草稿的探针；反事实回放 | 不改冻结 case 与评分纪律 |
| `scripts/loop-eval.ts` | 增加 arm/assignment/seed/holdout/CI 输出 | 不改变现有 bench 命令的默认语义 |
| `src/events/types.ts` | 仅加 `session_meta.evolve` 与 `surface_account.evolveChars` 可选字段 | 不新增事件型；replay 不动 |
| `src/main/ipc-protocol.ts` + desktop | P2 后加 Evolution 面板通道；按版本化规则 bump | 不破坏现有通道计数钉 |
| `scripts/gate-manifest.ts` | 先不新增空转门；`evolve-audit-check` 等真实流量出现再立 | 不立没有实质判据的门 |

---

## 8. 评估口径

### 8.1 指标

| 层级 | 指标 | 说明 |
|---|---|---|
| 任务 | 隐藏判据成功率、回归率 | 主指标；回归必须为 0 |
| 成本 | 每次成功成本、token 分项、延迟 | 不可定价记 `unknown`，不折成 $0 |
| 经验 | 注入精度/召回、触发误报、注入 token 占比 | shadow 阶段可测 |
| 实验 | 效应量、95% CI、样本量、花费、停止原因 | 预注册；不足记 `unmeasurable` |
| 系统 | 活跃经验数、stale/conflict 数、回滚率、回滚耗时 | 体检报告 |
| 元 | 每个算子的被接受后代数/花费、候选接受率 | 只用于采样，不用于晋升 |

### 8.2 设计

- 以任务为单位，不以 API 调用为单位；同题重复与同仓库任务按 cluster 处理。
- 配对/分层/交错；模型、端点、装配、判据版本全部记录；跨装配不合并。
- 主比较先看相同资源上限下的成功率，再看质量—成本—时延曲线。
- 报告必须含：N、分母、失败/超时/不可测、效应量、CI、判据版本、装配 digest。
- 不能从“不显著”推出“等价”；不能从“3/3 通过”推出“普遍有效”。

### 8.3 决策规则（默认，可按实验预注册改写）

| 结果 | 判定 |
|---|---|
| 任一 holdout 回归 / 安全违规 | `failed`，不晋升 |
| success RD 的 95% CI 下界 > 0 | `passed` |
| success 非劣且 cost 的 95% CI 上界 < -10% | `passed`（成本型） |
| 样本不足 / 判据不可测 | `unmeasurable`，不晋升 |
| 只在线观测到相关，无对照 | 只更新 observational，不晋升 |

### 8.4 反作弊验收

- 变异测试：删掉证据链、删掉 holdout、篡改 judge 哈希、放宽预算，各自必须红。
- 模拟实验：已知效应能被检出；零效应不误报；欠功率返回 `unknown`。
- 回滚演练：canary 退化 → 30 秒内回到 previous；playbook 冲突 → 两条都停注入。
- 真实冒烟：至少一个 workspace 从 Episode 到 candidate 到 SEMA staging 再到 rollback 的完整链路。

---

## 9. 分批落地

每一批独立可验收；前一批没达到退出条件，不进入下一批。

### P0 · 证据基座（建议第一批）· **已落地（2026-10-27，第 716 页）**

- 交付：`EpisodeRecord` 纯投影 + store + 索引 + facts 输出；接 `post-run-readings`；
  `session_meta.evolve` 可选字段（P0 只落类型与读取；写入端随 P1 实验分配一起接）。
- 落地文件：`src/agent/evolve/episode.ts`、`src/agent/evolve/index.ts`、
  `src/main/evolve/episode-store.ts`、`scripts/evolve-facts.ts`、
  `tests/evolve-episode.test.ts`；`src/events/types.ts` 只加可选字段。
- 不做：不改提示词、不改注入、不生成候选。
- 退出：每场会话要么产出 Episode，要么给出明确的 `unknown` 原因；replay 确定性不变；
  旧 evolution 行为逐字不变；定向测试与 typecheck 通过。
- 风险：低。只是观测面。

### P1 · 类型化 playbook + 影子 · **已落地（2026-10-27，第 717 页）**

- 交付：schema、delta 账本、投影、检索、渲染；旧补丁/教训/打法迁移为 candidate；
  离线 shadow 回放；记录命中 id/chars。
- 落地文件：`src/agent/evolve/playbook.ts`、`src/agent/evolve/shadow.ts`、
  `src/main/evolve/playbook-store.ts`、`scripts/evolve-shadow.ts`；
  `src/agent/evolve/episode.ts` 的 `evidence.toolNames` 供 on-tool 触发；
  `src/main/post-run-readings.ts` 在收束后把最新补丁/记忆迁成 candidate（受 STOP/预算约束）；
  `tests/evolve-playbook.test.ts`、`tests/evolve-playbook-store.test.ts`。
- 偏差：P1 的 shadow 是**离线回放**，不是装配缝实时 shadow；运行时注入、实验分配与
  `session_meta.evolve` 写入端留 P2。P2 起已接运行时，但 P1 的 shadow 仍保持离线。
  运行时补丁回流已接（第 728 页）：迁移产物一律 candidate，旧料没有 Episode id，不能直接 active。
- 不做：不自动晋升；不改变现有提示词文本。
- 退出：提示词前缀稳定（本笔零改动）；token 预算生效；旧测试全绿；
  shadow 能回答“本会命中哪些条目、成功/失败分布与是否无法区分”。
- 风险：中。主要在提示词面；用兼容层与帽约束。

### P2 · 在线随机对照 + 因果报告 · **已落地（2026-10-27，第 718 页）**

- 交付：确定性分配、ExperimentRecord、两比例风险差 + Newcombe 95% CI、实验分析报告；
  `suggest` 档（只建议、不自动装）；运行时 active 经验 + 实验臂注入；assignment sidecar
  进入 Episode；裁决后停止继续分配。
- 落地文件：`src/agent/evolve/experiment.ts`、`src/main/evolve/experiment-store.ts`、
  `src/main/evolve/assignment-store.ts`、`src/main/evolve/runtime.ts`、
  `scripts/evolve-experiment.ts`；`src/main/agent-runner.ts` 装配缝接线；
  `tests/evolve-experiment.test.ts`、`tests/evolve-p2.test.ts`。
- 偏差：在线对照是**非配对**的，因此用 Newcombe 风险差 CI，不用 McNemar；cluster bootstrap
  留 P3。分配落 `.agent/evolve/assignments/` sidecar，`session_meta.evolve` 写入端仍未接。
  P2 的“报告”是 CLI（create/list/analyze），只读面板留 P3/P4；`autonomy` 仍为 manual 语义。
- 不做：不自动晋升；不开放代码候选；不把实验结论直接装进运行面。
- 退出：模拟实验通过（检出/不误报/欠功率 unknown）；分配平衡；报告可读；
  一次真实低风险实验能给出 CI。
- 风险：中。统计误用是主要风险；用预注册 + 冻结算法规避。

### P3 · 离线候选搜索 + SEMA 晋升 · **核心机制与离线 holdout 已落地（2026-10-27，第 719、725 页）；真实实验晋升未跑**

- 交付：`CandidateRecord`（评分/族谱/元生产力）、Pareto 前沿与父代采样、候选档案存储、
  实验 passed → 候选、离线 search/validation/holdout 配对（McNemar 精确检验、回归税、
  不可测不晋升）、reflect-delta 证据绑定算子、候选 passed → SEMA `content-pack` staging
  （只提交，不安装）。
- 落地文件：`src/agent/evolve/candidates.ts`、`src/agent/evolve/offline-eval.ts`、
  `src/agent/evolve/offline-apply.ts`、`src/agent/evolve/operators.ts`、
  `src/main/evolve/candidate-store.ts`、`src/main/evolve/experiment-candidate.ts`、
  `src/main/evolve/offline-eval-store.ts`、`src/main/evolve/reflect-operator.ts`、
  `src/main/evolve/promotion.ts`、`scripts/evolve-promote.ts`、`scripts/evolve-eval.ts`、
  `scripts/evolve-reflect.ts`；`tests/evolve-candidates.test.ts`、
  `tests/evolve-offline-eval.test.ts`、`tests/evolve-reflect-operator.test.ts`、
  `tests/evolve-promotion.test.ts`。
- 偏差：reflect-delta 已落（反思 JSON 由外部生成，未接 provider/agent-runner 自动反思）；
  `policy-tune` 尚未接线。离线评估 CLI 吃外部 run JSON，未直接接 `loop-eval`/gym 适配器。
- 不做：不在线自改代码；不做技能合成（P4）；不自动安装。
- 退出：**晋升门已强制 holdout**（无 holdout/无回归安全 = 拒绝）；真实低风险 playbook 以
  CI 通过并晋升仍未发生——没有真实模型实验与业主批准，不往仓库 `modules/` 写生产候选。
- 风险：中高。开始改变常驻面；用 canary + 回滚 + 人工批准兜底。

### P4 · 技能合成 + 退役/冲突 · **核心机制已落地（2026-10-27，第 720 页）；真实技能验证未跑**

- 交付：`toolSequence`（Episode 证据）；成功同签名 Episode ≥3 → `strategy` candidate；
  精确序列分组、失败不参与、幂等落 playbook；退役 findings（过期/冲突）与 dry-run/`--apply` CLI。
- 落地文件：`src/agent/evolve/skills.ts`、`src/agent/evolve/retirement.ts`、
  `src/main/evolve/skill-synthesis.ts`、`scripts/evolve-skill.ts`、`scripts/evolve-retire.ts`；
  `tests/evolve-skills.test.ts`（4 条）。
- 偏差：技能合成是确定性精确序列，不是 Voyager 式可执行代码/环境探索；没有 gym 探针与
  真实技能 holdout（P3 的离线 holdout 评分可复用，但尚未接技能草稿）。退役默认 dry-run；
  冲突两条都 deprecate，等待人工裁决。
- 不做：不自动批准 tool；不做全局跨 workspace 自动晋升。
- 退出：机制面由临时 Episode 夹具证明；**真实技能通过 gym + holdout 尚未发生**——
  当前工作区 6 条真实 Episode 全部 unknown，没有成功序列可提炼。
- 风险：中高。技能可执行，必须严格门禁。

### P5 · 有界自治 + 元进化 + 桌面面板 · **治理后端已落地（2026-10-27，第 722 页）；面板/soak/自治联动未做**

- 交付：`STOP` kill switch（冻结注入、晋升、技能落库、旧料回流）；`budget.json` 预算读数与
  注入/技能落库/旧料回流上限；只读 `EvolveReport`（Episode/playbook/实验/候选/预算/冻结态）与 CLI。
- 落地文件：`src/main/evolve/governance.ts`、`src/main/evolve/report.ts`、
  `scripts/evolve-report.ts`；`tests/evolve-governance.test.ts`（4 条）。
- 偏差：桌面 Evolution 面板未做（报告是数据源）；两周 soak 未跑；`autonomy.json` 仍是
  既有 manual/gated-auto，未把“实验 passed”与零权限 content-pack 自动安装联动；
  实验/候选数量上限只报告、未强制。
- 不做：tool/desktop-panel 自动装；不让候选改评估器/预算/权限；不做在线代码自改。
- 退出：**未达成**——没有面板、没有 soak、没有自动回滚演练；当前只有治理后端与报告。
- 风险：高。自治面；必须有 TCB 与人工 kill switch。

---

## 10. 风险与反制

| 风险 | 反制 |
|---|---|
| 复杂度先于收益 | P0/P2 先把“测量”做出来；没有可测收益就不进入 P3 |
| 统计欠功率导致假阴性/假阳性 | 预注册、最小样本、CI、`unknown`；不以不显著宣称等价 |
| 奖励作弊 | holdout 轮换、judge 隔离、TCB denylist、回归税、人工抽检 |
| 经验膨胀 | 条数/字符/token 三帽、TTL、冲突降级、delta 帽 |
| 负迁移（跨项目） | workspace 默认隔离；全局需多 workspace 证据 + owner 批准 |
| 模型漂移 | `configDigest` 变化即降级 strategy/policy，重新验证 |
| 数据泄漏 | Episode 只存摘要/摘要哈希；沿用事件日志脱敏；judge 不可读 |
| 并行会话写冲突 | 每个 workspace 一把读-写串行锁（沿用 evolution 的 `withEvolutionLock` 模式） |
| 回滚失效 | SEMA 不可变版本 + previous 指针；playbook 追加式 deprecate/retire；定期演练 |
| 面板误读 | 只读为主；所有数字带 N/CI/判据版本；不可测显式显示 |

---

## 11. 需要拍板的点（附推荐）

> 执行口径（2026-10-27）：业主以「按照最优解直接开始做」批准执行，下列推荐作为缺省：
> P0–P5 后端已按此执行（P3 真实实验晋升、P4 真实技能验证、P5 面板/soak/自治联动未跑）；
> 代码改动永久人工、自动档只到零权限 content-pack/playbook；评估先用 gym/bench 确定性判据
> + 隐藏 holdout 验证机制；Evolution 面板是下一批（当前 CLI 报告）；原地演进并保留兼容层。
> 业主如不另行改口，后续批次沿用这组缺省。

1. **第一批范围**：推荐 **P0 证据基座**（只观测、不改行为），先拿到真实 Episode 分布，
   再决定 P1 的 playbook 形状。备选：P0+P1 一起，或先做离线 GEPA/ACE 原型。
2. **自治上限**：推荐 **代码改动永久人工，自动档只到零权限 content-pack/playbook**。
   tool/desktop-panel 不进自动档。备选：允许低风险工具自动，或全人工。
3. **评估源**：推荐 **先用 gym/bench 的确定性判据 + 隐藏 holdout 验证机制**，
   再上真实模型 RCT；否则会把“机制没接对”误读成“策略无效”。备选：直接真实模型 RCT，或只做离线。
4. **桌面可见面**：推荐 **P2 出只读 Evolution 面板**（实验/证据/预算/kill switch），
   让“看得见的形态”和机器证据同时存在；备选：先 CLI/报告，P4 再面板。
5. **与现有 evolution 的关系**：推荐 **原地演进，保留兼容层**；不新起一套并行机制，
   也不一次性替换。备选：新模块并行、旧模块冻结；或直接替换。

---

## 12. 明确不做

- 不做模型权重训练/微调（SEAL 路线）。
- 不做在线自我改写代码（Gödel Agent / DGM 式高频循环）。
- 不默认启用每步反思、常驻 planner 或第二套 critic。
- 不让模型整段重写经验库（ACE 的 brevity bias/context collapse）。
- 不让候选读写隐藏判据、权限、预算、自治档或 Evolve 内核。
- 不用单一标量分数作为父代选择或晋升的唯一依据。
- 不从“没有观察到失败”推出“成功”。

---

## 13. 参考来源

**论文/综述**

- Reflexion: Verbal Reinforcement Learning. <https://arxiv.org/abs/2303.11366>
- Self-Refine. <https://arxiv.org/abs/2303.17651>
- Voyager: An Open-Ended Embodied Agent with LLMs. <https://arxiv.org/abs/2305.16291>
- ExpeL: LLM Agents Are Experiential Learners. <https://arxiv.org/abs/2308.10144>
- Agent Workflow Memory. <https://arxiv.org/abs/2409.07429>
- Agentic Context Engineering (ACE). <https://arxiv.org/abs/2510.04618>
- GEPA: Reflective Prompt Evolution. <https://arxiv.org/abs/2507.19457>
- STOP: Self-Taught Optimizer. <https://arxiv.org/abs/2310.02304>
- Gödel Agent. <https://arxiv.org/abs/2410.04444>
- Darwin Gödel Machine. <https://arxiv.org/abs/2505.22954>
- Huxley-Gödel Machine. <https://arxiv.org/abs/2510.21614>
- SICA: A Self-Improving Coding Agent. <https://arxiv.org/abs/2504.15228>
- SEAL: Self-Adapting Language Models. <https://arxiv.org/abs/2506.10943>
- Red Queen Gödel Machine. <https://arxiv.org/abs/2606.26294>
- Intrinsic Self-Correction (ICLR 2024). <https://arxiv.org/abs/2310.01798>
- A Comprehensive Survey of Self-Evolving AI Agents. <https://arxiv.org/abs/2508.07407>
- Self-Improvements in Modern Agentic Systems: A Survey (2026). <https://hub-assets-cache.baai.ac.cn/paper/a889b783-1f60-4146-a6d4-8cf44cf58a61>
- Lilian Weng, Harness Engineering for Self-Improvement (2026-07-04). <https://lilianweng.github.io/posts/2026-07-04-harness/>

**开源实现/资源**

- Darwin Gödel Machine: <https://github.com/jennyzzt/dgm>
- Huxley-Gödel Machine: <https://github.com/metauto-ai/HGM>
- SICA: <https://github.com/MaximeRobeyns/self_improving_coding_agent>
- Voyager: <https://github.com/MineDojo/Voyager>
- GEPA: <https://github.com/gepa-ai/gepa>
- ACE: <https://github.com/kayba-ai/agentic-context-engine>
- Reflexion: <https://github.com/noahshinn/reflexion>
- awesome-rsi: <https://github.com/lobehub/awesome-rsi>
- awesome-Self-Improving-Agents: <https://github.com/selfimproving-agent/awesome-Self-Improving-Agents>
- Awesome Harness Engineering for Self-Improvement: <https://github.com/leezythu/Awesome-Harness-Self-Improvement>

> 说明：论文/仓库页面报告的数字属于其各自实验条件；本文只把它们当作机制证据，
> 不当作 Cairn 上的效果承诺。Cairn 的收益必须由本仓自己的 Episode/实验读数裁决。
