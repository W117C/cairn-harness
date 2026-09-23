# 智能调度层设计：让主 agent 真正「带队」（2026-09-19）

范围：只改 harness。目标面 = 子智能体编排 / 工具调用流畅度 / 规划与执行分层 / 由 harness 抬高模型的长时程任务能力。
允许重构，但重构只作为「加能力时顺手切的负载」，不为美观立项。

## 0. 前提（用户裁决，不再重开）

- **2026-09-18**：模型侧不动（不微调、不 RL）；四项能力面全要；产出必须绑定本仓差距；任何指标同时报**准确率**与 **$/成功任务**。
- **2026-09-19 目标口径追加**：架构最简单清晰；skill / MCP / 插件的**自动调用**是能力要求（不是"能配置"）。
- **本轮四问四答**：① 收队＝工具 + 回合末闸，分两步；② write worker 接验证门；③ 默认值分层（不加钱的默认开，加钱的实测后定）；④ 交付＝本 spec 并 commit。

## 1. 实测诊断（HEAD `a80d2a7`，每条附复跑口径；本轮关键判据在 HEAD 前移后重测过一遍）

| # | 事实 | 证据落点（file + 符号，用标签不用行号） |
|---|---|---|
| D1 | **产品路径没有 join。** `spawn_agent` 派完即返回回执、worker 后台跑；`runLoop` 遇纯文本轮即收束 ⇒ 主 agent 说完"我派了 3 个 worker"这一轮就结束，worker 结果作为合成 `tool_result` 落进日志但模型再不会被叫回来读。join 原语**存在且只被验收脚本用**：`Orchestrator.waitAll` 的调用者全部在 `scripts/agents-check.ts` / `scripts/supervisor-check.ts`；`waitForAgentTerminal` 是 private，调用者只有 `spawnSupervise` 与 sequencer 的 `runChain`。复跑：`grep -rn "waitAll" src/ scripts/` | `src/agent/orchestrator.ts` 「spawnReserved」尾、「waitAll」；`src/agent/loop.ts` 「runLoop」的 `if (!sawToolCall)` 分支 |
| D2 | **worker 的 loop 调用面是全仓最薄的一处。** `runWorker` 里那次 `runLoop({...})` 只传 provider/events/workspace/mode/maxSteps/allowedTools/tools/signal ⇒ 主会话这几轮新加的 `verify`、`autoVerify`、`hooks`、`clarify`、`plan`、`impact`（写后回注）**一个都没接**。`WORKER_TOOL_TABLE` / `WRITE_WORKER_TOOL_TABLE` 也没有 `verify`，两份 `*_FORBIDDEN_TOOLS` 把它列进禁入名单。（严格说 worker 今天的"禁 verify"是靠**没传钩子**兜住的，不是靠白名单——loop 的 verify 分支排在 `allowedTools` 判定之前，详见 §6 的闸序洞。） | `src/agent/orchestrator.ts` 「runWorker」；`src/agent/orchestrator-config.ts` 两张表 + 两份 `*_FORBIDDEN_TOOLS` |
| D2b | **影响面读端接进 worker、写端回注没接**（"只在一头设界"同族第 5 次）：`af3902d` 给 worker 补了 `impact_query` 三处同源，但 worker 的 `runLoop` 不传 `impact` 钩子 ⇒ write worker 落盘后拿不到跨文件波及摘要。 | `src/agent/orchestrator.ts` 「runWorker」的 runLoop 入参 vs `ToolContext.impact` |
| D3 | **调度没有任何指令面。** 主会话 `BASE_SYSTEM` 实测 12 行 / 1,272B（`node -e` 取数组字面量求 utf8 长度），六条纪律全是"单文件修 bug"画像；`spawn_agent` 只以**禁止项**出现（"不能再 spawn / 并发有上限"）。模型面规格 description 一句话。⇒ 拆不拆、拆成什么、结果怎么整合全靠模型先验。 | `src/main/agent-runner.ts` 「BASE_SYSTEM」；`src/agent/glm-session.ts` 「gateToolSpecs」内 spawn_agent 规格 |
| D4 | **并发满 = 硬拒，且给的指令在产品路径上没有可执行形式。** 拒绝文案是"不排队——请等现有 worker 收敛或取消后再试"，但 D1 使父轮已终止、且没有等待工具 ⇒ 模型收到一个它无法执行的指令，唯一合法动作是结束回合。注意归因：**"不排队"本身是权威方案里带论证的决定（见 R1），缺陷只在"让它等"这句话在当前原语下不可执行。** | `src/agent/orchestrator.ts` 「spawnReserved」预算闸分支；`scripts/agents-check.ts` 「B3」断言 |
| D5 | **没有执行态读的账本。** `propose_plan` 是一次性**审批闸**（批准后即解锁写工具），不承载 steps/status/验收口径；多步任务的"做到哪了"只存在于 prose 与压缩摘要里。 | `src/tools/propose_plan.ts` 「propose_plan.run」；`src/permissions` 「getPlanState」 |
| D6 | **工人报告是 prose。** `agent_result.summary` 是 2,000-token prose clip；`parseVerdict`（纯函数，定义在 `src/agent/sequencer.ts`）只在 supervise 的环决策与 pipeline 的 gate 环标注里采信，worker 自身终态（`finish` → `agent_result`）不经它 ⇒ 父侧整合要么重读全文，要么凭想象。`finish` 全程不读 `verify_result`（实测：`orchestrator.ts` 内 `verify_result` 零命中）。 | `src/agent/orchestrator-config.ts` 「SUMMARY_TOKEN_CAP」；`src/agent/orchestrator.ts` 「finish」 |
| D7 | **调度智能的燃料默认不在线。** `DEFAULTS` 里这批开关全 false：`routingBandit` / `impactAnalysis` / `actionFusion` / `autoVerify` / `evidenceReceipts` / `observationPack` / `requestMetering` / `economicCompaction` / `telemetry`，且 `maxBudgetUsd=0`（成本闸无效）；布尔项里只有 `autoMemory` 与 `promptCache` 默认开。⇒ 路由/预算/影响面/自动验证四条支撑面默认都不在线。 | `src/main/settings.ts` 「DEFAULTS」 |
| D8 | **一轮多工具调用是串行的，且模型看不到自己批处理了。** `runLoop` 在 `for await` 内逐条 `await tool.run(...)`；`projectContext` 又把每个 `tool_call` 拆成独立的 assistant 消息（一条一个 call）⇒ N 个只读探测 = N 段串行墙钟延迟（**不是** N 次请求），且模型每轮看到的自己都是"一次一个"。 | `src/agent/loop.ts` 「runLoop」工具执行段；`src/agent/context.ts` 「projectContext」的 tool_call 分支 |

> D1/D2/D2b 三条同族＝本仓已确认 6 次的「能力已发货、产品路径绕过它」。**本轮方案的主体就是把已有的东西接到缺它的那条路上，而不是新造。**

## 2. 设计总则

架构收成一句话：**主 agent = 唯一的决策者 + 唯一的收队者；worker = 有界、可验证、机器可读的一次性执行单元；harness = 提供 join、账本、价格标签和判据。**

五条施工不变量（每个工作流都必须能逐条自证）：

1. **三处同源**：运行时注入工具必须同时出现在 模型可见规格 / 可执行实例 / loop 白名单（worker 面）。缺任一处 = 新门红（§7 G-B）。
2. **不产生第二事实源**：`agent-plan.md` §10.1 第 4 条。任何新展示从事件流投影，任何新状态从事件流重算，且 live 与 replay 两条渲染路都补。
3. **外界文本两头设界**：新注入模型的每一段文本带上限（单位见下方 ⚠️）+ 如实截断提示 + 取回全文的通道。**每轮重送**的面（工具规格、计划块、调度纪律）按"整会话付费"估。帽的执行一律复用刚落成的 `src/agent/text-budget.ts` 「clampToTokenBudget」（`636b048` 已把 skill 正文 / worker 报告 / 地图渲染三份各写各的收成这一份）——**本 spec 不新造第二份裁剪器**，那正是本仓"同族策略副本"点名的病。
   ⚠️ 但**帽的数值一律以「字符」登记，不以 token 登记**：`estimateTextTokens` 是 `ceil(chars/4)` 的英文口径，对中文低估 3–4 倍（实测：`BASE_SYSTEM` 554 字符 → 估算器报 139，而 CJK 真实 token 数约在 400–550）。拿它的读数当"我们只花了 139 token"讲 = 自我安慰。调用形状：`clampToTokenBudget` 的保留量本就是 `tokenBudget*4` 个字符，所以**想让中文段留 N 个字符就传 `tokenBudget=ceil(N/4)`**，并在断言里锁的是**字符数**而不是估算器读数（英文为主的 skill / 角色 / 报告沿用原口径）。另立一笔小改（给估算器加 CJK 分支，让中文段读数不再虚低）不属本 spec 范围，但它是这条口径问题的正解。
   ⚠️ **2026-09-19 同日追注（上面那句原文不回改——那是该日快照）：「帽一律以字符登记」这条已被推翻，别再照它给新预算。**
   ① 当时说「不属本 spec 范围」的那个正解已经落地：`estimateTextTokens` 改为按字符类别计权
   （宽字符 1 token / 拉丁 0.25），纯 ASCII 与旧 `ceil(chars/4)` 逐字同值 ⇒ 零回归；取点与估算共用同一份权重
   （`clamp-cut-by-chars-not-weight` 锚点守着「估算一套、执行另一套」那族病）。
   ② 于是**中文段的帽现在一律以 token 登记、断言里锁的也是 token 数**；「想让中文段留 N 个字符就传
   `tokenBudget=ceil(N/4)`」那套换算法在字重口径下会把中文段少留 4 倍，属**已失效的写法**。
   ③ 同日按这条口径收口的三处（各带锚点）：记忆注入总预算 `f239587`（声明 6K token 实测 14,021 ⇒ −56%/轮）、
   ARCHITECTURE 大纲帽 `f586d77`（门槛按字节、帽按字符 ⇒ 4KB–16KB 的中文文档被整份注入）、
   prune 三处计量（保护区累计 / 最小修剪闸 / `savedTokens`；低估让修剪**根本不触发**，不只是数字难看）。
   一次性搜法：`grep -nE "/ 4\b|\* CHARS_PER_TOKEN" src/**` ⇒ 命中即问「这一处是给人看的数，还是决定要不要动手的数」。
4. **默认值分层**（本轮裁决③）：零边际成本的默认开；花真钱的默认关，但**同一批交付里必须给出实测读数和"值不值"**，不接受"留位待办"。
5. **双指标**：任何"更强"的宣称必须并列准确率与 `$/成功任务`；只有前者 = 未证。

## 3. W1 · 收队（本轮最高优先，其余三项的前置）

### W1a `wait_for_agents`（默认开）

- **接口**：运行时注入工具（与 `spawn_agent` 同族，不进静态 `TOOLS` 键域，用常量名，同 `WORKER_IMPACT_TOOL` 先例）。参数 `{ agent_ids?: string[], timeout_ms?: number }`；缺省 `agent_ids` = 本会话全部未终态 worker；`timeout_ms` 缺省 120,000、硬帽 600,000（超限 fail-visible 钳到帽值并在返回体里写明钳制，不静默）。超时**不算失败**——返回已收敛部分 + 未收敛清单与已花时长。
- **语义**：在工具内 `await`（挂起的是这一次工具调用，不是整轮），沿 `ctx.signal` 可取消；取消即返回 `cancelled` 而不抛。
- **复用，不新造**：`waitForAgentTerminal` 提为内部公有方法给工具体用；`resolveTerminalWaiters` 已是事件驱动无轮询；逐 worker 摘要的帽沿用 `SUMMARY_TOKEN_CAP` 的量纲、执行走 `clampToTokenBudget`（见 §2 不变量 3）。
- **返回体**（紧凑，不重发 prose）：`[{agent_id, status, verdict, summary(经 clampToTokenBudget), evidence[], usage, cost_usd}]` —— 依赖 W4b 的机器可读终态；W4b 未落时降级为 prose clip，接口不变。
- **零新事件类型** ⇒ 不触 `src/events/index.ts`、不触两套渲染器（"架构最简单清晰"的具体兑现：等待这件事在流里就是一条普通 `tool_call` + `tool_result`）。
- **测**（`tests/orchestrator-join.test.ts`，注入 mock worker 不依赖真模型）：全终态一次返回并汇齐 usage / 超时带已收敛清单 / `signal` 取消即刻收束 / 无 worker 时零行为（不占轮） / 返回体字节上界。变异锚点 4 条：等待被摘（立刻返回空）/ 超时被摘（永不返回）/ 取消被摘 / 返回体帽被摘。

### W1b 回合末在途闸（默认关，实测后定）

- 复用 `autoVerify` 已经打磨好的"收束前补一拍"骨架——**同族第二实例，不新造机制**：纯函数 `decideEndTurn({pendingWorkers, alreadyNudged, budgetLeft}) → "proceed" | "nudge"`；命中则注一行 `[harness] N 个 worker 未收敛，要么 wait_for_agents 要么明确交代它们`，**至多一拍**、模型已自调过 `wait_for_agents` 即让位、计数探测失败即跳过并告警。
- 为什么分两步而不是直接默认开：它多要一轮 = 花真钱，且动的是 `runLoop` 的终止语义（sidechat / worker / 靶场共用）。`dsh-loop-repeat-blindspot` 那条教训的判据在这里同样成立：**先量占比再动终止语义**。W1a 落地后，"忘记收队"应从主失败模式降为次要，W1b 的实测价值本来就要重新评估。
- 落点：`LoopOptions.endTurnGuard?: () => number`（缺省 undefined = 零行为），只有主会话传。断言含"零在途 worker 时事件流逐字不变"。

## 4. W2 · 计划账本（taskplan，默认开，排最后做）

- **新独立纯模块** `src/agent/taskplan.ts`（不进 `orchestrator.ts`，不加行）：reducer + 投影 + 校验，可单测、可被面板与上下文两面消费。
- **数据**：`{ goal, steps: [{ id, title, owner: "self" | agent_id, status: pending|active|done|blocked|failed, accept: string, evidence?: string }] }`。帽彼此要能自洽（这是本 spec 里唯一一处"三个数各定各的就会互相打脸"的地方）：`steps ≤ 8`、`title ≤ 40 字符`、`accept ≤ 40 字符` ⇒ 8×(40+40) + 状态与 id ≈ 700 字符，正好等于下面的上下文块帽；超限在 reducer fail-visible 拒绝，而不是投出去再被裁。
- **模型面**：新工具 `update_plan`（全表幂等提交，非 diff 语义——diff 会引入两侧真相漂移）。每次提交落一条 `plan_updated` 事件（含全表，append-only 可重算）。
- **上下文面**：`projectContext` 每轮注入一份"当前计划"块（从最后一份 `plan_updated` 投影，与压缩摘要注入同构、带"数据不是指令"免疫声明）。**这是每轮重送面**，帽 = **700 字符**（§2 不变量 3 的口径），超帽走 `clampToTokenBudget` 并在块内回显省略条数，测里锁字符数。
- **与 `propose_plan` 的关系：保留、不派生。** `propose_plan` 是人在环审批闸（写禁），`update_plan` 是机器执行态。自动从批准方案里生成 steps 会造第二事实源，明确不做；衔接方式 = 批准后模型显式提交首份 steps（写进调度纪律）。
- **代价（必须说）**：新增 1 个事件类型 ⇒ 必触 `src/events/index.ts`（类型 + `KNOWN_TYPES`）与**两套渲染器**（live `renderEvent` + replay `projectHistory`/`renderHistoryRow`，共用一份文案常量），且 `src/renderer/**` 是并发会话的正持有面 ⇒ **排在渲染层排队规则里等窗口**，不许插队。
- 收益落点：长时程不失忆（压缩摘要是有损 prose，账本不是）、面板能显示 `n/8`、W4c 的假完成率有可判分母。

## 5. W3 · 调度指令面与价格标签（默认开）

- **`BASE_SYSTEM` 加一段"调度"纪律**，并把它切进新模块 `src/main/system-prompt.ts`（纯字符串组装 + 一条**字符帽断言**：现值实测 554 字符 / 1,272B，新段预算 **≤ 400 字符**（+72%），超出即红——这是每轮重送的静态段，CJK 下约多付 300–400 token/请求）。每条纪律对应 §1 的一个 D 编号，不写套话：
  - 拆/不拆判据（可独立验收才拆；单一改动别拆；只读调研适合 fan-out；深度恒 1）— D3/D4
  - 任务书四件套：goal / files / **accept（验收口径）** / budget — D6（worker 看不到父历史，`accept` 是它唯一能被判的东西）
  - **收队义务：派完必须 `wait_for_agents`，未拿到回执不得转述 worker 结论** — D1（当前最真实的失败模式）
  - 价格税一句话：并行不是免费的，每个 worker 是独立完整会话、无共享前缀 — §0 判据
  - 计划账本用法（何时 `update_plan`）— D5
- **spawn 回执与终态结果带累计账**：`Orchestrator.budgetEstimateUsd()` 已有；`metering/pricing` 已有真钱口径。在回执里加 `spent_usd` 一个字段（纯投影，零额外请求）。配套：`maxBudgetUsd=0` 时不显示假数（fail-visible 写"预算未设"，D7）。
- **W3b 工具选择的可观测性**（兑现"skill / MCP 自动调用是能力要求"）：从既有事件流纯投影出 `tool_call` 分布 / 各工具失败率 / skill 命中与命中后是否真按其指令走 / 该调未调的候选（例如任务里出现过某 skill 描述的关键词却没调）。**不加模型面、不加决策**，只把"选对率"变成可测读数，交给 W5a 当判分面。落 `pnpm facts` 生成面（与 `docs/facts/gates.json` 同族），避免散文抄数。
- **D8 并行执行**（"工具调用流畅"的墙钟面）：`runLoop` 支持同一轮内对**并发安全只读工具白名单**（`read_file` / `grep` / `glob` / `lsp` / `impact_query`）并发执行，写类与 `run_shell` 保持串行；并发帽 4。两条硬约束：`tool_result` **按模型下序落流**（不按完成先后，否则 replay 与投影判据漂），且单工具调用时事件流**逐字节不变**。缺省关、主会话开（`stuckNudge` 同族先例，理由：`runLoop` 是共享内核）。

## 6. W4 · 把「执行—验证—修正」交给 worker（本轮裁决②）

关键取舍：**给 worker 的是 `autoVerify` 证据拍，不是 manual `verify` 门。**
原因实测在代码里：`verifyBeat` 通过即 `return`（loop 收束）。worker 若走 manual 门，收束点落在 `verify` 的 tool_call/tool_result 之后，而 `finish` 的报告取自 `lastAssistantText` ⇒ **验过了但没有交付文本**。`autoVerify` 的语义正好是为这个场景设计的：纯文本轮收束前补一拍、只落 `verify_result{auto:true}` 证据、不改写模型上下文、每 run 至多一拍、模型自调过即让位、无可验面则整段跳过。

- **W4a**：`runWorker` 的 `runLoop` 补 `autoVerify`（写 worker）+ `verify` 钩子（`createVerifyHook(loopWorkspace, { exec: verifyExec(...) })`，cwd = 它的 worktree，沙箱链照旧）+ `impact` 钩子（修 D2b，两头对称）。
- ⚠️ **先修一处既有闸序洞（不修则 W4a 自相矛盾）**：`runLoop` 里 verify 分支在 `allowedTools` 硬闸**之前**（loop 的 verify 分支早于白名单判定）。⇒ 只要把 `verify` 钩子传给 worker，模型幻觉出这个名字就能执行那道"名单说禁"的门（同洞第三实例：`sidechat` 的 `SIDECHAT_TOOL_WHITELIST` 也不含 verify，但那边没传钩子所以空洞不显形）。修法：把 `allowedTools` 判定提到 verify 分支之前（缺省 `undefined` = 全表可见，主会话逐字节不变），使**白名单成为真正的单一闸**，`*_FORBIDDEN_TOOLS` 断言面与运行时行为一致。配套：worker 白名单**不**加 verify ⇒ worker 只走 harness 自动拍，不给模型手动入口（这正好也是 §6 开头"manual 门会吃掉交付文本"那个坑的正面解法）。
- **W4b 机器可读终态**：把 `parseVerdict` 从 supervise 独享扩到全部终态，`agent_result` **加**（不改）可选字段 `verdict` / `evidence[]` / `open_questions[]`；`finish` 读子流最后一条 `verify_result` ⇒ 落 `verified: true|false|"absent"`。**自述 pass 从此有机器凭据**：`verified=false` 时 verdict 强制降为 `unverified`，不采信报告措辞。
- **W4c 假完成率**（一等指标）：`done 且 verified≠true ÷ 全部 done`。进 §7 G-C 的门与 W5a 的读数面。
- 成本如实报：每个写 worker 多跑一次真 lint/test（已配 `verify.timeoutMs` 与语言探测，非 npm 仓不再是死路）。这是 §0 第 4 条要"并报 $/成功任务"的那一类，判默认值看 W5a 的数。

## 7. W5 · 可证性与门禁（不做则上面全是感觉）

- **G-A 编排对照实验**（复用 `src/agent/gym/runner.ts` 的 `forkCase`，新 case 落 `fixtures/gym`，**不碰** `frozen-sha256.json` 判卷区）：同一任务三种策略——`solo` / `fanout-read` / `supervise`；输出 通过率 · `$/成功任务` · 收束轮数 · 假完成率。这是 W1b / W4 / W3 默认值的唯一裁决依据，也是 D7 那串"默认关"里**唯一该由数据而不是纪律决定**的一段。
- **G-B 三处同源静态门**（新，补 `tools-check` 不覆盖静态面的缺口——它只做逐工具真实调用）：任一运行时注入工具名必须同时出现在 规格面 / 实例面 / （worker 时）白名单面，缺一处即红。本仓已 4 次栽在这族上（`spawn_agent`、`lsp`、`impact_query`、worker 读端），现仅靠变异锚点守，**没有静态门**。落点随 W1a 一起建（第一个消费者就是 `wait_for_agents`）。
- **G-C 判据矩阵**（每项能力交付时逐格给，缺一格不算完）：

  | 项 | 定向测 | 变异锚点 | 反向对照 | 字符串断言波及 |
  |---|---|---|---|---|
  | W1a | `tests/orchestrator-join.test.ts` 5 条 | 4 条 | 摘掉等待→红；摘掉帽→红 | `agents-check` 的 spawn 回执文案 |
  | W1b | 计划闸 3 条（含零在途逐字不变） | 3 条 | 缺省开→靶场基线漂（预期，需并列报数） | `BASE_SYSTEM` 单测（提示词纪律已有测） |
  | W3 | 字符帽断言 + 每段纪律↔D 编号 | 2 条 | 帽调高→红 | `BASE_SYSTEM` 被 mutate 表与门禁字符串引用面（memory 明令扫） |
  | W4 | worker 自动拍 4 条（含无可验面零行为）+ 闸序 2 条（白名单挡 verify / 主会话缺省零变化） | 4 条 | 不传钩子→红；`verified` 强制降级失效→红；闸序改回→红 | 两份 `*_FORBIDDEN_TOOLS` 断言 + `sidechat-check` 只读白名单面 |
  | W2 | reducer 纯函数 + 上下文块字符帽 | 3 条 | 超帽→红 | `KNOWN_TYPES` 计数与两套渲染器测 |

## 8. 留位（要用户或协调会话裁决，本轮不动）

- **R1 · 并发排队**：D4 的"满即拒"是**带论证的规范决定**，不是疏漏——`agent-plan.md` 原文：「并发上限默认 4（可配 1–8）：超限 tool_result 直接拒绝（"并发已达上限"），不排队——**排队是隐藏调度状态，模型自行决定重试**（Claude CCL:1206 同款拒绝语义）」。它同时被 `agents-check` 「B3」与 `tests/agents.test.ts` 各钉一条。⇒ 改成队列 = 改权威方案 + 改两处判据，需你明确授权。
  **但我把它的论证读全后判断：W1a 恰好把它的前提补上了。** "模型自行决定重试"之所以可接受，是因为模型能自己等；今天它等不了（D1），所以"自行决定重试"退化成盲目重烧一次工具调用。有了 `wait_for_agents`，硬拒才是真正的背压建议。**故本轮不动 R1，先看 W1a 落地后真实轨迹里"满"的发生率与撞满后的行为**——若模型学会先 wait 再 spawn，这条缺陷自动消失；若仍频繁撞满，再拿数据来裁排队。
- **R2 · `spawnRace` 保持不接线**（2026-09-18 已裁，勿重开）；**深度恒 1 不动**；worker **不给** `clarify`（挂起等人 = 并发预算被占死，人在环是父会话的职责）。
- **R3 · 结构减法**随改动切出，不单独立项：`orchestrator.ts`（现 2,048 行）切 `orchestrator-join.ts`（随 W1a）；`agent-runner.ts`（现 1,831 行）切 `system-prompt.ts`（随 W3）。注：路线图记的 2,874 行是 09-18 值，已被并发会话拆小，引用前重测。

## 9. 排期（按依赖，不是按重要性）

1. **W1a + G-B**（同一次交付：新工具必须由静态门的第一消费者证明自己有面）→ 2. **W4a + W4b + W4c**（不依赖 W1a，可并行）→ 3. **G-A gym 编排对照**（要 W1a/W4 在树才能量出真差）→ 4. **W3**（调度纪律依赖 W1a 存在才有"收队义务"可写；D8 并行随 W3）→ 5. **W1b**（默认值由 G-A 出数）→ 6. **W2**（触最高竞争面，排队等渲染层窗口）。

## 10. 已声明代价 / 本轮没做 / 未验证

**已声明代价**：① 每轮重送的静态段变大（调度段 ≤400 字符 ≈ +300–400 token/请求）＋ 计划块 ≤700 字符，这两笔是**整会话付费**，换来的是 D1/D3/D5 三处结构缺口关闭；② worker 自动验证 = 每个写 worker 多跑一次真测试；③ W1b 若默认开，多要一轮；④ W2 必触 `events/index.ts` + 两套渲染器这两个高竞争面。

**本轮没做**：不改 `agent-plan.md`（R1 留给裁决）、不动 `spawnRace`、不加 depth>1、不做 UI 新增视图（除 W2 的既有面板投影）、不引框架、不给 worker `clarify`。

**未验证（未证 ≠ 通过）**：本轮全部为静态代码阅读 + 单点实测（`waitAll` 调用者、`runWorker` 的 runLoop 入参、`BASE_SYSTEM` 字节、settings 缺省值、两份 FORBIDDEN 名单）。**没有任何一条收益是实测的**：拆不拆更好、worker 验证值不值这些钱、调度纪律能否提高收队率——三者全部待 G-A 出数，此前不得对外宣称"更强"。

---

## 11. 执行期更正（2026-09-19/20 施工 W1a + G-B 时回写；上文原文一字不改，那是当日真值）

1. **§2 不变量 3 与 §5 W3 的「中文段帽一律以字符登记」前提已失效**：`d98fa19` 把 `estimateTextTokens`
   改成按字符类别计量（CJK 一字一 token），`4f66015` 又把 worker 报告裁剪接到同一口径。
   ⇒ 帽可以直接按 token 写。W1a 实测钉住了这条：400-token 帽下 500 个汉字**必须被截**
   （`tests/orchestrator-join.test.ts` 的 CJK 反向对照；旧 chars/4 口径会判它 125 而放过）。
2. **§3 W1a 返回体里的 `cost_usd` 移出 W1a**：逐 worker 折算要新铺一条 pricing 路径 = 第二事实源。
   会话级只有 `budgetEstimateUsd()` 一条现成通道 ⇒ 钱随 §5 W3「spawn 回执与终态结果带累计账」一起做，
   W1a 只回 `usage`。
3. **join 原语确实在，但带一条必须在调用方挡的洞**：`waitForAgentTerminal` 对**不存在**的 agent_id
   会把 resolve 推进 `terminalWaiters` 且永不触发（既不 resolve 也不清理）⇒ 收队前先摘 unknown 名单。
   这条不在原 spec 里，是接线时读原语读出来的，已落锚点 `wait-unknown-id-enters-waiters`。
4. **§7 G-B 的落地形态改了**：不立独立门，静态对账进 `test` 门——`gate-manifest` 的
   `checkGateManifest` 会把任何 `*-check` 形态脚本强制登记，凭空多一道进程换不来分辨力。
   实例面只能走源文本正则（`installAppTools` 拉起 AskGate/调度器/electron 依赖，单测里调它等于起半个主进程），
   其失效方向是**假绿** ⇒ 门自身带双向反向对照（造不存在的名要四处全报；谎报不可达要当场抓）。
5. **一条锚点主动撤回**：「abort 越权（收队时顺手 `cancelAll`）」在当前测试面上**不可观察**——
   `cancelAll` 只同步翻 `controller.aborted`，终态分类要等 worker 从挂起点恢复才发生，
   脚本模型下最终仍是 `done`。硬造一条刚好会红的断言就是造恒真锚点，宁缺。
   语义由方法注释与「取消只结束等待」那条测的行为面部分守着（`cancelled` 标记 + 不动 `timedOut`）。
6. **默认值按 §2 不变量 4 判为「不加钱 ⇒ 默认开」**：W1a 不给开关。等待本身不多要模型轮，
   代价只在 payload 体积，已由逐行 400 + 整批 2400 两段帽界住。
7. **W3 只落了第一段，且比原预算小一个数量级**（`65af88f` + `9f47c16`）：
   实际加的是**一行 115 字符**（+269 字节，静态段 1272B → 1542B），不是原写的「≤400 字符调度段」——
   写开之后发现剩下那几条（价格税、计划账本用法）要么依赖 W2/W5 还没落地的东西，
   要么就是把工具描述已经说过的话再说一遍。**没有为凑预算硬写句子。**
   配套裁决：`base-system-discipline` 的体积帽 1400 → 1600（一次显式预算裁决，测内注释留了实测数）。
   仍未做的三件：① `src/main/system-prompt.ts` 抽取——挪 BASE_SYSTEM 会迫使三条既有提示词锚点改指，
   与「不为美观立项」同向的判断是等 W3 其余部分真要在提示词里加长时再抽；
   ② spawn 回执与终态结果带 `spent_usd`；③ W3b 工具/skill 选对率的投影读数（这条是「自动调用」
   从"能配置"变成"可判分"的唯一通道，且不需要新能力，只投影既有事件流）。
   另外编排段刻意**不占纪律编号**（写成「编排（派子代理时）：…」而非「7) …」），
   这样 `base-system-discipline` 那条「编号连续 + 不含 7)」的守卫一字未改仍然有效，
   并补了一条锚点 `orchestration-rule-renumbered` 反向钉住它。
8. **item 7 的未做项②已落（2026-09-20，读数见 `outputs/w3-price-tag-readout-2026-09-20.md`）**：
   worker 的表价花费进三个面——spawn 回执一行、`agent_result.artifacts.spent_usd` +
   `price_calibrated`（done 与 failed 都带，失败也付过钱）、`wait_for_agents` 每行 + 整批合计。
   三条施工口径值得留档：
   ① **不开第二份价源**：只用 `routing/pricing` 的 `costUsd`/`priceOf`；没路由时按 worker 真实模型名
      （`glmDefaultModelName()`）经既有 `findSpecByNameOrId` 反查档位，不新建反查表、不新建价表。
   ② **不可知一律不折成 $0**：`scriptedWorkerModel` 打 `scripted: true` 自述标 ⇒ 冻结回放不给钱面
      （demo 是打包后主对话的缺省 provider，这里若报 $0 就是最近的假绿入口）；
      全未知时整批合计整行不印，部分未知写明「另有 N 个 worker 价格未知未计入」。
      被整批帽摘掉摘要的行**仍带花费**（帽摘散文，不摘读数）。
   ③ 实测代价：回执 +43 token/次 spawn、4-worker 收队 +84 token/次；`price_calibrated` 必须随读数同送
      （GLM 三档仍是占位数 ⇒ 这些数**不可**当省钱证据）。
   顺带可见但**未改**的一条现状：未开 `routing` 的 worker 恒走 `defaultWorkerModel`（= streamGlm），
   不跟随 `settings.model` / `M0A_PROVIDER`——回执现在写明 worker 真实模型名，
   「worker 是否必须跟随会话档位」留作独立裁决（不是本轮该 silently fix 的东西）。

9. **W1b 的前置读数已出（2026-09-23）⇒ 本项裁决：那道闸不建**（§3 的「先量占比再动终止语义」到此闭环）。
   复跑面 `replay:join-lapse`（`node --import tsx scripts/replay/join-lapse.ts`，判卷
   `tests/replay-join-lapse.test.ts`）量的正是 W1b 触发条件本身：**回合末仍有在途 worker 的 run 占比**。
   真语料 19 个 run 里派过活的 6 个（另 13 个无 worker 的会话**不**进分母，否则占比会被稀释成好看的 0）：
   **在途 = 0/6 个 run、0/12 个 worker**，「回执没读」也是 0/6。
   ⇒ 那道闸在现有全部轨迹上**一次也不会触发**，而它每次命中要多要一轮真钱 ⇒ **数据侧不支持建它**，
   默认值不再由纪律代答。若哪天有真会话派活后收束，复跑此面即可翻案。
   - 同一次读数顺手照出的另一条（不在 W1b 预算内，但同一面）：**主动收队缺席 3/6**——
     supervise 臂三次全部 `wait=0`，worker 是 harness 异步收尾的、不是模型等的
     ⇒ §5 那条「收队义务」纪律目前**没有可观测的遵守证据**，只是没造成损失（别把"没出事"读成"已做到"）。
   - 两条不外推的限定：① 样本只来自 3 个来源目录（同一实验的三次重复），生产会话面 0 条派活轨迹；
     ② 已实测 `ga-strategy.ts` 收束后**不** drain worker（`runLoop` 返回即复制事件流），
     所以在途确实会露出来——这条是"尺能红"的前提，已由单测锁住（造一条真在途必须报 1）。

10. **D8 的触发面已量出来（2026-09-24，`replay:latency`）**：`node --import tsx scripts/replay/latency.ts`
    （判卷 `tests/replay-latency.test.ts` 12 条）。真语料 19 个会话、**189 个含调用的轮**里，
    **6 个轮一次发了 ≥2 个工具调用，单轮最多 25 个；落在只读白名单里、可折进同一拍的调用 = 48 次**
    ⇒ §5 D8 的并发面**不是零**，与 item 9 那条"闸不建"是两件不同的事（那条量的是"有没有在途没收回"，
    这条量的是"同一拍里能不能并排跑"）。
    - 判据形状值得记：第一版把触发面判成「整轮**全部**是只读工具」，于是那个 25 调用的轮
      （23 个 `read_file` + 2 个别的）被整轮判为不可并发 ⇒ **读数 0，方向反了**。
      D8 自己写的是"白名单并发、写类串行"，所以可并的就是那一子集：改成逐轮累加
      `max(0, 只读调用数 − 1)`，并补一条"两读一写 ⇒ 可折 1 次"的用例钉住这个分歧格。
    - 另一半（**这些调用各花多少毫秒**）此前**根本不可测**：`createEventLog.append` 不盖时间戳，
      真语料 282 条 `tool_call` 的 `ts` 全缺 ⇒ 本轮起在落盘这一处统一盖（producer 自带的值不覆盖，
      不改写调用方对象）。旧语料在这一半上照常红着说「不可测」，不许读成"工具耗时 0ms"。
      配套代价如实报：四条「replay == 写入 / 两次 run 逐字节不变」判据改为**只剥 `ts` 一个键**后再比
      （`tests/helpers/stream-equals.ts`）——含 `action-fusion` 那条正是 D8/W4a 验收要用的那把尺。

11. **D8 裁决：有触发面，但收益上界不到一次模型往返 ⇒ 本轮不落地**（2026-09-24，
    读数与算法见 `outputs/d8-tool-cost-2026-09-24/00-裁决读数.md`）。三个数：
    ① 触发面 = **48 次**可折进同一拍的只读调用（`replay:latency`：189 轮里 6 轮 ≥2 个调用）；
    ② 白名单工具单次中位耗时（量发货实现 `TOOLS.<name>.run`，工作区=本仓）＝ read_file 2.3ms、
       glob 9.0ms、grep 14.9–20.1ms；③ 一次模型往返 = **8.7s–42s**（§7 G-A 三 rep 的「秒 ÷ 请求」）。
    折叠省时的**上界** = ①×②最慢一档 = **0.96s**——这已按"每次折叠都省掉一个 grep 全程"取满，
    真实省时是"除最长那条之外"的和，远小于它。对照 ③ 与整次 run 的 26–337s ⇒ **≤1% 全程墙钟**。
    而 D8 的代价是动 `runLoop` 这个共享内核（并发白名单 + `tool_result` 按模型下序落流 +
    单工具调用逐字节不变 + 并发帽）。按 §2 不变量 4 判为**不做**，§5 原文与设计不删。
    - 这条与 item 10 是同一课的下半段：**触发面 ≠ 收益**。决定值不值的是**被移除的那段时间**，
      不是"能不能移除"的次数。
    - 三条翻案条件（挂在可复跑读数上，不挂 SHA）：① 用户仓大到让白名单调用进数百毫秒以上 ⇒
      重跑 `measure-tool-cost.mts`（workspace 指过去）；② `impact_query` **未量**（运行期注入工具，
      真语料 0 次）⇒ 开了 `impactAnalysis` 的会话流上用 `replay:latency <路径>` 读它自己的分位；
      ③ 换 provider 后多调用轮变常见 ⇒ 复跑 `replay:latency`，但结论要连 ①② 一起看。


