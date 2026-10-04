# 成本可观测面取证（项目目标第 9 条 / 「消耗 token 最少」）

取料基线：`rev = a6a87627`（HEAD）。所有行号是 `git show "${rev}:path"` 的行号。
只读取证：未跑判卷、未跑 typecheck、未跑任何 `scripts/*.ts` 门、未跑 mutate-verify。
价格与凭证只读**变量名**（`EVAL_PRICE_IN` / `EVAL_PRICE_OUT`、`DEFAULT_PRICE_TABLE` 的字段名），未读任何值，报告内不含值。

「干净」= `git status --porcelain -- <path>` 无输出（工作树 == HEAD）。
「在隔壁手里」= 该文件在工作树是脏的，下面引用的是 HEAD 那一版。

主要**在隔壁手里**（脏）的相关文件：
`src/agent/metering.ts`、`src/agent/orchestrator.ts`、`src/agent/orchestrator-types.ts`、`src/agent/loop.ts`、
`src/agent/fork-cli.ts`、`src/cli.ts`、`src/main/agent-runner.ts`、`src/main/settings-handlers.ts`、
`src/providers/openai.ts`、`src/providers/glm.ts`、`src/routing/bandit.ts`、
`scripts/loop-eval.ts`、`scripts/routing-check.ts`、`scripts/gate-manifest.ts`、`scripts/mutate-verify.mjs`、
`scripts/replay/corpus.ts`、`tests/usage-attribution.test.ts`、`tests/worker-spent-usd.test.ts`、
`tests/session-tools.test.ts`、`tests/goal-continue.test.ts`、`tests/bandit-runtime.test.ts`、`tests/cli-surface.test.ts`、
`tests/budget-price-key.test.ts`、`tests/worker-budget.test.ts`、`tests/main-run-routing.test.ts`、
`tests/prompt-cache-breakpoints.test.ts`、`apps/desktop/src/renderer/App.tsx`、`apps/desktop/src/main/index.ts`。

主要**干净**的相关文件：
`src/agent/solpi-runtime.ts`、`src/agent/usage-attribution.ts`、`src/agent/orchestrator-join.ts`、
`src/agent/cost-per-progress.ts`、`src/agent/goal.ts`、`src/agent/glm-session.ts`、`src/agent/compaction.ts`、
`src/routing/pricing.ts`、`src/routing/policy.ts`、`src/routing/cascade.ts`、`src/events/index.ts`、
`src/main/settings.ts`、`src/main/ipc-protocol.ts`、`src/providers/anthropic.ts`、`src/providers/registry.ts`、
`apps/desktop/src/renderer/projections.ts`、`apps/desktop/src/renderer/components/TokenPanel.tsx`、
`apps/desktop/src/renderer/components/SettingsPanel.tsx`、
`scripts/cost-per-progress-check.ts`、`scripts/observe-surface.ts`、`scripts/replay-readings.ts`、
`scripts/replay/run-scorecard.ts`、`scripts/replay/latency.ts`、`scripts/replay/prompt-fixed-cost.ts`、`scripts/prompt-cost.ts`、
`tests/metering.test.ts`、`tests/solpi-runtime.test.ts`、`tests/session-spend-ruler.test.ts`、`tests/goal-price.test.ts`、
`tests/surface-account.test.ts`、`tests/provider-cache-usage.test.ts`、`tests/cost-per-progress.test.ts`、
`tests/replay-run-scorecard.test.ts`。

---

## 1. 计量面：一次运行结束时，能读出哪些数

### 1.A 事件流（会话 JSONL）——每次 run 一定落，这是**唯一人人可得**的账

| # | 读数 | 出处（定义 / 生产者） | 谁读它 |
|---|---|---|---|
| 1 | 每次模型请求 `inputTokens` | `src/events/index.ts:85`；生产者 `src/providers/openai.ts:100`、`src/providers/anthropic.ts:285`、`src/providers/gemini.ts:237` | CLI `src/cli.ts:455-456`；`--replay` `src/agent/fork-cli.ts:174-175`；桌面聚合 `apps/desktop/src/renderer/projections.ts:149-159`；`scripts/replay/run-scorecard.ts:89`；`src/agent/cost-per-progress.ts:42` |
| 2 | 每次模型请求 `outputTokens` | `src/events/index.ts:85`；`src/providers/openai.ts:101` | 同上 |
| 3 | 缓存命中读桶 `cacheReadInputTokens`（可选，缺 ≠ 0） | `src/events/index.ts:88`；`src/providers/openai.ts:96,102`、`src/providers/anthropic.ts:289` | `scripts/replay/run-scorecard.ts:91`；`src/agent/cost-per-progress.ts:44`；`src/routing/pricing.ts:93` |
| 4 | 缓存写桶 `cacheWriteInputTokens` | `src/events/index.ts:88`；`src/providers/openai.ts:97,103` | `scripts/replay/run-scorecard.ts:93`；`src/routing/pricing.ts:94` |
| 5 | **模型改名归因** `usage.model`（缺 = 不可定价） | `src/events/index.ts:92`；唯一盖章点 `src/agent/usage-attribution.ts:29-43`，接进 pipeline 于 `src/main/agent-runner.ts:1616`（在 append 之前） | `scripts/replay/run-scorecard.ts:95-98`（钱轴的前提）；`priceForModel` `src/agent/orchestrator-join.ts:36-43` |
| 6 | 归因到 worker `usage.agent_id` | `src/events/index.ts:88` | `src/agent/cost-per-progress.ts:45-50`；`scripts/replay/run-scorecard.ts:204-215` 分面 |
| 7 | 每个请求的时间戳 `ts`（全事件） | `src/events/index.ts:660` | `scripts/replay/latency.ts`（工具耗时分布 / 一轮几个调用） |
| 8 | **worker 终态花费** `agent_result.artifacts.spent_usd` | `src/events/index.ts:382`；生产者 `src/agent/orchestrator.ts:2091-2092`（done）与 `:2148`（failed） | CLI `src/cli.ts:471,475`（唯一打 `$` 的地方）；goal 美元闸 `src/agent/goal.ts:282-283`；收队行 `src/agent/orchestrator-join.ts:170-173,190,194` |
| 9 | 该档单价是否当日实测 `price_calibrated` | `src/events/index.ts:384`；`src/agent/orchestrator.ts:2092` | `priceTagText` `src/agent/orchestrator-join.ts:134-136` |
| 10 | worker 累计用量 `agent_result.usage.{in,out}` | `src/events/index.ts:386`；`src/agent/orchestrator.ts:226,1668` | 收队行、`scripts/supervisor-check.ts:141` |
| 11 | **工具调用次数（按工具名）** `agent_result.tool_stats` | `src/events/index.ts:387`；`src/agent/orchestrator.ts:2107,2130,2151,2167` | 定时任务摘要 `src/main/scheduler.ts:312,842`；**主会话没有任何等价的总次数读数**（CLI 只数失败 `src/cli.ts:1032-1037`） |
| 12 | 压缩前后体量 `compaction.tokens_before/after` | `src/events/index.ts:204-205` | 桌面只数条数 `src/main/agent-runner.ts:2693`；判卷 `scripts/compaction-check.ts` |
| 13 | 摘要器自己的用量 `compaction.usage` | `src/events/index.ts:206`；生产者 `src/agent/compaction.ts:776`（源自 `src/agent/glm-session.ts:557-567`） | **零读者**（见 §1.C 第 8 条） |
| 14 | 摘要器档位 `compaction.model` | `src/events/index.ts:207` | 未见消费者（只落盘） |
| 15 | **每轮模型面装配账** `surface_account` 18 项：`attemptSeq / declaredToolCount / declaredToolSpecChars / sentToolCount / sentToolSpecChars / baseSystemChars / volatileChars / memoryChars / skillsBlockChars / mapChars / attachmentContextChars / limitChars / overChars / shortened / dropped / unresolvable / prefixStableChars / faceChanged` | 定义 `src/events/index.ts:572-626`；生产者 `src/agent/glm-session.ts:866-887`；采样条件 `src/agent/glm-session.ts:860`（首请求 ∪ 面变 ∪ 超帽 ⇒ **不是每请求一条，不能拿来数请求**） | 门/面：`scripts/observe-surface.ts:94-119,164-190`（`pnpm observe-surface`，需手给 jsonl 路径）；投影侧显式不消费 `src/agent/sidechat.ts:152`、`src/agent/context.ts:318` |
| 16 | 路由读数 `routing_decision.{candidates,picked,reason,from,agent_id,stage}` | 定义 `src/events/index.ts:442-456`；生产者 `src/agent/orchestrator.ts:772-783`（见 §2） | `scripts/routing-check.ts:61-123`（门，脏）；`scripts/replay/cascade-traffic.ts:70`；`tests/bandit-runtime.test.ts:81`；**CLI/回放不渲染**（§3） |
| 17 | 被截断那一轮已花的输出 token `turn_truncated.output_tokens` | `src/events/index.ts:552` | 判卷 `tests/turn-truncated.test.ts` |
| 18 | 预算设定 `goal_set.{max_turns,max_usd}` | `src/events/index.ts:518-519` | CLI `src/cli.ts:486-487` |
| 19 | 停止理由 `goal_stopped.reason`（**里面夹着实付美元，散文**） | `src/events/index.ts:531`；文案 `src/agent/goal.ts:122` | CLI `src/cli.ts:488-489`；判卷 `tests/goal-continue.test.ts:364`（脏） |
| 20 | 定时任务终态 `automation_completed.{usage,tool_stats,summary}` | `src/events/index.ts:494-495`；`src/main/scheduler.ts:842` | 面板完成卡（投影） |
| 21 | 工具失败的机器可读列 `tool_result.{exitCode,timedOut,blockedBy,hold,gate}` | `src/events/index.ts:70-84`；`hold:"budget"` 生产者 `src/agent/orchestrator.ts:494-501` | `scripts/replay/*`、CLI `src/cli.ts:1032-1037` |

**注意：以上 1–21 里没有任何一条事件带「这一轮花了多少钱」的机器可读数字。**
主会话的实付美元确实**算出来了**，但它只活在散文里：

- `goalWindowSpend()` `src/agent/goal.ts:263-294` → `budgetLine()` `src/agent/goal.ts:169-172`（"已花 $X，美元上限 $Y"）→ 进 **模型可见的续跑提醒正文**（`src/main/agent-runner.ts:2201`）；
- 美元闸停时那句 `实花 $X` → `goal_stopped.reason` 的字符串里（`src/agent/goal.ts:122`）；
- 会话成本闸的估价 → `tool_result.output` 的一句散文（`src/agent/orchestrator.ts:489,499,501`）。

`UsageEvent`（`src/events/index.ts:85-92`）**没有 cost 字段**。所以「钱」在主会话这一侧不是字段，是文案。

### 1.B RequestMeter 报告（opt-in，缺省关）

`RequestMeter` 是真在跑的（不是设计稿）：

- 建：`src/agent/solpi-runtime.ts:71`（`flags.requestMetering` 才建），开关于 `src/main/agent-runner.ts:1606,1611`，读盘 `src/main/agent-runner.ts:2100` ← `src/main/settings.ts:78,121(缺省 false),205`；
- 逐请求记账：`src/providers/openai.ts:163`（`beginRequest`）+ `:356`（`finishRequest`），经 `src/providers/glm.ts:74` 转发给 GLM（本仓缺省 provider）；
- 分类注入：主会话 `src/agent/glm-session.ts:1083`（category `main`）、摘要器 `src/agent/glm-session.ts:559`（category `summary`）；
- 验证拍回灌：`src/main/agent-runner.ts:1618`（`recordVerification`，只主面 verify）；
- 落盘：`src/agent/solpi-runtime.ts:149-162` —— `session-data/<inode-key>/run-<runId>.json`，`mode 0o600`。

能读出的数（`src/agent/metering.ts`，HEAD 行号，该文件**在隔壁手里**）：
逐请求 `bytes`（UTF-8 精确请求体字节）/`chars`/`bodySha256`/`startedMs`/`elapsedMs`/`outcome` + 四个互斥 token 桶（`:14-28,101-127`）；
总计 `requests/bytes/chars/elapsedMs/usage/cost`（`:60-71`）；按 `main/summary/recall` 分面（`:78,149-153`）；
`wallClockMs`（构造→封口的跨度，不是请求之和，`:74-75,143`）；`verifications[]` 与 `verifyOutcome`（`:79-80,129-137,155`）；
同报告里另有 `localRecall[]`（本地召回的次数/字节/耗时，`src/agent/solpi-runtime.ts:136,153`）与 `economics`（`:153`）、
以及一行自陈 `realModelBenefits:"unverified"`（`:154`）。

### 1.C 算了但没人落 / 没人读的死值（9 处）

1. **`MeterRequest.prices` 与 `MeterRequest.cost`、`MeterTotals.cost` 在生产路径恒 `null`。**
   `beginRequest(category, serializedBody, prices = {})`（`src/agent/metering.ts:101`）的第三参在**唯一的**生产调用点没递
   （`src/providers/openai.ts:163` 只传两个参数），而 `meteredCost()` 对缺价 fail-closed 返 `null`
   （`src/agent/metering.ts:45-51`，第 48 行），`totals.cost` 只要有一笔 null 就整体 null（`:61-62,69`）。
   ⇒ 那套「四个互斥桶 × 单价 = 钱」的尺**从来没在生产里出过数**。单测把价格自己灌进去（`tests/metering.test.ts:9,15-25`，
   第 38 行断言 `totals.cost ≈ 0.001544`），所以这条**永远红不了**。
2. **`MeterVerification.elapsedMs` 恒 `null`** —— 硬写在 `src/main/agent-runner.ts:1618`（`elapsedMs: null`）。
   `verifyOutcome`（`src/agent/metering.ts:80,155`）有值，验证耗时没有。
3. **`MeterReport.categories.recall` 恒 0 请求** —— `RequestCategory` 的 `"recall"` 全仓零生产者
   （`src/agent/metering.ts:3` 定义、`:103` 只校验；生产只出现 `main`/`summary`）。本地召回走的是另一格
   （`localRecall`，`src/agent/solpi-runtime.ts:136`），三者不可混读。
4. **`RequestMeter.exportJSON()` / `stableMeterJSON()` 零生产调用者**
   （`src/agent/metering.ts:159,165`）—— 落盘那份走的是 `JSON.stringify`（`src/agent/solpi-runtime.ts:156`）。
   ⇒ 「同一份报告重复导出逐字节相同」这条承诺（`:158` 注释）在生产里没被执行过，只在 `tests/metering.test.ts:62-64` 里成立。
5. **`createOfflineComparison()` 与 `OfflineComparison` 零生产调用者**（`src/agent/metering.ts:193-225`）。
   只有 `tests/metering.test.ts:107-148` 消费。⇒「A/B 变体在同一份初始快照 + 同 seed 下各自出一份计量账」这件第 9 条
   要的能力，目前是**有尺无止**：没人拿它跑过任何真实对照。
6. **`splitUsageByAttribution.cacheReadTokens` / `totalTokens` / `requests` 算了没出口**
   （`src/agent/cost-per-progress.ts:29-31,44,52`）。门 `scripts/cost-per-progress-check.ts` 的判据只吃
   `mainTokens/workerTokens/tokensPerBoundary/spendAfterLastBoundary/excludedWorkerTokens`（`:60-85,164`），
   打印行（`:227-228`）里没有缓存那格；`cacheReadTokens` 的唯一读者是一条单测（`tests/cost-per-progress.test.ts:40`）。
   ⇒ 缓存命中率这件事**在这道成本门里根本没有读数**（只有 `run-scorecard` 的「缺报条数」，见下第 7 条）。
7. **`aggregateScorecard` 里累加好的 `cacheRead` / `cacheWrite` 总量被丢在函数内部**
   （`scripts/replay/run-scorecard.ts:296-312`：`allUsage.cacheRead/cacheWrite` 算出来了，但
   `ScorecardAggregate`（`:244-272`）不导出它们，只导出 `cacheUnreported.{read,write}`（`:326`）与打印那一行（`:277-281,399`））。
   ⇒ 复跑面能告诉你「有几条 usage 没报缓存」，**不能**告诉你「一共命中了多少」。
8. **`compaction.usage`（摘要器自己吃的 token）零读者** —— 落盘在 `src/agent/compaction.ts:776`，
   字段声明 `src/events/index.ts:206`；`usageOfStream` 只遍历 `type === "usage"`（`scripts/replay/run-scorecard.ts:86-105`），
   `goalWindowSpend` 同样只读 `usage` 事件（`src/agent/goal.ts:273-277`）。
   ⇒ **主会话的摘要开销不在任何钱轴里**（worker 那侧另有一份，`src/agent/orchestrator.ts:2529-2534` 会补一条 `usage` 事件，
   所以两侧口径不对称）。
9. **`run-<runId>.json` 整份报告零面向人的读者。** 全仓读它的只有两条判卷：
   `tests/solpi-runtime.test.ts:99-104` 与 `tests/session-tools.test.ts:370-378`（脏）。
   CLI、`--replay`、桌面 IPC、`scripts/` 的任何门/面都不读它。⇒ **有数据无出口**（这一条是唯一一个「数据存在但没人能看」的整块，
   与第 1–5 条的「算了但算成 null / 没接线」性质不同）。

补充（不是死值，但会读错）：`worker` 侧的美元一律**不含缓存分桶**，所以是上界
（`src/agent/orchestrator-join.ts:70` 注释 + `:71-86` 只吃 `{inputTokens,outputTokens}`；`src/agent/orchestrator.ts:226,1668` 同样只带两桶）。
GLM 三档在价表里仍是占位、不打 `calibrated`（`src/routing/pricing.ts:57-60`，字段名 `calibrated`），
`unpricedModels()` 明列哪几行是占位（`:46-50`）⇒ 本仓缺省 provider 的钱数是**不可当省钱证据**的那一档。

---

## 2. 路由面：「选了哪个模型、为什么」有没有可审计的轨迹

**有轨迹，但只在 worker 那一侧、且只在路由开着时；「为什么」只到 reason 一层，再往下不可重建。**

1. 决策本身是纯函数且带候选面：`routeFor()` 返回 `{picked, tier, reason, from?, candidates}`
   （`src/routing/policy.ts:49-57,72-116`）——`reason` 是五挡枚举 `pinned | tier-default | bandit | cascade-upgrade | fallback`
   （`:79,84,95,99,108,114`）。**候选也进返回值**，这是能事后重建的前提。
2. 决策**在拨号之前**就落盘成事件：`src/agent/orchestrator.ts:563-564`（注释即纪律）→ `:772-783` emit
   `routing_decision{agent_id, stage, candidates, picked, reason, from, ts}`；与 `agent_spawned` 一对一（`:769-771`，
   租约拒绝/worktree 失败不留孤儿决策事件，门判据 `scripts/routing-check.ts:123`）。
   所以「当时有哪些候选、落到谁、为什么、哪个 worker、哪一环角色」是**能从 JSONL 事后重建的读数**，
   不是只活在那次返回值里——这是这一格最好的事实。
3. 级联升档也留痕：`ctx.cascadeFrom` 在唯一出口把 reason 改写成 `cascade-upgrade` + `from`
   （`src/agent/orchestrator.ts:584-590`），每一档重跑再走 `spawnInternal`  ⇒ 每升一档**又多一条 routing_decision**
   （升级路径 `:1371-1407`，另有一条 `agent_message` 散文行 `:1358-1362`）。
   `runCascade()` 自己那份 `decisions[]`（`src/routing/cascade.ts:44-45`）不再落事件，但它是事件的真子集（逐档一决策），
   不构成信息缺口。
4. **不可重建的两块**：
   - **bandit 的后验轨迹**。学习状态只有一处落盘：`.agent/routing-routing-bandit.json`
     ——实际路径 `join(ROOT, ".agent", "routing-bandit.json")`（`src/main/agent-runner.ts:344-346`），
     写于每次回灌（`src/agent/orchestrator.ts:1966` `saveBanditState`，代价项是 `costUsd` 折的真钱 `:1964`）。
     **原地覆盖**，没有历史 ⇒ 事后拿得到「最后一次」的后验，拿不到「这一次决策当时」的后验。
     `routing_decision` 里也不带臂/概率（`src/events/index.ts:442-456` 无该字段）。⇒「为什么当时抽中这一档」不可复盘。
   - **主会话这一侧整条缺**。`routing_decision` 的生产者只有 orchestrator 的 spawn 一处（`:772`），
     主会话模型走 `resolveRunModel/mainUsageModelOf`（`src/main/agent-runner.ts:1706-1708`），
     **没有任何事件记「主会话为什么用这一档 / 有哪些候选」**。事后只能从 `usage.model`（`src/agent/usage-attribution.ts:38-42`）
     重建「用了谁」，重建不出「为什么」与「本可以选谁」。
5. 轨迹面向人的出口：**没有**。`formatReplay` 对 `routing_decision` 走 default 分支，明打
   「（routing_decision：本行不做摘要）」（`src/agent/fork-cli.ts:177-178`），而这条**被一条判卷钉死了**
   （`tests/cli-fork-replay.test.ts:150-154`，脏）⇒ 想在看板/回放里读「选了谁/为什么」得先改那把尺。
   `src/cli.ts:490-491` 的 live 渲染同样 `return null`。桌面侧 `routing_decision` 被显式排除在只读投影之外
   （`src/agent/sidechat.ts:146`、`src/agent/worker-projection.ts:120`）。
6. 开关可达性：路由与级联都缺省关（`src/main/settings.ts:114-115`），开由 `routingBandit/routingCascade` 决定
   （`src/main/agent-runner.ts:344,350`）；桌面设置面板的 patch 白名单只有五个键、不含它们
   （`apps/desktop/src/renderer/components/SettingsPanel.tsx:46`）⇒ 与 `src/cli.ts:12` 那句自陈一致
   （「三个最值钱的开关默认全关且无处可翻」）。

---

## 3. 出口面：这些读数最终在哪里被人看见

| 出口 | 看得见 | 看不见 |
|---|---|---|
| **终端 live**（`m0`） | 每轮 `· tokens in=X out=Y`（`src/cli.ts:455-456`）；worker 终态一行 `$0.0000`（`:471,475`）；`goal_set` 的上限（`:486-487`）；`goal_stopped` 那句含实花的散文（`:488-489`） | 没有缓存桶、没有 `usage.model`、没有 `surface_account`、没有 `routing_decision`（default 分支 `:490-491`）；**运行结束只打一句「事件日志：<path>」，没有任何合计行**（`:1152`） |
| **终端 `--replay`**（`m0 --replay`） | 逐行决策链（`src/cli.ts:887`→`src/agent/fork-cli.ts:80-184`），含每行 token（`:174-175`） | `agent_result` 那行不带 `spent_usd`（`:137-143` 只取 files/verified/summary）⇒ **回放里连 worker 的钱都看不见**；`routing_decision`/`surface_account`/`compaction` 一律「本行不做摘要」（`:177-178`）；没有合计 |
| **桌面层 IPC / 渲染** | 会话条 token 面板 `↑in ↓out`：**主会话那一只在渲染端算**，从流过来的事件现聚（`apps/desktop/src/renderer/App.tsx:252`→`projections.ts:149-159`；`App.tsx` **在隔壁手里**、`projections.ts` **干净**），组件 `components/TokenPanel.tsx:12-17` **干净**；**旁路会话（sidechat）那一只走 IPC 载荷** `{inputTokens,outputTokens,usageCount,compactionCount}`（类型 `src/main/ipc-protocol.ts:96` 干净、生产者 `src/main/agent-runner.ts:2685-2693` 在隔壁手里）——两个数不是同一处算的，别当一个读数读 | 面板写死 **`cost –`** 并注释「M2 无价格数据源」（`TokenPanel.tsx:2-4,14-15`）——而 `src/routing/pricing.ts:56-99` 与 `src/agent/orchestrator-join.ts:71-122` 里价格与美元**就有** ⇒ 这是「core 有数、UI 声称没数」的分叉，不是能力缺口。缓存桶/`model` 归因/`surface_account`/`routing_decision` 一概不上屏（全仓 `apps/` 内 `grep spent_usd|costUsd|表价|成本` = 0 命中） |
| **判卷门**（`scripts/gate-manifest.ts` 的 GATES，脏） | `cost-per-progress-check`（门名 `scripts/gate-manifest.ts:50`；`package.json:46`）印 token/前进比与「死跑成本」`spendAfterLastBoundary`（`scripts/cost-per-progress-check.ts:227-228`，语料 = 4 条**冻结 fixtures** `:29-34`，不是今天的会话）；`routing-check` 的 F 段印价表覆盖/占位行清单/合成真钱收敛（`scripts/routing-check.ts:271-337`，脏） | 两道门里都**没有美元**：前者是纯 token 尺，后者吃的是自己造的价注入（`:315-331`），不是任何一次真实 run 的钱 |
| **复跑面（需手动跑）** | `scripts/replay/run-scorecard.ts:401-403` 印「钱轴：$X / 不可测——原因」，`:396-399` 印 token 轴与缓存**缺报条数**；登记在 `scripts/replay-readings.ts:63-66`，取料 `outputs/` + 应用会话目录（`scripts/replay/corpus.ts:19`，脏）。`scripts/observe-surface.ts:164-190` 印逐轮装配账（字符，token 靠 `--factor` 现给，`:23-25`）。`scripts/prompt-cost.ts:177-192` 印每轮固定开销估算 | 钱轴是**语料级一个数**，不是 per-run/per-turn；每条流一行的明细那一段（`:464-475`）只有 写/拍/红/返工，**没有钱也没有 token** |
| **bench（唯一「一次真跑的实付」出口）** | `pnpm bench`→`scripts/loop-eval.ts:718-736` 印「实付≈¥…」「每达标任务 ¥…」「没算数的趟次花 ¥…」，单价来自 `EVAL_PRICE_IN`/`EVAL_PRICE_OUT` 两个 env（`:127-131`），缺任何一个 ⇒ 空着出声、不印 ¥0（`:724-728`）；逐行也带 `tok=in/out`（`:708`）；原始读数落 `outputs/<out>/readings.json`（`:737`），`pnpm eval-report` 出对照表（`scripts/eval/report.ts:180-253` 的模型归因面/身份闸） | 只有 CNY 一个合计 + 每达标任务；无缓存桶、无美元、无 `$/worker`。**该文件在隔壁手里**（脏）⇒ 今日工作树这一段不可作数 |
| **计量报告文件** | 无。`session-data/<key>/run-<runId>.json`（`src/agent/solpi-runtime.ts:152-156`）的读者只有两条判卷（`tests/solpi-runtime.test.ts:99-104`、`tests/session-tools.test.ts:370-378`） | —— |

**结论：不是一句「有数据无出口」能概括的，是三段式：**

1. **token**：有数据、有窄出口（CLI 逐轮行 + `--replay` 逐轮行 + 桌面 ↑in↓out + 两道门的合计）——但**任何出口都没有「本次 run 合计」那一行**。
2. **钱（美元/表价）**：只在 worker 回执那一个数上真正面向人（`src/cli.ts:475`）；主会话的钱**只进散文**
   （`src/agent/goal.ts:122,172`、`src/agent/orchestrator.ts:499`）；语料级钱轴要手动跑复跑面才有；bench 的钱要真拨号 + 手给单价。
   ⇒ 「有事件流、没有一条面向人的主会话美元出口」这一句成立。
3. **计量报告（字节/哈希/跨度/验证）**：**有数据无出口**（第 3 条，§3 末行）。
4. **路由轨迹**：**有数据无出口**（§2 第 5 条）。

---

## 4. 判卷钉的是接线还是纯函数

**两类都有，但「钱」这一格的要害处只有纯函数证人，接线证人集中在 worker 与落盘两处；「cost 恒 null」这一点没有任何证人。**

纯函数尺（自喂输入、挡不住装配缺位）：

- `tests/metering.test.ts:11-40`（**价格由测试自己灌** `:9,15` ⇒ 第 38 行的 `totals.cost` 与生产无关）；`:41-56` 桶/价缺报传播；`:107-148` `createOfflineComparison`。
- `tests/routing-pricing.test.ts:32-36`（价表覆盖）、`tests/prompt-cache-breakpoints.test.ts:111,126`（未标定清单，脏）、`tests/goal-price.test.ts:25-62`（`priceForModel → 价表 → usd>0` 一条链，含表外模型返 null）。
- `tests/cost-per-progress.test.ts:32,40`（含那条唯一读 `cacheReadTokens` 的断言）。
- `tests/replay-run-scorecard.test.ts:296`（名 → 价 → usd>0，跑在合成流上）。

接线证人（真跑、断言「数真的进了事件/汇总行」）：

- **worker 的钱进终态 + 进收队行**：`tests/worker-spent-usd.test.ts:170-190`——真起 `Orchestrator` + 替身 provider，
  断 `artifacts.spent_usd`（`:181`）、`price_calibrated`（`:182`）、收队行同一笔（`:186`），
  并有反向哨兵：冻结剧本 worker 三处都**不许**带 `spent_usd`（`:155-167`）。`shapeJoinRows` 那格还专门钉
  「被整批帽摘掉摘要的行仍带花费」（`:209-225`）。⇒ **这是这一格最像样的一只接线证人。**（文件在隔壁手里）
- **设置盘上的 requestMetering 到得了主会话、报告真落盘且有请求条数**：`tests/session-tools.test.ts:347-379`——
  真走 `handleAgentRun` × 2、stub fetch，断 `run-*.json` 恰好两份、`report.metering.totals.requests > 0`（`:376`）。
  **但不断言 `cost` 非 null**（第 1 条死值因此无人问）。⇒ 这一条是**真接线**证人，也是它把「计量只剩 worker 有」那族挡住的原因
  （对应锚点 `scripts/mutate-verify.mjs:5708-5712`，脏）。
- **缓存桶进事件而非只进 metering**：锚点 `scripts/mutate-verify.mjs:1327-1342`
  （`openai-cache-read-not-forwarded` 的 desc 就是「命中量只进 metering 不进事件 ⇒ UI/账本/回放/bandit 代价面看不见缓存」），
  宿主 `tests/provider-cache-usage.test.ts`（干净）⇒ **这一条判卷正是为了不让「计量面」变成私有账**。
- **盖章点在 append 之前、且全仓只此一处**：`tests/usage-attribution.test.ts:316-325` 行为面 + 源文本面双钉，
  `:343-348` 钉 worker 侧「价格标签与归因键同分支同式子」，`:236-310` 真起 orchestrator 验 `usage_model`
  随「拨不拨号 / 自述名 / 剧本」分岔，`:351+` 把「每个盖章点都有消费者」升级成全仓普查。⇒ 归因这一格钉的是接线，钉得实。
  （文件在隔壁手里）
- **两把美元闸吃同一把尺**：`tests/session-spend-ruler.test.ts:44-60,80`（真 orchestrator + 注入 budget，
  断「钱已过上限还放新 worker ⇒ 这道闸形同虚设」）。⇒ 主会话闸的**行为**有证人，但它的**读数**没有落盘面。
- **装配账落流 + fail-open + 投影不变**：`tests/surface-account.test.ts:89,236,242,267`（干净）。
- **goal 美元闸的实花进 `goal_stopped`**：`tests/goal-continue.test.ts:364`（脏）——但断的是**散文子串**
  `toContain("已花到（实花")`，不是字段 ⇒ 它钉住了「有数」，钉不住「机器能读」。

变异锚点（`scripts/mutate-verify.mjs`，脏；只点名不取值）：`:1304-1342` 缓存桶四支、`:2516/:2980` 收队行的 spent、
`:4025` `costUsd→0` 杀 bandit 真钱代价、`:4205` 价格标签退成对象、`:1187-1189/:1205/:1223/:1231` 成本闸单价与价键、
`:5708-5712` requestMetering 转发、`:7413-7495` 归因键/剧本枚举。⇒ 覆盖面不薄。

**判卷没钉住的那一格（本报告的结论性缺口）**：

- 没有任何证人要求「生产的 `beginRequest` 递了单价」或「`MeterRequest.cost`/`MeterTotals.cost` 非 null」。
  把 `src/providers/openai.ts:163` 那一行补上第三个参数、或不补，**现有全绿不变**——因为唯一断 `totals.cost` 的用例
  （`tests/metering.test.ts:38`）自己灌价，而唯一走生产路径的用例（`tests/session-tools.test.ts:376`）只看 `requests`。
  ⇒ 这正是本仓自己点名的「producer 有判据、consumer 零观测」形状（见 `tests/usage-attribution.test.ts:351-353` 那段自陈）的**反向实例**：
  尺在，喂尺的手没被钉。
- 没有任何证人要求「`run-*.json` 有人读」。落盘即算数（`tests/solpi-runtime.test.ts:102` 只断非 null，
  而**空 meter 封出来的对象本来就非 null**）⇒ 那条「证人」即使一份账都没记也绿。

---

## 5. 要让成本这一格真的可观测，最小缺口是哪块

按「改一处就多出读数」排序，每条带涉及文件与在飞状态。

**G1（最小、最便宜，且是其余几条的前置）：把单价递给 `beginRequest`。**
- 改点：`src/providers/openai.ts:163` 的第三参（价从 `src/routing/pricing.ts:56-99` 的表折来，换算注意
  `src/agent/metering.ts:5-12` 的互斥桶纪律：`inputTokens` 要**先剥掉**两个缓存桶——剥桶那一步已经有现成写法
  `src/providers/openai.ts:166-172`）。
- 状态：`src/providers/openai.ts` **在隔壁手里**（脏）；`src/agent/metering.ts`（HEAD 行号口径）也**在隔壁手里**；
  `src/routing/pricing.ts` **干净**。
- 必须同笔：一条接线证人（真走 `handleAgentRun`/GLM 那条 stub fetch，断 `report.metering.totals.cost` 非 null
  且 = 表价）+ 一支 mutate 锚点（把第三参摘掉 ⇒ 该用例红）。宿主候选：`tests/session-tools.test.ts`（脏）、
  `scripts/mutate-verify.mjs`（脏）。**不做这条，G2/G3 拿到的是恒 null 的账。**

**G2：给主会话的钱一个机器可读字段。**
- 最小形状：`UsageEvent` 加一个可选 `cost`（与 `model` 同样「缺席 = 不可定价，绝不折 0」），或新增一条 run 级
  汇总事件；盖章/算价点复用 `src/agent/orchestrator-join.ts:71-122` 那一把尺（**不要**再开第二份）。
- 状态：`src/events/index.ts` **干净**（但改联合类型要同笔 `KNOWN_TYPES`，`:671+`，以及
  `tests/event-registry.ts` 的取料口）；`src/agent/goal.ts` **干净**、`src/main/agent-runner.ts` **在隔壁手里**；
  出口那两侧 `src/cli.ts` / `src/agent/fork-cli.ts` 都**在隔壁手里**。
- 顺带把 `budgetEstimateUsd()` 与 `goalWindowSpend()` 现在丢掉的 `unpricedTokens`
  （`src/agent/orchestrator.ts:199` 只取 `.usd`；`src/agent/goal.ts:289` 同样只取 `.usd`；尺本身
  `src/agent/orchestrator-join.ts:105-122` 干净）出声，否则「算不出价的那部分」又是一格无观测面。

**G3：给 `run-<runId>.json` 一条面向人的读者 + 一条可达开关。**
- 现状两份：`requestMetering` 缺省 false（`src/main/settings.ts:121` 干净），CLI 无 flag、桌面面板白名单只有 5 键
  （`apps/desktop/src/renderer/components/SettingsPanel.tsx:46` 干净）⇒ 只能手改 `.agent/settings.json`。
  这条与 G1 是**乘积关系**：开关不可达 ⇒ 修好的账也没人生成。
- 读者形状建议照 `scripts/observe-surface.ts`（干净）的样子：一条读文件、印表、**零读数时显式出声**的面，
  登记进 `scripts/replay-readings.ts`（干净）以躲开 D-8 孤儿判据。
- 顺手把 §1.C 第 4 条（导出走 `exportJSON()` 而非 `JSON.stringify`，`src/agent/solpi-runtime.ts:156` 干净）
  与第 3 条（`recall` 那个恒零分类）一并收口，成本≈0。

**G4：把「摘要器花的钱」并回钱轴。**
- 改点：`scripts/replay/run-scorecard.ts` 的 `usageOfStream`（`:86-105`，干净）把 `compaction.usage` 也建一个桶
  （带 `compaction.model` 定价，缺则按 `price:null` 走「真实但算不出」那条既有分支 `:100-102`）；
  并把 `allUsage.cacheRead/cacheWrite` 真导出（`:312` 现算现丢，`:244-272` 结构体加两字段）。
- 全部涉及文件**干净**（`scripts/replay/run-scorecard.ts`、`src/agent/compaction.ts`、`src/events/index.ts`）⇒ 可以只做读侧，不碰生产端。

**G5：让路由轨迹面向人（第 9 条的「在效果和开销之间权衡」缺的就是这一屏）。**
- 最小改动：`src/agent/fork-cli.ts` 给 `routing_decision` 一行真摘要（picked/reason/from + 候选的档位），
  同时把钉住「不摘要」的那条判卷 `tests/cli-fork-replay.test.ts:150-154` 换向。
- 状态：`src/agent/fork-cli.ts` **在隔壁手里**；钉住「不摘要」的那条判卷 `tests/cli-fork-replay.test.ts` **也在隔壁手里**（脏）⇒ 这一笔要等两边都落定才谈得上改向。
- 若要真正可复盘「为什么抽中这一档」，bandit 后验要从原地覆盖改成**每次回灌留一条痕**
  （`src/agent/orchestrator.ts:1966` 脏；尺本身 `src/routing/bandit.ts` 脏）。这一块是本清单里唯一需要动状态存储形状的，
  建议排在 G1–G4 之后单独一笔。

**G6（桌面，收益最直接但被隔壁占着）：`cost –` 换成真读数。**
- `TokenPanel.tsx:2-4` 那句「M2 无价格数据源」已经不成立——`priceForModel/spentUsdFor/bucketsSpendUsd` 在
  `src/agent/orchestrator-join.ts:36-122`（**干净**），IPC 载荷只需扩 `{cost}` 与 `{inputTokens…}` 的缓存两桶
  （`src/main/ipc-protocol.ts:96` 干净 / 生产者 `src/main/agent-runner.ts:2685-2693` 在隔壁手里 /
  `apps/desktop/src/renderer/projections.ts:149-159` 干净 / `App.tsx` 在隔壁手里 / `TokenPanel.tsx` 干净）。
- 注意分层纪律：钱只在 `src/` 算，桌面只做投影（`scripts/desktop-boundary-check.ts`，未证：本笔没跑它）。
  另：今天 token 那两个数是**两处各算一遍**的（渲染端 `projections.ts:149-159` 管主会话、主进程 `agent-runner.ts:2685-2693` 管 sidechat），
  加 `cost` 时要把它们收到一处尺上，否则又会多出「限制类判据与它要限制的读数分叉」那一族（同 `src/agent/orchestrator-join.ts:97-104` 那段实测教训）。

**未证清单（缺哪一步才能写成事实）**

- 「`--replay` 里看不见钱」是**逐文件读出来的**（`src/agent/fork-cli.ts:137-143,177-178`）；但**没有真跑过任何一次 CLI**
  （纪律要求），所以「用户实际看到的终端输出长这样」这一格按 `renderEvent/formatReplay` 的代码事实读，未按实拍读数。
- mutate 锚点的**存活/被杀状态**全部未取：`mutate-verify` 明令不许跑。§4 里所有锚点只证「表里有这一条 + apply 文本对得上」，
  不证「今天真能杀红」。
- `requestMetering` 打开后**真实 provider**（非 stub fetch）下报告里到底有几笔、`elapsedMs` 分布如何：未证——要真拨号付钱，
  本笔没跑。
- 门表里 `cost-per-progress-check`/`routing-check` 今天的**耗时与绿否**：未证（不许跑门）。
- 桌面 IPC 是否另有我没扫到的通道把 `usage.model` 递上屏：按 `grep` 覆盖 `ipc-protocol.ts`/`projections.ts`/`App.tsx`/
  `components/*` 未命中，**未做全 `apps/` 逐文件复核**。
