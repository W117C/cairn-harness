# goal 模式与 plan 模式：把两条「模型自愿才有」的能力变成用户可强制（2026-09-20）

范围：只改 harness。交付两件：**plan 模式**＝用户可强制的「先批后写」；**goal 模式**＝会话级长任务续跑 + 完成前证据审计。
两者都不新造能力，只把已发货的原语接到缺它的那条路上（本仓第 7 次同族：能力已发货、产品路径绕过它）。

前置阅读：`docs/superpowers/specs/2026-09-19-orchestration-design.md`（五条施工不变量、默认值分层、双指标口径、W2 留位）。本 spec 沿用其不变量，不重述。

## 0. 前提（沿用既有裁决，不重开）

- 只改 harness；模型侧不动。任何"更强"的宣称并列**准确率**与 **$/成功任务**。
- 默认值分层：零边际成本默认开；花真钱默认关，但同一批交付里必须给实测读数，不接受"留位待办"。
- 运行时注入工具三处同源（G-B，`src/agent/tool-surface.ts`）。本 spec 不新增注入工具（见 §4 说明）。
- 事件流是唯一事实源：新展示从流投影，live 与 replay 两条渲染路都要补。

## 1. 实测诊断（HEAD `8c5b62a`，每条附复跑口径）

| # | 事实 | 证据落点（file + 符号，用标签不用行号） |
|---|---|---|
| P1 | **方案门的"先批后写"只在模型自愿时成立。** 写禁的唯一来源是 `markPlanProposed()`，而它在生产路径上只有一个调用者——`propose_plan` 工具自己（`markPlanProposed` 的 src 命中：`src/tools/propose_plan.ts` 「propose_plan.run」）。用户侧没有任何入口能把会话置成"没批方案就不许写"；唯一约束是 `BASE_SYSTEM` 纪律 2 的一句话，而同一份提示词的纪律 6 已被真模型实测违背过一次（`src/permissions/autonomy.ts` 「judgeTarget」注释：「提示词自觉拦不住」⇒ 才加的判卷面硬闸）。复跑：`grep -rn "markPlanProposed" src/` | `src/permissions/index.ts` 「markPlanProposed」「planBlocks」；`src/main/agent-runner.ts` 「BASE_SYSTEM」 |
| P2 | **同一个判据在两份文件里被抄了五处**（实测命中 5）：`agent-runner.ts` 「runAgent」内两处 `s.autonomy.planBlocked = ps.proposed && !ps.approved` + 「sessionObj」同步点一处 + 「installAppTools」里 `isPlanBlocked`（remember 工具的门）一处，加上 `permissions/index.ts` 「planBlocks」一份。⇒ 新增"用户武装"时漏改任一处，就是"未批 plan 期间 `remember` 能写、`write_file` 不能写"这种裂口——`autonomy.ts` 里那句现成注释早已点明：**同一轮里两种口径就是这条规则的漏洞形状**。复跑：`grep -rn "proposed && " src/main/agent-runner.ts src/permissions/index.ts \| wc -l` → 5 | 同左 |
| P3 | **审批面其实齐了。** `plan_proposed`/`plan_approved` 事件、渲染卡（批准/拒绝按钮 + 决议后摘按钮）、`decidePlan` → `agent:plan` IPC、`handlePlanDecide`、拒绝后"写禁保持"的返回文案全在。**缺的只是让用户武装这道门**，不是再造一道门。复跑：`grep -n "plan_proposed\|plan-approve" src/renderer/app.js`；`grep -n "decidePlan" src/preload/index.ts` | `src/renderer/app.js` 「case 'plan_proposed'」；`src/agent/gates.ts` 「requestPlan」 |
| P4 | **会话级目标不存在。** `goal` 这个词在产品里只有三处：`propose_plan` 的入参、supervise 环的审批契约 `{goal,budget,forbidden,maxStages}`（**环内**作用域，链终态即弃）、记忆注入的 `CONTROL_TAG` 消毒名单。没有任何东西承载"这一会话要达成什么、还剩多少预算、做到第几轮"。复跑：`grep -rn "goal" src/` | `src/agent/supervisor.ts` 「SupervisorContract」；`src/agent/memory/inject.ts` 「CONTROL_TAG」 |
| P5 | **一轮结束 = 会话结束。** `runLoop` 在 `if (!sawToolCall)` 处收束，`maxSteps ?? 50` 是**单 run 内工具步数**，不是跨 run 轮数；run 结束后没有任何续跑驱动（定时任务走「makeScheduledExecutor」⇒ `handleAgentRun({unattended:true})`，一次触发一个 run，不自我续跑）。⇒ 长任务必须由人每轮手推。复跑：`grep -n "sawToolCall\|maxSteps" src/agent/loop.ts`；`grep -n "makeScheduledExecutor" src/main/agent-runner.ts` | `src/agent/loop.ts` 「runLoop」；`src/main/agent-runner.ts` 「makeScheduledExecutor」 |
| P6 | **修正拍的红要"下一轮"才能被模型看到，而"下一轮"今天要人手推。** 收束闸（`autoVerify`，缺省关）确实会在收尾前补跑一次 verify，但它**不影响收束**：补拍完立刻 `return`（`loop.ts` 「runLoop」的 `if (!sawToolCall)` 分支尾）。红进模型靠的是 `context.ts` 「autoVerifyNote」——文案原话是"**上一轮**收尾前系统补跑的 verify 未通过 ⇒ 先处理这条再继续新任务"，注入点是**下一次 `projectContext`**，也就是**下一个 run**。⇒ 修好这条红的通道建好了，消费它的轮次却不存在（除非用户自己再发一条）。worker 侧的同一判据早已升级成机器可查四态：`workerVerificationEvidence(events)`（`verified`/`stale`/`failed`/`absent`，`lastWrite > lastVerify ⇒ stale`），主会话从不读它。复跑：`grep -n "autoVerifyNote" src/agent/context.ts`；`grep -c "workerVerificationEvidence" src/agent/loop.ts` → 0 | `src/agent/context.ts` 「autoVerifyNote」；`src/agent/worker-report.ts` 「workerVerificationEvidence」 |
| P7 | **美元闸在主会话是惰性的。** `maxBudgetUsd` 缺省 0 ⇒ `budgetBlocked()` 恒不触发（`DEFAULTS` 里布尔项只有 `autoMemory`/`promptCache` 默认开）；`spent_usd` 只出现在 worker 终态与收队回执（`orchestrator-join.ts` 「spentUsdFor」），主会话每轮只有 `usage` 事件的 token 数。复跑：`grep -n "maxBudgetUsd\|routingBandit" src/main/settings.ts`；`grep -rn "spent_usd" src/main/` | `src/main/settings.ts` 「DEFAULTS」；`src/routing/pricing.ts` 「costUsd」 |

> P1/P4/P6 是同一条病的三面：**规划、验收、修正的原语都在，但① 没有用户可强制的入口，于是它们对模型不构成约束；② 没有"下一轮"去消费已经建好的修正通道。**

## 2. 设计总则（一句话）

**plan 模式＝把已有那道写禁的"武装权"从模型手里拿到用户手里；goal 模式＝把"继续干"这件事从人的手推变成带预算和证据审计的自动续跑。**

三条收口约束（防止本次交付变成新的病）：

1. **谓词只有一份。** 新增导出 `planGateBlocks(state)`，P2 列出的**五处**全部改读它（`permissions/index.ts` 「planBlocks」 + `agent-runner` 四处：`runAgent` 两处、`sessionObj` 同步点、`installAppTools` 的 `isPlanBlocked`）；判卷锁"除 `planGateBlocks` 外不得再出现该比较式"（§5 J1）。
2. **不冒充 W2。** 执行态账本（steps/status 的 ledger）仍是留位项；`goal` 只承载"目标 + 预算 + 第几轮 + 是否审计通过"，**不**承载步骤，也不与 supervise 的环契约合并——后者作用域是一条链，前者是一个会话，两者不同生命周期，混用会造出第二事实源（§4 边界段明写）。
3. **价格不可知时不得把美元闸当已生效。** `spentUsdFor` 返回 `null`（未校准价）时，`maxUsd` 是**惰闸**，续跑必须明写"美元闸无效，仅轮次闸生效"后按轮次闸停，而不是按 $0 继续烧（「把不可知记成免费」同族）。

## 3. P · plan 模式（用户强制先批后写，交互与无人值守同一口径）

- **数据面**：`PlanState` 加 `required: boolean`（缺省 false ⇒ 逐字等于今天的行为）。判据收成
  `planGateBlocks(s) = (s.required || s.proposed) && !s.approved`。
  只读档与三门工具不受影响（`isWriteCall`/`isSideEffectTool` 口径一字不改，MCP 未标 `readOnlyHint` 仍按写处理——那是 #43 刚立好的口径）。
- **武装点**：`RunRequest` 加 `planRequired?: boolean`；`runAgent` 入口在 `enterPlanRunScope()` 之后落一次 `markPlanRequired(true)`（与工具侧 `markPlanProposed` 同属 run 级 ALS 作用域，并发 run 不串台，沿用 P1（审查）已建立的隔离）。缺省取 `settings.planRequiredByDefault`（false）。
- **用户入口**：渲染层设置行「方案门：未批准即写禁」——复用 `data-setting` 的 `set-choice` 形状（与「权限默认模式」同族），写 `planRequiredByDefault`；会话内即时开关放 run-control（同一份值，不新增第二状态）。
- **无人值守**：**照同一口径生效**（写向工具被方案门拒绝，理由逐字进 `tool_result`）。不在 unattended 分支偷偷忽略用户的设置——那正是"收下字段但不读"的反面教材；今天 unattended 的 `ask` 本来就自动拒（`unattendedAskGate`），语义一致。定时任务表单不暴露该开关，避免用户没看见就把日程变成永不写盘。
- **成本**：关 = 零（只是谓词与一个布尔）；开 = 一次 `propose_plan` 往返——而 `BASE_SYSTEM` 纪律 2 已经每轮要求它，所以增量提示词为 0，只是从"自觉"变成"必做"。
- **不新增工具、不新增卡片、不新增审批通道**（P3：三样都在）。

## 4. G · goal 模式（带预算与证据审计的自动续跑）

- **新纯模块 `src/agent/goal.ts`**（零 I/O、零状态，可单测）：
  - `GoalSpec { objective: string; maxTurns: number; maxUsd: number }`，入参收窄 fail-visible（空目标拒；`maxTurns` 钳 `[1, 25]` 并在返回体写明钳制；`maxUsd<=0` = 美元闸关）。
  - `goalReminder(spec, turnNo, spent): string`——每轮起点注入的一小块静态段（目标原文 + 第 N/M 轮 + 已花 + 审计口径）。帽走 `clampToTokenBudget`，**整会话付费**按每轮重送估：`maxTurns=8` 时该段付 8 次，故原文帽登记为 token 并实测报数（不变量 3）。
  - `goalStopDecision({ turn, spec, spentUsd, priceKnown, evidence }): "continue" | "done" | { stop: 原因 }`——次序即优先级，逐条可测：
    ① `evidence === "verified"` 且模型本轮收束 ⇒ `done`；
    ② `turn >= maxTurns` ⇒ 停「轮次上限」；
    ③ `priceKnown && spentUsd >= maxUsd` ⇒ 停「美元闸」；`priceKnown === false && maxUsd > 0` ⇒ 明写"美元闸无效"并**只按轮次闸**继续计数（§2 约束 3）；
    ④ 否则 `continue`，续跑文案带"证据不绿（stale/failed/absent）"的具体态与最后一次红的来源。
- **审计谓词复用 W4b**：`workerVerificationEvidence(本会话事件)`（P6）。不新造第二份证据面；四态与 worker 回程口径同源，故主会话/worker/级联三处说的是同一件事。
- **状态 = 事件流**：新增一个事件类型 `goal_set { objective, max_turns, max_usd, ts }`（`KNOWN_TYPES` 增量；M4a 的三条 `automation_*` 就是先例，旧日志逐字可重放）。**只有这一条新事件**：续跑轮次、停止原因都从"该事件 + 其后 run 边界"重算，不写第二份会话态文件。
- **续跑驱动（main 侧）**：`runAgent` 收束后，若本 run 属 goal 会话 ⇒ `goalStopDecision(...)`；`continue` 则以合成 `user_message` 再入 `handleAgentRun`，直到 `done`/`stop`/取消。合成轮**不新增事件类型**：走 `UserMessageEvent.origin` 这条既有通道（M2f 的先例：「零新增事件类型——主流仍是 user_message，只多一个可选 origin 字段，重启后重放无损」），把 `PromoteOrigin.kind` 从字面量 `"sidechat"` 扩成 `"sidechat" | "goal"`（实测今天它是单一成员联合，扩成员即全量判据重算的入口）。**轮次号不进状态**：由"最后一条 `goal_set` 之后有多少条 `origin.kind==="goal"` 的 user_message"投影出来（不变量 2）。取消沿用 `interactiveRunAbort`；停止原因每轮上屏，不静默结束。
- **入口**：输入区折叠块「目标 + 轮次上限 + 美元上限」→ `agent:goal-set` IPC → preload；`goal_mode` 开关位缺省关（花真钱）。
- **与 supervise 的边界**：`SupervisorContract` 的 `goal/budget/maxStages` 仍是**一条链**的审批契约，链终态即弃；会话 goal 跨链存活。两者只在"审计通过才算完成"这一条上共用谓词，不共用状态。

## 5. 判据与验收（每条都有反向对照）

| # | 断言 | 落点 |
|---|---|---|
| J1 | 谓词单一来源：`src/` 内除 `planGateBlocks` 外不得再出现 `proposed && !s.approved` 形状的比较式（静态扫描测，锁 P2 不再复发） | `tests/plan-required.test.ts` 内一条静态断言 |
| J2 | 用户武装后：写向工具被拒且理由含"方案门"；`propose_plan` 仍可调用；批准后放行；拒绝后保持写禁；`required=false` 时行为与今天逐字相同（零回归） | 同上，逐条 |
| J3 | unattended + `planRequired` ⇒ 写向被拒（**不是**被忽略） | 同上 |
| J4 | `goalStopDecision` 五路：verified→done / 轮次上限 / 美元闸 / **价未校准时美元闸惰且明写** / stale+failed+absent 三态各一条 `continue` 文案 | `tests/goal-stop-decision.test.ts`（纯函数） |
| J5 | 续跑端到端（注入 mock 模型剧本，不依赖真模型）：一轮收束无绿证据 ⇒ 自动续跑到 `verify_result(ok:true)` 后 done，事件流里 `goal_set` 恰一条、合成轮 `origin` 可投影；达 `maxTurns` ⇒ 停且原因上屏；`interactiveRunAbort` 中途取消 ⇒ 不再起新轮 | `tests/goal-continue.test.ts` |
| J6 | 渲染层：live 与 replay 两条路都出 goal 芯片（`goal_set` 投影）；`panels-check`/`renderer-arch-check` 不因此红 | `tests/renderer-run-control.test.ts` + 现网探针 |
| J7 | 变异锚点 ≥6 条：`planGateBlocks` 的 `required` 项被摘 / `||` 被换成 `&&`；三处赋值点回退成手写副本；`goalStopDecision` 的证据闸被摘（恒 `done`）；轮次上限被摘（永不停）；`priceKnown` 反向（把不可知当免费）；`goalReminder` 帽被摘 | `scripts/mutate-verify.mjs`（独立一笔提交） |

**实测读数（G 的"值不值"，交付同批给出，缺读数字即不算完成）**：
用 `fixtures/mock` 确定性剧本跑 A/B——同一任务、同一模型，关 vs 开，报**完成率、run 轮数、input/output token、按现价折算的美元**，`$/成功任务` 并列。真模型（GLM）至少一条同任务读数；无 key 时该条如实标"未证"，不写进"已证"。

## 6. 影响面与并发窗口（施工前排雷）

- **本仓正在被另一会话占着的表面**（2026-09-20 实测 `git status -uno`）：`src/main/agent-runner.ts`、`src/permissions/autonomy.ts`、`src/agent/orchestrator.ts`、`src/frozen.ts`、`src/agent/gym/runner.ts`——其原子簇＝"判卷面硬闸接进 worker/主会话"。
  本 spec 的 P 与 G **都要动前两处**（三处赋值点、`runAgent` 入口、`evaluate` 的方案门）。
  ⇒ 施工改道 worktree（`.worktrees/goal-plan` + `ln -sfn <主树>/node_modules node_modules`），或等该簇落地；**不在主树上叠**（AGENTS.md 相交检查）。
- 新事件类型 ⇒ 触 `src/events/index.ts` + `KNOWN_TYPES` + 两套渲染器投影（`app.js` 的 live 与 `history-window.js`/replay）——这是本 spec 唯一一处"要动渲染层"的必然代价，且它正是不变量 2 的兑现方式（不是第二份状态文件的替代品）。
- `tool-surface.ts`（G-B）本轮不动：P/G 都不新增运行时注入工具（`propose_plan` 已在静态 `TOOLS` 键域）。若实现中途想加 `set_goal` 让模型自设目标，**停**：那是把武装权又交回模型手里，与 P1 的立项理由直接冲突。

## 7. 留位（明确不做，不偷做）

- 让 goal 自动拆步 / 自动改预算（"动态重规划"）：需要 W2 执行态账本落地后才有事实源可读，本轮不做。
- goal 跨会话续跑（重启进程后接着跑）：`goal_set` 已在事件流里，具备重放条件，但续跑驱动绑在交互 run 生命周期上，先不接。
- 计划批准后自动按 plan 逐条核对完成度：属 W2 + 判据面，留位。
- 美元闸接入真价校准：`pricing` 表价仍标"待校准"，本 spec 只做"未校准 ⇒ 明写惰闸"，不假装已生效。
