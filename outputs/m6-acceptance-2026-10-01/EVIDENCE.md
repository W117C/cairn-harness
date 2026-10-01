# M6 · 记忆与跨会话学习：把失败轨迹提炼成**带证据指针**的教训

- 分支：`feat/m7-perm`（自 `zcode` @ `274f165` 起，工作树 `.worktrees/m7-perm`）
- 前置：M7 已收口（`f55f52e` + 证据 `ee7e12c`）；M5 已收口（`1e42c74`）
- 范围：**只做 M6**。M5 那一格的证据在 `1e42c74` 的 commit message 与本文 §6。
- 一句话交付：会话结束时把失败轨迹**确定性地**（不经模型）提炼成条目，每条指回「哪条会话、哪个 callId」，
  写进项目记忆，下一轮按 `modified` 倒序限量回注；**造不出证据指针就不产出条目**。

---

## 1. 业主那条硬要求，和它为什么不是「加个总结」

路线图 M6 的硬要求逐字是：**教训必须带「证据指针」（哪条会话、哪个 callId），不许凭空总结**。

既有 `distill.ts` 已经在做「把失败摆到模型眼前」，但它给的正是**凭空总结**那一支：
`failureDigestFromEvents` 产出的是计数摘要（`verify×2（工具失败）、write_file×1`），
**不带 callId、不带会话**，结论交给模型自由写。所以 M6 不是「加个功能」，是**补一条对位**：

| | `distill.ts` 的 digest | M6 的 `lessons.ts` |
|---|---|---|
| 形状 | 喂给模型的提示词 | 写进项目记忆的条目 |
| 出处 | 无（计数） | 每条带 `session#callId` |
| 结论 | 模型自由总结 | 确定性纯函数提炼 |
| 消费者 | 当场那一次模型调用 | 下一轮回注 |

两者都留着：digest 擅长「把失败摆到眼前」，lessons 擅长「把结论钉死」。

---

## 2. 三个实测发现（都改了写法，不是照抄计划书）

### 2.1 会话 id **不在事件里**，它是日志文件名

事件流有 `agent_id`（worker 归属），没有会话 id。唯一的会话出处是 `basename(logPath)`。
⇒ `sessionOf()` 的取不出就退化成空串，而**空串会让整条教训作废**（硬门，见 §3）。

第一版我把「末尾分隔符」的判断写在了 `basename` 之后 —— `basename("/logs/")` 已经把斜杠吃掉了，
返回的是目录名 `"logs"`，于是「来自会话 logs 的教训」凭空就编出来了，正是本模块要禁的那件事。
修法：判**入参**的 `logPath.endsWith("/")`。

### 2.2 `tool_result` 事件**不带工具名**（只有 callId）

不预扫 `tool_call` 建 `callId→工具名` 的表，每一条连败都会被记成 `unknown` —— 那不是教训，是噪音。
（这一条在写的时候就发现了，没等跑。）

### 2.3 verify 那一拍的 `tool_result` 回声会把「一次验证红」数成「工具连败」

`loop.ts` 的 verify 拍会发**两声** `tool_result(ok:false)`，与 `verify_result` **共享同一个 callId**。
第一版只把「成了条目①的那几拍」加进 `verifyCallIds`，于是**环境红**的那几声回声会被来源②重新捞回来，
变成一条假的「verify 连败」教训。
修法：`verify_result` 的 callId **不论成不成为条目**都回灌（绿拍与环境红拍同样回灌）。

---

## 3. 硬门：造不出证据指针 ⇒ **不产出条目**（不是事后过滤）

三类来源每一条都**先把证据指针造出来**，指针造不出（callId 缺失/空、session 为空、tool_result 查不到归属工具）
就**直接不进列表** ⇒ 「无证据」与「无条目」是同一条路径，不是「先产出再过滤」。
注入侧从盘上正文 `^evidence-line:` 解析，指针不落在正文里就**读不出这一条** ⇒
「无出处不注入」与「无出处不写盘」是同一道门在两侧的表现。

**这一条的反向验证**（路线图点名的核心）在本轮真跑了：把每一处证据门摘掉（session 门、callId 门、
tool 归属门、verify 回声过滤、注入侧 `d === null` 跳过、`parseLessonDigest` 返 null），
再跑判卷 ⇒ **19 条里 9 条变红**。还原后 19 条全绿。

---

## 4. 一个设计问题被实测数据改了（不是拍的）

来源③「同一 `(工具, 参数)` 重复调用」最初不限工具。对 tracked 的 20 份日志离线提炼：
**40 条教训里 35 条来自这一源，逐条打开看全是 `read_file` 读同一个文件**。

re-read 是「确认改动真的写进去了」的**正常**动作（M5 的 `repeatDigestNote` 就明写让模型这么干）。
把它们写成教训 = 每轮回注都在教「别再读文件了」，纯噪音，还会挤掉真教训的预算。

⇒ 来源③ 收窄为**只收写向工具**，复用 `mayHaveWrittenDisk`（`src/agent/write-face.ts`，本仓唯一那一份、
多处消费，不另抄工具表）。同批日志 **40 条 → 10 条**，剩下 5 条重复逐条看过，是真的写向动作。

---

## 5. 验收读数（`TERM=dumb`）

### 5.1 真语料离线提炼（`replay:lessons-offline`，exit 0，原始输出 `lessons-offline.log`）

```
[lessons-offline] 日志数 = 21        （20 份 tracked outputs/** + 1 条本机真会话）
[lessons-offline] 合计：产出教训 10 条，覆盖 5/21 份日志
[lessons-offline] 按类：{"repeat-action":5,"tool-streak":2,"verify-red":3}
[lessons-offline] 分母侧（不依赖提炼器）：{"codeRed":3,"envRed":0,"toolFail":13,"orphanFail":0,"verifyBeats":19}
```

分母侧那一栏是**独立**于提炼器算的：两栏对不上就说明硬门在悄悄丢东西。
今天 `orphanFail = 0` ⇒ 硬门这一轮没有静默丢任何东西。

### 5.2 两轮 A/B（`replay:lessons-round-ab`，exit 0，原始输出 `round-ab.log`）——**含一条不可达声明**

业主定的验收形态是「冻结 mock 剧本跑两轮，前后对比」。**实测那条路在本仓结构不可达**，理由两条：

1. `fixtures/mock/todo-fix.jsonl` 是**一次成功**的回合（read → write → 跑测试绿），
   事件流里 **0 个 `verify_result`、0 个 `tool_result{ok:false}`** ⇒ 按硬门提炼 **0 条**。
   没有失败就没有教训。
2. 即便把剧本改成失败的：`createMockProvider` **忽略 messages**（它照 `tool_call` 念剧本），
   而记忆块是**会话启动时**由 `glm-session` 读盘的，`runLoop` 里根本没有注入点
   （`loop.ts:316` 唯一出口是 `projectContext(seen)`）。⇒ 「模型读到教训并改了动作」**没有承载路径**。

本轮改成测**真能测的那一半**：造一条真失败轨迹（就地生成、不碰冻结 fixture）→ 提炼 → 写盘 → 回注 → 逐字对照。
这一轮读出来的是**一个正确的零**：

```
轮 A 确有红：1 条 tool_result{ok:false}（callId=c3 工具=run_shell），
但工具只败 1 拍（TOOL_STREAK_MIN=2），且它跑在 verify 反射之外 ⇒ loop 不发 verify_result ⇒ 三类来源一条都够不着。
```

单拍偶发失败不成教训，**这正是设计要的**（见 §4）。代价写明：**非零产出那一跳在 mock 靶上测不到**，
它由 `tests/memory-lessons.test.ts`（20 条，含真写盘往返与注入逐字断言）与 §5.1 的真语料读数承担。

冻结 fixture 未被动：`fixtures/mock/todo-fix.jsonl` sha256 = `e253aae90285ecd4…`（本轮只读）。

### 5.3 M5 的反向验证（本轮补跑，三条变异）

| 变异 | 判卷读数 |
|---|---|
| 类型面探测摘掉（`const tc = []`） | **2 红**（探测面 / surface 认这一面） |
| 命令换成 `npx --no-install tsc` | **1 红**（命令必须是本地二进制） |
| 第 3 拍升级段摘掉半句 | **1 红**（「先判这条红可不可修」那句） |

第一次跑第 3 条时**变异写错了**（在 `if` 后面加了一个恒假的 `return base`，恒假分支不可达 ⇒ 死代码 ⇒ 全绿）。
这正是本仓记忆里那条纪律的又一次应验：**变异本身没生效时，不能把「绿」当成「判卷抓得住」**。
改成真删掉那半句后才拿到预期的红。

### 5.4 门禁与全量

```
typecheck  exit=0（0 条报错）
test       exit=0  266 files / 3561 passed / 0 skipped   （基线 264 files / 3523 ⇒ +38：M5 的 18 + M6 的 20）
docs-check exit=0  UNVERIFIED=3
memory-check exit=0
断言体检    零命中
```

**测试数只增不减**：3561 > 基线 3523，本轮只增未减。

### 5.5 `mutate-verify` 门：**超时，不是内容红**（照贴，不写成「全绿」）

```
mutate-verify=124  （预算 1200s 耗尽，SIGTERM 宽限 15s 内未退出，整组 SIGKILL ⇒ 判红）
完整日志：mutate-verify-timeout.log（1023 条锚点已读，未跑完）
```

日志末尾 1023 条已读锚点里 **5 条 ❌**，逐条核对**无一条属本轮文件**：
`worker-budget-window-ignored` / `worker-budget-clamp-removed`（orchestrator 预算窗）、
`sandbox-mapping-copy-reintroduced`（worker 沙箱映射）、`openai-never-reads-finish-reason`（GLM finish_reason）、
`tree-guard-refusal-not-wired`（主检出护栏接线）。

其中 `tree-guard-refusal-not-wired` 的日志自述是「基线这一拍选中 **未取到**（收尾行没读到＝取料坏）⇒
不许当成绿也不许当成红」——**它本身就不是一条内容红**，是取料坏。故本轮该门**没有一条可归因的红**，
但它**没跑完**这件事照贴：1023 条是已读数，不是总数（M7 那轮同样以 124 收场）。

**超时是否留下突变体**：实测**没有**。全树 `find -name '*.mutbak'` 零命中，
本工作树 `git status` 干净，`.worktrees/gate-head-cert` 树也干净。
（这条要查而不是信日志——日志明写「子进程未自还原」，但实际那支没崩在写盘阶段。）

- **typecheck 验证面**：`tsconfig.json` + `./node_modules/.bin/tsc` 可执行 ⇒ 产出这一面，否则**不产出**
  （探测不出工具链还给一条必红的命令，比探不出来更坏）。
- 命令选**相对路径二进制**而不是 `npx`：实测 `.bin/tsc` 缺失时 bash 退出 **127** ⇒ 落进**既有**的
  `toolchain-missing`（环境类，**不扣模型修复额度**）；而 `npx --no-install tsc` 缺失时退出 **1**
  且不匹配包管理器正则 ⇒ 被判 `code` ⇒ **拿 harness 的环境问题扣模型的钱**。
  ⇒ **零新增归因类别**（M5 禁区）。
- **重复失败升级处置**：第 2 拍文案逐字不动（`tests/verify.test.ts` 逐字钉着），
  第 3 拍起追加「别再改同一处 + 先判这条红可不可修」。

---

## 7. 局限与遗留（**不偷做**）

1. **M5 的差距 2（长任务中途没有周期性自检）与跨会话回归跟踪不在本轮**：那是 `loop.ts` 的节拍问题。
2. **M5 那个更值得记的发现**：路线图把写范围写进 `loop.ts`，实测**不需要动它** ——
   `runVerifyOutcome` 本来就返回多 result 数组，新增一面只是多一个 result，不改拍数记账。
   写范围缩到 `verify.ts` 是实测结论，写在这里以免下一轮又去改 loop。
3. **lint 面不做**（业主已确认）：`action-fusion.ts` 每次 `write_file` 后都跑 `config.lint`，
   凭空造 lint 面会把正常的写判成 failed；`scripts/mutate-verify.mjs` 还有一条锚点专门钉「不许凭空造 lint」。
4. **M6 的教训写入不过人工批准**（业主已定）。写入内容是证据指针 + 原文摘录，不是模型自由文本；
   但它确实绕过了 `remember` 的合并审批 —— 取舍照贴，日后要人工把关把 `writeTopic` 挪到
   `mergedApproval` 之后即可，形状不用改。
5. **「命中率可观测」只做到「注入行自带出处」这一层**；真正的命中率统计需要事件侧埋点，超本轮写范围。
6. **`mutate-verify` 门**：见 §8 第 2 条。

---

## 8. 本轮踩到并修好的两处（含一处是**我自己的判据失效**）

1. **孤儿护栏（D-8 第五判据）**：`scripts/replay/lessons-offline.ts` 一落盘就红。
   我先试了「让它 import `./corpus` 变成被吃的取料件」—— 那是**共用取料层**的豁免，不是面该走的路。
   正确做法是**登记进 `REPLAY_READINGS` + 在文档里写一句 `replay:<id>` 引用**
   （登记表自己的规矩：「新增一条 = 同提交里既要有脚本，也要有引用它的那句文档，缺一侧即红」）。
2. **记忆正文与索引行撞字面量**：`store.indexLine` 取的是正文**首行**当摘要，
   于是「伪造条目」测试里我写的伪造文字被索引行带进注入块。
   修法：抬头与正文用**两段不同字面量**，两条断言各扣各的（一条扣教训正文没进来，
   一条扣既有索引机制**未被动** —— 后者是防「为了让断言过而削弱既有机制」）。

---

## 9. 未证 / 待集成 owner

1. **`mutate-verify` 门在本机的状态**：见 commit message 与下方附注。它在 M7 那轮以 `exit=124` 超时收场，
   本轮再跑仍需实跑；**它超时这件事本身照贴**，不写成「全绿」。
2. **热文件接线请求**（归集成 owner，本轮只提不改）：
   `scripts/gate-manifest.ts` 未加新门（M6 的判卷走既有 `test` 门，**故意不新增 `*-check` 脚本** ——
   新脚本会触发孤儿护栏并迫使改热文件）；`PROGRESS.md` 本轮未动。