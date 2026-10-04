# #73 第二半：`buildSkillRoutingList(..., query)` 的接线面取证（2026-10-05 现读）

口径：取证时 HEAD = `19dfa23c`（"S3 接线补完"）。**只读取证**，未跑 vitest／typecheck／任何 `scripts/*-check.ts`／`mutate-verify`。
脏/净一律按 `git status --porcelain -- <path>` 现判：干净的文件直读工作树（= HEAD），
脏的文件（`src/agent/glm-session.ts`、`tests/session-tools.test.ts`）一律按 HEAD 读，引号里的行号是 **HEAD 行号**，
并附工作树行号（该文件在飞的改动只落在 71–406 行的 `gateToolSpecs` 工具说明书区，**其下所有行整体 +41**）。

台账里记的 `agent-runner.ts:1707` **已漂**：`git show 19dfa23c^:src/main/agent-runner.ts` 里那句确实在 1707，
本笔 S3（给 `RunOptions.trustedRepo` 接线）把它推到 **`src/main/agent-runner.ts:1715`**。

---

## 问一：清单在哪一拍被组装、装进哪条消息；有哪些当轮可用的取料点

### 1.1 生产链路上唯一的组装拍（run 起点，每**轮用户消息**一次）

| 拍 | 位置 |
|---|---|
| 会话级插件装载 | `src/main/agent-runner.ts:1658-1668`（`PluginRuntime.load` + `connectMcp` + `installPluginTools`） |
| 命令/skill 用户侧展开 | `:1672`（`expanded`）、`:1680-1683`（`skillFace` → `promptText`） |
| 钩子上下文 | `:1696-1713`（SessionStart / UserPromptSubmit） |
| **清单组装（唯一生产点）** | **`src/main/agent-runner.ts:1715`** `const skillsRouting = rt && rt.routingList().text !== "" ? rt.routingList().text : null;` |
| 交给 provider | `:1774`（`createProvider(promptText, systemPromptFor(opts.mode), …)`）→ `:1779-1783`（`plugins: { skillsRouting, hookContext, deriveRemount }`） |
| provider 形参 | `:1371` `createProvider`，`plugins` 槽声明在 `:1377` |
| 进模型面的哪一块 | `src/agent/glm-session.ts` HEAD `:738-746` `pluginContext()`（HEAD `:740` 把 `opts.plugins.skillsRouting` 当**第一段**拼）→ HEAD `:926` `let skillsBlock = pluginContext(events, liveNote)`（每请求一次）→ HEAD `:1046` 压缩后重组装时**再算一次** |
| 最终落成哪条消息 | HEAD `:592` `composeTurnMessages` → **HEAD `:626`** `if (opts.skills) msgs.push({ role: "system", content: opts.skills })`：**独立的一条 `role:"system"` 消息**，排在 base system（HEAD `:621`）与两段记忆（`:622-623`）之后、符号地图之前 |
| 清单本体 | `src/agent/plugins/index.ts:407-413`（`routingList()`；`:412` 是 `buildSkillRoutingList(this.skills(), roleLines)` ← **query 的缺口就在这里**）→ 纯函数 `src/agent/plugins/skills.ts:194-229` |

要点：**清单字符串在 provider 构造时冻结一次**（`:1715` → `:1780` 传的是 primitive），此后每请求/压缩后重挂都复用同一份字节；
`runAgent` 每轮用户消息进一次（`:2106` 的 goal 续跑也重新进 `runAgent`）⇒ 冻结粒度 = **一轮用户消息**，不是整个会话。
（顺带：`:1715` 把 `rt.routingList()` 调了两次——条件一次、取 `.text` 一次。）

### 1.2 候选取料点（逐个带行号与主动取料代价）

**A 类：`agent-runner.ts` run 起点，当轮已在手（取料代价 0）**

1. `opts.message` — 字段声明 `src/main/agent-runner.ts:1327`，本轮用户**原文**（斜杠未展开）。代价 0。
   注意 goal 续跑轮里它不是人话而是 harness 生成的提醒：`:2149-2152` `message = next.message`，正文 =
   `src/agent/goal.ts:205-207` `goalReminder` 的 `"[goal 续跑…] 目标：" + clampToTokenBudget(spec.objective…)` ⇒ **目标原文就在里面**，
   所以这一条对 goal 路也够用（`opts.goalTurn` 本身 `:1352` 只带 `turn/max_turns`，**没有文本**）。
2. `expanded.text` — `:1672` 的返回（命令展开后、skill 未展开前）。代价 0。命中插件命令时它已是渲染后的命令正文。
3. `promptText` — `:1683`（= `skillFace.text`，命令与**用户侧 skill 都展开完**的那份，也是 `:1792` 真正交给 loop 的文本）。
   代价 0，但**不能当 query**：用户敲 `/skill …` 命中时它是 `src/agent/plugins/skills.ts:418-421` 渲染并按 5000 token 裁过的 **SKILL.md 正文**
   （`expandSkillInvocation` `:402-424`），拿它排序就是"按 skill 自己的用词给自己排名"，与用户想干什么无关。
4. 显式点名的调用名 — `:1686-1693`（`expanded.invoked` / `skillFace.hit.invoke`）。代价 0。
   命中即"用户已经点名"，此时清单的相关性其实无所谓（模型直接就能看见那条），可作为"整条跳过排序"的信号。
5. `hookContext` — `:1696`/`:1700`/`:1710`。代价 0，但它是插件作者注入的上下文，不是本轮任务文本；用它当 query 会把插件的措辞变成排名依据。
6. `opts.attachments` 路径 — `:1333`。代价 0，只是路径串（可当弱信号：附件文件名命中 skill 名）。
7. 事件流里**上一条** user_message（`replay(opts.logPath)` 现读）— `:1715` 这一拍**盘上还没有本轮那条**：
   `user_message` 由 loop 在 `src/agent/loop.ts:360-366` 落盘，而 loop 是 `:1767` 才起的。代价 = **多一次 JSONL 全量 replay**
   （provider 自己有增量重放 `glm-session.ts` HEAD `:904`，run 起点这次是重复 IO），且拿到的永远是**上一轮**的话题 ⇒ 对本轮排名是滞后信号。
8. plan / goal 的状态文本 — plan 只有布尔 `:1345 planRequired`，**无文本**；goal 的 objective 要 `projectGoal(await replay(logPath))`
   （现读样板在 `:2158`）⇒ 与 7 同代价（多读一次事件），收益已被 1（goal 续跑轮的 message 自带 objective）覆盖大半。

**B 类：`glm-session.ts` 逐请求那一拍（新鲜，但要动隔壁在飞的文件）**

9. `lastUserContent(events)` — HEAD `:818-822`（工作树 `:859`）：**已经存在、且已经在每请求现读**的取料点，
   消费者是符号地图 `queryText`（HEAD `:938`）。events 在 HEAD `:904` 已到手 ⇒ **取料代价≈0**。
   但清单在这一拍是 `opts.plugins.skillsRouting`（HEAD `:670` 类型 = `string`），要按当轮 query 重算就必须把它变成
   闭包/函数（同 `deriveRemount: (events) => string | null` 的形状，HEAD `:672`、生产端 `agent-runner.ts:1782` 已有先例）⇒
   改动面 = `glm-session.ts` HEAD `:670`（类型）+ `:738-746`（`pluginContext` 调用点）+ `agent-runner.ts:1779-1783`（生产者）
   \+ **两份类型副本**：`tests/surface-account.test.ts:48`（自己重declare了一遍 `plugins` 形状）、
   `tests/session-provider.test.ts:105,119`（传字面串）。压缩后重挂那一拍（HEAD `:1046`）会自然拿到新 query。
10. 压缩后的重建点 — HEAD `:1046`（`({ events, history } = await assemble()); skillsBlock = pluginContext(...)`）。
    这一拍**已经在重算**（为了 remount），清单却仍是 run 起点那份冻结串 ⇒ 唯一"免费"的新鲜化位置就在此处（同 9 的改动面，无额外 IO）。

---

## 问二：`query` 传进去会被哪些既有判卷碰到（**均未改动**）

清单文本只有在**超 1536 帽**那一支才会被重排（`src/agent/plugins/skills.ts:199` 装得下就逐字早退），
`query` 缺省（`""`）与"query 非空但零命中"两种情况都走 `skills.ts:204-207` 的 `idx` 稳定序 ⇒ 与从前逐字相同。
按这个前提逐条数：

1. `tests/skill-routing-tiering.test.ts` — 零回归两钉：`:17-28`（小清单逐字 `toBe` 全文）、`:30-34`（缺省 query ⇒ 发现序第一行仍是 `/p0:`）；
   相关性那一组 `:82-109`（`:88` 已经在**直接给纯函数传 query**）。只接调用点、不改纯函数签名 ⇒ 全条不受影响。
2. `tests/plugins-skills.test.ts:49-58,69` — 纯函数（`:58` 钉 ≤1536）。
3. `tests/plugin-role-discoverability.test.ts:97,111,121-160` — `rt.routingList()` 无参调用 + 合并语义/`dropped` 口径钉；
   只要 `routingList()` 的新参数**有缺省值**就不红。
4. `tests/skill-invocation-faces.test.ts:30,74` — 行格式 + `routingList()` 无参。
5. `tests/skill-user-invocation.test.ts:95` — `routingList()` 无参。
6. `tests/user-agent-roles.test.ts:115,123` — `routingList()` 无参（角色行必须可见）。
7. `tests/session-tools.test.ts` HEAD `:238-315`（`it` 起在 HEAD `:238`；工作树 `:286` 附近被隔壁在改）
   — **唯一走生产链的端到端判卷**（`runAgent({…, message: "继续"})` → 断 request body）。
   取证一句：**它的第①条断言没有分辨力** —— HEAD `:306` `expect(serialized).toContain("/echo-suite:greet")`
   把 `messages` 整串 JSON 化后 `toContain`，而预置日志里 HEAD `:269` 就有 `user_message` 正文 `"用 /echo-suite:greet"`
   ⇒ 就算路由清单为空、就算 query 排序把这条排到最后，该断言照绿。接了 query 也不会被它抓到（它抓不到，也不会被弄红）。
8. `tests/session-provider.test.ts:103-114` — 传字面 `skillsRouting: "ROUTING-LIST"`。**只在改 `plugins` 形状（B 类）时才受影响**；A 类不碰它。
9. `tests/surface-account.test.ts:48`（`plugins` 类型的**第二份副本**）与 `:172`（传字面 routing）、`:178`（逐字钉 `skillsBlockChars = routing+2+hook+2+remount`）
   — 同样**只在改形状时**受影响；改形状不改这里就是"尺与实现分家"。
10. `scripts/plugins-check.ts`（门，非 vitest）— `:136-137`（B1 超 1536 截断）、`:669-674`（F18 真实 skill 面 `rt2.routingList()` 无参 + `truncated`/≤1536）。
11. `scripts/mutate-verify.mjs`（变异表针脚，**硬耦合**）—
    `:4839` 锚点 `routing-list-hides-plugin-roles` 的针脚就是 `src/agent/plugins/index.ts:412` 那句
    `"return buildSkillRoutingList(this.skills(), roleLines);"`；`:335` 锚点 `user-agent-role-hidden-from-routing` 的针脚在同一个函数体里
    （`"    const roleLines = [...this.agentRoles(), ...this.userAgentRoles()].map((a) => {"`，这行不动就活着）。
    ⇒ **只要 `index.ts:412` 变成 `buildSkillRoutingList(this.skills(), roleLines, query)`，`:4839` 的针脚命中数变 0**，
    按 `scripts/lib/mutate-gates.ts:225-228`（`needleSeverity`：hits≠1 且 hits=0 ⇒ `blocking`）与 `:250` 的措辞
    "针脚已不在源文件里（变异必然不生效）"——**`--check-needles` 当场红**，必须同一笔把针脚改指新句（先例：`mutate-verify.mjs:550`、`:3183` 那两条注释就记着"针脚跟着搬"）。

另外两条**不是判卷但会被读成判卷**的尺：
`scripts/probe-promise-recall.ts`（`:244 CLAIM_UNWITNESSED_CAP = 0`，AST 收 `src/main/agent-runner.ts` 里的模型可见承诺字面量，
`RUNNER_NAMES` 表 `:956-959` 已登记 `src/main/agent-runner.ts#body`）——接线时若新增"先看清单/按相关性列出"那类**给模型看的话**，
就要按隔壁第 376 页刚踩过的样子补证人；只改代码、注释不写承诺句 ⇒ 不触发。
`scripts/lib/wiring-coverage.ts` 只管 `handleAgentRun` 里 `over.x ?? (await store().get()).y` 那族开关（`agent-runner.ts:2130-2131` 自述），
query 接线**不是**新设置开关就不进这张表；若哪天把"是否按相关性排序"做成 settings 开关，就必须同时补锚点。

---

## 问三：压缩后重挂那条路（5000/25000）是不是同一个清单？

**不是同一个清单，也不共用 `buildSkillRoutingList`。** 两头是两块不同的产物、同一个 system 消息里前后相邻：

- 重挂走：`src/main/agent-runner.ts:1782` `deriveRemount: (events) => rt.remountFromEvents(events).text`
  → `src/agent/plugins/index.ts:456-471` `remountFromEvents` → `src/agent/plugins/skills.ts:478-501` `skillRemount`
  （预算常量 `src/agent/plugins/skills.ts:13-14` = 每条 5000 / 合计 25000 token），注入的是**激活过 skill 的正文**。
  全仓 `buildSkillRoutingList` 的调用点只有 `src/agent/plugins/index.ts:412` 一处生产（其余是 re-export `index.ts:13,61` 与判卷/探针脚本）。
- 两头唯一的合流点是 `src/agent/glm-session.ts` HEAD `:740-746`：`[skillsRouting, hookContext, liveNote]` + `remount` 拼成**同一条 system 块**，
  并且 HEAD `:1046` 在压缩后**整块重建**。

两头口径不一致的后果（若不把 query 也送到重挂那一拍）：

1. **新鲜度不一致**：remount 每次请求按 `events` 现算（压缩后立刻随新事件流变化），清单却是 run 起点冻结的串（`agent-runner.ts:1715` 一次）。
   接了 query 之后，这条差异变成**排名依据也跟着过期**：第 1 轮问"渲染图表"、第 7 轮改成"导出 pdf"，
   `pdf` 那条在第 7 轮仍可能停在 `nameOnly` 档（`skills.ts:220-225` 的降级）甚至 `dropped` 里，
   而同一块文本里的 remount 已经在给 pdf skill 付 5000 token 全文——模型读到"清单说它只列名字／没列出，正文却整段在那儿"。
2. **账面数字说谎**：`dropped`/`nameOnly` 两个数（`skills.ts:146-151` 的标记行）是 run 起点算完就写死在串里的；
   query 一旦参与排序，这两个数就同时把"按哪句话排的"钉死，压缩后重挂不会重算它。
3. **不互相污染预算**：清单帽是字符（`skills.ts:11` = 1536）、重挂帽是 token（`:13-14`），`skills.ts:210-219` 的贪心不看 remount ⇒
   接 query 不会把重挂挤掉，也不会把清单顶出 1536（≤ 帽不变量由 `:199`/`:215` 的 `markerReserve` 保底，与 query 无关）。
4. **worker 那条路根本没有清单**：`src/agent/orchestrator.ts:2466-2474 createWorkerProvider` 不吃 `plugins`，
   `createGlmSessionProvider` 的 `plugins` 只有 `agent-runner.ts:1371/1405` 一个生产者 ⇒ query 接不接都只影响主会话，
   不必担心两头（主/worker）不一致。

---

## 最小接线改动 + 文件状态 + 撞隔壁判定

### 若走 A 类（run 起点取料，**推荐**）——三处，两行代码 + 一处针脚

1. `src/agent/plugins/index.ts:407` `routingList(): RoutingListResult` → `routingList(query: string = "")`（签名一行）；
   `src/agent/plugins/index.ts:412` → `return buildSkillRoutingList(this.skills(), roleLines, query);`（一行）。
   **缺省 `""` 是硬要求**：`:412` 之后 `tests/plugin-role-discoverability:97,111`、`tests/user-agent-roles:115,123`、
   `tests/skill-invocation-faces:74`、`tests/skill-user-invocation:95`、`scripts/plugins-check.ts:669` 全是无参调用，
   缺省值一丢就是六处一起红。
2. `src/main/agent-runner.ts:1715` 传料：`rt.routingList(opts.message)`（**不要用 `promptText`**，理由见 1.2 第 3 条；
   `opts.message` 在 goal 续跑轮里自带 objective 文本，见 1.2 第 1 条）。顺带把这句调两次的 `routingList()` 收成一次，少排一遍。
3. `scripts/mutate-verify.mjs:4839` 锚点 `routing-list-hides-plugin-roles` 的针脚与改法两处同步改指新句（否则 `--check-needles` blocking 红，见问二第 11 条）。

涉及文件状态（取证时）：
`src/agent/plugins/index.ts` **干净**（上一次动它的是我自己的第 370 页 `3dff65c1`）、
`src/agent/plugins/skills.ts` **干净**、`src/main/agent-runner.ts` **干净**、`scripts/mutate-verify.mjs` **干净**。

### 若走 B 类（逐请求新鲜 query）——要多碰两支在飞/相邻的文件

`src/agent/glm-session.ts` HEAD `:670` + `:738-746`（把 `skillsRouting` 变成 `(query: string) => string` 或让 `pluginContext` 现取）
+ `tests/surface-account.test.ts:48`（类型副本）+ `tests/session-provider.test.ts:105,119` + `tests/surface-account.test.ts:172`
+ 生产端 `src/main/agent-runner.ts:1779-1783`。好处是顺带把问三第 1、2 条的过期问题关掉（HEAD `:1046` 那一拍会自动重算）。

### 判定：**这一半现在动手会撞隔壁 —— A 类可以接，B 类要等**

取证时隔壁会话正在飞的簇是「工具说明书（`gateToolSpecs` 的"何时用"段）＋ `M0_API_KEY`→`CAIRN_API_KEY` 改名」：
脏文件里有 `src/agent/glm-session.ts`（+75/−26，只在 71–406 行）、`tests/session-tools.test.ts`、`src/agent/system-prompt.ts`、
`src/main/provider-keys.ts` / `provider-runtime.ts` / `settings-handlers.ts`、`apps/desktop/**`、`PROGRESS.md`，共 161 条脏项。
⇒ **B 类直接撞**在 `glm-session.ts` 与 `tests/session-tools.test.ts` 两支在飞文件上，且第 376 页刚因为"别人在飞的文本"挨过一条 `CLAIM_UNWITNESSED_CAP` 红。
⇒ **A 类不撞**：三个目标文件此刻全干净，且 HEAD 顶格那笔（`19dfa23c`）刚动过 `agent-runner.ts` ⇒
   `:1715` 这行处在"隔壁每笔都可能重排行号"的热区，落地要按 pathspec 逐文件取面、并把 `:1715` 的**当前行号重读一遍**再动。

**要等的东西（不是等文件，是等一起落）**：`scripts/mutate-verify.mjs:4839` 的针脚必须与 `index.ts:412` 同笔，
且台账页（`PROGRESS.md`）**此刻在隔壁手里**——页号与第 370 页"等 agent-runner 让出再接线"那句自述都要在新页里改口，
建议等隔壁这一簇（工具说明书 + env 改名）落完再开页，否则就是踩自家"钉在飞文本"那条雷。
