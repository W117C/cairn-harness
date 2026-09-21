# 思考档位（effort）透传的参数面评估（2026-09-21）

> **结论先行**：「用 laya 决定当前任务用哪个模型 + 用哪档思考强度」这一问，前半句是已裁决的旧格
> （`outputs/laya-evaluation-2026-09-21.md` §5.2 否决清单里的「档位路由」，且对面已有三条选路支），
> **后半句是新的、而且是唯一值得做的**。但它卡的不是"谁来决策"，而是**动作本身不存在**：
> 渲染层那个五档滑块是一个没有任何读者的装饰，全仓零 `thinking` / `reasoning_effort` / `budget_tokens`
> 发侧字段，`Provider` 契约也没有 per-turn 通道。⇒ 本格的正确第一步不是接模型，是把写侧建起来并攒留痕。
>
> 本文只落事实与形状，**不改一行代码**。任务见 #1–#5（#1 = 本文）。

> **阅读前提**：基线 HEAD `977c67b`，全部读数为当日实跑（复跑命令见附录）。当日快照不回改；
> 引用前先重跑 —— ⚠️ `src/routing/bandit.ts` 在本文撰写时**有别的会话在飞改动**（`git status` 显 ` M`），
> 该文内坐标不在本文引用面内，但任务 #2 动 routing 时会撞同一个文件。

## 一、这一格的位置：为什么它是新的

| 提案句 | 现状 | 判定 |
|---|---|---|
| 「laya 决定用哪个模型」 | `src/routing/policy.ts` 三条支已存在：pin > bandit(Thompson Sampling) > 环角色档位表 + 降级链；bandit 的 reward 从**真终态**回灌 | 已裁否（laya §5.2），不重开 |
| 「laya 决定思考程度」 | **动作不存在**（下节 R1–R3、R7） | 新格；但接任何决策方（规则或学出来的）之前，缺的是写侧 + label 源，不是决策方 |

一条区分：本格的"决策方"问题与 laya 提案的"换判断主体"不冲突 —— 前者要在**一条尚不存在的通道**上
选人，后者是换已有通道的判据。§5.2 否的是后者。

## 二、仓内参数面实测（八条读数）

**R1 — `Provider` 契约没有 per-turn 参数通道。**
`src/providers/index.ts:33`：`stream(messages, tools?, call?)`，而 `ProviderCall`（`:26-28`）**只有一个字段**
`signal?: AbortSignal`。⇒ 加 effort 必先扩这个契约（这是接口变更，不是传参变更）。

**R2 — 发侧零命中，收侧已容错。**
全 `src` 零 `budget_tokens` / `reasoning_effort` / `thinkingConfig`；`thinking` 三处命中全是别的用途：
`agent/memory/inject.ts:40`（控制标签正则）、`providers/anthropic.ts:217`（**接收**侧"`thinking_delta` /
`signature_delta` 按未知优雅跳过"）、`agent/glm-session.ts:366`（注释，见 R4）。
⇒ Anthropic 支的**流解析**已经能吃 thinking 增量，缺的只是请求体不开它。

**R3 — worker 那条链连 `call` 都不收（两处，同族）。**
`providers/registry.ts:82` `RegistryWorkerModel = (messages, tools) => AsyncIterable`、
`agent/worker-model.ts:7` `WorkerModel = (messages, tools) => ...` —— 两个类型都没有第三个形参，
`toWorkerModel` 返回的 closure（`:103-124`）也逐字只转两参。
⇒ **设计结论（不是缺陷裁决）**：worker 的 effort 只能长在**构造期**（spawn 时定档，与 pin 同层）；
要 per-turn 就得同时扩这两个类型。主会话侧相反，见 R4。

**R4 — 主会话自己组装请求，落点有两处，别只改一支。**
`agent/glm-session.ts:641-642` 是主会话真正出网的那一跳（`streamGlm(msgs, {...}, tools, call)`，
tools 与 call **都传**）；而 `agent/loop.ts:184` 的中立适配器是 `provider.stream(messages, **undefined**, {signal})`
—— 工具面由 provider 内部自组装（`main/agent-runner.ts:1028` 的逐请求 `requestFace`）。
⇒ 同一条"per-turn 旋钮"有两个装配点。只改一处 = 本仓点名的「同族出口各抄一份」第六族变体。
顺带：`agent/glm-session.ts:366` 那句注释「非流式单轮调用（**thinking**/streaming 关）」里，
streaming 关是真的（走 `stream:false`），**thinking 关没有任何代码兑现** —— `streamGlm` 的 opts
（`providers/glm.ts:30-42`，字段只有 apiKey/model/endpoint/stream/fetchImpl/metering）**不含** `thinking`，
请求体（`providers/openai.ts:123-127`）只有 `model/messages/stream/stream_options/tools`。对照 §三第一条（GLM 侧多数模型**默认开**思考），
这条注释是一处「注释不是实现」，压缩摘要器可能在为它以为关掉的推理付钱。**未量化，属独立缺陷候选**。

**R5 — Anthropic 的 `max_tokens` 缺省 4096，且 src 内无人覆盖。**
`providers/anthropic.ts` 内 `maxTokens` 出现五处（`:19/:67/:107/:147/:164`），**全部在该文件内部**，
`:147` `opts.maxTokens ?? 4096`，`toWorkerModel` 也不传。
⇒ "抬 thinking 预算要同时抬 `max_tokens`"这一步会改动一个**从来没人调过的常量**，
影响面是所有 Anthropic 轮次的输出上限与计费 —— 不是加一个字段。

**R6 — OpenAI 兼容支已经有缝，缝上有血案。**
`providers/openai.ts:127` `if (opts.extraBody) Object.assign(body, opts.extraBody)`，唯一生产者
`providers/glm.ts:70`（塞 `tool_stream:true`）。
⚠️ **但这条缝只对 OpenAI 支开着**：`extraBody` 是 `OpenAiOptions:30` 的字段，`GlmOptions`（`:30-42`）
**不暴露**它 —— GLM 那份是 `toOpenAiOptions` 内部由 `glmToolStreamFlag(opts.stream)` 生成的固定值。
⇒ 任务 #3 在 GLM 支要**新开一个入参**（并决定它与 `tool_stream` 怎么合并成一次 `Object.assign`），
不是白捡的现成缝。而 `glm.ts:43-47` 记录着实测后果：
第三方 OpenAI 兼容中转**拒收未知字段**（`{"code":"UNKNOWN_FIELD","field":"tool_stream"}` / HTTP 400），
当时把整个 `provider:check` 和所有 worker spawn 的第一跳打死。
⇒ effort 字段是同一颗雷，必须显式关闭位（形状照 `glmToolStreamFlag` `glm.ts:49-57`：只认 `0|false|off`、
拼错不静默当关），且**不许按 host 猜** —— 该文件头注的原话理由今天仍成立。

**R7 — 渲染层那个五档滑块是装饰（本格的"零写侧"实证）。**
`renderer/app.js:2020` `THINK_LABELS = ['关','低','中','高','高+']`、`:2022` `let thinkValue = 2`；
`thinkValue` 在全部 `src` 的命中**只在 app.js 内部**（视觉/键盘：`:2028-2040`、`:2052-2053`、`:2091-2094`），
一处都没送出渲染层；`index.html:2067` 的 `#modelBtnEffort` 也只是被 `app.js:2036-2037` 回写文本。
⇒ 用户今天拨这个滑杆，改变的是**一个像素位置和一个标签文字**。

**R8 — 留痕面：`category` 是闭枚举，`bodySha256` 有记录无比较。**
`agent/metering.ts:101-113`：`beginRequest(category, serializedBody, prices)`，`:103` 对 category 做
`["main","summary","recall"]` 白名单并 `TypeError`，记录 bytes/chars/bodySha256/outcome/usage/cost。
⇒ (a) effort 标签**不该**塞进 meter 的 category（那是钱与拨号面的闭枚举），应落事件流（与
`routing_decision` 同族：决策先于实例化落流，`orchestrator.ts:498` 的理由是"崩溃后也能审计当时选了谁"）；
(b) 全仓 `bodySha256` 的消费者只有 `tests/metering.test.ts:34` 自己 ⇒ **请求体变了没有比较面**，
所以加字段不会撞现有守恒门，但也意味着今天没人审计"这轮和上轮请求体差在哪"。

**R9（顺带，同一条接缝）**：输入预算按 `maxOutputReserve: 8_192` 预留（`agent/compaction.ts:32`，
`agent/glm-session.ts:636-638` 用它做 fail-closed 硬闸），而 Anthropic 支实际发出的 `max_tokens` 是 4096（R5）
⇒ 预留大于允许，方向保守（不放大风险，只白扣 4096 输入额度），但两支数字无同源。

## 三、官方面（两条已核实、一条未证）

- **GLM（核实自智谱官方文档「深度思考」页）**：字段 `thinking: {"type": "enabled" | "disabled"}`；
  **多数模型默认 enabled**；GLM-4.5 起支持；另有 `reasoning_effort` 做推理优化；**部分版本禁止关闭**。
  ⇒ 我们一支都没发（R4）；"禁止关闭"这一条意味着"显式 disabled"不能当 universally safe 的缺省写法。
- **Anthropic（核实自官方 extended-thinking 文档）**：`thinking: {type:"enabled", budget_tokens:N}`，
  `budget_tokens` **下限 1024**，且 thinking token **计入本轮 `max_tokens`**，`max_tokens` 始终是总输出硬顶；
  特定旧模型的 interleaved thinking 另需 `interleaved-thinking-2025-05-14` beta 头。
  ⇒ 与 R5 合起来是硬约束：在当前 4096 缺省下，`budget_tokens` 只有 1024–4095 的空间，
  而且开了就会挤占可见回答的输出预算 —— 所以「高/高+」两档在我们现有 `max_tokens` 下**发不出去**。
- **Gemini（未证）**：`generationConfig.thinkingConfig` 一类字段本轮未核；`providers/gemini.ts:109,150`
  的 `toGeminiBody` 零 thinking 面。⇒ 接线前须单独核实，不要按 Anthropic/GLM 的形状推定。

## 四、由此得出的形状（给 #2–#5 的约束，不是实现）

1. **契约先行，且是一次真接口变更**：`ProviderCall` 加可选字段（缺省 undefined = 零行为，
   与本仓既有 `signal` 的加法同形状）；worker 侧另需扩 R3 那两个类型，或明确"worker 只有构造期档"。
2. **两个装配点一起改**（R4），并让单测同时打在两支上 —— 一支绿不算绿。
3. **缺省必须逐字等于现状**：不发新字段 ⇒ 请求体不变 ⇒ `bodySha256` 与现有回放测试不动。
   这与 laya §5.2 的"用户显式指令直达"是同一条纪律的两个方向。
4. **映射是我们自定的口径**：五档 ↔ `budget_tokens` / `reasoning_effort` / `thinking.type` 三家形状不同名，
   映射表必须是纯函数 + 单测（照 `routing/policy.ts` 的"纯函数、无 IO、可单测"形状），
   不得写成注释里的约定。
5. **中转兼容是产品问题不是 bug**：BYOK 用户走第三方中转是常态（R6 实证），
   所以每支都要有自己的"关"位并在留痕里报走了哪支。

## 五、不做什么（防回潮）

- **不接 laya 当 effort 决策方**，直到 §六的前置闸过线。R7 说明我们现在连"概率层的动作空间"都没有；
  先造动作，再造选动作的人。
- **不动用户显式指令面**：`/plan`、pin 档位属用户意志直达（laya §5.2 已裁）。
- **不把 effort 塞进 `metering` 的 category**（R8）。

## 六、前置闸（与 laya 轮同一条，逐字对齐）

接任何"学出来的 effort 决策方"之前需同时满足：① 生产留痕 ≥300 条可标行（本轮 R7 之后才开始计数）；
② 候选方能报「漏拦=0 约束下的免批覆盖率」+ ECE，只报 accuracy 不算；③ 提供方在包外（远端 HTTP），
否则 torch + 421M 权重进 unsigned DMG 这条分发否决仍然有效。
⇒ ①的口径要在 #5 里写死：**effort 的"好"不等于 verify 绿**（冻结靶面实测 `verifyOkLast` 绿 8/8，
结果面无 y 轴），候选口径是「同档 $/成功任务」与「达绿所需轮数」。

## 七、任务映射

| 任务 | 内容 | 依赖 |
|---|---|---|
| #1 | 本文 | — |
| #2 | 契约 + renderer→IPC→settings→loop 写侧（照抄 pin 通路 `orchestrator.ts:504`） | #1 |
| #3 | GLM/OpenAI：`extraBody` 透传 + UNKNOWN_FIELD 关闭位 | #2 |
| #4 | Anthropic：`thinking.budget_tokens` × `max_tokens=4096` 耦合裁决 | #2 |
| #5 | 留痕 + label 源（≥300 条可标行） | #2 |

**顺序建议**：#4 的裁决先于 #2 落地 —— `max_tokens` 那个常量的改法决定 #2 契约要不要同时带
"输出上限"这一维（R5 + §三第二条）。

## 附录：复跑命令

```sh
git rev-parse --short HEAD                                    # 本文基线 977c67b
git status --short src/providers src/renderer/app.js src/routing   # 在飞改动面（bandit.ts 当时为 M）

# R1/R2 发侧零命中（一律 -E，不用 \b/\s/\|：BSD grep 不支持且静默返回空）
grep -rnE "budget_tokens|reasoning_effort|thinkingConfig" src          # 期望 0 命中
grep -rni "thinking" src                                               # 期望 3 处，全部见 R2

# R3 worker 面不收 call
grep -rn "export type RegistryWorkerModel\|export type WorkerModel" src

# R5 Anthropic maxTokens 只在文件内部
grep -rn "maxTokens" src                                               # 期望 5 处，全在 providers/anthropic.ts

# R6 extraBody 唯一生产者
grep -rn "extraBody" src                                               # 定义/合并 + glm.ts:70

# R7 滑块不出口
grep -rn "thinkValue" src                                              # 命中全在 renderer/app.js

# R8 bodySha256 有记录无比较
grep -rn "bodySha256" src scripts tests                                # 除定义外只有 tests/metering.test.ts

# 官方面（两条已核实）
# https://docs.bigmodel.cn/cn/guide/capabilities/thinking
# https://platform.claude.com/docs/en/docs/build-with-claude/extended-thinking
```
