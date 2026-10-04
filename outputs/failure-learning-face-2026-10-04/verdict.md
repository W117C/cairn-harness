# 「失败轨迹 → 下次别这么干」这一格：HEAD 现读取证

取证对象：HEAD `a6a87627`（= `a6a87627b4520c05bb974a3c0dfeaf5586fabd79`，第 371 页）。
方式：只读。所有 HEAD 现状取料一律 `git show "${rev}:path" | cat -n`（zsh 下带 `${}`），
脏文件的**行号是 HEAD 行号**，与工作树不同（工作树有 171 笔别的会话的改动，见末节）。
未跑判卷 / typecheck / 任何 `scripts/*.ts` 门 / mutate-verify（认证在另一窗口跑）。

先记一句纠偏：本仓**没有** `src/agent/lessons.ts`。教训面住在 `src/agent/memory/lessons.ts`
（`git ls-tree -r --name-only "${rev}" | grep -i lesson` 只有这一条 + 两支判卷 + 两支读数脚本）。
记忆里的「lessons 有码无接线」这个负面结论，在 HEAD 上**已不成立**（下面 Q2 给读者链）。

---

## Q1 · 失败轨迹有没有落盘的面 —— 有，而且是两支

### 1.1 事件面：失败长什么样（`src/events/index.ts`）

| 形状 | 位置 | 关键字段 |
|---|---|---|
| 单次工具失败 | `src/events/index.ts:70` `ToolResultEvent` | `callId` / `ok: boolean` / `output`；`exitCode?` 在 `:73-77`、`timedOut?` `:78`、`blockedBy?` `:79-81`（「压根没执行」与「执行了但失败」刻意分列）、`hold?` `:81-84` |
| 验证拍失败 | `src/events/index.ts:172-189` `VerifyResultEvent` | `ok` `attempt` `maxAttempts` `results[]` `cause?` `agent_id?` |
| 单条命令失败 | `src/events/index.ts:162-170` `VerifyCommandResult` | `command` `ok` `output` `cause?` `exitCode?` |
| 归因枚举 | `src/events/index.ts:141-148` `VerifyCause`（7 值） | 缺省（字段缺席）= `code` |
| 环境红唯一谓词 | `src/events/index.ts:153-155` `ENV_VERIFY_CAUSE_SET` + `:158-160` `isEnvVerifyCause()` | 「别照它改代码」那一类：`timeout`/`toolchain-missing`/`no-surface`/`hook-error`/`pkg-manager`/`not-run` |

落盘出口（模型侧看到的与盘上同一份）：`src/agent/loop.ts:544-551`（通用工具块，`ok: result.ok`）、
`src/agent/loop.ts:317-326`（verify 拍的第二声 `tool_result` 回声）。

### 1.2 跨会话载体 A：带证据指针的教训条目（M6，纯函数提炼、不经模型）

- 提炼：`src/agent/memory/lessons.ts:107` `distillLessons(events, logPath)`，三类来源
  - ①验证红（环境红不进）`src/agent/memory/lessons.ts:133-154`
  - ②同一工具连败 ≥2（`TOOL_STREAK_MIN` 在 `:34`）`:156-183`
  - ③同一 (工具,参数) 逐字重复 ≥2 且**只算写向工具**（`REPEAT_ACTION_MIN` `:36`，收窄理由 `:185-193`，谓词复用 `src/agent/write-face.ts` 的 `mayHaveWrittenDisk`，调用点 `src/agent/memory/lessons.ts:197`）
- 硬门（「无证据 ⇒ 不产出」是产出路径而不是事后过滤）：`:109`（session 取不出 ⇒ 全废）、
  `:143`（verify 无 callId）、`:167`（tool_result 无归属工具 ⇒ 不记 unknown）、`:253`（无出处 ⇒ 抛，不降级）
- 指针的机器可解析锚：`src/agent/memory/lessons.ts:78-81` `evidence-line:` / `session-line:`，写形 `:83-98`
- 落盘：`src/agent/memory/distill.ts:148-182` `writeLessons()` → `:168` `writeTopic(dir, topic, "feedback", body)`
  （类型常量 `src/agent/memory/lessons.ts:258`）；写失败留痕 `src/agent/memory/distill.ts:171-178`
- **进生产链的那一行**：`src/agent/memory/distill.ts:202`（在 `runSessionEndDistill` 内、调 provider **之前**，理由 `:199-201`）
- 会话结束真的调它：`src/main/agent-runner.ts:1872`（HEAD 行号），开关 `:1873`
  `enabled: autoMemory && opts.mode !== "read-only" && opts.unattended !== true`
- 另一支（同一批失败的第二种消费）：`src/agent/memory/distill.ts:105-129` `failureDigestFromEvents()`
  的**计数**摘要 → `:198/:203/:209` 拼进沉淀指令 → `ephemeralUserTurn` 送请求末尾。
  这支交模型自由总结（`type=feedback` 引导在 `src/agent/memory/distill.ts:128`），产出走 `src/tools/remember.ts:138/143` 的审批面。

### 1.3 只在本轮内、**不落盘**的那几个面（逐个核过）

| 面 | 判据在哪 | 结局 |
|---|---|---|
| 无进展阶梯 | `src/agent/no-progress.ts:179-203` `noProgressLadder`，`escalate` 级定义 `:165`/`:174` | 唯一生产消费者 `src/agent/loop.ts:299-316`（注释 `:292` 自陈「此前全树零消费者」）。它只往那一拍 `tool_result` 的 `output` 里拼一行 `:313-315`，每个 rules 组合只出一次 `:316`。**无任何持久写。** |
| supervisor escalate | `src/agent/supervisor.ts:49-61`（`kind:"escalate"`，枚举 `:19`） | 消费者 `src/agent/orchestrator.ts:1214-1217`：只 `rejectRings` + 返回一行给人看的文本 + 保留最终环 worktree（现场说明 `:1522` 一带）。**不写任何跨会话面。** 但它以 `ok:false` 落进事件流（出口 `src/agent/loop.ts:544-547`），**可以被 1.2 的来源② 二次捞起**——离线读数里确有这条实例：`outputs/m6-acceptance-2026-10-01/lessons-offline.log` 的 `lesson-tool-streak-spawn_agent`。（这一格是形状推导 + 离线读数佐证，**无判卷**。） |
| recovery（`recovery.ts` 与 `recov-*` 两种拼法都搜过） | `src/agent/recovery.ts:41` `recoveryParentMode` / `:61` `interruptedWorkers` / `:76` `respawnArgsFrom` | 崩溃后**重派 worker**（权限父档回推、幂等标 failed）。是恢复面，不是经验面：无持久沉淀。文件名探针：`git ls-tree -r --name-only "${rev}" | grep -i recov` 在 `src/` 下只命中 `src/agent/recovery.ts`（正控：同一条探针在 `recovery` 上命中 17 条，探针有分辨力）。 |
| 工具/skill 选择面 | `src/agent/tool-choice.ts:1-7` 自陈「从既有事件流纯投影读数，**不加模型面、不加决策**」 | 只数 `failures`/`failRate`（`:16-21`），不回灌。靶场读数 `src/agent/gym/tool-choice.ts` 同理（`:17-21` 面不同就不许比）。 |

### 1.4 真正闭环的第二支载体：路由 bandit（学的是「哪个模型臂划算」，不是「下次别这么干」）

- 写：`src/agent/orchestrator.ts:1953-1969` `rewardBandit()` → `:1965` `updatePriced` + `:1966` `saveBanditState`
  （失败判据 `:1963`：`done` 但客观证据 `failed`/`stale` 记 0）；调用点 `src/agent/orchestrator.ts:1998`
- 读：`src/agent/orchestrator.ts:1928-1947` 懒加载 → `:565-586` 把 posteriors 喂 `routeFor`
- 机器：`src/routing/bandit.ts:101` `update` / `:117` `updatePriced` / `:144` `loadBanditState` / `:160` `saveBanditState`
- 开关：`src/main/agent-runner.ts:344-346`（HEAD 行号）——默认关，要 `routingBandit` 设置项
- 与 1.2 的区别：这一支**学的是模型档位**（钱/成功率），且**有判卷钉住写后 reload**（`tests/bandit-runtime.test.ts:69-100`、`:102-123`）。

---

## Q2 · 读回来的路径存在吗 —— 存在，不是「只写不读」

读者链（逐跳，全在 HEAD 现读）：

1. 认条目：`src/agent/memory/inject.ts:146-167` `lessonsSection()`
   —— `:147` 只收 `LESSON_TOPIC_PREFIX`（常量 `src/agent/memory/lessons.ts:76`）、`:149` 按 frontmatter `modified` 倒序、
   `:150` 先筛能读的那几份再切 `limit`（纯函数 `:182-192`）、`:153-157` 逐条 `readTopicBody` → 解析 → 成行。
2. 从**盘上正文**解析出处：`src/agent/memory/lessons.ts:235-248` `parseLessonDigest()`
   —— 指针在而那行内容为空也算不合格（`:243`，这一格是第 312 页补的）；解析不出 ⇒ `src/agent/memory/inject.ts:156` `continue`。
   ⇒ 「无出处不写盘」与「无出处不注入」是同一道门的两端。
3. 成行：`src/agent/memory/lessons.ts:252-255` `lessonLine()`（抬头 + 逐字出处，缺出处直接抛）。
4. 装进上下文：`src/agent/memory/inject.ts:267` —— 教训段被排进 `projectSections`，
   且刻意放**最后**（理由 `:265-266`：超限是从各段首部整行丢弃、保尾部）。渲染 `:233-249`，段头 `:170-172`。
5. **谁在什么时候读**：`src/agent/glm-session.ts:922`（`buildMemoryInjectionSafe({ workspace })`），
   位置在会话型 provider 的 `stream()` 里 ⇒ **每轮组装重读重注**（同文件 `:919-921` 注释；压缩后自然重注）。
   → `src/agent/glm-session.ts:1052-1057` 交 `composeTurnMessages({memory, memoryNote})`
   → `src/agent/glm-session.ts:622-623` 落成 `role:"system"` 消息（`:625` 是没注入时的出声）。
6. 另两个消费者同一条出口：worker 任务书 `src/agent/worker-prompt.ts:59`、旁路问答 `src/agent/sidechat.ts:273-274`
   （共用 `src/agent/memory/inject.ts:346-352` `buildMemoryInjectionSafe`；降级措辞 `:336-339`）。
7. 生产入口闭合：`src/main/agent-runner.ts:1394`（HEAD 行号）真会话走 `createGlmSessionProvider` ⇒ 第 5 跳在真实链上。

结论：**写面有、读面也有。** 记忆里的「只写不读」在 HEAD 上不成立。

但读面有三个**真实**的边界，别把它们读成「闭环已成立」：

- `src/main/agent-runner.ts:1873`（HEAD 行号）把**整支** `runSessionEndDistill` 关在
  `autoMemory && mode!=="read-only" && unattended!==true` 之后。而确定性教训写盘（`src/agent/memory/distill.ts:202`）
  压根不需要审批（它自陈绕过了 remember 的审批面：`src/agent/memory/distill.ts:139-140`）
  ⇒ 无人值守/定时 run（`src/main/agent-runner.ts:1163-1166`，HEAD 行号）**一条教训都不产**，尽管那一支不会因审批被拒而空转。
- 读者无条件（`src/agent/glm-session.ts:922` 每轮读盘），所以「关掉的只是产、不是消费」：盘上旧教训照样进上下文。
- `src/agent/memory/inject.ts:335` 明写：这一格**不给**模型「那你自己去读某个路径」的出路。

---

## Q3 · 判卷钉的是「读回来并改变了行为」，还是只钉纯函数/落盘格式

### 3.1 已经钉住的（有，但不闭环）

- **真写盘往返**（格式 + 索引行 + frontmatter）：`tests/memory-lessons.test.ts:211-232`（真 `mkdtemp`，`writeLessons` → 读 `.md` 与 `MEMORY.md` 索引行 `:231`）；
  写失败不连累结局且留痕 `:234-250`。
- **真读回**（盘上条目 → 注入块逐字行）：`tests/memory-lessons.test.ts:268-361`
  —— 倒序与出处 `:271-286`；无证据指针不注入 `:288-304`；空指针与缺指针同门 `:309-316`；
  一份坏数据不吃整段 `:318-341`；`lessonsLimit` `:348-361`；不绕过 token 预算 `:363-376`。
- **隔离面**：`tests/memory-lesson-isolation.test.ts:82-115`（真盘，段头计数、点名行、槽位）。
- **消费者出声**：`tests/memory-degradation.test.ts:99-106`（真 `buildWorkerSystemMessages`）、
  `:108-117`（真 `buildSidechatContext`）、`:119-125`、落位纪律 `:127-141`；
  正控 `:82`（同触发下教训**真进了 project 段**）；唯一出口守卫 `:154-161`。
- **变异锚点两枚**：`scripts/mutate-verify.mjs:12660-12668`（摘 `lessons.ts` 空指针门）、
  `:12669-12681`（注入侧现造 digest，desc 明写「这条 killer 钉的是**行为**」）——`expectFail` 都打在 `tests/memory-lessons.test.ts`。
  （该文件工作树是脏的，行号为 HEAD。）
- **沉淀轮请求形状走真 `runAgent`**：`tests/session-wiring.test.ts:57-93`、`:105-125`、`:133+`（HEAD 行号；工作树脏）。

### 3.2 没钉住的三格（每格都配了探针正控）

1. **没有一条判卷钉「`runSessionEndDistill` 真的调了 `writeLessons`」**
   （即 `src/agent/memory/distill.ts:202` 这一行是裸的）。现读：
   - `tests/memory-lessons.test.ts` 里 `runSessionEndDistill` 只出现一次，且是 `enabled:false`（`:252-265`）；
   - `tests/distill.test.ts` 六处 `enabled:true`（`:87 :107 :165 :179 :191 :236`）断的全是**指令文本**与结局分型，
     全文对 `lesson|topic|\.agent/memory` 的命中只有 1 行、且那是 remember 的 args（`:223`）
     ——正控：同一条 grep 在 `tests/memory-lessons.test.ts` 命中 44 行。
   ⇒ 摘掉 `src/agent/memory/distill.ts:202`：`writeLessons` 的直测（`:211-232`）照样绿，其余全绿。**无人报错。**
2. **没有一条判卷钉「会话结束这个调用点在」**
   （`src/main/agent-runner.ts:1872`）。`scripts/memory-check.ts` 的门面（A–G，见其 `:1-7` 自陈）**没有一条涉及 lesson**
   （探针：`git show "${rev}:scripts/memory-check.ts" | grep -ic lesson` = 0；正控 `memory` 命中 >0）。
3. **没有一条判卷钉「教训真的进到发给模型的请求体」**。
   `tests/` 里 14 个用 `createGlmSessionProvider` 的文件，`LESSONS|〔证据|证据指针` 计数**全为 0**；
   其中 6 个还把 `memory/inject` mock 成空壳（`tests/context-auto-verify-note.test.ts:18`、
   `tests/final-budget.test.ts:5`、`tests/model-surface.test.ts:16`、`tests/session-provider.test.ts:10`、
   `tests/session-prune-attachments.test.ts:15`、`tests/surface-account.test.ts:24`）。
   断「真请求体里含 `[LESSONS 最近` / `〔证据: …#callId〕`」的判卷：全仓 0 条。
4. **行为证人：没有，而且被自己声明为不可达。**
   `scripts/replay/lessons-round-ab.ts` 全文 `throw|expect|assert` 命中 **0**（纯 `console.log` 读数），
   它头部 `:1-13` 明写业主定的「两轮 A/B 比同类失败率」在本仓**结构不可达**：
   mock provider 忽略 messages（`:8-9`），而 `runLoop` 里没有注入点（`:10-11`；
   探针：`src/agent/loop.ts` 里 `lesson|memory` 命中 0、同文件 `no-progress` 命中 6 ⇒ 探针有分辨力）。
   并且它在 HEAD **既不在门表也不在 npm scripts**：`scripts/gate-manifest.ts` 与 `package.json` 对 `lesson` 的命中都是 0
   （正控：`package.json` 有 `memory-check`）。⇒ 连那半截「读数」现在也没有常驻入口。
5. **产出侧真实读数 stale**：非零产出只有 `outputs/m6-acceptance-2026-10-01/lessons-offline.log`
   （21 份日志，若干非零，逐条带 `session#callId`）。但那是 2026-10-01 的判据；HEAD 已把来源③ 收窄到写向工具
   （`src/agent/memory/lessons.ts:185-194`）并改了签名分隔符写法（`:198-202`）⇒ **HEAD 口径的产出条数未现读**
   （本轮禁止跑门；缺的一步就是 `node --import tsx scripts/replay/lessons-offline.ts` 在干净树重跑一次）。

### 3.3 判定

**接线是通的（写有链、读有链），但闭环没有证人。**
准确说法不是「只写不读」，也不是「只有骨架」，而是：
**两端各自有判卷、接缝一处都没有**——提炼器与注入器都被真盘往返钉着，
而「会话结束真的调用提炼」和「提炼结果真的到达模型」这两个接缝点，摘掉不会有任何判卷变红。

---

## 这一格要真能用，缺的最小一块是什么

**一块就够：一枚走真 `runAgent` 的「A 轮失败 → 盘上 lesson → B 轮请求体含该 lesson 行」端到端判卷。**
它同时封掉 3.2 的第 1、2、3 格，形状现学现用（`tests/session-wiring.test.ts:57-93` 已经证明 stub `fetch` 走真 `runAgent` 这条路是可行的）。

最小配方（不需要新机制、不改任何判据）：

1. A 轮：临时 workspace + 一条含非环境红（`cause` 缺席或 `code`）的剧本，跑 `runAgent`，
   断言 `<workspace>/.agent/memory/lesson-*.md` 落盘、`MEMORY.md` 索引行在（复用 `tests/memory-lessons.test.ts:231` 那条口径）。
2. B 轮：**同一 workspace 再 `runAgent` 一次**，断言第二次出网请求体里
   出现 `[LESSONS 最近` 与 `〔证据: ` 那一行（`src/agent/memory/lessons.ts:254` 的形状）。
   ⇒ 这一条同时是「调用点在」与「读者接到了」的证人。
3. 反向守卫两条：`enabled:false` 那一路（unattended / read-only）B 轮请求体里**不许**出现该行；
   盘上手写一条无 `evidence-line:` 的条目，B 轮该行**不许**出现（复用 `tests/memory-lessons.test.ts:288-304` 的门）。
4. 配套两枚变异锚点：摘 `src/agent/memory/distill.ts:202` 那一行、摘 `src/agent/memory/inject.ts:267` 里 `lessonsSection(...)` 那一项；
   killer 必须指向第 1/2 这两条，而不是现有那两条直测。

顺带两条**不是接线**、但会让这一格半空的口径项（各自都只需动一两行，列在这里供 owner 裁决，本轮不判）：

- `src/main/agent-runner.ts:1873`：把确定性教训写盘从 `enabled`（那支需要审批的沉淀轮）里拆出来，
  无人值守 run 至少能产教训——依据写在 `src/agent/memory/distill.ts:139-140`（它本来就不走审批面）。
- 常驻入口缺失：`scripts/replay/lessons-round-ab.ts` / `lessons-offline.ts` 既不在 `package.json` 也不在
  `scripts/gate-manifest.ts`，HEAD 上属于「有过一次读数、此后没人再跑」。

---

## 涉及文件当前是干净还是在隔壁手里

`git status --porcelain -- <path>` 现读（工作树 171 笔脏）：

**在隔壁手里（脏 ⇒ 本报告行号只对其 HEAD 版本成立）**

- `src/main/agent-runner.ts`（写面调用点 `:1872`、bandit 开关 `:344`、真 provider `:1394`）
- `src/agent/loop.ts`（事件落盘 `:544-551`、no-progress 消费 `:299-316`）
- `src/agent/orchestrator.ts`（escalate `:1214-1217`、bandit `:1928-1969`）
- `src/agent/memory/store.ts`（`writeTopic` 落盘原语）
- `src/agent/recovery.ts`、`src/routing/bandit.ts`
- `tests/session-wiring.test.ts`（最小那块要抄的那条链就在这文件里）、`tests/bandit-runtime.test.ts`
- `scripts/mutate-verify.mjs`（锚点表）、`scripts/memory-check.ts`、`scripts/replay/corpus.ts`

**干净（可直接动）**

- `src/agent/memory/lessons.ts`、`src/agent/memory/distill.ts`（第 1 步要钉的 `:202` 就在这支）、`src/agent/memory/inject.ts`
- `src/agent/no-progress.ts`、`src/agent/supervisor.ts`、`src/agent/sidechat.ts`、`src/agent/worker-prompt.ts`、`src/agent/glm-session.ts`
- `src/events/index.ts`、`src/tools/remember.ts`
- `tests/memory-lessons.test.ts`、`tests/memory-lesson-isolation.test.ts`、`tests/memory-degradation.test.ts`、
  `tests/memory-runner.test.ts`、`tests/distill.test.ts`
- `scripts/replay/lessons-round-ab.ts`、`scripts/replay/lessons-offline.ts`
- 判卷落点建议新建 `tests/memory-roundtrip-runner.test.ts`（新文件，不与任何在飞改动相撞）；
  若坚持追加进 `tests/session-wiring.test.ts`，需先等隔壁那笔落库。
