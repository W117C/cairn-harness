# M3 验收总对表（三态：已证 / 未证 / M4）

> 出具：M3c 收口轮（2026-09-12）。对表对象：`agent-plan.md` §14 M3 行 + §4.4.11 实施序 1–5 + §4.4.7 V1 范围收敛 + §4.4.8 卡死/闸门 + §4.4.9 崩溃恢复 + §4.5 依赖链 + §7.5 worker 压缩 + §9.11-4 + §11.6 M3 范围。
> 每行带**证据指针**（脚本名 + 断言编号:行号 / 文件:行），审查方可按指针复跑。
> 三态口径：**已证** = 有可复跑的断言；**未证** = 断言没跑到（环境/凭据限制），**不等于通过**；**M4** = 方案明确的后续里程碑欠账，不许在 M3 偷做。
> 复跑口径：`pnpm gates`（20 道门逐道退出码 + 恒真式体检）；M3 主断言面 = 第 20 道门 `pnpm run agents-check`（A–M + N 压力段，**233 断言**）+ `tests/m3c.test.ts`（23 项）。
> M3 分三轮交付：M3a（编排原语 + read mode，HEAD 8fb73f4）→ M3b（write mode/worktree/合并控制塔/gate 模式，HEAD 3431e72）→ M3c（依赖链 + pipeline sequencer + 卡死/成本闸/崩溃恢复 + 压力验收，本轮收口）。

## 一、§14 M3 行验收标准（2 条 + 任务书补强 2 条）

| # | 标准 | 状态 | 证据指针 |
|---|---|---|---|
| 1 | 指挥官同时调度 ≥3 worker 并行干不同性质的活（写+读+审查） | **已证** | `scripts/agents-check.ts` N1–N2（write worker + read worker + pipeline(implement=write→review) 三路同时 running：`hang.size === 3` + `activeCount() >= 3`）；N2c（write worker 可写根 = worktree，agent_spawned 记 worktree）；N3d（write worker 产 diff 快照 = 真实写产出） |
| 2 | gate 模式生效且 worker 可写根 = worktree | **已证**（M3b） | gate 三档：`scripts/agents-check.ts` K1–K5（off 零行为 / report 只标 / gate 红标 + 第一次合并拒绝 + force=true「仍要合并」二次确认 + LLM 跳过显式）；可写根 = worktree：H1–H5（worktree 创建/base_commit/symlink 降级）+ I 段（可写根内 git 破坏命令全拦）+ J 段（合并唯一出口 = git 面板，`--no-ff` 主分支前进） |
| 3 | 中途取消（任务书 §2.7 补强） | **已证** | `scripts/agents-check.ts` N3–N3c（三路并行中取消 read worker → cancelled 落终态；兄弟 write done 不受影响；M3a E 段另有单取消/全树取消/重放无损） |
| 4 | 杀进程重启恢复（任务书 §2.5 补强） | **已证**（投影层模拟 + 真实代码路径） | `scripts/agents-check.ts` N10（无终态 worker 扫描 → `failed(reason=interrupted)` 落流 + 恢复卡载荷 artifacts.respawn（原 spawn 参数）+ 补发幂等 + 重派跑通且全新 agent_id）；截图：`docs/m3c-recovery.png`（真实 kill -9 进程 → 重开应用 → 恢复卡，见任务 11）；实现 `src/agent/recovery.ts:interruptedWorkers/respawnArgsFrom` + `src/main/agent-runner.ts:applyCrashRecovery/handleSessionOpen` |

## 二、§4.4.11 M3 内部实施序（5 步）

| # | 实施序项 | 状态 | 证据指针 |
|---|---|---|---|
| 1 | spawn_agent 原语 + 子流事件 schema + 审批事件协议 + read mode | **已证**（M3a） | `scripts/agents-check.ts` A 段（事件契约 + 旧日志重放无损）/B 段（spawn 纪律）/C 段（read 闭环 + 主上下文零转录泄漏）/D 段（审批解耦） |
| 2 | 多 agent 面板投影 + 取消链 | **已证**（M3a） | 同脚本 E 段（取消链）+ F 段（usage 按 agent 归因）；面板 `src/renderer/panels/registry.tsx`（agents 面板 7 列）+ `src/renderer/projections.ts:projectAgentPanel` |
| 3 | write mode：worktree 生命周期 + 写租约表 + diff/合并卡 + git 破坏命令拦截 | **已证**（M3b） | 同脚本 H 段（worktree 生命周期四路清理）/I 段（写租约 + git 破坏拦截）/J 段（合并控制塔）/K 段（gate）/L 段（绝对行号） |
| 4 | depends_on 依赖链 + 卡死检测 + 闸门（独立 pipeline sequencer 见 §4.4.7） | **已证**（M3c） | 依赖链：同脚本 N7（延迟登记/无 callId 拒绝/前环 cancelled → dependency_failed 不静默/前环 done → 后环自动 spawn 事件驱动 + depends_on 记录）；环检测纯函数 `src/agent/sequencer.ts:dependsOnCycle` + `tests/m3c.test.ts`；卡死检测：N9（短阈值 silenceMs → waiting_input(stuck) + 提醒 + resume 出口 + 幂等闸）+ 三规则纯函数 `src/agent/stuck.ts:detectStuck`（`tests/m3c.test.ts` 规则一/二/优先级）；闸门：max_turns（M3a C 段既有）+ maxBudgetUsd 成本闸 N8 |
| 5 | 压力验收：≥3 worker 并行（写+读+审查）+ 中途取消 + 杀进程重启恢复 | **已证**（M3c） | 见本表一之 1/3/4 行 |

## 三、§4.4.7 pipeline sequencer V1 范围收敛（P20 逐项）

| # | 范围项 | 状态 | 证据指针 |
|---|---|---|---|
| 1 | 确定性 sequencer（零 LLM 调用，约百行） | **已证**（静态+动态双证） | 静态：`scripts/agents-check.ts` N6b（sequencer.ts 零 provider/模型/摘要器引用）+ N6c（runChain 源码段零 provider/摘要器）；动态：N6（modelFor 调用恰 = 环数 4——write+read+两 stage，展开路径零额外模型调用） |
| 2 | stages 展开为逐环 spawn；前环 agent_result.report 由**代码**拼进后环 task | **已证** | N4（整链 done）+ N4b（后环 depends_on 前环）+ N4c（后环 task 含 `[harness] 前环 <agent_id> 的 agent_result.report` + 前环报告正文——代码拼接非模型转发）；拼接实现 `src/agent/sequencer.ts:concatStageTask`（8000 字符截断帽） |
| 3 | stages 在审批卡批准后冻结（sequencer 不可被模型改向） | **已证** | N1c–N1d（整链一个审批，审批卡展示 stages 全表）+ N5（批准后同 callId 变更请求被拒 + `[sequencer] stages 变更请求被拒` 落流）；冻结实现 `parseStages`（Object.freeze 双层）+ `spawn()` 冻结闸；N4e（快照 stages `Object.isFrozen` 可重建） |
| 4 | V1 只做 depends_on + 内置角色模板 sugar | **已证** | 内置角色 implement(write)/review(read+gate)/test(read+gate)：`src/agent/sequencer.ts:BUILTIN_ROLES` + `tests/m3c.test.ts`（角色面断言）；gate/loopback 重跑未做（V1 明文不做，见本表七之 3） |
| 5 | gate 环只落 verdict 标注，不重跑 | **已证** | N4d（`[sequencer] gate verdict=pass` 标注落流）+ N4e（快照 verdict 可重建）；verdict 解析 `src/agent/sequencer.ts:parseVerdict`（锚定行首防正文误伤 + 大小写归一——M3c 真缺陷修复） |
| 6 | 自定义角色走 plugin 内容类型（§9.6 映射） | **已证** | 见本表六（§9.11-4 行）；映射实现 `src/agent/sequencer.ts:resolvePluginRole` |
| 7 | 整链终态：任一环 failed → 整链 failed + 各环报告可见 | **已证** | 实现 `src/agent/orchestrator.ts:runChain/failChain`（failChain 将 pending/running 环全部置 failed + 各环报告在链表 tool_result 可见）；单测 `tests/m3c.test.ts`（spawnStage 失败路径经 failChain 断言链表可见） |

## 四、§4.4.8 卡死检测 + 闸门

| # | 定稿项 | 状态 | 证据指针 |
|---|---|---|---|
| 1 | 三规则：同 action+同 observation ×4、同 action+error ×3、静默 >10 分钟 | **已证** | 纯函数 `src/agent/stuck.ts:detectStuck`（`tests/m3c.test.ts`：规则一 ×4 触发 ×3 不触发 / 规则二 ×3 触发 + 规则一优先 / 动作观察变化不触发）；静默规则：`scripts/agents-check.ts` N9（silenceMs 短阈值 → stuck） |
| 2 | 数据源 = 子流 tool_call/tool_result 天然时间戳（不造心跳） | **已证** | 实现：`src/agent/orchestrator.ts:workerPipeline`（armStuckSilence = 每事件刷新计时器；recordStuckTurn = call 配对成 StuckTurn 滑动窗口）；零新心跳事件（事件契约 §3.4 无新增类型） |
| 3 | 检测器是纯函数（事件窗口 → verdict），可单测 | **已证** | `src/agent/stuck.ts`（无 IO 无状态）+ `tests/m3c.test.ts`「M3c 卡死检测纯函数」3 项 |
| 4 | 触发 → waiting_input(reason=stuck) + 提醒落流；人决定继续/取消 | **已证** | N9（waiting_input(stuck) + `[stuck]` 提醒复用 agent_message，不新增卡片类型）+ N9c/N9e/1036（resume 出口 + 幂等闸）+ 取消走既有取消链（`tests/m3c.test.ts` 静默超时 + cancelAgent → cancelled） |
| 5 | 阈值可配（验收用短阈值） | **已证** | `OrchestratorOptions.stuckConfig`（N9 注入 `silenceMs: 150`；N1 压力块用缺省 10 分钟全程零误伤） |
| 6 | 会话级 maxBudgetUsd 可选设置：按 usage 累计 × 可配单价估算，超限拒绝新 spawn 并落流 | **已证** | 设置字段：`src/main/settings.ts`（maxBudgetUsd/budgetPricePerMTok，缺省 0 = off）+ 设置页 UI `src/renderer/main.tsx`（data-m3c-budget-section）；闸：`src/agent/orchestrator.ts:budgetBlocked/budgetEstimateUsd/rejectOnBudget`；断言 N8（缺省零行为 / 单价 0 无效化 / 超限拒绝 + `[budget]` 落流警告）；主 loop 不受闸（V1 口径：闸只拦编排扩张 = spawn 入口统一校验） |

## 五、§4.4.9 崩溃恢复

| # | 定稿项 | 状态 | 证据指针 |
|---|---|---|---|
| 1 | 重启重开会话 → 扫描无终态事件的 worker → failed(reason=interrupted) + 恢复卡 | **已证** | `scripts/agents-check.ts` N10（扫描命中 / `failed(reason=interrupted)` 落流 / 恢复卡载荷 artifacts.respawn / 幂等）；UI：恢复卡渲染 `src/renderer/main.tsx`（data-m3c-recovery-card，reason=interrupted + respawn 载荷 → 恢复卡形态）；扫描 `src/agent/recovery.ts:interruptedWorkers`（纯函数，`tests/m3c.test.ts`） |
| 2 | 「重派」= 全新 agent_id 按原 spawn 参数再 spawn；V1 不做热恢复 | **已证** | N10e–N10f（respawn 受理 + 全新 agent_id + done）；实现 `src/agent/orchestrator.ts:respawn` + `src/main/agent-runner.ts:handleCardAction(respawn)`（card_action 出口）；无 transcript resume（代码零 resume 路径） |
| 3 | write worker 旧 worktree 走孤儿列表（不自动删） | **已证**（M3b） | `src/agent/worktree.ts:orphanWorktrees` + git 面板「孤儿 worktree（可清理 · 不自动删）」+ `scripts/agents-check.ts` J 段拒绝清理断言；恢复卡文案显式指向孤儿列表 |

## 六、§4.5 依赖链 + §9.11-4（M2 移交欠账闭合）

| # | 定稿项 | 状态 | 证据指针 |
|---|---|---|---|
| 1 | depends_on: [agent_id]；前环 done 事件自动触发后环 spawn（事件驱动，无轮询调度器） | **已证** | `scripts/agents-check.ts` N7（延迟登记 deferred 应答 / 无 callId 拒绝 / 前环 cancelled → 后环 dependency_failed 落流不静默 / 前环 done → 后环自动 spawn + agent_spawned 记 depends_on）；实现 `src/agent/orchestrator.ts:deferredSpawns/resolveDependents/triggerDeferredSpawn`（finishInner 终态解析，零轮询） |
| 2 | 终态裁决：前环 done 才触发；failed/cancelled → 后环 failed(reason=dependency_failed)；成环/跨会话/不存在拒绝 | **已证** | `src/agent/orchestrator.ts:validateDependsOn`（存在性/环 DFS/终态裁决三段）+ `src/agent/sequencer.ts:dependsOnCycle`（三色 DFS，菱形非环）；`tests/m3c.test.ts`（环/自环/菱形 + 跨会话拒绝 + dependency_failed）+ N7c/N7d/N7e |
| 3 | pipeline mode = 预置链（后环 depends_on 前环 sugar） | **已证** | `src/agent/orchestrator.ts:runChain`（后环 stageArgs 带 depends_on = [前环 agent_id]，§4.5 预置链）+ N4b |
| 4 | §9.11-4：agents/*.md 被编排采纳——stages[].role 引用插件角色，经 depends_on sugar 跑通一环 | **已证**（M3c 闭合，M2 移交欠账清账） | `scripts/agents-check.ts` N12（真实 fixture `fixtures/plugins/project/pipeline-crew` 经 `PluginRuntime.findAgentRole` → stages[].role → 整链跑通：正文进 system 首块 / 工具面按 frontmatter.tools 白名单裁剪（表外工具不可达）/ frontmatter.maxTurns 采纳 / CC 不支持键（hooks/mcpServers/permissionMode）忽略 + 警告落流 / isolation=worktree → write mode 可写根 = worktree）；解析面 `src/agent/plugins/index.ts:agentRoles/findAgentRole` + `src/agent/sequencer.ts:resolvePluginRole`（§9.6 映射）+ `src/agent/orchestrator.ts:filterWorkerTable/filterWorkerSpecs`（规格/执行双面裁剪，裁空 fail-visible） |

## 七、§7.5 worker 压缩

| # | 定稿项 | 状态 | 证据指针 |
|---|---|---|---|
| 1 | 同一压缩器实例化、参数独立配置（worker 触发更晚：ratio 0.95） | **已证** | `src/agent/orchestrator.ts:WORKER_COMPACTION_CONFIG`（ratio 0.95，与主会话 DEFAULT 0.9 同族独立）+ runWorker 经同一 `runCompaction`（`tests/m3c.test.ts` 参数独立断言 + `scripts/agents-check.ts` N11c auto 阈值路径触发）；静态证 N11f（orchestrator 走 runCompaction、六段模板字面零复制 = 无第二套摘要实现） |
| 2 | keep_first 映射 = task 任务书 + context 交接 | **已证** | 结构性保障：worker 的 task/context 在 buildWorkerSystemMessages 产物（每轮原样前置、永不进子流事件投影，压缩只作用于事件）；`tests/m3c.test.ts`（压缩后一轮模型消息含任务书原文 + 摘要 envelope + 被压原始事件已摘除） |
| 3 | 压缩摘要调用计入 usage(agent_id) | **已证** | `scripts/agents-check.ts` N11d（usage 事件带 agent_id 且含摘要调用 tokens）+ N11e（agent_result.usage 汇总含摘要调用） |
| 4 | 压缩事件落 worker 子流（agent_id 归因）；主投影隔离 | **已证** | N11b（compaction 事件带 agent_id 落流）；主投影隔离：`src/agent/context.ts:isWorkerCompaction`（worker 压缩事件不参与主投影排除集/摘要注入——其 compressed_event_ids 是 worker 内存态序号）+ `tests/m3c.test.ts`（主上下文零注入 + 主事件不被误摘） |
| 5 | 压缩是 max_turns 之后的第二道防线 | **已证**（顺序结构性） | worker 触发顺序：runLoop max_turns 在先（M3a 闸门），压缩挂每轮组装前（`src/agent/orchestrator.ts:maybeCompactWorkerEvents`）；ratio 0.95 > 0.9 确保主/子会话同规模下 worker 更晚触发 |

## 八、§11.6 M3 范围（产出代码安全 gate 模式，M3b 交付）

| # | 范围项 | 状态 | 证据指针 |
|---|---|---|---|
| 1 | gate 模式：critical|high → 合并卡红标 +「仍要合并」二次确认（不硬禁，合并权在人） | **已证**（M3b） | `scripts/agents-check.ts` K3（第一次合并拒绝 / `[gate]` 红标注记落流 / worktree 保留 / gate-confirm 投影可重建）+ K4（force=true 合并成功）+ K5/K5b（LLM 审查跳过显式 / llm_reviewed 与 key 在场性一致） |
| 2 | LLM 两段流水 + FP 过滤（P22 降 M3 项） | **已证**（M3b） | `src/agent/security/llm-review.ts`（BYOK 非流式单轮 + 严格 schema + 输出扫描）+ `filterFalsePositives`（`tests/m3b.test.ts`）；无 key 显式打印跳过（K5） |

## 九、未证 / 留位清单（M3 收口后仍开放的口）

| # | 项 | 状态 | 说明 |
|---|---|---|---|
| 1 | 真 LLM 驱动的全链 pipeline（非 scripted 模型） | **未证**（无 M0_API_KEY 环境口径） | agents-check 暗卷段（M 段）与 M3a/M3b 同口径缺席跳过；结构断言（零 LLM/冻结/拼接/verdict）均为模型无关判据，真实模型只在「报告带 verdict 行」这一 prompt 语义上依赖内置角色提示词 |
| 2 | gate/loopback 重跑机制 | **已证**（M5c §m5-proposal 步骤 13 闭合） | 证据指针：`scripts/supervisor-check.ts` 段 B（B1 永远 fail → 第 6 环后必 abort / B2 同 (role, task-hash) 第 3 次 → escalate）+ 段 A（封闭枚举 + 畸形 escalate）——V1 纯规则受限 Supervisor（src/agent/supervisor.ts）落地「失败不触发系统级反应 → 触发有界重试/升级/中止」；编排器运行时接线（supervise 模式 + 审批卡双轨）留 M6（见 m5-acceptance 未证/留位节） |
| 3 | 崩溃恢复的「热恢复」（transcript resume） | **V1 明文不做**（§4.4.9） | 重派 = 全新 agent_id 全参重 spawn（N10f） |
| 4 | 会话中途切换成本闸的动态生效 | **V1 口径** | maxBudgetUsd 为设置项，编排器逐 run 实例化时读取；run 中途改设置下一 run 生效（设置页文案已说明） |
| 5 | 跨会话聚合审批队列（§10.4 M3 正式化） | **部分** | M3a 备案 4：worker 审批仍走对话流 card_action，approvals 面板聚合主会话 IPC 审批；M3c 未扩展（任务书未列） |

## 十、收口基线（2026-09-12）

- `pnpm gates`：**20/20 绿 + 恒真式体检零命中 + exit 0**（逐道退出码见 PROGRESS.md M3c 收口段；TERM=dumb 实测）。
- test：**40 files / 357 passed / 0 skipped**（M3b 基线 334 → +23，只增不减）。
- agents-check：**233 ✅ / 0 ❌**（M3b 165 → +68，只增）。
- 冻结判卷 sha256 3/3 逐字一致；`scripts/frozen-sha256.json` 本体 sha256 = `9b7f44f9…8c4ba` 逐字节未改。
