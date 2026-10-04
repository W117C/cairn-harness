# 检索质量有没有一把尺 —— 只读取证报告

日期：2026-10-05 · 取数基线：**HEAD `513d4d7d`**（工作树那份一律标「未入库」）
纪律：本次**没有**跑 vitest / typecheck / mutate-verify / head-cert / 任何 `*-check` 门 / 任何真模型评测。
只用 Read／Grep／Glob／`git show HEAD:<path>`／两支只读探针（本目录，不写盘、不起服务、不碰凭据）。

---

## 0. 结论（先说这句）

**有尺，但那把尺没有刻度盘上的指针读数被任何人读。**

`scripts/probe-locate-recall.ts` 是一把**形状相当完整**的检索质量尺：14 条真值题＋1 正哨兵＋1 负控、三臂（生产形状／只条件化／不条件化）×三档预算、词面与排名两个面分开数、自检不过就 `exit 1`。现读记录 **A 臂 14/16**（`outputs/rank-head-comment-45-2026-10-04/locate-recall-after-336.log`，PROGRESS 第 336 页）。按本仓规矩它也已经把「取料不许自己再算一遍」做到了：尺与生产端**共用同一支正则源** `src/agent/context-signals.ts`，并由 `tests/context-signals.test.ts:48-70` 反向钉住「尺里不许再出现字面量副本」。

缺的不是尺，是**观测者**：

1. 它**不在 `package.json` 里、因此不在 `scripts/gate-manifest.ts` 的 33 道门里的任何一道**。`ACCEPTANCE_SHAPE = /check/i` 的孤儿护栏只盯 `*-check`／`*:check` 形态，`probe-*` 天然逃逸 ⇒ 门表**结构上永远不会问它**。谁都不跑它的时候，它就不说话。
2. 全仓**没有任何一条判卷或门读那个命中率数字**。`tests/locate-recall-ruler.test.ts` 钉的是「尺会不会响」和「自检有没有接到尺上」，全文**一条读数断言都没有**。⇒ 14/16 掉到 5/16，只要正哨兵 L-POS 仍命中，`自检 ✅`、`PROBE_EXIT=0`，**全量判卷 0 红**。
3. 尺的**真值数据面自己零观测者**（本次实测已经在腐烂，见 §5）。

而「仓库级代码理解＋长上下文＋RAG 精准定位」（产品目标 1）与「用基准衡量并持续迭代」（目标 10）这两条，今天的落点是：**目标 10 那一格对检索质量只做到「有把尺、有人记得跑」，没做到「跑不跑都记账」。**

---

## 1. 要查第 1 条：现有检索面判卷/门逐个点

搜索面：`map-check`／`tests/map-*`／`retrieval`／`recall`／`held-out`／`scripts/eval/`／`scripts/loop-eval.ts`／`scripts/gym-check.ts`。

| # | 判卷 / 门 | 它读的是什么 | 有正样本吗 | 是不是恒真 |
|---|---|---|---|---|
| 1 | `scripts/probe-locate-recall.ts`（**不是门**，手动探针） | 「问题→该落的文件是否进了首轮注入」的命中与位次，三臂×三档 | 有：14 题真值＋L-POS 正哨兵 | 尺本身不恒真（有哨兵＋负控）。但**它不在任何门上**⇒「换掉检索实现」这件事没有自动路径能看见（见下面 §1.5 的形状） |
| 2 | `tests/locate-recall-ruler.test.ts` | 尺的自检纯函数 `rulerSelfCheck` ＋它在探针里的接线（读探针源码文本） | 有：合成三态 (true,false)/(false,false)/(true,true) | 不恒真，但**它一条读数都不判**。`toContain("const selfCheck = rulerSelfCheck(")` 这类针脚只保证「那句话还在」，不保证「那个数还在往下走」 |
| 3 | `scripts/lib/probe-self-check.ts` | `posHit`／`controlHit` 两个布尔 → 出声 | — | 不恒真。⚠️ 但它的两个入参来自**探针里硬编码的两个题号**（`"L-POS"`／`"L-NEG"`），那两个靶子的真值路径也在探针源码里，没有任何判卷钉住（§5 实测②③） |
| 4 | `scripts/map-check.ts`（**第 11 道门**） | ①token≤1024 ②预算生效 ②b 单行截断 ④缓存逐字相同 ⑤改一个文件→新符号入图 ⑥缓存不漏进用户仓 **⑦真仓库「零抽取文件数=0」** | ⑤b 是正样本（塞一个探针符号进 rank.ts，要求它在图里） | **⑦ 只守抽取机制、不守检索质量**：它问的是「合法文件别整文件从图里消失」，不问「这个文件该不该排在前面」。把 `personalizedPageRank` 的边权全换成常数，⑦照绿 |
| 5 | `scripts/probe-map-recall.ts`（被 map-check ⑦ 调用） | 抽取召回率：独立地面真值＝**TypeScript 自己的 AST**，对照 tree-sitter 抽出的模块级具名声明 | 有，且真值独立于被测面（这是本仓少见的干净形状） | 不恒真。但它量的是**解析层**，不是**检索层**——文件头自己写着「`map-check` ⑦ 现在只守机制不变量，阈值不守」 |
| 6 | `tests/map-rank.test.ts` | 边权规则（mentioned ×10／contextFiles ×50／长名 ×10／下划线 ×0.1／定义点>5 ×0.1）＋√num_refs 单调＋幂迭代收敛 | 有：合成两文件图，逐项 `toBeCloseTo` | 不恒真，**但它钉的是权重函数自己**。「问句→正确文件」这件事不在它的视野里——第 336 页就是**改了一句注释**把 L10 从 MISS 变成第 1，`map-rank.test.ts` 一字未动照绿 |
| 7 | `tests/map-retrieval.test.ts`（375 行，词面通道的主判卷） | `commentSummary`／`tokensOf`／`retrieveByQuery`／`renderRetrievalLine`／预算扣减／buildMap 问句那一维／接线 6 条针脚 | **形状非常正**：每条「A＝B」都配反面（`retrieveByQuery("",c)=[]` 之后紧跟「同一份语料的有效问句必须给东西」；预算那格先证明 `前缀≥8 token` 且「不扣那一支必须超帽」） | 不恒真。⚠️ 但它全部**语义断言喂的是合成语料**（`corpus(n, hot)`：`src/f007.ts` 那种），真工作区只有 3 个临时文件。⇒ 它验的是「词面通道这台机器会转」，**不是「词面通道在本仓真能捞到该捞的文件」**，后者只有 #1 |
| 8 | `tests/context-signals.test.ts` | 生产端与尺两端**共用同一支正则源**（读两份源码文本＋行为） | 有，且带反向针（源串里不许再留路径/标识符字面量，「镜像复活就红」） | 不恒真。这一格正是本仓「取料复用被度量方已算出的那个变量」的**已兑现先例** |
| 9 | `tests/impact-accuracy.test.ts` | **真基准**：冻结 10 文件夹具＋16 条人工核对的跨文件调用边真值，断言 `precision=1.0`、`recall≥0.9`、逐条 upward/downward 查询与真值一致 | 有，人工真值 | 不恒真，而且是全仓**唯一一条带人工真值的准确率断言**。⚠️ 但量纲要说清：夹具是合成的 10 文件、量的是**边集**，不是「自然语言问句→文件」。探针头自己就写了这一句：「`tests/impact-accuracy.test.ts` 量的是合成 10 文件上的边集真值（**换更好的检索器这些数一动不动**）」 |
| 10 | `scripts/probe-summary-coverage.ts` | 词面通道的**分母**：608 个候选里有摘要／截在帽上／没注释／读不到 四档各占几个（现读 84.7% 可见、59.4% 截帽） | 有（真值 13 个文件那一格） | 不恒真，但它量「语料覆盖」不是「命中」。它同样是**手动、不在门里** |
| 11 | `tests/promise-recall-inventory.test.ts` ＋ `scripts/probe-promise-recall.ts` | 「回取承诺的清单完整性」：每个模型可见的「全文见 X」都有判定归属＋归属表里无陈旧键，带 `CLAIM_NO_NEEDLE_CAP`／`CLAIM_UNWITNESSED_CAP`／`claimCountCeiling`／`claimWitnessCeiling` **四顶帽** | 有 | 不恒真。**这一条是本仓「检索邻域已兑现的正确形状」的范本**：探针把纯函数 `export` 出来，判卷直接吃那一份（文件头原话：「本文件不重抄判据，只吃探针导出的那一份纯函数」），于是它跑在全量判卷里、不需要新门 |
| 12 | `tests/skill-recall-address.test.ts`／`tests/observation-capture.test.ts` | 前者＝skill 回取地址可达性；后者＝`obs_recall` 的分页白名单/错误码消毒/未启用不进工具表 | `obs_recall` 有正反例（合法参数返回 JSON 页 / 非白名单 code 回落 EIO） | **都不是检索质量**：`obs_recall` 判的是「取到的那页是不是真的那一页 + 不泄漏」，没有任何一条问「模型该取哪条时取对了吗」 |
| 13 | `tests/eval-heldout.test.ts` | held-out 隐藏验收面的**装载/归因**（dest 越界、装一半必须点名、退出码归因与 verify 同源、输出保头保尾） | 有（合成假 exec） | 不恒真。但它量的是**作弊面**，不是检索面（详见 §2） |

### 1.5 「换掉实现它照绿」那一个形状（要查第 1 条要求举的实例——已逐条现读验过）

**实例：把 `src/agent/map/retrieve.ts:23` 的 `RETRIEVAL_MAX_FILES` 从 `6` 改成 `1`**（＝词面检索行每轮只准列 1 个候选文件）。

谁会红？**全量判卷 0 条红、33 道门全绿。**
现读依据（`grep -rn RETRIEVAL_MAX_FILES tests/ scripts/ src/` 的全部命中就是这几处）：
- `tests/map-retrieval.test.ts` 里凡是用到这一位的断言**全部对着常量比，而不是对着数字比**：
  `:141` `expect(hits.length, "10 个候选该被 k 截成 6").toBe(RETRIEVAL_MAX_FILES)`——**断言消息写着 6，比较的是常量**；
  `:187` `if (i < RETRIEVAL_MAX_FILES) expect(present).toBe(true) else expect(present).toBe(false)`；
  `:190` `…(/、/g).length).toBe(RETRIEVAL_MAX_FILES - 1)`；`:219` 合成前缀也用 `Array.from({length: RETRIEVAL_MAX_FILES})`。
  ⇒ 常量改成 1，这四格**逐格自洽地跟着改口**，一条不红。仓里**没有任何一处把 6 这个数钉住**（`grep 'toBe(6)'` 在该文件命中 0）。
- `map-check` 的 ⑦ 只看抽取（零抽取文件数=0）、⑤b 只看排名面里新塞的那个符号，两格都不吃词面列数。
- `tests/impact-accuracy.test.ts` 走影响面边集，不碰词面通道。
- `tests/map-self-report`／`map-turn-gate` 钉的是覆盖面自述与「只首轮送」，也不吃这一位。
- 唯一会红的仍是 `probe-locate-recall`——**而没人必须跑它**。它现读那一行就是 `词面通道：有检索行的格=48/48，平均列=6.0 个文件`，帽**常被打满**（第 302 页原话），改成 1 之后按现读日志逐题重算，`L03 第2／L05 第5／L07 第5／L08 第3` 四题的词面落点全部掉出列外面 ⇒ A 臂从 14/16 掉到约 10/16，**而正哨兵 L-POS 仍命中、负控仍 MISS ⇒ 尺自己 `自检 ✅`、`PROBE_EXIT=0`**。

⇒ 这一格同时给出两个结论：**⑴ 恒真的不是那条 df 边界用例**（它 `expect(stopAt).toBe(3)` 钉的是数字，动 `STOPWORD_DF_RATIO` 会红——本仓该钉的地方钉得住）；**⑵ 真正没有观测者的那一格是"帽常被打满"这件事本身**：判卷把「列多少」交给常量自己说，于是**这一位从来没有人要求它≥2**。这正是 `assertion-health.ts` 那套恒真式扫描够不着的形状（它扫 AST 里的 `X || true`，扫不出「断言与常量同口供」）。

---

## 2. 要查第 2 条：靶面 `src/agent/eval/task-set.ts`（HEAD 那份）

- 条数：**12 条**（`fixtures/bench/tasks.json`，B1…B12；另有 `tasks-chain32/chain48/long30.json` 三张扩表）。
- 判据事实源：`EXPECT_NAMES` 10 枚（HEAD `task-set.ts:64-75`），解释表在 `scripts/lib/eval-expects.ts`，两支键集相等由判卷核。全部 10 枚：`clarify`／`planBeforeWrite`／`readBeforeWrite`／`verifyOk`／`verifyRecovered`／`judgeUntouched`／`testNotRewritten`／`onlySrcChanged`／`wroteTest`／`heldOutPass`。
- 12 条里 `expects` 的分布：B1、B2 = `verifyOk + judgeUntouched + heldOutPass`（只有这两条有隐藏验收面，`fixtures/bench-heldout/`）；其余 10 条 = `verifyOk + judgeUntouched`。

**有没有「需要检索到正确文件才算对」那一类？没有。这是本次最硬的一条负面结论。**

逐枚看最接近的两枚：
- `readBeforeWrite` 的解释是 `r.readsBeforeFirstWrite < 1 ⇒ "写盘前一次都没读"`（`eval-expects.ts`），而那只读数在 `loop-eval.ts:458` 算的是**首笔写之前读过几次**——一个**计数**。读错文件与读对文件同分。
- `onlySrcChanged`／`judgeUntouched` 判的是**写**的越界，不是**读**的正确。
- `heldOutPass` 判「哄绿可见测试 vs 修对根因」，形状很干净（三种「量不出来」分开出声、未证≠通过），但它的动因是**作弊**，不是检索。
- `gym` 侧最接近：`src/agent/gym/score.ts:judgeCase` 判 `expect.mustChangeFiles`——「**改了**该改的文件」。这一格确实能算「定位对了」的一个弱代理，但 `gym-check`（第 17 道门）默认档是 `model:"scripted"`（`src/agent/gym/runner.ts:60` 明卷剧本 `script.jsonl` **逐轮冻结回放**）⇒ 剧本写死读哪个改哪个，**量不到检索质量**；`real` 档要 `CAIRN_API_KEY`。
- 真跑模型那条路（`pnpm bench` = `scripts/loop-eval.ts`，走 `createGlmSessionProvider` + `BASE_SYSTEM`，是真模型、真钱、凭据只走 env）**不在门表里**：`bench` 与 `eval-report` 都不含 `check` 词根 ⇒ `checkGateManifest` 的孤儿护栏对它们完全安静。第 335 页记分板把 ⑩ 外部基准记成「**无可达观测面（缺凭据＝#36）**」。

⇒ 结论：**「检索准不准」这件事在评测靶面上今天没有那一枚判据名**。要加的话，它是**新增一枚 EXPECT_NAME ＋ 一条解释分支 ＋ 靶子里补真值文件名单**，属能力面工作（动 `src/agent/eval/`＋`fixtures/bench/`），不是加门；而它只有在**真模型**跑起来时才有意义（回放档按构造恒真）。这笔要花真钱，本次范围外。

⚠️ 未入库标注：`src/agent/eval/task-set.ts` 工作树那份只有 **1 行**在飞（`feasibility()` 里把凭据名从 `M0_API_KEY/M0_ENDPOINT` 改成 `CAIRN_API_KEY/CAIRN_ENDPOINT`），是别人的改动，本报告全部按 HEAD 计。

---

## 3. 要查第 3 条：符号地图／影响面进上下文的路径与「一致性」判卷

**进上下文的路径（现读 `src/agent/glm-session.ts`）**
- 装配点：`buildMapText(history)`（`glm-session.ts:971-996`）。闸：`if (!mapBuilder || historyForMap.length > 2) return null;` ⇒ **只在首轮注入**，第二轮起根本不送。
- 预算：`budgetTokens: MAP_TOKENS_DEFAULT` ＝**1024**（`src/agent/map/render.ts:12`；`MAP_TOKENS_MAX=4096` 是**上限不是缺省**，注释专门点过这个坑）。生产实际正文 **918 token**（现读记录，`locate-recall-after-336.log` 覆盖面那一行 `渲染进地图=59 tokens=918`；第 358 页另记「地图正文 919 token、且排在历史**之前**，抖掉的不是这 919 而是它后面整段可缓存前缀」——这就是它不每轮送的理由）。
- 取料三路（都来自 `context-signals.ts` 那两只共用正则）：`mentionedIdents`＝最近一条 user_message 的标识符切片；`contextFiles`＝最近 8 条里 read/edit/write 的路径＋user_message 里的路径形状；`queryText`＝**整句问话原文**（`lastUserContent`，两半共用一个取料点）。
- 重算节奏：`RECOMPUTE_EVERY_DEFAULT = 10`（`map/build.ts:42`）——但既然只首轮注入，这一维实际管的是 builder 缓存的复用窗口。
- 影响面另一路：`settings.ts` 的 `impactAnalysis: true` 缺省开 ⇒ 语义租约管 spawn 准入＋每写一次回注一句 `[impact]`（`gate-manifest.ts` 第 204 页那段），读端工具 `src/tools/impact-query.ts`。

**有没有一条判卷钉住「地图内容与代码真一致」？**
分三层，答案是**下层有、上层没有**：

| 层 | 判卷 | 状态 |
|---|---|---|
| 解析层（声明抽全没抽全） | `map-check` ⑦ ＋ `probe-map-recall`（独立 TS-AST 真值，召回 0.9991、零抽取=0） | **有**，且真值独立于被测面 |
| 图/边层（关系对不对） | `tests/impact-accuracy.test.ts`（16 条人工真值边，precision=1.0/recall≥0.9）＋`impact-multilang`＋边权 `map-rank` | **有**（但夹具是合成 10 文件） |
| 注入层（模型真收到了吗、只首轮、降级要出声） | `tests/map-turn-gate.test.ts`（钉「次轮根本不送」，注释里写着「把 `>2` 改成 `>200` 全量判卷一条都不红」⇒ 这格是**补了观测者**之后才有的）＋`tests/map-self-report.test.ts`（覆盖面自述＋降级那句不许与「这仓库没结构」同形） | **有** |
| **语义层（地图里那行说的还是代码现在的事吗）** | **没有** | ⚠️ 缺口。地图正文的行号/权重说明来自 `rank.ts` 注释，第 336 页就是靠**改注释**把 L10 从 MISS 抬到第 1 ——改的是文案，不是行为；没有任何判卷问「注释里承诺的那几个数还对不对」。§5 已经量到同一族在真值集那一侧**确实漂了** |

---

## 4. 要查第 4 条：记忆面 `scripts/memory-check.ts` 的 G5／G6（读源码，未跑）

- **G5（`memory-check.ts:262`）**：`check(canaryBefore === canaryAfter, "G5 压缩器不触记忆文件（canary 逐字不变）")`。
  它验的是**破坏性**：跑一次真 `runCompaction`（真临时仓、`ratio:0.05` 逼它真压），然后比 `.agent/memory/MEMORY.md` 的字节。它**不验检索**——它只保证压缩器不写记忆盘。
- **G6（`:264-270`）**：`memorySurfaceHits(compactionSrc)` 必须为空 ＋ **G6b** `stringLiterals(compactionSrc).length > 5`。
  这是**静态面**：扫 `src/agent/compaction.ts` 的**字符串字面量**（2026-10-04 从「扫整份源码文本」改过来，因为旧写法被 `who(e.agent_id)` 里的巧合子串 `".agent"` 撞红）。G6b 是本仓标准的那枚**反向自证**——「字面量清单非空，尺没退化成永远不匹配」。单源谓词在 `scripts/lib/source-literals.ts`，判卷侧（`tests/memory-check-g6-face.test.ts`）引用同一只，不抄第二份。
- **「检索到的记忆条目是否真的被用到」——没有覆盖。**
  记忆面今天有的观测者是这几枚（10 支 `tests/memory-*.test.ts`＋G 段）：`memory-inject-token-budget`（6000 token 预算怎么裁）、`memory-arch-outline-cap`、`memory-eviction-notice`（驱逐要出声）、`memory-lesson-isolation`、`memory-degradation`、`memory-runner`、`memory-store-pure`——全是**装配/预算/生命周期**，没有一条问「注进去的那条 LESSON，模型后来用了没」。
  全仓唯一「条目没被用到就要报」的谓词在**别的面**：`src/agent/reproducibility.ts:86` 的 RD4（死引用白名单复查，防登记表只增不减），被 `tests/reproducibility.test.ts:66` 与 2 支变异锚点指着。那是**复用面**，不是记忆面。

---

## 5. 本次新增的现读：尺的真值面已经在漂（探针＋日志在本目录）

`truth-face-probe.mts`（只读、零建图、取 HEAD 那份，日志 `truth-face-reading.log`）：

```
真值集＝HEAD 那份 fixtures/locate/dsh-questions.json｜题数=14
⑴ 真值文件不在跟踪清单里的（负控除外）＝ 0 条
⑵ 负控条数＝ 0（期望恰 1）
⑶ 正哨兵条数＝ 0（期望恰 1）
⑷ 题型分布＝{"nl":10,"ident":4}｜去重后真值文件＝ 13 个｜重复指向＝ 1 组：src/agent/no-progress.ts(L03+L11)
⑸ 问句短于 20 码点的题＝ 1/14：L08
```

逐条读法（都不许乐观读）：
- ⑴＝0 是**因为还没腐烂，不是因为有人守着**。没有任何判卷读过这个 fixture（全仓只有 2 支手动探针读它：`probe-locate-recall.ts:64`、`probe-summary-coverage.ts:82`）；它**不在 `scripts/frozen-sha256.json` 那 66 条冻结面里**。
- ⑵⑶＝0 说清了一件从前没写下来的事实：**正哨兵与负控不在 fixture 里，是硬编码在探针源码里**（`probe-locate-recall.ts:65-68`）。所以尺的两枚自检靶**住在被测方自己的文件里** ——改探针就能改靶子，而 `tests/locate-recall-ruler.test.ts` 读探针源码时只 assert 那几支接线串，**没 assert 靶子的身份**。
- ⑷ 重复 1 组：「A 臂 14/16」的分母里有**两题指向同一个文件**（L03 自然语言、L11 标识符）——这不是 bug（两种题型同文件本来分别计分），但**帽的口径必须写「14 题／13 个不同真值文件」**，否则下一次有人拿 13 当分母。第 302 页注释其实已经知道（「14 行真值（去重 13 文件）」），只是这条从没落进判卷。
- **★真凭据（本次逐条 `git show HEAD:<file> | sed -n '<n>p'` 量的）：fixture 的 `evidence` 行号已经在漂，而 ⑴ 一声不吭——因为它只核文件存在性，不核行号。**

| 题 | fixture 声称 | HEAD 实际 | 漂移 | 怎么量出来的 |
|---|---|---|---|---|
| L03/L11 | `src/agent/loop.ts:297` 是 `noProgressLadder` 生产调用点 | 该行是注释；调用在 **304** | **+7** | 手工（探针落成「无法核」：引用后没跟符号名） |
| L02 | `src/agent/verify.ts:101` = `ESCALATE_REPEAT_ATTEMPT` | 该行是注释尾巴；常量在 **106** | **+5** | 探针＋手工复认 |
| L08 | `src/main/agent-runner.ts:1143 serveScheduler` | 该行是 `scheduler?.stop();`；定义在 **1150** | **+7** | 探针＋手工复认 |
| L09 | `src/agent/memory/inject.ts:27` = `MEMORY_TOKEN_BUDGET_DEFAULT` | 该行**是空行**；常量在 **28** | **+1** | 探针＋手工复认 |
| L10 | `src/agent/map/rank.ts:52` buildGraph ／ `:164` personalizedPageRank | 第 52 行是注释；实际在 **77**／**231** | **+25／+67** | 前者探针抓到；后者是**裸行号**、探针不解析，手工补 |
| L14 | `src/agent/model-surface.ts:17-145 planSurfaceBudget` | 该区间是文档注释；函数定义在 **167** | 声称区间整体错位 | 探针（其自动行号 15 不可信，见下面的洞②） |
| ~~L07~~ | `src/tools/apply_patch.ts:198-200` 拒 rename/move/delete | 第 198 行确实是 `if (f.op === "rename") {` | **0（假漂）** | 探针取词取到散文里的 `hunk` ⇒ **不进账** |

第二支探针 `evidence-line-probe.mts`（日志 `evidence-line-reading.log`）逐枚核了 20 条引用：**自动读数＝命中 7／漂 6／符号在该文件不存在 0／无法核 7**；人工复认后进账 **7 枚已漂（自动 5＋手工 2），落在 14 题里的 7 题上**，其中 1 条候选是假漂（L07）。

⚠️ **这条尺的第一版读数不进帽，先人工复认**（本仓规矩第 3 步「先在 HEAD 上量一次现读，拿到真实总数才写帽」在这里同样成立）。探针自己的两个洞写在日志里，别把 7 当精确值：① 只认 `<路径>:<行号>`，`rank.ts:52 … / :164` 那种**裸行号**要手工补；② `findIndex` 取首个文本出现，可能落在注释里（L14 那条自动读数是第 15 行，真实定义在 167）。

L10 那一格最说明问题：**上一笔检索改进（第 336 页，只改了 `rank.ts` 的顶部注释）自己把真值集里那条行号引用撞漂了 25–67 行，而所有判卷、所有门、尺的自检全部照绿。** 尺不会因此报错，因为它只比 `文件路径`；但它承诺的「evidence＝可核对的证据」这一格已经名不副实。

---

## 6. 要查第 5 条：那把最小的尺长什么样（以及该不该加）

### 6.1 先接受这条前置约束

PROGRESS **第 358 页**（2026-10-04）是本仓「加尺」这条线的**收口页**，白纸黑字：

> 用户令「不要过拟合」我按字面执行——**不再新增尺／锚点／变异矩阵**……本页之后我的工作面转到 `src/` 的**能力**本身。

同一页还给了两条不乐观的读数：那天 5 把尺里**只有 2 把钉住了「生产端真的吃这个决策函数」**（只有接线突变被杀，纯函数突变没人看）；`C6`／`C9` 两台「杀死但独有红 0 条」——用例按整表断言、一条覆盖多格，互为顶包候选。

⇒ **任何建议都必须是「不新增一把尺」。** 下面是「给已有那把尺补一枚观测者」，它不加维度、不加门、不加针脚，且形状照抄本仓已兑现的先例（`promise-recall-inventory` ＋ `source-literals`）。

### 6.2 建议的最小那一格：尺的真值面自检（**唯一一格**）

**输入面（取料复用，不许再算一遍）**：
- 数据＝`fixtures/locate/dsh-questions.json` 那份（**由探针 `export` 一个纯函数出来，判卷直接吃它**，正如 `tests/promise-recall-inventory.test.ts` 吃 `probe-promise-recall.ts` 导出的那一份；判卷**不**自己再读一遍 JSON 再自己解析一遍形状）。
- 存在性判断＝**参数注入**（`(rel: string) => boolean`），像 `scripts/head-import-face.ts` 的 `findDanglingImports(files, existsFn)`。真跑器传 `git ls-files` 的集合；判卷传假集合。判据本体不碰盘、不起进程、**一毫秒都不建图**。
- 靶子身份＝把 L-POS／L-NEG 从**探针源码里的硬编码**搬进同一份 fixture（`shape:"sentinel"/"control"` 那两个字段本来就已经在类型里，只是没人用）。搬完之后，尺的自检入参照旧由 `rulerSelfCheck` 吃，而「哨兵指向的文件必须真存在、负控指向的文件必须真不存在」这件事第一次有个能秒级跑的家。

**判据（纯函数怎么写）**：
```
checkLocateTruthFace(questions, exists):
  ① 每条非 control 题的 truth[0].file 必须 exists=false ⇒ 点名（抓「真值腐烂」）
  ② 恰有 1 条 shape=control，且它的 truth **必须不存在**（抓「负控变成正样本 ⇒ 命中定义失去观测者」）
  ③ 恰有 1 条 shape=sentinel，且它的 truth 必须存在（抓「哨兵指向一个早已不在的枢纽文件 ⇒ 永远 MISS，
     而 rulerSelfCheck 会把整张表的命中率判成不可引用——那是尺自杀，不是仓库变坏」）
  ④ 题号不重复、真值文件重复那一组必须**被登记**（现读 1 组：L03/L11）⇒ 帽那格的分母口径写死「14 题／13 文件」
```

**正／反例（合成输入，先验分辨力，不碰真仓）**：
- 正例：`[{id:"A",shape:"nl",truth:[{file:"x.ts"}]}, {id:"S",shape:"sentinel",truth:[{file:"s.ts"}]}, {id:"C",shape:"control",truth:[{file:"ghost.ts"}]}]` ＋ `exists = f => f!=="ghost.ts"` ⇒ 0 出声。
- 反例 1（腐烂）：`exists = () => false` ⇒ ①与③都出声（不同用例）。
- 反例 2（负控变正）：`exists = f => f==="ghost.ts"` ⇒ ②出声。
- 反例 3（**「对全部输入同答」那一格**）：`exists = () => true` ⇒ ②出声；`exists = () => false` ⇒ ①③出声。⇒ 恒真是写不出来的。
- 反例 4：两条 control ⇒ ②出声（不许由「至少有一条」蒙过去，「字段缺席」要分列印）。
- ⚠️ 按规矩**别编一张「全违规面」**：②与③对 `exists` 是**反极性**读的（一个要假、一个要真），那张面不存在。正确分辨力证人＝枚举面 × 两句（有面无它出声／有面它闭嘴），各一台造红。

**帽与存量登记（本仓帽只准调低）**：
- 存量＝本次 §5 现读，逐条带页号出处：**1 组真值文件重复（L03/L11 同指 `src/agent/no-progress.ts`）**、**7 枚 `evidence` 引用已漂（L02、L03 与 L11 共指的一枚、L08、L09、L10 的两枚、L14）**、**0 枚指向不存在的文件**、**2 枚自检靶（L-POS／L-NEG）住在探针源码而不是 fixture 里**。
- 帽口径：漂的引用枚数＝**帽 7**，**只准调低**；不再命中也要红（stale 即红，否则登记表自己烂掉）——同 `docs-check` 那条「存量不再命中要点名该删」。⚠️ 这一维**只登记、不拦**（理由见下面 6.2 末段与 6.4），所以帽写在页与探针注释里，不写成断言。
- 行号那一维**要不要进判据**：建议**只登记、不拦**。理由是第 358 页那条纪律——刻意不做成阻断维的格子，要把理由写在页上：行号随任何一次编辑漂，把它当阻断维就会逼所有人「改代码前先改 fixture」，那才是真过拟合。要拦的是**文件级存在性**与**哨兵/负控形状**（那两格变了是语义变了，不是排版变了）。

**接进 `scripts/gate-manifest.ts` 的代价（现读那个文件）**：
- 门表现读 **33 道**（`GATES`），其中认证面 **`CERT_GATES` 23 道**，预算之和 **58 700ms**，距 `tests/cert-gate-face.test.ts:124` 钉的那条 **≤60000ms** 只剩 **1300ms** 余量——文件头上那句「这条线快到头了：再往门面买门之前要先裁『要不要抬 60000』，而抬它＝单独一笔说明＋单独一次认证，不许顺手改」**今天仍然成立**。
- ⇒ 建议**完全不动 `GATES`、不动 `CERT_GATES`、不新增 package.json script**。新判据落在**已有的 `test` 那道门里**（`tests/locate-truth-face.test.ts` 之类，吃探针导出的纯函数），代价是**秒级判卷的一条新用例**，不是道新门。这是 `promise-recall-inventory` 已经走通的那条路，也是第 358 页唯一认可的方向（「不是没闸，是闸在后面」）。
- **不要**把 `probe-locate-recall` 本身买进门：它一次 ≈**60s**（第 336 页第 8 条），量纲与 `map-check`（主树现读 53.0s，正是「四道不进门面」里的那一道）同级。门面买不起第三道 60s 级门；而 1300ms 的余量也不允许"顺手多买"。
- 命中率那个数字：建议按 `no-progress-check` 那句同一口径处理（「真实录制显示命中/未命中是全有或全无 ⇒ 拿命中率当判据＝一扇随机红的门」）——**登记为读数（第 335 页那张 B 口径记分板那一行），不做成阻断维**，并且只在**动了 `src/agent/map/**` 或 `src/agent/impact/**` 的交笔**里跑一次同分母 A/B（那是第 303/336 页已经建立的做法：单变量、全新 tags 缓存目录、`cp` 备份＋`cmp` 复原）。

### 6.3 明确**不该做**的四件事（过拟合清单）

1. **不加「命中率 ≥ 14」这种帽。** 14 道题、13 个不同真值文件、其中 10 题「条件化输入为空」（`条件化输入为空=10/16`）——用这张面当阻断维，等于把**本仓注释的写法**钉进判卷。第 336 页那台**措辞探针**已经亲手证过：`rank.ts` 一句注释让夹具原句 **+7** 个词、四句没参照的换说法只 **+1／+1／+3／+1**，「这一笔的 14/16 里约一半是措辞撞上的」。给一把已知约一半靠措辞的尺装帽＝把一次撞对钉成规矩。
2. **不在 `eval` 靶面上伪造检索判据。** 用 `changedFiles ⊇ 该读的文件` 之类的代理（gym 已有 `mustChangeFiles`）冒充「检索到了」是恒真的另一种写法——写之前它就被剧本回放喂好了。要加就是第 2 节说的**真模型＋新 EXPECT_NAME**，那是花真钱的能力笔，不该伪装成一把尺。
3. **不再为「尺的尺」加第二把。** `tests/locate-recall-ruler.test.ts` ＋ `probe-self-check.ts` ＋ 3 支锚点已经是「尺的尺」了，再加一层就走进第 358 页那句「两道闸同拦一件事时摘一道必存活，变异存活不等于守卫多余」的反面。
4. **不动 `fixtures/locate/dsh-questions.json` 的行号来"清账"。** §5 那张漂了三处的表，正确处置是**登记并写明这一维不拦**；批量刷行号只会让 `docs-check` 的证人点名与 12 支引用它的判卷一起跟着动，是零收益的抖动。

### 6.4 替代做法（如果连 6.2 那一格都不做）

那么这条线就该这样收：**把「检索质量今天有尺、但尺只在人记得跑时说话」这一句写进 PROGRESS 与产品目标 1 的对应格，作为一条**已知债**登记（照 `#43`／`#47` 那两格的写法），然后按第 358 页的方向转去动 `src/` 的能力本身**——因为 ⑴ 词面通道的硬上限已经量出来了（整个文件也只有 **38.5%** 的问句词在文件里存在，第 336 页第 6 条），继续加判据不会让定位变准；⑵ `#46`（把词面语料从「头注释」扩到「全文注释行」，边际 **+14.2 个百分点**，比单文件改写大一个量级）那条**能力**待办还压着没动——那才是目标 1 的下一格，且它做完必须有同分母 A/B 而不是新尺。

---

## 7. 附：本次读过的关键路径（全绝对）

- `/Users/ze/Downloads/Cairn/deepseek harness/scripts/gate-manifest.ts`（HEAD：GATES 33／CERT_GATES 23／预算 58700ms）
- `/Users/ze/Downloads/Cairn/deepseek harness/scripts/probe-locate-recall.ts`、`scripts/lib/probe-self-check.ts`、`tests/locate-recall-ruler.test.ts`
- `/Users/ze/Downloads/Cairn/deepseek harness/fixtures/locate/dsh-questions.json`、`outputs/rank-head-comment-45-2026-10-04/locate-recall-after-336.log`
- `/Users/ze/Downloads/Cairn/deepseek harness/scripts/map-check.ts`、`scripts/probe-map-recall.ts`、`scripts/probe-summary-coverage.ts`
- `/Users/ze/Downloads/Cairn/deepseek harness/tests/map-retrieval.test.ts`、`tests/map-rank.test.ts`、`tests/map-turn-gate.test.ts`、`tests/map-self-report.test.ts`、`tests/context-signals.test.ts`
- `/Users/ze/Downloads/Cairn/deepseek harness/src/agent/map/retrieve.ts`、`src/agent/map/cap.ts`、`src/agent/map/render.ts`、`src/agent/context-signals.ts`
- `/Users/ze/Downloads/Cairn/deepseek harness/src/agent/glm-session.ts:971-996`（地图注入闸）、`src/agent/recall-path.ts`
- `/Users/ze/Downloads/Cairn/deepseek harness/tests/impact-accuracy.test.ts`、`src/agent/impact/index.ts`（**工作树在飞，未入库**）
- `/Users/ze/Downloads/Cairn/deepseek harness/scripts/memory-check.ts:238-270`（G 段）、`src/agent/memory/inject.ts`
- `/Users/ze/Downloads/Cairn/deepseek harness/src/agent/eval/task-set.ts`（HEAD）、`scripts/lib/eval-expects.ts`、`scripts/lib/eval-heldout.ts`、`fixtures/bench/tasks.json`
- `/Users/ze/Downloads/Cairn/deepseek harness/scripts/loop-eval.ts`、`scripts/eval/report.ts`、`scripts/gym-check.ts`、`src/agent/gym/score.ts`、`src/agent/gym/runner.ts:60-90`
- `/Users/ze/Downloads/Cairn/deepseek harness/PROGRESS.md`：第 302／335／335 补／336／**358**（「不要过拟合」收口页）／359 页
- 本次探针（全在本目录，只读、零建图、不写盘）：`truth-face-probe.mts`＋`truth-face-reading.log`（真值面形状/存在性/重复），`evidence-line-probe.mts`＋`evidence-line-reading.log`（20 枚 `evidence` 引用逐枚核）

**本次未跑（按硬约束）**：vitest 全量与单文件、`scripts/typecheck.ts`、`mutate-verify.mjs`（含 `--check-needles`）、`head-cert.ts`、任何 `*-check` 门、任何真模型。文中所有「门/判卷行为」均为**读源码所得**，不是跑出来的读数；唯一跑出来的是本目录那支只读探针。
