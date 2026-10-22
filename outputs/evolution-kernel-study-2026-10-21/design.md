# Cairn 自进化内核：可实施路线（2026-10-21）

> 范围：只读调研 + 输出目录内的最小机制实验；生产代码、判卷、fixtures、门脚本、权限与全局配置均未改动。
> 基线：`HEAD=6af24734ba957838e5584e01228499e5e77b61e9`；A–D 读数见 `evidence.md`。
> 注意：任务写的相对路径根实为仓库 `deepseek harness/`；本文件所有路径均相对该根。

## 0. 三条关键结论

1. **先接「多候选 + 配对实测 + 观察期回退」闭环（路线 B），首期只放开 content-pack / prompt。**
   当前建议闭环（路线 A）保留为候选种子与低成本前端，但不作为收益证据来源。
   复核：§2 的四级判定表；`src/agent/evolution/index.ts:57-95`；`src/main/agent-runner.ts:1242-1247,1287`。

2. **真实断点不是「不会生成」，而是「装上之后没人装载、没人观察」。**
   `EvolutionPlane` / `Installer` / `RuntimeLoader` / `CanaryController` 都有实现与判卷，但生产 grep 零消费者；
   `STATE.md:47` 已把「canary 控制器尚未在生产接线」登记为债。
   首期最小接线 = 收束读数 → `CanaryController.tickAll`；active content-pack → prompt 装配。
   复核：`src/main/evolution/canary.ts:114,395,560`；`grep` 结果见 `evidence.md` §3。

3. **收益未验证，本轮不宣称「自进化已实现」或成功率变化。**
   当前 CLI 缺模型凭据，12/12 条 bench 任务都不可跑且 0 条有逐名 judge 规格（C 读数）；
   最小实验只证明生成/提交→门→安装→装载→判定→回退→重启续跑这条管线，候选与任务是手写脚本化 demo。
   复核：`outputs/evolution-kernel-study-2026-10-21/logs/C-feasibility.log`；`experiment/run.ts`。

## 1. 目标、顺序与硬边界

- 目标：让 agent 依据**真实任务结果**提出、试验、选择自身改进；先覆盖提示词/技能/记忆/内容包，再逐步到工具、调度、代码与内核自身。
- 取舍顺序（本轮采用）：结果可信与可恢复 > 任务成功率 > 能力范围 > 成本速度。
- 硬边界（不因「建议」放宽）：
  - 候选不得修改评价规则、任务集、判据阈值、权限面、门脚本、冻结判卷与进化内核自身。
  - 权限、验收规则、内核变更：必须由**现任监督器**独立验收后交接；候选/新内核不得自批。
  - 未过门、无可复跑证据、无回滚路径 ⇒ 不激活。
  - 不可测 ⇒ 不判绿、不判红、不归档为「已解决」。

## 2. 现有基础、真实断点与四级判定

判定口径：**存在组件**（文件/测试在）≠ **真实执行**（生产调用）≠ **影响下一轮**（改变行为）≠ **证明有收益**（配对实测）。

| 面 | 组件 | 真实执行 | 影响下一轮 | 证明收益 | 证据 |
|---|---|---|---|---|---|
| 建议闭环 `src/agent/evolution/*` | 有（signal / strategy-patch / patch-effect / advice / store） | 是：收束时 `runEvolution`，落 `.agent/evolution.json` | 是：下一轮装配读回，拼进 system prompt | **否**：无配对任务/判据，只有提示词注入 | `src/agent/evolution/index.ts:57-95`；`src/main/post-run-readings.ts:69-77`；`src/main/agent-runner.ts:1242-1247,1287` |
| 后置读数 `post-run-readings.ts` | 有 | 是：`runAgent` 收束后调用 | 间接（写 evolution.json） | 否 | `src/main/agent-runner.ts:1548-1552` |
| 控制平面 `manifest / registry / gate-runner / installer / grants / permission-broker` | 有，150 条判卷覆盖 | **否**：生产零调用 | 否 | 否 | `grep` 仅命中 tests；`evidence.md` §3 |
| 进化前门 `EvolutionPlane` | 有（submit / installApprovedProposal） | **否** | 否 | 否 | `src/main/evolution/evolution-plane.ts:99,194`；无生产 import |
| 运行面装载 `RuntimeLoader` | 有（按账本重验后返回包内容） | **否** | 否 | 否 | `src/main/evolution/canary.ts:114-147` |
| 观察期 `CanaryController` | 有（begin / tickAll / 退化回退 / 跨进程观察档） | **否** | 否 | 否 | `src/main/evolution/canary.ts:395,471,560,672-763`；`STATE.md:47` |

**真实断点（按修复顺序）**

1. **装载断点**：`RuntimeLoader.load(id)` 能返回已激活包内容，但没有生产调用者把 content-pack 拼进 prompt / 把 tool 注入工具表。
2. **观察断点**：`CanaryController` 没有任何宿主在会话收束时 `tickAll(sample)`；因此退化不会自动回退，观察期也不会跨进程续档（实现已备）。
3. **证据断点**：候选记录不绑定父版本、内容摘要、生成器配置、任务集版本、实际成本与失败原因；`signedBy` 只是管线身份戳（`evolution-plane.ts:25-26,142`），不是完整性证明。
4. **评价断点**：bench 12 条任务 0 条有逐名 judge 规格（C 读数），当前无法做「正确性优先」的配对评价。

## 3. 路线比较（最多三条）

### 路线 A：扩展现有建议闭环（prompt-only，单候选）

- 复用：`extractSignals → strategyPatches / advice → evolution.json → evolutionPromptNote` 全链已生产化；零新运行时。
- 能做的：把失败读数变成下一轮提示词里的策略提醒；成本极低；可审计（每条带读数）。
- 缺口：**没有可执行候选、没有配对评价、没有版本/回滚、没有收益证据**；提示词是否真的改善结果无法归因。
- 适用：低风险提示词/记忆提醒；作为路线 B 的**候选种子**，不作为择优依据。

### 路线 B：多候选可执行 + 配对实测择优（推荐）

- 复用：SEMA 的 manifest 契约、JSONL 账本、GateRunner、Installer（版本不可变 + previous 指针）、
  EvolutionPlane、RuntimeLoader、CanaryController（跨进程观察档 + 退化回退）；省掉重建版本/安装/回滚三层的成本。
- 新增：候选生成器、候选档案（sidecar）、配对评价器、装载接线、收束 tick 接线。
- 证据：每个候选在**同一批任务、同一配置**下与当前 active 配对；先判正确性，再比成本/耗时；差异不足保留旧版。
- 回滚：观察期命中退化规则 → `Installer.rollbackInstalled(expectedPrevious)`；回滚后用产物行为复核，而不是只看指针。
- 适用边界：首期只放开 content-pack / prompt / skill；工具与代码候选在权限闸与评价设施稳定后再放开。

### 路线 C：DGM 式开放式自改代码（暂不采用）

- 可复用思想：版本档案树（parent → child）、经验证而非形式证明来选候选、沙箱 + 人工监督（DGM，arXiv:2505.22954，2025-05-29）。
- 不适合当前 Cairn 的部分：搜索空间过大、成本高；当前没有逐任务 judge 规格与真实模型凭据；
  自改代码会触碰 TCB/权限/判卷，风险与「可信可恢复」优先级冲突；开放式归档会放大评审与存储负担。
- 结论：**暂不采用**；先把 B 的评价与回滚跑稳，再考虑把代码候选纳入同一流水线。

### MiroFish 的定位

- 原始资料：`https://github.com/666ghj/MiroFish` README（2026-10-21 抓取），定位是「群体智能预测引擎 / 多 agent 数字沙盘」，
  用大量带人格与记忆的 agent 做社会演化预测。
- 可复用：仅「多 agent 作为候选生成/沙盘演练的一种手段」；不预设它比单生成器更好。
- 不引入：完整社会模拟平台、无关的预测/舆情业务、重型运行时。多 agent 只在 B 的候选多样性不足时作为可选生成器。

### 选型理由（按本轮取舍顺序）

- **可信与可恢复**：B 有配对证据、版本档案、观察期回退；A 只有提示词、无归因；C 风险最高且当前无法评价。
- **任务成功率**：B 直接以正确性判据选版本；A 只能间接影响；C 未证。
- **能力范围**：B 可逐步从 content-pack 扩到 tool/code；A 只覆盖提示词；C 范围最大但不可控。
- **成本速度**：A 最低，B 中等（每轮 1–2 候选、固定任务集），C 最高。
- **结论**：先 B；A 保留为候选种子；C 在 B 成熟后再评估。

## 4. 内核设计（目标与预算 → 生成 → 隔离 → 评价 → 选择 → 生效/回滚/恢复）

### 4.1 目标与预算

- 每个进化周期固定：最多 2 个候选、每个候选在同一任务集上跑 1 次配对评价 + 观察期最多 N 个样本；
  设定 token/金额上限、墙钟上限、最大重试次数。
- 预算耗尽 ⇒ 本周期不激活，交当前最优与未排除项；不拿「下一轮恰好成功」补账。
- 所有成本从既有 metering 读取实际值；不可测写 `null` 与原因，不折成 0。

### 4.2 候选生成

- 输入：失败样本（verify cause / goal drift / cost）、用户显式请求、当前 active 版本。
- 首期候选形态：`content-pack`（提示词片段、技能说明、记忆 schema）；代码/工具候选后置。
- 生成器：真实模型（有凭据时）或人类/手写 bootstrap；记录 `generator.kind / model / tools / params`。
- 硬闸：候选内容不得触碰评价器、任务集、判据阈值、权限面、门清单、内核路径；提交时按路径与契约拒绝。
- 候选多样性：保留 top-k 与互补候选档案；不因单个漂亮案例淘汰其他候选。

### 4.3 隔离执行

- 每个候选在独立临时工作区/`git worktree` 中运行；不安装依赖、不改主检出、不联网（除非任务显式需要且已授权）。
- 固定环境指纹：commit、Node 版本、模型/工具配置、任务集 id+摘要、随机种子。
- content-pack 候选在一次性工作区副本上装配并运行；代码候选必须走 worktree + 门注入面（TCB）。
- 运行失败、模型中断、超时：记录为该候选的失败证据；不重试到「碰巧成功」为止。

### 4.4 独立评价（先正确性，后成本/耗时）

- **固定同一批任务与配置**做新旧配对：`baseline = 当前 active`，`candidate = 新版本`；同一任务集、同一模型/工具配置、同一环境。
- **保留未参与搜索的验证任务**：生成/搜索只能看训练/失败样本；最终门用 holdout 验证任务。
- 判据顺序：
  1. 正确性：逐任务 pass/fail；任何 holdout 回归 ⇒ 直接拒绝（不允许用成本优势抵消）。
  2. 成本/耗时：仅在正确性不劣时比较；差异不足（低于预设最小效应）⇒ 保留旧版。
- 不可测 / 模型中断 / 运行失败 / 回滚失败分别记录，不得混写成一个「失败率」；不可测不参与择优。
- **规则不可被候选同时改动**：评价器、任务集、判据、阈值、门清单是 TCB，只读、摘要固定；候选进程无写权限；
  GateRunner 的真实命令面由 `scripts/` 注入（沿用 `gate-runner.ts:6-9` 的纪律）。候选若试图改这些路径 ⇒ 提交/门阶段拒绝。

### 4.5 候选档案与版本选择

候选记录（sidecar，建议 `modules/candidates/<id>/<version>.json`）：

| 字段 | 含义 | 来源 |
|---|---|---|
| `id`, `version`, `parentVersion` | 身份与父版本 | 提交/生成器 |
| `contentDigest` | 排序后逐文件 sha256（含路径与内容） | 评价器从 installed 字节计算 |
| `generator` | kind / model / tools / params | 生成器自报，评价器记录 |
| `taskSet` | id / version / digest | 固定任务集快照 |
| `env` | commit / node / 配置指纹 | 运行环境 |
| `runs[]` | runId / taskId / ok / cost / tokens / duration / artifactDigest / failureReason | 实测 |
| `evaluation.status` | pending / passed / failed / unmeasurable / rolled-back | 评价器 |
| `approvals` | approvedBy / at | 人工或监督器 |
| `rollbackTo` | 回滚落点 | 观察期 |

- **完整性**：以 `contentDigest` 为准；`signedBy` 只是「哪个管线写的」身份戳，不能当完整性证明。
- 账本仍是权威（registry.jsonl）；sidecar 是证据档案，装载/激活时交叉核对摘要。
- 选择规则：正确性不劣 + holdout 无回归 + 成本/耗时达到最小效应 ⇒ 新版本；并列或证据不足 ⇒ 旧版本。

### 4.6 生效 / 回滚 / 恢复

- 生效路径（首期 content-pack）：
  `submitProposal` → `GateRunner`（冻结门）→ `Installer.installStaged`（指针切换、previous 保留）
  → `CanaryController.begin`（装载重验 + 观察档）→ 下一轮装配 `RuntimeLoader.load` 把 active 包内容拼进 system prompt
  → 收束时 `CanaryController.tickAll(sample)`。
- 观察期规则（沿用 `canary.ts:672-698`）：
  - 连续失败样本达阈值 ⇒ 回退；
  - no-progress 仅在可测时判；
  - 成本相对基线超倍数 ⇒ 回退；无基线/不可测 ⇒ 不判。
- 回退：`Installer.rollbackInstalled(id, actor, expectedPrevious)`；只回退到观察记录里的 previous；
  回滚后用**产物行为**复核（artifact 内容 / 判定结果），不能只看 active 指针。
- 回滚失败：`state=degraded` + `rollbackError`，active 不动，人工告警；不假装成功。
- 重启恢复：观察档 `<workspace>/.agent/canary/<id>.json`（原子写）；新进程 `tickAll` 扫描并续档；
  档损坏 ⇒ `refused`，不静默清零。
- 旧监督器验证新内核再交接：
  1. 新内核作为候选包提交，由**现任** GateRunner / 评价器在隔离 worktree 中跑冻结一致性套件（typecheck、内核判卷、回滚演练）；
  2. 现任监督器的规则、任务集、阈值在新内核评价期间保持不变；
  3. 通过后由人类/独立监督者批准（`approvedBy != 管线 actor`），再切内核指针；旧内核留在 previous 以便回退；
  4. 新内核不得参与自己的验收，也不得修改验收规则。

### 4.7 自治分级（与领导拍板对齐）

| 类别 | 例子 | 生效方式 |
|---|---|---|
| 普通内容/提示词/技能/记忆 schema | content-pack、prompt、skill | 门 + 配对评价 + 观察期通过后**自动择优** |
| 普通模块（不触 TCB、无高危权限） | 纯函数工具、内部服务 | 同上；首期暂不放开代码类 |
| 高危工具/代码 | net/fs/shell、执行面 | 门 + 配对评价 + 人工批准 |
| 权限、验收规则、门清单、进化内核自身 | permissions、judges、gate-manifest、kernel | **独立批准 + 旧监督器验收 + 交接**，永不自动 |

## 5. 辅助手段（按证据与成本排序）

1. **失败样本回归**：把每个失败任务钉进固定回归集；直接约束后续候选，成本最低。帮助评价环。
2. **任务课程**：按失败簇排序任务，先修高频/高影响；帮助生成环选方向。
3. **带来源/版本/适用范围/失效条件的记忆**：只写有证据的 lesson；过期或条件不满足即失效；帮助生成与提示词环。
4. **工具与提示词改进**：在 content-pack/tool 候选内做小步变更；帮助执行环。
5. **候选多样性保留**：top-k / 互补档案，避免早熟收敛；帮助选择环。

本期删除/不做：完整社会模拟平台（MiroFish 平台本体）、模型权重训练、通用调度大平台、自组织模块树全自动 prune。

## 6. 首期施工规格（最小接线）

### 6.1 文件白名单（下一施工期；本轮不改）

新增：
- `src/main/evolution/candidate-record.ts`：候选 sidecar schema、摘要计算、读写与校验。
- `src/main/evolution/evaluator.ts`：配对评价编排（只编排；真实命令由 `scripts/` 注入）。
- `src/main/evolution/activation-host.ts`：构造 Registry/Canary，收束时 tick；装载 active content-pack 的只读出口。
- `scripts/evolution-eval.ts`：TCB 评价器（固定任务集、judge、配对运行、输出 JSON 证据）。
- `tests/evolution-kernel.test.ts`：候选档案/摘要/配对/回退/恢复判卷。

修改：
- `src/main/post-run-readings.ts`：在 `runEvolution` 后，把同一份 signals 喂给 `tickAll`（失败不影响主流程，但必须出声）。
- `src/main/agent-runner.ts`：在 `evolutionNote` 同一装配缝加载 active content-pack（零包 ⇒ 空串，系统提示词逐字节不变）。
- `scripts/gate-manifest.ts`：仅在真实 staging 流量出现后登记 `evolution-eval` 门，不提前造空转门。

不动：`src/permissions/`、冻结判卷、`fixtures/`、`tests/` 既有断言、`apps/desktop/` 边界、全局配置。

### 6.2 接线表（谁调用谁 / 读什么 / 写什么 / 新增什么）

| # | 调用链 | 读 | 写 | 新增 |
|---|---|---|---|---|
| 1 | `post-run-readings.emitPostRunReadings` → `activation-host.tick(signals)` → `CanaryController.tickAll(sample)` | `modules/registry.index.json`、`.agent/canary/*.json`、本轮 `EvolutionSignals` | 观察档、lesson、`rollback` 事件 | `activation-host.ts` |
| 2 | `agent-runner.runAgent` → `activation-host.loadActiveContentPack(workspace)` → `RuntimeLoader.load(id)` | `registry.index.json`、`modules/installed/<id>/<version>` 字节 | 无（返回文本，拼进 `systemPromptFor(...) + note`） | 同上 |
| 3 | 候选生成器 / `scripts/evolution-eval.ts` → `EvolutionPlane.submitProposal` | 候选 manifest/files | `modules/staging/`、`register` 事件 | `evaluator.ts`、`scripts/evolution-eval.ts` |
| 4 | `GateRunner.runDeclaredGates` → `scripts/` 注入的 `runGate`（TCB） | 账本定格的门清单、staging 包 | `gate` 事件 | 门命令注入（真实流量后再登记） |
| 5 | `EvolutionPlane.installApprovedProposal` → `Installer.installStaged` | staging manifest、`modules/grants.json`、账本 | `modules/installed/`、`activate` 事件 | 无（复用） |
| 6 | `evaluator` → `scripts/evolution-eval.ts`（固定任务集 / judge） | 任务集快照、baseline 与候选产物 | 候选 sidecar、评价结果 JSON | `candidate-record.ts` |
| 7 | `CanaryController.settle` → `Installer.rollbackInstalled(expectedPrevious)` | 账本 previous、installed 旧版本文件 | `rollback` 事件、观察档 | 无（复用） |

**不可被候选改动的对象**：任务集与 judge、评价阈值、`scripts/gate-manifest.ts`、`src/permissions/`、冻结判卷、
本表 1–7 的调用规则本身。候选进程只写自己的 staging/产物；评价器与门命令由 TCB 注入。

### 6.3 最小接口 / 状态表

```
CandidateRecord v1（sidecar，证据档案；账本仍权威）
  id, version, parentVersion
  contentDigest
  generator { kind: "model"|"human"|"handwritten-demo", model, tools, params }
  taskSet { id, version, digest }
  env { commit, node, configDigest }
  runs[] { runId, taskId, ok, costUsd, tokens, durationMs, artifactDigest, failureReason }
  evaluation { status: pending|passed|failed|unmeasurable|rolled-back, reason }
  approvals { approvedBy, at }
  rollbackTo?
```

```
候选生命周期：
  proposed → gated → installed(active) → observing
      ├─ promoted（观察期满且无退化）
      ├─ rolled-back（退化 → previous）
      └─ degraded（回滚失败，active 不动）
  任一门/评价失败 → rejected / failed（不激活）
```

### 6.4 纯文本流程图

```
run ends
  │
  ├─ post-run signals (verify cause / drift / cost)
  │      │
  │      ├─ 现有：strategy patches → .agent/evolution.json → 下一轮 prompt（保留）
  │      └─ 新增：候选生成（1–2 个 content-pack）→ submitProposal
  │
  ├─ GateRunner（冻结门；缺证据 ⇒ 拒绝）
  │
  ├─ Installer（版本不可变；previous 保留）→ active 指针
  │
  ├─ Canary.begin（RuntimeLoader 重验 + 观察档 .agent/canary/<id>.json）
  │
  ├─ 下一轮 run：RuntimeLoader.load(active) → 拼进 system prompt → 产物/判定
  │
  └─ run ends → Canary.tickAll(sample)
         ├─ 无退化且样本满 → promoted（保留新版本）
         └─ 命中退化 → rollbackInstalled(expectedPrevious)
                ├─ 成功 → rolled-back → 产物行为复核 → 保留旧版本
                └─ 失败 → degraded + 人工告警（不假装成功）
  重启：新进程 tickAll 扫描观察档续档（样本不清零）
```

### 6.5 验收命令（可复跑）

```sh
# 1) 基线（工作树，非 HEAD 认证）
node node_modules/vitest/vitest.mjs run --config tests/vitest.config.ts \
  tests/evolution.test.ts tests/evolution-registry.test.ts tests/evolution-install.test.ts \
  tests/evolution-plane.test.ts tests/evolution-canary.test.ts tests/post-run-readings.test.ts
node --import tsx scripts/typecheck.ts

# 2) 机制实验（本轮已跑；输出目录内源码，运行数据在临时目录）
WS=$(mktemp -d "$TMPDIR/cairn-evo-XXXXXX")
node --import tsx outputs/evolution-kernel-study-2026-10-21/experiment/run.ts phase1 "$WS"
node --import tsx outputs/evolution-kernel-study-2026-10-21/experiment/run.ts phase2 "$WS"
# 期望：1.1.0 promoted；1.2.0 先被缺门拒绝、过门后运行期判红；phase2 续档 samples=3 并回退到 1.1.0；
#       restored artifact producerVersion=1.1.0 且 judge ok。

# 3) 真实能力评价（需模型凭据；本轮未做）
node --import tsx scripts/loop-eval.ts --tasks fixtures/bench/tasks.json --feasibility
# 期望：可跑 > 0 且逐名 judge 规格 > 0；否则收益仍为「未验证」。
```

### 6.6 扩容条件

- content-pack 自动择优：连续 2 个周期 holdout 无回归 + 回滚演练通过 + 观察档跨进程续跑通过。
- 工具候选：PermissionBroker 接线完成、net/fs/shell 仍走人工确认、观察期至少覆盖 2 个进程重启。
- 代码候选：worktree 隔离 + 冻结判卷 + 变异验证门（mutate-verify 纪律）稳定后；内核/权限/判据永不自动。
- 多 agent 生成器：单生成器候选多样性低于阈值且成本预算允许时才引入，不预设更优。

## 7. 失败模式记录口径

| 情况 | 记录 | 是否可择优 |
|---|---|---|
| 任务不可测 | `unmeasurable` + 原因 | 否 |
| 模型中断/超时 | `failed` + runId + 阶段 | 否 |
| 运行失败 | `failed` + 产物/错误摘要 | 否 |
| 回滚失败 | `degraded` + `rollbackError`，active 不动 | 否，人工告警 |
| 门/评价证据缺失 | `rejected` + 缺哪道门/哪条判据 | 否 |
| 单个漂亮案例 | 仅作样本，不单独构成因果收益 | 否 |

## 8. 本轮边界与未验证项

- 生产代码、判卷、fixtures、门脚本、权限与全局配置零改动；工作树 127 项他人改动未触碰。
- 实验候选与任务是手写脚本化 demo，**不发模型请求**；只证明管线，不证明能力收益。
- 缺模型凭据、12/12 bench 任务无逐名 judge 规格 ⇒ 真实任务成功率、成本收益均**未验证**。
- 本设计中的首期接线尚未施工；验收命令 1 是现状基线，命令 2 是机制复跑，命令 3 需凭据。
