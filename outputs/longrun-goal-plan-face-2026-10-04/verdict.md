# 长程规划与任务分解：goal / plan 两格在 HEAD 的守势取证

日期：2026-10-04 ｜ 度量对象：HEAD `19dfa23c9dddfba81f734002ee81f061e544a7da`
性质：只读取证，未跑判卷 / typecheck / 任何 `scripts/*-check.ts` 门 / mutate-verify。

## 取料纪律与清洁度（先声明，否则行号不可用）

`git diff --numstat HEAD -- src/agent/loop.ts src/agent/compaction.ts src/agent/goal.ts src/agent/goal-trace.ts src/agent/context.ts src/main/agent-runner.ts src/permissions/plan-state.ts src/tools/propose_plan.ts` ⇒ **空输出**：这八个主证据文件工作树逐字等于 HEAD，下面引的行号两面通用。

以下文件**在飞**（别的会话未提交），行号按 HEAD 面引，用 `git show "${rev}:path"` 现读（`rev` 必须带 `${}`，zsh 里 `$rev:path` 会被当 git 修饰符）：
`src/agent/orchestrator.ts`、`src/agent/glm-session.ts`、`scripts/compaction-check.ts`、`tests/compaction.test.ts`、`tests/goal-continue.test.ts`、`tests/goal-trace.test.ts`、`tests/plan-required.test.ts`、`tests/plan-gate.test.ts`、`src/cli.ts`、`src/agent/system-prompt.ts`。
全仓此刻 161 条脏项（`git status --porcelain | wc -l`），与本文判定无关。

探针分辨力负控（每次说「不存在」之前都配一条）：
- 同一 path 集里找已知在场的词：`plan_proposed` 命中 `src/agent/compaction.ts:143,154,204`；`user_message` 命中 `src/agent/plugins/index.ts:89,100`。⇒ 该 path 集的 grep 确实在读这些文件。
- `userMessageSkill` 命中 `src/agent/loop.ts:34,155,363` + `src/main/agent-runner.ts:1793`。⇒ skill 那一族的探针有分辨力。
- `无可压缩事件` 同时命中 `src/agent/compaction.ts:719` 与 `scripts/prefix-churn-check.ts:122`。⇒「抛句/门句在 src 有、在 tests 没有」这种读法成立。

---

## 问 1：状态存哪

### goal —— 唯一事实源 = append-only 事件流（盘上 JSONL），**没有**第二份会话态

类型定义：`src/events/index.ts:512-515`（`goal_set`）、`:698`（`KNOWN_TYPES` 登记）、`:27-28`（`user_message.origin.kind === "goal"` 的轮次记账字段，注释明写「只作展示记账，续跑判定不信它」）。

**写点（4 类，全走 `emitGoalEvent` 这一颗出口）**
- `src/main/agent-runner.ts:2277-2283` `handleGoalSet`：人武装/改设目标的唯一写入面（IPC `agent:goal-set`）；越界值先经 `src/agent/goal.ts:68-101` `parseGoalSpec` 钳制并逐条点名 `clamped`。
- `src/tools/refine_goal.ts:47-55`：模型改措辞，落同一条 `goal_set` 但带 `set_by:"model"`，且**逐字继承** `max_turns/max_usd`（`src/tools/refine_goal.ts:40-43`：没有已武装目标就直接拒）。
- `goal_stopped` 四处：`src/main/agent-runner.ts:2228-2229`（判据停）、`:2200-2205`（无人值守拒续 #53）、`:2266-2272`（用户清除）、`:2159-2160`（硬上限强停）。
- 落盘出口：`src/main/agent-runner.ts:2172-2175` `emitGoalEvent` → `createEventLog(logPath).append`；`logPath = pathOf(requireSessionsDir(), sessionId)`（`src/main/agent-runner.ts:2068`、`src/main/sessions.ts:260`、`src/main/session-handlers.ts:40`）。`src/cli.ts:278` 另点名 `--log` 与 `goal_set` 落盘分叉这一格。
- 续跑轮那一条：**不是** goal 专属事件，而是一条 `user_message` —— `src/main/agent-runner.ts:2232-2237` 造 `goalReminder(...)` 文本 + `origin:{kind:"goal",turn,max_turns}`，经 `:2114` `goalTurn` → `:1794` `userMessageOrigin` → `src/agent/loop.ts:360-366` 落进流。

**读点**
- `src/agent/goal-trace.ts:69-73` `traceGoal`：全量重算的 reduce（`:42-65` 是 `step`）。
- `src/agent/goal.ts:239-253` `projectGoal`：`window = events.slice(trace.at + 1)`，证据/写盘/花费同轴取这一段。
- 消费方：`src/main/agent-runner.ts:2190`（判据）、`:2158`（强停路径）、`:2263`（清除）；渲染层芯片与判据读同一份 reduce（`src/agent/goal-trace.ts:1-7` 的立文件理由）。
- 不变量写在码上：`src/agent/goal.ts:235-238`「一律从事件流重算，live 与 replay 同一份函数……不写第二份会话态」。

### plan —— **劈成两半**，一半在盘上一半只在内存

- **门布尔**（`{required, proposed, approved}`）：`src/permissions/plan-state.ts:8-16`，实体是模块级变量 `:26` + run 级 `AsyncLocalStorage` `:30`。**内存态，不落盘、不进事件流、不进事件投影。**
  - 写点：`enterPlanRunScope` `:34-36`（生产接线 `src/main/agent-runner.ts:1598`，`required` 取自 `:2113` `planRequired ?? settings.planRequiredByDefault`）；`markPlanProposed` `:58-61`（唯一生产调用者 `src/tools/propose_plan.ts:67`）；`approvePlan` `:65-67`（`src/tools/propose_plan.ts:77`）；`resetPlanState` `:70-72`。
  - 读点：`planGateBlocks` `:22-24` ← `planGateLive` `:76-78` ← `src/permissions/autonomy.ts:202`（活委托，不是快照）；另一读点 `src/main/agent-runner.ts:1024` `isPlanBlocked`。
- **方案正文**（`PlanProposal` 规格）：走事件流。`src/events/index.ts:127`（`plan_proposed`）、`:129`（`plan_approved`）、`:680-681`（登记）。写点 `src/tools/propose_plan.ts:69-70`（`ctx.emit`，与盘同一条 pipeline）与 `src/main/agent-runner.ts:2437`（IPC 决议落 `plan_approved`）。入参校验收在 `src/tools/propose_plan.ts:11-56`（空 goal / 空 files / action 越界一律 `ToolError`）。

**关键不对称（取证结论，非推测）**：门布尔**没有任何一处从事件流反推**。`plan_proposed`/`plan_approved` 的全部读者是 `src/cli.ts:1014,1022`（结算计数）、`src/agent/economics.ts:178,181`（进度边界）、`src/agent/compaction.ts:143-155,204,215-216,428-433,530,563`（原子单元/固定回注/摘要输入/Tried&Rejected）、`src/agent/prune.ts:43-44`、`src/agent/sidechat.ts:124-126`、`src/agent/worker-projection.ts:99,119`、`src/agent/fork-cli.ts:150-153` —— 权限层不在其中。⇒ 进程/run 边界一过，`proposed`/`approved` 回到 `false/false`，而盘上那条未批准的 `plan_proposed` 不会被重放成写禁态。

---

## 问 2：压缩之后还在不在

### 结论先说：goal 文本**活着，但不是靠回注**——是**被动受护**；仓里**没有** goal 的压缩回注点

**「有没有回注点」的判据（拿 skill 那一族当尺）**：skill 确实有一个专门的、压缩感知的重挂口 —— `src/agent/plugins/index.ts:455-471` `remountFromEvents`（注释原文「压缩后重挂（从事件流投影激活记录）」，`:466-470` 显式读 `compaction.compressed_event_ids` 作排除集），逐请求消费在 `src/agent/glm-session.ts:742-743`（HEAD 面；工作树面 `:783`），接线 `src/main/agent-runner.ts:1782` `deriveRemount`。

**goal / plan 找不到同类口**：`grep -rn "goalReminder|projectGoal|traceGoal|goal_set" src/agent/compaction.ts src/agent/context.ts src/agent/plugins/index.ts src/agent/memory/` ⇒ **0 命中**（同一 path 集的负控 `plan_proposed`、`user_message` 均命中，见上）。⇒ **没有回注点**。

**那它靠什么活下来：固定回注名单 `keepFirstSet`**
- `src/agent/compaction.ts:206-241`，其中 `:214` 把**每一条** `user_message` 播进 seed；`:220-239` 按原子单元做闭包扩护。
- 续跑提醒块本身就是一条 `user_message`（`src/agent/loop.ts:360-366`），所以**每一轮那块目标文本都被结构性保护**。
- 两条压缩路径都拒绝吞它：摘要路径 `src/agent/compaction.ts:321`（`if (ctx.keepFirst.has(id)) return`）；overflow 紧急半分截断 `:333` 与 `:342`。
- 投影逐字外送：`src/agent/context.ts:285-287`。prune 只替换 `tool_result` 正文（`:305-306`），动不到它。

**所以「长跑/压缩之后目标还在不在模型的上下文里」= 在，但有三处硬边界，都得上账**：

1. **目标原文从来没有进过模型上下文**。`goal_set`（全文唯一载体）在 `src/agent/context.ts:267-321` 的 if 链里**没有任何分支** ⇒ 不产消息。码上自己承认：`src/agent/goal.ts:19`「全文在 `goal_set` 事件里，不靠这块携带」。
2. **进上下文那一块对目标原文另有 400 token 帽**：`src/agent/goal.ts:20` `GOAL_OBJECTIVE_TOKEN_CAP = 400`，施加在 `:206`；整块帽 `:22` `GOAL_REMINDER_TOKEN_CAP = 700`，施加在 `:211`。⇒ 目标超过 400 token 时，模型压缩前后都只看得到开头那一截——这是「被截断」，不是「压缩丢的」。
3. **摘要里那句 Objective 是模型写的，harness 不兜底**。六段模板 `## Objective` 只在提示词里（`src/agent/compaction.ts:372`）。而同文件对另外两段是有确定性兜底的：`applyFilesFallback` `:471-480`、`applyTriedRejectedFallback` `:584-587`（`:585` 还专门让模型自写的段落优先）。**Objective 没有对应的 fallback。** 更冷一层：因为 `user_message` 全受护、永不进 `compressedIds`，摘要输入 `serializeConversation(compressedEvents, ...)`（`:741-746`）**根本拿不到目标提醒块**——摘要里那句 Objective 是从助手/工具散文反推的，不是从目标原文带来的。

**goal 状态量不受压缩影响**（这一格是硬的）：`projectGoal`/`traceGoal` 读的是 append-only 原始流（`src/main/agent-runner.ts:2189` `replay(args.logPath)`），而压缩按设计不改写流——`src/agent/compaction.ts:2-3`「压缩只是组装时的投影……事件流永不删改」。轮次计数、`stopped` 终态、证据窗口都不依赖投影。

**plan 状态量**：
- 正文受护：`src/agent/compaction.ts:215-219` 播最后一组 `plan_proposed`/`plan_approved`；`:150-158` 按 `callId` 把 `tool_call↔tool_result↔plan_proposed↔plan_approved` 并成一个原子单元，`:220-239` 的闭包扩护于是把 `propose_plan` 那次 `tool_call`（`:294-301` 把完整 args JSON 投进 `assistant.tool_calls`）和它的 `tool_result` 一起保住。⇒ **方案规格在压缩后的上下文里逐字在场**。
- 但两个事件**本身不投给模型**：`src/agent/context.ts:316-317` 注释明写 `plan_proposed`/`plan_approved`「语义已在 tool_result / 卡片侧，模型上下文不需要」。所以模型看到的方案是 tool_call 参数那一份。
- 门布尔与压缩无关（内存态，压缩链够不着），但**与进程/run 边界有关**，见问 1 末。

---

## 问 3：证人钉的是哪一头

### 3a. 「压缩之后仍能看见目标」这一拍——**判卷里没有；门脚本里有近亲，但钉的是别的通道**

- `grep -rn "compact|压缩|keepFirst|projectContext" tests/goal-continue.test.ts tests/goal-drift.test.ts tests/goal-trace.test.ts tests/goal-stop-decision.test.ts tests/goal-drift-reason.test.ts tests/goal-price.test.ts tests/refine-goal-tool.test.ts` ⇒ **0 命中**。goal 侧判卷从不碰压缩面。
- 反向：`grep -rn "goal|objective" tests/compaction.test.ts tests/compact-wiring.test.ts tests/compaction-tried-rejected.test.ts tests/compaction-cost.test.ts tests/hook-precompact-producer.test.ts` ⇒ 只有两条，且都不是 goal 模式：`tests/compaction.test.ts:143`（一句 `toHaveLength(2)` 的注释）与 `tests/compaction-tried-rejected.test.ts:135`（plan 的 `goal` 字段，不是 goal 模式）。
- 最接近的两条尺，都走的是**裸 `user_message`**，不是 goal 的 `goal_set` + `origin.kind:"goal"` 通道：
  - `tests/compaction.test.ts:172`（HEAD 面）`it("最近 typed 用户消息永不吞 + keep-first 永不进压缩与摘要输入")`，素材是 `:32` `const GOAL = "修复 todo 应用的排序 bug"` —— 一个字符串，无 origin、无 `goal_set`；断言 `:192-194` id 1/7 不被压、`:197-198` 摘要输入不含它。**机制钉住了，goal 通道没钉。**
  - `scripts/compaction-check.ts`（HEAD 面）`:93` `buildLongSession` 起手 `user("任务：" + GOAL_KEYWORD)`；`:163-176` 断 `keepFirstSet` 含用户目标 id 与 plan 对 id；`:189-190` 断投影里能看见 `GOAL_KEYWORD`（断言文案就叫「固定回注名单（用户目标）未重注」）。这是**门脚本**不是 `tests/` 判卷。
  - 同一门里那条看着最像证据的 `:145` `assert(st.event.summary.includes(GOAL_KEYWORD), "摘要缺目标关键词")` **读数不可信**：摘要器是 `createMockSummarizer(FROZEN_SUMMARY_1)`，而 `FROZEN_SUMMARY_1` 自己第 2 行就写着 `GOAL_KEYWORD`（`:51-52`）⇒ 这条恒真，测的是 fixture，不是链。
- goal 侧真正钉住的两端（与用户猜的一致）：**落盘 + 判据**
  - `src/main/agent-runner.ts:2105` 续跑圈 + `src/agent/goal.ts:105-146` 判据被端到端钉：`tests/goal-continue.test.ts:190`（HEAD 面）「轮次上限到点必停」断 `turns.length === 1` 且 `goal_stopped.reason` 含「已用尽而目标未达成」；`:86` 钉 `handleGoalSet` 真写盘 + 越界钳制；`:284-341` 钉 `projectGoal` 只看最后一条 `goal_set` 之后那段。
  - 提醒块**生成面**有尺、**存活面**无尺：`tests/goal-stop-decision.test.ts:175-199` 断块含 `SPEC.objective`、断超长按 `GOAL_REMINDER_TOKEN_CAP` 截断（`:195` 还配了「输入真能触发截断」的反控）。**没有任何一条把这块文本喂进一次压缩再读 `projectContext`。**
  - 面进门（不是存活）：`tests/prompt-surface-check.test.ts:236` 断 `goalReminder[` 进了渲染族、`:282` 断文案含「goal 续跑」、`:291` 断块里认得出 `verify`。
- plan 侧同理，钉的是「布尔能读写 + 判据只有一份」：`tests/plan-required.test.ts:41`（J1：src 内不得再出现手写比较式）、`:59`（三态齐备）、`:106`（模型提交不得顺手关掉用户的 `required`）、`:158`（`enterPlanRunScope(true)` 武装 / 缺省回未武装）、`:113`（worker 权限会话默认带活判据）；`tests/plan-gate.test.ts:178`（`propose_plan` 落事件 → 写禁 → 批准解锁）、`:232`（run 级隔离）。**没有一条把方案对喂进压缩、再断言模型面仍看得见方案。**

**判定：判卷只钉了两端（落盘/读写），中间那一拍「压缩之后仍能看见目标」无人跑过。** 机制本身有门脚本的裸 `user_message` 版本守着，所以不是「全靠自觉」；但 goal 模式的实际通道（`goalReminder` 块 + `origin.kind:"goal"`）与 plan 的方案对，都从未穿过一次真实压缩。

### 3b. #69 步数上限：**HEAD 未修，且补丁与两条判卷都没落笔**

上限判定那行：**`src/agent/loop.ts:368`** `for (let step = 0; step < maxSteps; step++) {`；缺省 **`:168`** `const maxSteps = opts.maxSteps ?? 50`；撞帽抛出 **`:619`** `throw new Error("agent loop 超过 maxSteps=…，强制中止")`。

它「不执行」的那一格 = 收束闸在帽外：
- 能力 5 收束闸整段住在 `if (!sawToolCall)` 里：`src/agent/loop.ts:573`（块首）、`:585`（闸条件 `opts.verify && opts.autoVerify === true && wroteThisRun && (firstBeat || repairBeat)`）、`:616`（正常收束的 `return`）。
- 撞帽的定义就是「每一轮都 `sawToolCall === true`」⇒ 循环耗尽后从 `:619` 抛出，**结构上不可能经过 `:573-616`**。⇒ 「写过盘 + 用完步数」这一批 run 一条验证证据都没有，事件流里也不留痕。与 `outputs/cap-hit-verify-gap-2026-10-04/patch-ready.md` §1 描述同一件事；该文档当时引的 HEAD 面行号 366/571/583/605 现已位移到 **368/573/585/619**，判定逻辑逐字同一份。
- 落笔状态：`tests/` 里**无** `cap-hit-verify.test.ts`（`ls tests | grep -i cap` 只出 `cap-notice-unit / impact-cap-policy / measure-impact-cap-divergence / memory-arch-outline-cap / observation-capture / provider-capabilities / shape-doc-cap / skill-body-cap`）；`tests/auto-verify-wiring.test.ts` 里 `maxSteps|帽` **0 命中**。文档 §4 也自陈「登记，未落笔」。⇒ **这一格今天仍没有尺。**
- 帽外抛出的下游：`src/agent/orchestrator.ts:1876`（HEAD 面）把含 `maxSteps`/`max_turns` 的消息折成 worker 终态 `max_turns`；**主会话侧没有任何对应出声**（`grep -rn "maxSteps" src/main/agent-runner.ts` ⇒ 0）。且 `runAgent` 的外层 `try`（`src/main/agent-runner.ts:1611`）只配 `finally`（`:1928` 起，`:1964` 收）**没有 catch** ⇒ `:619` 那一抛穿过 `:2106` 的续跑圈，落到 `:2163` 的外层 catch 直接 `return ok:false`：既不写 `goal_stopped`（对照 `:2154-2160` 那条为硬上限专门补的「必须落 goal_stopped」纪律，这条岔路没享受同样待遇），芯片仍显示「续跑中」；`:1975` 的漂移读数也被跳过。
- 第二道帽确实存在且带终态：`src/main/agent-runner.ts:2102` `hardCap = GOAL_TURN_CAP_MAX + 2`（= 27，`src/agent/goal-trace.ts:14`）在 `:2105` 作圈数上限，`:2157-2160` 强停并落 `goal_stopped`。⇒ 总步数上界 = 27 × 50。
- 轮次闸 `src/agent/goal.ts:110` `if (turn >= spec.maxTurns)` 不执行的**合法**前置（逐条现读）：`:108` `evidence === "verified"` 先认 done；`goalNextTurn` 更早返回 null 的三支——`src/main/agent-runner.ts:2188` 已 abort、`:2191` 无 `goal_set` 或已 `stopped`、`:2196` unattended。轮次计数只认 `origin.kind === "goal"` 的 `user_message`（`src/agent/goal-trace.ts:63`），而 `set_by:"model"` 那条 `goal_refined` 路径**显式不重置轮次、不移窗口锚、不清停止、不改两条闸**（`src/agent/goal-trace.ts:44-53`，注释点名「绕过工具直接造事件就能把轮次帽归零」这一族），未武装时返回 `null` ⇒ 模型不能自武装。**这一头是守住的。**
- 仍开着的旁路（现读，`src/agent/orchestrator.ts:627-631` HEAD 面）：worker 的 `maxTurns` 优先取 `stageRole?.maxTurns`（内置角色 / 插件 frontmatter，经 `resolveStageRole` `:1545`/`:1553` 直传），**这条分支不过** `args.max_turns` 那一支的 `>= 1 && <= 200` 整数校验；结果原样喂进 `maxSteps: w.maxTurns`（`:1860`）。⇒ 一个角色 frontmatter 就能把 worker 的步数帽抬到任意值；`undefined` 时回落 `:168` 的 50。（未证：没有实测把某个 `maxTurns` 写成 10⁶ 后 run 真跑多久——缺一条端到端取证。）

---

## 这一格如果要补，最小一块是什么

**最小一块 = 一条判卷，不是一条产品码。** 现读的机制已经够用（`keepFirstSet:214` + `loop.ts:360-366` 的 origin 通道），缺的只是「把 goal 的实际通道穿过一次压缩再读投影」这一拍证人。

1. 新增 `tests/goal-compaction-survival.test.ts`（**全新文件，不存在，零撞窗**）：造一条 goal 已武装的流（`goal_set` + ≥1 条 `user_message{origin.kind:"goal", content: goalReminder(...)}`）+ 足量尾部工具轮，跑 `runCompaction`，再 `projectContext([...events, compactionEvent])`，断言三件事：
   - 提醒块原文在投影里逐字在场（钉 `src/agent/compaction.ts:214,321` 对 goal 通道确实动作，而不是只对裸 user_message 动作）；
   - `projectGoal` 在同一份流上仍算得出同一个 `turn`/`stopped`（钉 `src/agent/goal.ts:239` 不受压缩影响）；
   - 反控一条：`compressedIds` **不含**任何 `user_message`（防「加一条 `## Objective` 回注就当修完」把受护集改松）。
   建议顺手把 `scripts/compaction-check.ts:145` 那条恒真的 `summary.includes(GOAL_KEYWORD)` 一起登记为**已知不可信读数**（fixture 自证），别再当证据引用。
2. `src/agent/goal.ts:20` 的 400 token 目标帽是**独立的一格**，补判卷前要先定口径：目标原文唯一载体 `goal_set` 从不进投影（`src/agent/context.ts:267-321` 无分支）。要么显式承认「模型只看得见 ≤400 token 的锚点，全文归审计面」并把它钉成一条测（`tests/goal-stop-decision.test.ts:192-195` 已很近，差「投影侧看不到全文」这半边），要么给 `projectContext` 加一个 goal 的压缩感知回注口（对齐 `plugins/index.ts:455-471` 的形态）。**这是产品决策，不是 bug。**
3. `#69` 仍欠它自己的那一块：`outputs/cap-hit-verify-gap-2026-10-04/loop.patch` + `cap-hit-verify.test.ts.txt` 两条判卷照贴即可（文档 §5 已在隔离树实测 `patch --dry-run` 退 0、打补丁 4/4 绿、不打恰好红 1 条）。
4. plan 那半格如果也要补，最小一块不是测而是**接线选择**：门布尔在 run 边界归零（问 1 末的不对称）。要么补一个「从盘上未批准的 `plan_proposed` 重建 `proposed` 态」的读点，要么把「不重建」写进 `src/permissions/plan-state.ts` 头顶当明账。

**涉及文件现在干净还是在飞**：

| 文件 | 状态 | 说明 |
| --- | --- | --- |
| `tests/goal-compaction-survival.test.ts` | 不存在（新建，零撞窗） | 本块主体 |
| `src/agent/compaction.ts` | **干净** | 被钉方，不需要改 |
| `src/agent/goal.ts` / `goal-trace.ts` / `src/agent/loop.ts` / `src/agent/context.ts` | **干净** | 取料面，不需要改 |
| `src/main/agent-runner.ts` | **干净** | 若加投影侧回注口才碰它 |
| `tests/vitest.config.ts` | **在飞**（` M`） | 新判卷要进门表就会撞这个窗；落笔前重核 `git status --porcelain -- tests/vitest.config.ts` |
| `scripts/mutate-verify.mjs` | **干净**（现读 `git status --porcelain` 空） | 新锚点今天可插；`cap-hit-verify-gap-2026-10-04/patch-ready.md` §6 那句「现在在别人手里」已过期，别照抄 |
| `src/agent/orchestrator.ts` | **在飞** | `#69` 的 worker 侧与 `stageRole.maxTurns` 校验都在这棵 |
| `src/agent/loop.ts`（`#69` 补丁落点 `:619` 之前） | **干净**（2026-10-04 那扇在飞的窗已让出） | 补丁今天可贴 |

**未证清单（别把这份取证读成全部证完）**
- 未跑任何判卷/门/认证（取料纪律禁止），所以「`tests/compaction.test.ts:172` 今天确实绿」没有读数——只核了它的素材与断言形状。
- `stageRole.maxTurns` 抬帽那一条只做了静态取证，缺一次端到端实跑。
- 目标 >400 token 在真实长任务里的实际丢失率未量（需要真语料 + 投影文本比对）。
- 压缩后芯片/live 界面是否仍显示同一个目标（`goal-trace.ts:1-7` 声称两端同源）未做 live-vs-replay 对读；`src/cli.ts:278` 点名的 `--log` 分叉也未量。
