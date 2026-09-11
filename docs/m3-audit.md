# M3 ponytail-audit（§16 纪律 5：从零自研最大的风险是给自己造抽象）

> 出具：M3c 收口轮（2026-09-12）。方法：对每个「对外声明但无消费路径」的抽象做 `grep -rn "<名>" src/ scripts/ tests/`，
> 命中只有声明点 = 无第二消费者。**处置三选**：删 / 保留待下里程碑用 / 记 BLOCKED。
> 本轮重点审 M3 新抽象（orchestrator 编排面 / worktree / sequencer / stuck / recovery）有无第二消费者；M2 audit 已关闭项不重复审。

## 一、审查方点名候选（任务书任务 9：orchestrator/worktree/sequencer 的新抽象）

### 1. `Orchestrator.pipelineSnapshot(callId)`（sequencer 只读快照）

- **审计结果**：声明于 `src/agent/orchestrator.ts`；消费者 = `scripts/agents-check.ts` N4e/N4e 快照断言 + `tests/m3c.test.ts`（快照冻结/verdict 断言）。**渲染侧零消费**（pipeline 链状态经 sequencer 状态 tool_result 落流，由通用 tool_result 卡投影，不另有面板）。
- **判定**：它是「stages 冻结、sequencer 状态只读呈现」（§4.4.7）的**验收面**——任务书硬指标 6「批准后 stages 变更请求被拒且落流」需要可观测的链状态。删掉等于删掉「冻结不可改」的可证性。
- **处置**：**保留**（验收面消费者在场，且不提供任何变更通道——只有 get 没有 set）。

### 2. `src/agent/sequencer.ts` 纯函数层（parseStages/BUILTIN_ROLES/concatStageTask/parseVerdict/dependsOnCycle/resolvePluginRole）

- **审计结果**：六个导出的消费者：parseStages/BUILTIN_ROLES/concatStageTask/parseVerdict → `orchestrator.ts`（runChain/resolveStageRole）+ `tests/m3c.test.ts` + `scripts/agents-check.ts`（静态零 LLM 扫描 N6b）；dependsOnCycle → `orchestrator.validateDependsOn` + 单测；resolvePluginRole → `resolveStageRole` + 单测。**单一生产消费者（orchestrator）+ 双验收消费者（check/test）**。
- **判定**：sequencer 从 orchestrator 拆成独立模块不是抽象造作——它承载「零 LLM」的结构性边界（agents-check N6b 对该文件整文件扫 provider 引用 = 0，拆文件使这条断言可写、可失败）。
- **处置**：**保留**。

### 3. `src/agent/stuck.ts`（detectStuck 纯函数 + StuckConfig）

- **审计结果**：消费者 = `orchestrator.ts`（evaluateStuck/recordStuckTurn/armStuckSilence）+ `tests/m3c.test.ts`（三规则单测）+ `scripts/agents-check.ts` N9（短阈值注入）。无第三消费者。
- **判定**：拆出的理由与 sequencer 同构——「检测器是纯函数（事件窗口 → verdict），可单测」（§4.4.8 定稿原文）需要 IO-free 模块边界；OrchestratorOptions.stuckConfig 的消费链（设置→阈值→检测）跨两文件。
- **处置**：**保留**。

### 4. `src/agent/recovery.ts`（interruptedWorkers/respawnArgsFrom）

- **审计结果**：消费者 = `src/main/agent-runner.ts`（applyCrashRecovery 会话重开扫描）+ `src/agent/orchestrator.ts:respawn`（RespawnArgs 类型）+ `tests/m3c.test.ts` + `scripts/agents-check.ts` N10。
- **判定**：扫描是纯投影（事件 → 无终态 worker 清单），落流与重派在调用方——「纯投影层模拟口径」（M3c 裁决 5）要求扫描可脱离编排器单测/直调。
- **处置**：**保留**。

### 5. `Orchestrator.respawn(args, ctx)`

- **审计结果**：消费者 = `src/main/agent-runner.ts:handleCardAction`（恢复卡「重派」按钮的 card_action 出口）+ `scripts/agents-check.ts` N10e + `tests/m3c.test.ts`。
- **判定**：respawn = spawn 的全参薄包装（约 10 行）——它存在的理由是「恢复卡重派 = 全新 agent_id 全参重 spawn」（§4.4.9）是一个**用户可达动作**而非模型工具面；不拆出来就得让 card_action 层手拼 SpawnArgs（协议细节泄漏进主进程接线层）。
- **处置**：**保留**。

### 6. `Orchestrator.appendProtocol`（M2e 既有，本轮新增第二消费者）

- **审计结果**：M2 引入时唯一消费者是 card_action 的事件回写；**M3c 新增第二消费者**：`tests/m3c.test.ts` 成本闸测试经 appendProtocol 注入 usage 事件驱动 sessionUsage 统计（与真实 emit 管线同路）。
- **处置**：**关闭**（第二消费者在场）。

### 7. `WORKER_COMPACTION_CONFIG`（§7.5 worker 压缩参数）

- **审计结果**：声明于 `orchestrator.ts`；消费者 = runWorker（compaction runtime 组装）+ `tests/m3c.test.ts`（ratio 0.95 参数独立断言）+ agents-check N11c。
- **判定**：「同一压缩器、参数独立」是 §7.5 的明文行为，必须有一个**具名常量**才能被断言（反向验证 ④ 即靠它红）。
- **处置**：**保留**。

## 二、自查补充候选

### 8. `Orchestrator.sessionUsage`（会话累计 usage）

- **审计结果**：写入 = 构造器 emit 包装（usage 事件累加）；读取 = budgetEstimateUsd/budgetBlocked（成本闸）+ `tests/m3c.test.ts`。主 loop 不受闸（V1 口径）——sessionUsage 只服务闸的估价，不做展示（token 面板走既有 projectTokenUsage 投影，两套口径并存但数据源同流）。
- **判定**：内存态聚合是估价需要（闸判定逐 spawn 调用，不能每次全量重放事件流）；与面板投影不冲突（面板可重建 = 事件流唯一事实源不破，sessionUsage 是**缓存**不是第二事实源——它由同一事件流累加而来）。
- **处置**：**保留**（记录于本审计，防后续被误读为双事实源）。

### 9. `Orchestrator.terminalWaiters/resolveTerminalWaiters`（sequencer 同步点）

- **审计结果**：写入侧 = waitForAgentTerminal（runChain 逐环等待）；解析侧 = finishInner（done/failed/cancelled 三分支）。**唯一消费者 = sequencer**。
- **判定**：这是「前环终态 → 后环继续」的进程内同步原语；替代方案（轮询 pipelineSnapshot）被 §4.5「无轮询调度器」明文排除。promise waiter 模式与 M3a 审批等待（pendingApprovals）同构。
- **处置**：**保留**。

### 10. `PipelineChain/PipelineChainStageState`（链状态结构）

- **审计结果**：写入 = runChain/failChain；读取 = pipelineSnapshot（验收面）+ chainTable（整链 tool_result 正文）。无渲染侧消费（链状态以 [sequencer] 文本落流呈现）。
- **判定**：同第 1 条——验收面 + 只读呈现的载体；无变更通道。
- **处置**：**保留**。

### 11. `filterWorkerTable/filterWorkerSpecs`（插件角色工具面双面裁剪）

- **审计结果**：消费者 = runWorker（执行表 + 模型规格同口径裁剪）+ `tests/m3c.test.ts` + agents-check N12h。两面一致是防「规格可见执行不可用」的明文要求（§9.6 映射的执行语义）。
- **处置**：**保留**。

### 12. `CompactionEvent.agent_id`（M3c 扩字段）与 `AgentResultEvent.artifacts.respawn`

- **审计结果**：agent_id → context.isWorkerCompaction（主投影隔离，消费于 projectContext/excludedIds）+ N11b 断言；respawn → 恢复卡渲染（renderer/main.tsx）+ handleCardAction(respawn) + N10c。两者均为 §3.4 契约增量的可缺省字段，旧日志零影响（A 段旧日志重放断言照常绿）。
- **处置**：**保留**（消费链完整：内核 → 投影/UI → 验收）。

## 三、删除项

无——本轮未发现「零消费纯声明」抽象（M2 audit 的删除纪律在本轮无对象；所有新抽象在引入的同一提交内即有验收/单测消费者）。

## 四、结论

- M3 新抽象 12 项候选全部「有真实消费路径」：内核消费者 + 验收脚本消费者 + 单测消费者至少两类在场；
- 唯一需要警惕的是 `sessionUsage`（缓存 vs 第二事实源）与 `pipelineSnapshot`（只读验收面），均已在本审计显式记录判定理由；
- 反向验证 4 条（PROGRESS.md M3c 段）证明这些抽象的断言面**可失败**——不是恒真式体检能漏过的装饰品。
