# 停止原因零读者：被砍断的一轮原本记账成「成功」（2026-09-21）

## 一句话

三家 provider 每轮都送来「这一轮为什么停了」，本仓**四个适配器一个都没读**。于是被
`max_tokens` 拦腰砍断的一轮与答完的一轮在事件流里长得一模一样，而 loop 判任务结束的
唯一依据是「这一轮有没有 tool_call」 ⇒ **截断被记账成成功**。这是能力 5（执行-验证-修正）
与「返工少」的直接病灶：模型踩着半句话继续盖楼，harness 全程不知情。

## 实测证据（本轮全部可重跑）

1. **字段在线上一直存在**（不是"上游没给"）：冻结夹具逐字记着
   `fixtures/providers/anthropic/text-stream.sse:23` `stop_reason:"end_turn"`、
   `openai/text-stream.sse` `finish_reason:"stop"`、`gemini/text-stream.sse` `finishReason:"STOP"`。
2. **零读者**：`src/` 全树 `stop_reason|finish_reason|finishReason` 命中 **4 处**，
   全部是 `src/providers/{anthropic,openai,gemini}.ts` 与 `glm.ts` 注释里的**类型声明/注释**，
   读取点 **0**。`glm.ts` 整文件委托 `streamOpenAI`，所以实际是三家四适配器同一件事。
3. **判定面**：`src/agent/loop.ts:219-221` 对每个流事件只问 `output.type !== "tool_call"`
   就 continue；收束在 `:377 if (!sawToolCall) { ... return; }`。停止原因**从不参与**这个判定。
4. **同族只修了一半**（本轮最高价值的一条）：三个适配器各自的 C7 注释明写着
   「上游把一帧截断了…而流随后正常收尾会让本轮以「不完整输出」成功收束（**loop 无从得知**）」，
   并为此在 `JSON.parse` 失败时抛死。**同一个危害，认过一次错的地方通常只修了一半**——
   它管的是「半帧丢失」，没管「帧到齐但篇幅不够」，而后者才是日常发生的那一种。
5. **测试面也零覆盖**：`fixtures/providers/**` 12 份夹具里出现的停止原因只有
   `end_turn / tool_use / stop / tool_calls / STOP`（+ 若干 `null`）——
   **没有一份夹具走到过非正常收尾**。
6. **文档缺口**：`agent-plan.md` 里 `stop_reason` 零命中（唯一命中的 `stopReason` 是 §9.5
   hook 的 JSON 输出契约，另一码事）。这条不是"实现漏了方案"，是**方案本身没写**。

## 本轮落了什么（只到「感知」，没碰「动作」）

- `src/providers/stop-reason.ts`（新）：三家词表 → 中立结局（`completed / tool_use /
  output_budget / content_blocked / unknown`）；**未收录值一律 `unknown` 且不落证据**
  （「不知道」≠「知道它坏了」，把不知道说成坏就是自造证据）。
- `turn_truncated` 事件（`src/events/index.ts`）：**只在非正常收尾时落**——答完的轮
  零新事件，既有转录与 12 份冻结夹具字节不变。只存机器可读 token，界面文案留给渲染层投影。
- 三家适配器各接一处，payload 由**同一个** `turnTruncatedEvent()` 构造：一份政策两份实现，
  其中一支迟早悄悄少做几件事（sidechat 与 worker 回传的输出扫描就是这么撞车的）。
- `src/agent/context.ts`：`truncationNote()` 把截断投影成一行 `[harness]` 说明，
  **紧跟在被砍断那段正文之后**（不做「只投最新一份」：截断是发生在特定位置的既成事实，
  位置本身就是信息，摘掉旧的等于假装那半句完整过）。
- `src/agent/sidechat.ts`：主会话只读投影加一个 case（与 `error` 同档——那句回答不完整，
  是用户接着提问的前提事实）。
- `src/providers/mock.ts`：剧本允许带 `turn_truncated`。它原先只收
  `assistant_message/tool_call/usage` ⇒ 截断**在冻结剧本格式里根本表达不出来**，
  端到端那一跳（剧本 → `runLoop` → JSONL）没有观测者，只能靠测试里手写 provider 造——
  正是本仓点名的「只测被调的纯函数 = 把没接线洗成绿色」。理由与该文件第 18-20 行为 `usage`
  写下的那句一模一样，沿用而非另立。
- **跨轮真请求体证明**（`tests/turn-truncated.test.ts` 末段）：上一段只证明
  「`projectContext` 里有这一行」，而生产入口是**会话型 provider**（它以事件日志为唯一事实源、
  忽略 loop 传入的 messages）⇒ 「模型下一轮真的看得到」只能用
  `createGlmSessionProvider` + transport 抓包判。现在抓到了：说明紧跟在那半句正文之后，
  且**答完的一轮请求体里一个字都不多**（负控）。

### 顺手被结构性检查抓到的一件事

把 `turn_truncated` 加进 `AgentEvent` 联合后，`tsc` 当场点名 `sidechat.ts` 的
`renderProjectionLine`「缺结尾 return」——那是本仓刻意的**穷尽 switch**（新事件类型必须让
每个投影器表态）。**这就是 M7 影响面那条规矩在门内的样子**：不是靠人记得去 grep。

## 验证读数（工作树态，含并发会话的在飞 hunk）

- `TERM=dumb node node_modules/typescript/bin/tsc --noEmit` → 本轮触及面 0 错。
  唯一残留红因是**未跟踪草稿** `scripts/sidebar-probe.ts`（不属本轮、不属任何提交）。
  备案一条归因纪律：本轮第一次 tsc 里那条 `src/agent/sidechat.ts(110,47) TS2366` **起初被我
  记成对方在飞 hunk 的错，实测是自己造成的**——我给 `AgentEvent` 加了成员、还没补 sidechat
  的穷尽 switch。补上 case 后该行即消失，而对方那两个 hunk 全程无害。
  ⇒ 见到在飞文件的红，先按「我刚刚动了什么」验一遍再指认别人（规则 5 的镜像：误派的代价是
  让别人重做没坏的东西）。
- 全量 `test` → **182 files / 1697 tests passed，exit 0**（新事件类型未破任何投影/门）。
- 新增 `tests/turn-truncated.test.ts` **22 条**（解码器 6 / 三家适配器 6 / 落盘与投影 5 /
  剧本入口 3 / 跨轮真请求体 2）。

### 一次自我纠错（值得留，因为它暴露了主树测不出来的那类错）

首笔提交 `77b18f3` **HEAD 悬空**：测试文件把 `ModelOutput` 从 `../src/events` 导入，
而它的真身在 `../src/providers`。主树三重读数全部放行——
① `tsc` 是在**建这个测试文件之前**跑的（顺序错了，不是判断错了）；
② `test` 走 vitest，`import type` 编译期整体擦除，**运行时永不暴露**这类错；
③ 全量绿 + 门绿都不能反证类型干净。
抓到它的唯一一档证据 = **干净 HEAD 的隔离 worktree 重跑 tsc**（无未跟踪草稿、无在飞 hunk，
且文件集就是提交里那份）。已作为第二笔修复。

⇒ 教训成一条可复用的口径：**新增 `.ts` 文件后，tsc 必须在「文件已存在」的状态下重跑一次**；
且「先跑门、后写测」的次序等于没跑门。

### 分辨力实测（HEAD 隔离 worktree 手注入，主树零改动）
  | 注入 | 结果 |
  |---|---|
  | 三家 provider 的读取全摘 | **恰好 3 条红**（每家一条），6 条负控全绿 |
  | 只摘 anthropic 那一处 | **恰好 1 条红**（另两家不受影响 ⇒ 三条不是冗余副本） |
  ⇒ 三条 provider 用例各自有分辨力，且「正常收尾零事件」那三条负控不是恒真摆设。

## 刻意留的边界（别看成已完成）

**这一轮只让截断「可见」，没有让 harness「接着做完」。** `runLoop` 的收束语义一字未动
（测试里显式锁住 `requests === 1`）：截断后仍按原样返回，**不多要一轮模型**。

为什么不顺手做：自动续跑 = 每次截断多烧一轮真钱，而本仓对「花钱的动作」有一条硬规矩——
先拿准确率与 `$/成功任务` 的实测再决定开闸，不在零读数的情况下默认开。
所以动作那一半（在截断处续写 / 收窄范围重做）留作下一步，且它的**前置条件正好是本轮**：
没有停止原因，续跑策略连"该不该续"都判不出来。

同一条通道现在解锁了两件此前量不了的事：
1. **思考档位**（`0ae8c46` 那份量测文档点名「真前置是三家的停止原因全是零读者」）——
   现在有了读者，档位这一格动作空间才谈得上开。
2. **输出预留够不够**——`output_tokens` 第一次随截断一起落盘，
   「8192 的预留是否 binding」从猜测变成可数的事件。

## 第二程（同日，`b1780b5` + `25ab07d`）：把「看得到」推到两端

第一程的读数有一个共同短板：**全部是手写 provider**。这一程补两处真实入口。

1. **剧本格式收 `turn_truncated`**（`src/providers/mock.ts`）。原先只收
   `assistant_message/tool_call/usage` ⇒ 截断在冻结剧本里**根本写不出来**，
   端到端那一跳没有观测者。沿用该文件自己为 `usage` 写下的理由（「不许它 = 判据只能靠手工注入，
   而手工注入测不到生产那一跳」），并保留负控：`tool_result` 等运行时产物仍拒收
   ——放行它等于让剧本伪造工具回执。
2. **跨轮真请求体**：用 `createGlmSessionProvider` + transport 抓包判「模型下一轮真的看得到」
   （`projectContext` 有这一行 ≠ 模型看得到，会话型 provider 以事件日志为唯一事实源）。

新增后的读数（**clean HEAD 隔离 worktree**，非工作树态）：
- `tsc --noEmit` **0 错**；`tests/turn-truncated.test.ts` **22 条**；
  主树全量 `test` 182 files / **1702 passed** exit 0；`mutate-needles-check` 552 条 0 问题。
- **clean HEAD 全量**（`git worktree add --detach HEAD`，零在飞文件）：**180/182 files 绿**，
  唯二红是 `gated-tools` 与 `runner-gates`——**已定名的 worktree 专属假红**
  （fresh worktree 缺宿主本地安装态，`run_shell` 真实执行那类断言必红；本仓既有备案）。
  回主树复算这三只文件：**3 files passed**。⇒ HEAD 无待收口的红测。
  ⚠️ 这句的失效条件挂在「回主树复算即绿」这条可重跑读数上，不挂 SHA。
- 变异表本条通道累计 **+9**，逐条实跑**全杀**。
- 追加一次直接注入（把投影分支那句 `push` 摘掉）：跨轮那条**当场红**，
  报错原文印出真实请求体 `把 flush 讲清楚\nflush 的关键在于把`（说明确实不在里面），
  而同一组的负控**照样绿** ⇒ 这条判据不是摆设，也不是恒真。

## 第三程（同日，`serializeConversation` 那一支）：压缩会把它忘干净

第二程之后自检「还有哪儿看不见它」，撞到一个**属于本通道自己的静默漏洞**：
`src/agent/compaction.ts` 的摘要输入链（`assistant_delta / assistant_message / user_message /
tool_call / tool_result / clarify / plan / verify`）**没有 `turn_truncated`**，未匹配的类型被
if-else 链静默丢弃。后果不是"少一行"：压缩会**排除**被摘要掉的旧事件，所以摘要输入是截断
在长任务上**唯一的存活通道**——没有它，半句话会被摘成一条完整结论，而"最长的那条路"
恰恰是最容易撞 `max_tokens` 的那条。这与本文件开头立的是同一件事，只是这次被擦掉的
正是新加的读数本身。

修法一行分支（只落事实、不落劝告——摘要规范明写「不要提及压缩过程本身」，行内塞指令会与它打架）：
`[Assistant 回复被截断] 没写完就被收走（篇幅用尽，停止原因 max_tokens，已用 4096 输出 token）`，
两种原因各说各的话（下一步一个是续写、一个是改道，并成一句等于把选择权擦掉）。

**RED 是先跑出来再修的**：4 条新判据首跑即红，报错原文印出实际序列化结果
（`expected '[User] 把 flush 讲清楚\n[Assistant] flush…' to contain '[Assistant 回复被截断]'`），
负控那条照样绿——它本来就断言"不该出现"，前后都绿是设计如此，不是恒真。

顺手查过的两处**不改**（避免越界，也记下理由免得下轮又翻出来）：
- `prune.ts` 的 token 计量表把 `turn_truncated` 记成 0：它与 `usage`/`session_meta`/`verify_result`
  同列在"非大块内容事件"那一档，且 prune 只改写 `tool_result` 正文，碰不到这条事件。
- 该文件的调用面只有 `compaction.ts:589`（摘要输入）与 `tests/compaction.test.ts:196`，
  `scripts/` 里没有对 `[Assistant]`/`[Tool result` 标签的文本断言 ⇒ 新增一行不会打断任何门
  （规则 13 那条「改文案要扫 scripts/」这里扫过，零命中）。

## 第四程（同日）：goal 模式原本把「被打断」擦成「没产出」

按规则 50 自己去查剩下的折叠面，撞到**本通道最要紧的一处**：
`goal.ts` 的 `goalStopDecision` 在 `evidence === "absent" && !wrote` 时**停下来**，理由是
「这个目标没有可验证的产出，自动续跑只会白花钱」。而被 `max_tokens` 砍断的一轮
（没写盘、没验证、没 tool_call）恰好落进这一支 ⇒ **harness 把「被打断」擦成「没产出」并收摊**，
还反过来建议用户「纯问答类目标请关掉 goal 模式」。这与目标里
「遇到失败能重试、换路径，而不是卡死」「长任务能力」正相反，而且发生在**最不需要人盯着**的那条路上。

改法（`GoalDecisionInput.truncated` + `lastTurnWasTruncated`）：这一支先看原因再决定——
被收走的 continue，自己说完的才停。**安全性由判据次序免费得到**：轮次闸与美元闸都在这一支
**之前**判过，所以 continue 不可能换来无界花费；这一点不是口头承诺，有两条测例正面钉住
（轮次上限已用尽 + 被截断 ⇒ 仍 stop；美元上限已花到 + 被截断 ⇒ 仍 stop）。

`lastTurnWasTruncated` 的三条口径都各有测例，因为它们各自对应一种会静默失灵：
- 从流尾往回走，**第一个内容事件**才作数：usage / verify_result 是纯计量与纯证据事件，
  继续往回找——自动验证拍就落在截断之后，把它当"新内容"会让这条判据在最该 continue 的那一格失灵；
- 后面已经来了新 `user_message` ⇒ 打断不再是当前态（旧截断不该替这一轮说话）；
- `agent_id` 在场的（worker 子流）不算（§4.4.4：父目标只收 `agent_result`）。

**没有**把这件事同时写进 `goalReminder`：`decision.note` 在生产里**没有读者**（agent-runner 只用
`goalReminder`，note 被丢弃——又一处「算完就丢」，另案），而模型本来就能从 `truncationNote`
那条投影看到这个事实，再抄一份就是同一拍两份事实。

RED 的性质这一程要说清楚：新判据没法在 HEAD 上跑红，因为 HEAD 的 `goalStopDecision`
**连 `truncated` 这个参数都不存在**——不是"判错"，是"无从判"。所以本程用的是**结构论证**
（读 HEAD 第 117-123 行：那一支不看原因）+ 逐字回归锁（模型自己说完那一支的 stop 理由
原文一字未改）。把行为级 RED 补上的办法是变异：三条新锚点已覆盖（摘掉 continue 支 /
判据恒 false / 算了不挂进 view）。

**本程读数**（`tests/turn-truncated.test.ts` 现 **33** 条；全量 `test` 182 files / **1713** passed
exit 0；clean HEAD 隔离 worktree 上 `tsc` 0 错、本通道 14 条锚点**逐条全杀**、
针脚体检 557 条 0 阻断 / 0 待复认 / 0 未覆盖）。
数字是先单独取、回读输出后才写进这里的——本文件同日两处提交信息里的条数都填错过
（真值 1707 写成 1706、1713 写成 1715），根因是「测量与撰写写在同一条命令里」，
已在两处提交里各自点名更正。

## 第五程：四份评审跑出来的五处真缺陷（`7f548e2` + 表那一笔）

派了 TS / 安全 / 简化 / harness 四份评审，**逐条自己复跑后才动手**——五处成立，形状各不相同：

| # | 缺陷 | 为什么前四程没看见 |
|---|---|---|
| 1 | `withAgentId` 的类型白名单不收 `turn_truncated` ⇒ worker 的截断以「主会话上一轮没说完」落进父转录与父目标判据 | 规则 49/50 的反向形状：不是执行端不读，是**装饰/装载端不收**。我上一程刚立规矩，自己这一条就漏在另一张白名单上 |
| 2 | openai/glm：记录排在 `parseArgs` 之后，而被砍断的 `write_file` 参数正是抛的那一步 ⇒ 最常见的截断形状一条都发不出去，goal 仍看到 `truncated:false`，撞上第四程刚修的那一支 | 只测了「参数完整」的剧本，没测「参数半截」 |
| 3 | anthropic 用 `!== undefined` 而另两家写真值判断 ⇒ 后到的 `stop_reason:null` 帧抹掉已拿到的 `max_tokens` | 「同一条解析只硬化一支」的又一例 |
| 4 | `output_tokens` 是这条事件上唯一未过校验的字段，而它被拼进**滚动摘要的散文行** | 我在 `stop-reason.ts` 给 `stop_reason` 加了界，就以为整条有界 |
| 5 | 摘要行两因共用后半句 ⇒ 内容策略那支印出「中止（，停止原因 …」半截括号，而我的测例只断言含「内容策略」，绿着放过 | 断言太宽，不是实现错 |

外加一处**自证型绿色**（本仓第四次抓到同一形状）：一条断言拿 `truncationNote` 自己的输出当期望值，
永不可能红 ⇒ 换成字面文案。

`7f548e2` 一并补了渲染层 `EVENT_LABELS`：不补，卡片标题退回原始英文类型名（界面在说谎），
而**没有任何门看着标签覆盖率**（已另立任务）。

一处**刻意没锚**：openai 的「先记后刷」是两条语句的相对位置，写成单点 replace 就等于
「删掉这条记录」——那是另一条锚点在管的事。顺序由测例正面钉住。

一条协作事项值得记：我给 `withAgentId` 换行时抹掉了并发会话锚点 `verify-result-out-of-attribution`
的针脚（它按整行前缀匹配）。改指新字面量、语义逐字不变（仍然只摘 `verify_result`），
表里留了行内说明。**针脚体检先红后绿才算接住**——不是靠我记得。

**本程读数**：本文件 38 条；全量 `test` 183 files / 1729 passed exit 0；
`tsc` 本轮触及面 0 错（唯一红因是**另一会话正在写的 sandbox 三件套**，未碰）；
针脚体检 560 条 0 阻断；本通道锚点累计 **17**。

## 第六程（同日，`c549e6d`）：这条通道撞的第三面，与「静默白名单」这个通用形状

同一天里 `turn_truncated` 第三次以同一方式差点溜过去：**渲染层标签表没收它 ⇒ 卡片标题会退回
原始英文类型名**（界面上「看得见」，但说的是谎）。前两次分别是 `withAgentId` 白名单与
`serializeConversation` 的 if-else 链。三个面同属一个形状——**按类型白名单取料的静默面**：
少一个成员不报错、不红，只是少做一件事。

对照实验值得记：`sidechat.renderProjectionLine` 是**穷尽 switch**，加联合成员时 tsc 当场开口。
所以「要不要为这个形状建门」不是信仰问题，是**该面用哪种控制流**的问题。

`tests/event-type-coverage.test.ts` 的口径刻意做小（只判能判的）：
卡片集**按 `projectUnits` 的行为量出**（逐类型喂一条裸 `{type}`，不文本猜、不写死 fixture），
卡片型必须有 `EVENT_LABELS` 条目或自己的 `case`；注册表 ↔ 联合差集双向判空；标签表反向判死条目。
四道取料标记找不到即 `throw`——改名不能把这张闸抹成空集。

**一次自我纠偏（建门前的实测救了一次）**：评审建议的形状是「每个 EVENT_LABELS 都要覆盖全部类型」,
朴素探针读数 13/30 缺标签；逐条回读 `app.js` 后发现其中 **5 条有专属 `case` 分支**
（`error`/`clarify_requested`/`plan_proposed`/`plan_approved`/`compaction`）。收紧为
「标签 ∪ case」后缺口为 0——若照原口径建门，得到的是一个开局就要写五条假豁免的门。

注释里同样**不假装有门**：`withAgentId` / `compaction` 两面要泛化成「新类型必须进白名单」，
得先答上「worker 到底会发哪些类型」，而那个集合目前无人写过——写错即造假豁免。

**本程读数**：本文件 4 条；3 根锚点（`registry-drops-a-card-type` / `card-type-without-label` /
`label-for-a-non-card-type`）在 clean HEAD 隔离 worktree 实测**全杀**；建门前的手工注入
（删掉 `turn_truncated` 标签）同样把它自己判红。

## 第七程（同日，`ff56bb7`）：余下两支读数，与压缩的第四道质量闸

补完流式路径后仍盲的两支，都靠**先问「这条通道还有谁在用」**找到：

1. `stream:false` 在 `src/` 里只有一个真调用者——`glm-session.createGlmSummarizer`（压缩摘要器）。
   而 `openai.ts` 的非流式分支从不读 `choices[0].finish_reason`。合起来正好落在第三程那句结论上：
   **摘要是长任务上旧事件被排除后唯一的存活通道**，于是一份被 `length` 砍断的摘要会以最坏的形态
   通过——它替掉的旧事件不会再回来，这是本通道唯一**不可逆**的一面。
2. Gemini 被 prompt 级安全策略拦下时 **`candidates` 整个缺席**，原因只在 `promptFeedback.blockReason`；
   只读 `candidates[0].finishReason` 的那一条道永远撞不到它 ⇒ 这一轮在账面上是「答完了但没内容」。
   两字段互斥到值，末尾 `finishReason ?? blockReason`（候选级更具体）。

消费端一起补，否则就是第 10 次「两头断」：摘要器把事件透出成 `SummarizerOutput.truncated`
（值是线上停止原因原文），`runCompaction` 添**第四闸**——质量闸链从「空 / 超帽 / 膨胀」变成
「空 / **没收尾** / 超帽 / 膨胀」。被收走的摘要一律拒绝落流：宁可这次不压缩（旧事件留在流里、
一条不丢），也不让半句以完整结论的形态进记录。

另记一笔覆盖事实：`createGlmSummarizer` 此前在 `tests/` **零覆盖**（grep 该符号无命中），
本次改动正好落在它身上——纯函数有单测、装配点没人读，正是「两头断」的藏身处。

**本程读数**：`turn-truncated.test.ts` 45 条、`compaction.test.ts` 24 条；四文件批（含
`compact-wiring` / `hook-precompact-producer` / `glm` / `http-retry`）95 passed exit 0；
`tsc` 触及面 0 错；4 根新锚点（`openai-nonstream-blind` / `gemini-blind-to-prompt-feedback` /
`summarizer-hides-truncation` / `compaction-accepts-truncated-summary`）在 clean HEAD
隔离 worktree 实测**全杀**，主树零改动；针脚体检全表 0 阻断 / 0 待复认 / 0 未覆盖。

## 待办（按优先级）

1. 沉淀面：`failureDigestFromEvents`（能力 6/10）现在只看 `verify_result(ok:false)` 与
   `tool_result(ok:false)`——**截断两种都不属于**，所以它是失败轨迹里价值最高、
   沉淀器却完全看不见的一类。补进 digest。（⚠️ `src/agent/memory/distill.ts` 另有
   在飞 hunk，动前先确认对方已落库。）
2. 面板可见：渲染层按 `outcome` 出文案（main 只落 token 的规矩，#48 同口径）。
3. ~~门/锚点~~ **已落**：变异表本条通道累计 **+14**，逐条在 clean HEAD 隔离 worktree 实测**全杀**
   （`stop-reason-keeps-wire-text` / `-emits-on-benign-reason` / `-drops-case-fold` /
   `-hides-zero-output-tokens` / `anthropic-never-reads-stop-reason` /
   `openai-never-reads-finish-reason` / `gemini-never-reads-finish-reason` /
   `context-never-projects-truncation` / `mock-script-cannot-express-truncation` /
   `compaction-input-drops-truncation` / `compaction-merges-truncation-causes` /
   `goal-treats-truncation-as-no-output` / `goal-truncation-scan-blind` /
   `goal-view-drops-truncated-field`），主树一个字节未动；
   `pnpm mutate-needles-check` 报全表针脚 **0 阻断 / 0 待复认 / 0 未覆盖**
   （条数不写死——它是全仓共享的滚动数，事实源是该命令的输出，不是本行）。
   其中 `stop-reason-hides-zero-output-tokens` 是一条**通用形状**的针：
   `...(x !== null && x !== undefined ? {…} : {})` 被顺手改成 `...(x ? {…} : {})` ——
   `output_tokens = 0` 是读数，不是「没上报」。
   **追加（同日第六、七程，不回改上面那句「累计 +14」——那是该日快照）**：再 +7 根，
   同样逐条在 clean HEAD 隔离 worktree 实测全杀——`registry-drops-a-card-type` /
   `card-type-without-label` / `label-for-a-non-card-type`（清单闸三条）+
   `openai-nonstream-blind` / `gemini-blind-to-prompt-feedback` / `summarizer-hides-truncation` /
   `compaction-accepts-truncated-summary`（两支读数与第四闸）。
   计数口径写清楚，别拿总数当事实源：`grep -c 'test: "tests/turn-truncated.test.ts"' scripts/mutate-verify.mjs`。
4. 动作半（截断续跑）：需真钱 A/B，先出 `$` 与准确率两个数再裁默认值。
5. 词表余下的小口（本轮**刻意未动**，都不是静默面而是「映射该不该由我们替上游定」）：
   Gemini `pause_turn` / `server_tool_use`（流被服务端工具暂停，语义是「稍后继续」而非截断）、
   `OTHER` / `IMAGE_SAFETY`（`OTHER` 真意未知——把它折成任一档都是说谎，留在 `unknown` 更诚实）、
   `promptFeedback` 的 `blockReasonMessage` 未透出（人读的诊断文案，与本事件的「只落事实」口径冲突待定）。
   判据：`normalizeStopReason` 未命中即 `unknown` ⇒ 不落事件，所以这些是**少记账**不是记错账。
6. 三面一致闸的第二步（等前提凑齐再做）：若哪天有人把「worker 会发哪些类型」写成显式集合，
   `withAgentId` 与 `serializeConversation` 就能一起纳进 `event-type-coverage`；现在纳进来只能靠手列名单。

## 复算命令

```
TERM=dumb node node_modules/vitest/vitest.mjs run --config tests/vitest.config.ts tests/turn-truncated.test.ts
TERM=dumb node node_modules/vitest/vitest.mjs run --config tests/vitest.config.ts tests/event-type-coverage.test.ts tests/compaction.test.ts
TERM=dumb pnpm mutate-verify registry-drops-a-card-type card-type-without-label label-for-a-non-card-type \
  openai-nonstream-blind gemini-blind-to-prompt-feedback summarizer-hides-truncation compaction-accepts-truncated-summary
grep -c 'test: "tests/turn-truncated.test.ts"' scripts/mutate-verify.mjs   # 本通道锚点数（按 test 指向计）
grep -rn "stop_reason\|finish_reason\|finishReason" src/ | wc -l   # HEAD 实测 4（全是声明/注释）→ 本轮后 23
```
（`wc -l` 两边都数：单看修复后的 23 说明不了任何事，修复**前**那个 4 才是缺陷本身——
4 个命中全在类型声明与注释里，读取点为 0。）
分辨力注入法（不动主树）：`git worktree add --detach /tmp/x HEAD` + 软链 `node_modules`
→ 把 `src/` 同步进去 → `git checkout -- src/providers/{anthropic,openai,gemini}.ts` → 跑同一份测。
