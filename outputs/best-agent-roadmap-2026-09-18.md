# 怎样做出比 Codex / Claude Code 更强的 agent：harness-only 路线图（2026-09-18 调研轮）

**用途**：回答用户的原始问题「到底如何才能做出最好的 agent，比 Codex 和 Claude Code 更好，不止代码能力」。
按用户本轮拍板的三个前提收窄：**产出 = 绑定 DSH 的差距 + 优先级路线图**；目标能力面 = **长时程完成率 / 同任务成本最低 / 非代码能力 / 越用越强**四项全要；
**模型侧不动，只能改 harness、挂第三方 API**。这条前提决定了全部打法——凡是「要靠模型/训练/流量语料」的护城河，我们不进。

**方法**：三路并行。① Codex/CC 护城河拆解（官方工程博客 + 文档 + arXiv + 缺陷票）；② 非编码能力面前沿（OSWorld/OfficeEval/CAP/SkillsBench/深调研系统簇）；
③ 本仓代码实读盘点（HEAD `9371865`）。三路结论 + 我的关键断言逐条本机复跑。

**结论一句话**：**赢不了的部分是模型和流量（CC 的 auto-mode LLM 分类器要 1 万条真实轨迹语料、Codex 的 `apply_patch` 已长进 RL 分布），能赢的部分很具体——
两家在「工具结果截断、压缩成本核算、长时程可恢复、每任务成本透明」四件上都留下了可复现的错误或空白，而我们手上已经有其中三件的半成品；
但在讨论任何一项之前，先过「门 0」：本轮实测发现渲染层只接了 34 条 IPC 桥中的 13 条，
**新加的马力今天依然到不了用户手里**，且 29 道门没有一道拦得住这种塌陷。**

可信度标注：`【实测】`本轮我复跑验证 · `【继承】`并发会话/文档记载，未复验 · `【外部】`一手论文或官方文档 · `【外部⚠】`厂商自报或口径不可比 · `✗不可引用`。

---

## 0. 读法与去重（与四份在飞产出的互指表）

本仓今天已有四份相关产出，**同一事实我只引用不重列**：

| 产出 | 归属会话 | 与本文的关系 |
|---|---|---|
| `outputs/agent-landscape-gap-analysis-2026-09-18.md`（A1–A9 / B / C 档 + 优势 + 三件优先级） | a6cfc8c3 | 代码能力面的差距台账。**本文所有代码面缺口都写「同 A_n」**；本文只补它没覆盖的非代码能力面与长时程面 |
| `outputs/design-contradictions-2026-09-18.md`（C/D/E/F 四类矛盾 + T1–T28） | 3a3564d8 | 渲染侧事实（D5 双实现 7 个、D7 **37 个无 JS 引用的 DOM id**、T1 runCancel 无按钮）。**与本文 §2 是不同一面**：它是「渲染层自己有的东西没人用」，本文是「后端发货的东西渲染层接不到」，两者不同集合、别混列 |
| `.worktrees/r1b/.../r1b-renderer-subtraction-design.md`（渲染器 2→1、22 条钩子白名单） | 316c75f9 | 本文 §2 的所有「补 UI」一律**排在 R1b 之后（R1c）**，理由见 §2.4 |
| 主树未提交的 128k 预算修复（A2） | 6a8c777c | **已入库**（`d64084e`，6 文件 +112/−7，本轮复验）。本文不列该待办；两层钳制机制见 §4.2 |

---

## 1. 立论：harness-only 到底能赢多少（正反证据都摆）

不先钉死这一条，后面全是信念。同模型换 harness 的**受控实验**给出的是双向结论：

**能赢的证据**
- LangChain Deep Agents：模型固定 `gpt-5.2-codex`，Terminal-Bench 2.0 **52.8% → 66.5%（+13.7pp）**，增益全部来自提示/工具/含验证环的 middleware。【外部·2026-02-17】
- arXiv 2608.26218：**唯一改动 = 机械缩短旧工具结果**。20k token 预算下 Qwen3.6 fail-to-pass **28%→49%**、完整解 **43→72**；SWE-bench Pro F2PF 15%→33%；Devstral +20pp。⇒ **截断/压缩策略本身近乎翻倍解题率**。【外部·2026-08-26】
  ⚠️ **这一条对我们格外刺**：DSH 的 `prune.ts`（每轮零 LLM 裁剪，保护 40k / 免剪 skill·remember·memory）**就是这篇论文的机制**，且做得更细。我们有半成品，缺的是把它变成**可发表的数字**。
- SWE-bench Verified 榜（2026-02-13 行）mini-SWE-agent 固定 harness 下 Claude 4.6 Opus 72.0%，而 Anthropic 自报同模型同指标 81.42% ⇒ 约 **9pp 归因于 harness/提示**。【外部⚠ 自报】

**赢不了的证据（同样重要，防自欺）**
- arXiv 2607.22585《Harness Choice as a Hidden Variable》：2 模型 × 3 harness × 50 任务，**通过率只移 0–8pp，token 差 ~40×**（Goose 38–50% @ 28–37k / OpenHands 46–50% @ ~841k / OpenCode 46–50% @ 1.1–1.5M）。【外部·2026-06】
- DeepSWE（arXiv 2607.07946）：16 个前沿 agent 统一挂 mini-swe-agent 评测，**成本与准确率无相关性**；harness 试点（仅 10 题，噪声大）显示标准 harness 无系统性劣势。【外部·2026-07】
- NLAH（arXiv 2603.25723）：SWE Verified 上 TRAE full 74.4% → **去掉某组件反而 76.0%** ⇒ **harness 组件可以净负贡献**。【外部·2026-03】

**⇒ 本文的判据（不是口号）**：harness 买「分数」只在**预算受限 + 长时程**这两格里成立；短任务上它买的是**成本**。
所以 DSH 的正确战场恰好是它的约束本身——**第三方模型 + 低预算 + 小时级任务**，这是全行业 harness 收益最高的一格；
而代价是：**任何指标必须同时报「准确率」与「$/成功任务」两个数**，只报一个的结论一律作废（Goose/OpenCode 那 40× 就是只报通过率时看不见的）。

✗不可引用：「scaffold 移 22 分、模型移 1 分」「harness 可摆动 36 分」——子代理未能追到一手，别写进任何文档。

---

## 2. 门 0 · 可达性：能力已发货，用户点不到（本轮实测）

### 2.1 事实（我复跑验证，非引用）

| 量 | 实测值 | 方法 |
|---|---|---|
| preload 暴露的方法 | **34** | `src/preload/index.ts` 顶层键枚举 |
| 被渲染层引用的 | **13** | 与 `app.js` + `index.html` 词边界匹配 |
| **孤儿桥** | **21** | 补集 |
| `app.js` 出现 "provider" 的次数 | **0** | `grep -nE "provider\|apiKey\|providerKey" src/renderer/app.js` → 空 |
| `index.html` 的 `<input>` 数 | **2**（搜索框 + 隐藏 file input） | 实测 |
| 缺省 provider | `"demo"`（冻结 mock 剧本），且 `PROVIDER_KINDS = ["demo","glm"]` | `src/main/settings.ts:85,99`（本轮复验）|
| 有没有门能抓到这件事 | **没有** | `scripts/ipc-check.ts` 触 `renderer\|app.js\|index.html` → **0 命中**；门清单无可达性门 |

**机制解释（本轮实测，比「没门」更值得记）**：21 条桥对应的 21 个 IPC 通道名，在 `scripts/` + `tests/` 全文检索 **0 命中**。
⇒ 29 道门全部直打内核函数（`schedule-check` / `sidechat-check` / `plugins-check` / `commercial-check` 都是），
**IPC↔渲染层那一段从来不在任何断言面上**——门全绿与产品面塌陷同时成立，不是门松了，是它们量的是另一条路。
任何后续「能力已闭合」的宣称，若不写「经 IPC 到 UI 可达」的断言，都默认继承这个盲区。

21 条孤儿（全文照录，便于 R1c 逐条裁决）：
`submitClarify, runCancel, compact, getProviderInfo, renameSession, deleteMemory, pluginDecide, sidechatCreate, sidechatAsk, sidechatPromote, sidechatState, cardAction, scheduleSnapshot, scheduleUpsert, scheduleDelete, scheduleRunNow, providerKeySet, providerKeyDelete, providerKeyStatus, checkUpdate, openExternal`

### 2.2 为什么这是最高优先级（不是「UI 小 bug」）

缺一条桥 = 一整个**已验收能力**在产品里不存在，而不是一处交互不便：

- `providerKeySet/Status/Delete` + `getProviderInfo` + `app.js` 无 provider 字样 ⇒ **用户无法在 UI 里选真模型、录 BYOK key**。缺省是 `demo` ⇒ 出厂 app 的主对话跑冻结剧本。后面 G1–G5 的每一个收益数字都要真模型才有分子分母。
- `submitClarify` ⇒ **三门之一的澄清门在桌面端没有表单**，只能挂到 60s 默认拒绝（fail-closed 的代价是「门永远拒」而不是「门永远问」）。
- `cardAction` ⇒ worker 审批/合并**只能看不能点**。而「agent 无合并权、唯一出口是 git 面板」（`src/agent/worktree.ts:8-9`）是刻意设计 ⇒ 没有这张卡，M3 整套编排在桌面上不可用。
- `schedule*`（4 条）⇒ M4a 定时/无人值守全链路后端齐备（989 行 scheduler + 四道准入 + fail-closed）**无入口**。
- `pluginDecide` ⇒ 项目级插件首载出信任卡、未信任则 hooks/MCP/LSP 一律不激活（`plugins/trust.ts`）⇒ 桥断了 = **所有项目级插件永久停在 pending**，且这是静默的。
- `sidechat*`（4 条）⇒ M2 已验收的旁路问答不可达。`compact` ⇒ 用户主动压缩无出口。`openExternal` ⇒ `setWindowOpenHandler` 全 deny 的前提下，链接点不开。

**⚠️ 判读纪律**：这条与 `defaultImpactHook` 零调用者、bandit 两头断、SoL-Pi §2-P-1「组装型 provider 不在生产热路径」是**同一个失效模式的第四次出现**，只是这次规模大一个数量级（21/34）。本仓反复在「模块写完 + 有测试 + 门全绿」上停住，缺的从来是最后一跳。所以任何新能力立项时，**验收断言必须写「用户可达」而不是「函数正确」**。

### 2.3 门 0 的解法只有两种：删桥 或 补 UI

21 条逐条裁决（含通道、后端 handler、是否唯一路径、删掉会空掉什么、归属批次）**见 §13**——那是本轮复跑过证据的版本，也是协调会话要的 R1b/R1c 输入。
本节只留三句结论：

1. **一条都不该「随手删」**：21 条在 `src/main/index.ts:200-266` **全部有活 handler 并委托真子系统**（实测），所以「孤儿」只证明渲染层没人调，不证明能力已死。判「删」必须有独立理由（见 §13 的「唯一路径」列）。
2. **四条是硬断路**：`providerKeySet/Status` + `getProviderInfo`（真模型录不进 key）、`submitClarify`（澄清门只能挂超时）、`cardAction`（worker 审批/合并唯一出口）、`pluginDecide`（项目级插件/hook/MCP 永久 pending）——这四条不补，G1–G5 全部无法取证或不可达。
3. **补 UI 一律排 R1c**（`3a3564d8` P0 → `316c75f9` R1b 之后），理由见 §2.4。

### 2.4 归属与排期（我不动手）

- **G0.1 新增机械门 `ipc-reachability`**：断言「preload 每个方法在 `src/renderer/` 至少一个调用者，否则红；豁免须行内理由（照 `assertion-health` 的 `// gates:disjunction-ok` 体例）」。落点 `scripts/` + `gate-manifest.ts`，**不碰 `src/renderer/`**。
  **归属已裁（2026-09-18 协调会话）：派 `6a8c777c`（当前主树 writer），本文作者不做。** 本文只提供它需要覆盖的 21 条基线清单（§13）。
  这条同时是**防再犯**：R1b/R1c 之后任何一轮减法都可能再造孤儿桥。
- **G0.2 21 条逐条删/补裁决**：**本文已交付，见 §13**（只读产物，含影响面与严重度）。最终裁决与施工归渲染层队列 writer。
- **G0.3 补 UI 全部排 R1c**，即 **`3a3564d8` P0 三条 → `316c75f9` R1b 之后**。理由：R1b 正在把 live/replay 两套渲染器合成一套并定 22 条钩子白名单，先补 UI 等于对着即将消失的结构写代码；且 R1b 的 `panelEmptyHTML`/`data-tool-toggle` 白名单会直接决定新卡怎么写。
- **R1b 侧只需顺手做一件**：把 §2.3 判「删」的桥列入其 §8「出清单不动手」，别在本轮动。

---

## 3. G1 · 让自评可外推（前置于 G2–G5 的一切数字）

| 项 | 为什么必须先做 | 现状证据 |
|---|---|---|
| 靶场补「分叉回放」+ 记录动作分歧率 | arXiv 2608.08239：同 prefix 换模型后**动作分歧 61–94%、对成功的预测准确率 0**。我们的 bandit 与 M5a gym 共享「回放轨迹可估值」这一未验证假设 ⇒ 不修，「路由省钱/压缩省 token/技能有效」的结论在方法上都是自证 | 【继承】同 gap 分析 §B2；`fixtures/gym` 仅 3 个本地冻结 case（`scripts/gym-run.ts`）+ 明卷 token 是剧本字节纯函数（`solpi-port-proposal.md` §P3 已自述） |
| 接一个非自有任务集 | τ²-bench 电信域已饱和至 99.1%（【外部⚠】2026-09-18）、BIRD 类 SQL 榜标注错误普遍（arXiv 2601.08778 / VLDB CIDR 2026）、真实库 Spider 2.0 91%→21% ⇒ **公开榜与可用性正在脱钩**；但零外部集 = 对外无可信度、对内易过拟合 `todo-app`。**不追 SWE-bench Verified**（OpenAI 官方已判其不再区分前沿） | 同 gap 分析 §B3（那条判据我们复核为准确） |
| 真模型凭据（`M0_API_KEY` 常驻 CI + 严格未证模式写死） | 现有 9 项联网/凭据未证项长期不闭合 ⇒ 一切「已闭合」都带星号 | 【继承】AGENTS.md 当前状态节 |

⚠ 这三条都在主树/`scripts/`，**与渲染层队列无关，可与 G0.1 并行**。

---

## 4. G2 · 同一任务成本最低（四项里证据最硬、且我们半成品最多）

### 4.1 缓存断点（同 A1）——但**顺序**要反过来写
外部量级：长时程代理任务上 prompt caching 省 **41–80% 成本、TTFT ↓13–31%**，且结论是「战略性缓存边界」优于整段缓存（arXiv 2601.06007【外部·2026-01-31】）；实战上一个动态 ID 移到上下文尾部 → **命中率 7%→74%、推理成本 −59%**（DigitalOcean【外部·2026-07-23】）。
**DSH 的不对称优势**：事件溯源 append-only + `composeTurnMessages` 固定装配次序（system → 项目记忆 → 全局记忆 → skill/hook → 符号地图 → 历史投影）已经天然满足「稳定前缀 + 动态尾部」。
⇒ 建议写法：**不是「加缓存」，而是「加缓存断点 + 把 cache 读写量喂给已入库的 `economics.ts`」**——经济闸的公式输入就是 `cacheWriteReadRatio`，现在这个变量恒零，**装上缓存它就活了**。这是全案里唯一一处「补 A 让已有模块 B 从死件变卖点」的复利。
验收须含：命中率进事件流、miss 当缺陷统计（Anthropic 已把 cache miss 当生产事故【外部·Implicator 转述，未复验】）、以及 ⚠️ **写 1.25×/读 0.1× 会让「不计量就开缓存」直接涨价** → 净收益必须在 G1 靶场里证明为正，否则按本仓纪律红牌。

### 4.2 上下文预算认模型（A2 已入库，本轮复验其机制）
`d64084e` 的修法**是两层、不是一层钳制**（协调会话提示后我逐行复核，两条都实测）：
① `compaction.ts:47-50` `withModelBudget()` = **替换**（`inputLimit: ctxWindow`），且窗口不可得 / 非有限 / 连 `maxOutputReserve` 都放不下时**原样返回**（保守回落，既不放大也不炸）；
② `glm-session.ts:409-410` = 先按模型窗口定基线，再叠加调用方显式 config，最后 `Math.min(merged.inputLimit, window)` 兜住「显式值超窗」⇒ **provider 必 400 的 fail-closed 让给本地钳住**。
⇒ ⚠️ **推论（对 6a8c777c 有用）**：任何一处「只改 ①」或「只留 ②」的重构都会打开放大洞——①单独存在时显式 config 可以超窗，②单独存在时窗口不可得的回落面不同。**别把它简化成单层。**
残余两项：
- **【实测】`sidechat.ts:50` 仍是硬编码 `inputLimit: 32_000`**，`d64084e` 未覆盖（该提交 6 文件不含 sidechat）⇒ 旁路问答在 200k/1M 档上依旧按 32k 提前压缩。这条**归 6a8c777c 续做**（同一判据族，且 `tests/session-provider.test.ts` 已有可照抄的断言形状）。
- **【设计约束】压缩与缓存必须对账**：`compaction-check` 需加一条「压缩后稳定前缀逐字节不变」的断言，否则 §4.1 的缓存断点与压缩互相拆台（经济闸会误判 saving）。⚠️ 该断言落在 `scripts/`，按协调协议归主 writer，不做渲染层。

### 4.3 步级路由 + 每任务成本一等指标
外部：真实代理负载上仅 **7% 的调用需要前沿模型，成本 −74% 且保 93% 准确率**（LangChain Switchyard 145 任务【外部·2026-08-11】）。
现状：我们的 bandit 是 **spawn/任务级**（`orchestrator.ts:13-15,1994-2003` 回灌 done/failed），`costUsd` **只存在于奖励面、不对外**——本轮实测 `grep costUsd` 仅 `routing/bandit.ts` + `routing/pricing.ts` + `orchestrator.ts` 三处，**没有任何 UI/面板/门读它**。
⇒ 两步：(a) `$/成功任务` 进底栏与右栏投影（⚠️ 新字段，不得复用 `#tokenTotal` 的 `tokStr()` 缩写口径——AGENTS.md 底栏契约）；(b) 路由粒度从「派生时选一次」升级到「步级 effort/档位」。这是**唯一能把 Goose/OpenCode 那 40× token 差变成产品承诺**的路径，而且它天然可发表。

---

## 5. G3 · 复杂长时程任务完成率（对手的四个可复现错误，是我们的四个入口）

| # | 对手留下的缺口（带证据） | DSH 已有 / 缺 | 建议 |
|---|---|---|---|
| 3.1 | **截断把判据吃掉**：CC 失败测试只给 10K 摘录、通过才给全文（wmedia【外部·2026-08-29】）；而学界 LHTB（46 长任务最佳仅 28.3% pass@1、**79% 失败是超时**、另一主因是自我验证不足导致 false finish）【外部·2026-07】 | 我们的 `run_shell` 是**同一个错的更坏版本**：32KB/60s 硬顶且超限**直接丢尾字节**（`run_shell.ts:21-31`，同 A6/同 solpi P1） | **语义化截断**：失败路径必留尾部 + 错误行，与成功路径对称；配合已入库的 `ledger.ts` 留档回取 = 证据永不丢 |
| 3.2 | **无持久 auto-compaction**（openai/codex#24366）；CC 的 auto-compact 在 80–90% 触发且把逐字历史压成有损摘要 | 我们双条件触发 + 六段模板 + 经济闸 + evidence receipts（**这一项是真领先**），但见门 0 | 领先成立的前提是门 0 + G2.1；不要在门 0 前宣称 |
| 3.3 | **快照语义有洞**：CC `/rewind` 保留 100 个快照，但 **bash/子代理/符号链接变更不被追踪**（官方文档【外部·2026-09-04 口径】） | 我们完全没有用户态 rewind（同 A3）；但 append-only 事件 + `forkSession` + worktree 三件套都在 ⇒ 补齐成本低于对手 | **双检查点回滚**（上下文 + 环境同一 epoch）。外部最强证据：AgentRewind 在 MettleBench 成功率 **87.8%、较「继续往前跑」+25.6pp**【外部·2026-08-14】⇒ **单条增益最大的已证机制**，且必须同提交处理「bash 副作用不入快照」这条对手踩过的语义洞 |
| 3.4 | **验证环不收敛**：Codex「每次 review 自己产物都能发现新问题」 | 我们有 verify 上限 3 + verify-on-`ok` 即停 | 见 3.5 |
| 3.5 | 没有「终态必须绑证据」这一层 | `verify` 门 + `evidence.ts` 逐字引文校验 + `impact` + `ledger` + 判卷 sha256 冻结，**零件齐全但没人管终态** | **verify-on-stop 证据闸**：任何 done 声明必须绑定可复核凭据（文件哈希/重算结果/测试退出码/HTTP 回执/diff），缺凭据 → 状态降级为「未验证」而非「完成」。并新增指标 **假完成率**。这条同时是 G3、G4、G5 的公共底座（OfficeEval 的翻倍正是靠「可机检判据」）|
| 3.6 | 短任务 harness 已饱和，长任务没人做「闲暇期预计算」 | 我们有 `scheduler.ts` 1min tick + 桌面常驻 ⇒ **结构性免费**，而 Codex/CC 的产品面是 repo 会话，不做常驻 | sleep-time compute：测试期算力 **↓~5×、准确率 +13~18%**（arXiv 2504.13171【外部·实验室结果】）⇒ **排在 G2.1 之后**，否则预计算的成本先失控 |

⚠️ **不做**：像素级 computer use / 自研 OS 动作模型。OSWorld-Verified 短程已达 86.1%（Qwen3.8 Max，provider-exact【外部⚠】），长程 OSWorld 2.0 最佳仅 20.6%、CAP 跨站 420 任务仅 **8.0%**【外部·2026-08】。⇒ 短时程已被「官方模型 + 官方 harness」吃掉，且这是模型侧战场的 RL 活（Qwen-CUA 自报 87.6），**harness-only 追不上**。这与 gap 分析把浏览器/CUA 判入 C 档的结论一致，只是我给出的理由是「战场归属」而非「读数不可信」。
🔻 审批面别再加压：四种人监督策略实测**攻击成功率仍 54.8–67.3%、人工干预率仅 9.2–26.4%**（arXiv 2604.04918【外部】）⇒ 逐动作确认既挡不住注入又制造疲劳。我们的「风险分级 + critical 强制 + 四层管线 + scope 回写」方向正确（同 gap 分析 §4.2/§4.5），**这条是「不再多加审批」的背书**。

---

## 6. G4 · 非代码能力（用户明确要，且这是唯一没被 A 档覆盖的一面）

**判据**：harness-only 前提下，非代码能力里**只有「产物可被程序判定」的那些值得做**。这条判据的直接证据是本轮最干净的一个数：
OfficeEval（NCRE Word/Excel/PPT，7,118 条原子判据）最佳 **agent 68.8% vs 最佳单轮模型 36.6%**（arXiv 2606.10956【外部·2026-06-09】）⇒ **代理化让办公能力翻倍，且增益全部来自 harness**（能执行、能回读、能重算公式）。

| 做 | 机制 | 依赖 |
|---|---|---|
| **联网两件 `web_search` / `web_fetch`**（同 A4） | 所有非代码能力的共同入口；今天 `src/tools/` grep `http\|fetch` 零命中，写代码时查不到文档 | ⚠️ **硬依赖 A7**：Seatbelt `(deny default)` 零 network 放行 = 全断网 ⇒ **先做出口 allowlist 再做工具**，否则装个连不出去的工具。这个先后关系是 gap 分析 A4/A7 并列时没点出的 |
| **文档产出 = 代码化 + 原子判据**（docx/xlsx/pptx/pdf 走 openpyxl/python-docx 类脚本 + 执行回读校验） | 复用 `ledger`/`evidence`/`verify` 三条现成链；判据形态就是 OfficeEval/OmegaUse 的形态 | 新工具 → 必过 §8 的「单一门装配点」 |
| **深调研 = 已有 read 档 fan-out + 独立 verifier** | Ptah 的 planner/researcher/writer + **独立 Verifier**、DeepVerifier 令 GAIA **+8~11%**【外部】；我们的 read 档 + sidechat 只读白名单已是同构骨架 | 依赖联网 + 3.5 证据闸（引用↔来源必须可回溯，否则检索只是幻党生成器） |
| **不做**：SQL/浏览器/CUA 三块 | 读数与可用性脱钩（Mind2Web 自报 97% vs 真实站点 ~30%【外部⚠ 厂商自测】；Spider 2.0 真实库 91→21、BEAVER 0–2%） | — |

⚠️ 长时程办公仍是硬骨头：OmegaUse-OfficeVal GLM-5.2 **17.91 vs 人类 27.79**【外部·2026-07-29】、GDP.pdf 顶级模型仅 ~30.7%【外部·2026-07】⇒ **别对外宣称办公能力，先当内部靶子用**。

---

## 7. G5 · 越用越强（这是与用户成本诉求同向的唯一一条大杠杆）

**先给反直觉的外部结论**：
- SkillsBench（87 任务 × 18 个模型-harness 配置）：精选技能通过率 **33.9% → 50.5%（+16.6pp）**；**≤3 模块的聚焦技能优于大而全的包**；**小模型 + 技能可追平大模型裸跑**【外部·2026-02-13】⇒ 与「成本第一」直接同向的杠杆。
- **但同一篇里：自生成技能普遍失败，部分任务被拖累 −39.3pp**；生态实测 190 万技能平均质量 **6.2/12**、**36% 含提示注入**、策展可 **+16.2 分**【外部·Agentman 2026-06-24】。
- 有效的闭环：SkillRevise（轨迹诊断 + 原则记忆 + 改写 + 回归）**36.05% → 61.63%**【外部·2026-06-02】；SkillEffect 的 checked lowering **拒绝全部 500 条对抗提案、接受 60 条合法提案**，验证正确率 100%【外部·2026-08-17】。

**⇒ 「自动沉淀」在公开证据里是负资产，除非配策展闸。而策展闸正是 DSH 架构的强项**（fail-closed + 冻结判卷 + 三态表 + 靶场）。
现状（本轮实测）：`plugins/skills.ts` 只有字符预算与重挂裁剪（`:52,134`），**无质量分、无注入扫描、无 A/B 回路**；素材端反而已经具备——`failureDigestFromEvents` 已把失败轨迹喂进沉淀指令。

**建议（一条闭环，四道闸）**：`会话尾沉淀 → 技能提案 → 〔质量分 ∧ 注入扫 ∧ 与既有技能去重〕 → 靶场 A/B（未过即拒） → 入库但默认关`。
未过闸的技能**一律不自动启用**（照 `plugins/trust.ts` 指纹信任门同构：先 pending，批准才激活）。
⚠️ 三处既有纪律必须同时守：① 新键进 `validateSettings` 白名单 + 反向断言（漏加即静默吞）；② 渐进披露的**截断要显式回显**（CC 的 1536 字符 / 1% 预算是**静默**截断，外部已列为缺陷）；③ 技能入库面必须进 `frozen-sha256` 之外的**新**判卷面，不许改冻结判卷凑数。
配套：`deleteMemory`（§2.3 判「不删」的那条）在这一批里补 UI —— **能写不能删的记忆/技能 = 负债**。

---

## 8. G6 · 两条结构前提（不做则每次加能力都在赌「没忘装门」）

1. **权限判定单点装配**。本轮继承事实：`runAgent` 给 loop 传 `mode:"auto"`（`agent-runner.ts:1127`）⇒ loop 层恒放行，真实门散在 5 处（`gatedTool` 包装 / `createGatedRemember` / `gatedMcpTool` / `orchestrator` 分级出卡 / `obs_recall` 自调 `evaluate`）。
   G2/G4/G5 **每一项都要新增运行时注入工具** ⇒ 漏装一处就是无声提权。判据建议：一道静态门——「任何 `installXTools`/运行时注入路径必须出现权限装配符号，否则红」（与 `assertion-health` 同族，可测、不碰渲染层）。
2. **`orchestrator.ts` 2,874 行**（本轮复验）承载八件事（spawn/race/pipeline/supervise/merge/审批/取消/路由 bandit 回灌/血缘），且是最常被改的文件；`app.js` 2,621、`agent-runner.ts` 2,018。文档两次自述「结构拆分留位」（`PROGRESS.md:982`【继承】）。
   与用户既有取向一致（**走减法、不引框架**）：**每次往里加新能力时顺手切一个纯函数模块出来**，不单独立项、不为美观立项。理由不是可读性，是 blast radius：G3.5 的证据闸、G5 的策展闸、§4.3 的步级路由都要动这个文件。
3. **`spawnRace` 对模型不可达**（【继承】`SpawnArgs` 无 race 字段、模型面 enum 只 read/write/pipeline/supervise）+ 多 agent 有确定税（≈15× token；OneFlow 给出「强单 agent + KV 前缀复用即追平」的反证【外部·2026-01-18】）⇒ **保持「修但不接线」的现状是正确的**，别为了「看起来强」把它接上。

---

## 9. 排序总表（一行一件事；证据强度决定顺序，不是想法大小）

| 序 | 项 | 对应能力面 | 落点 surface | 归属会话 / 排期 | 规模 | 证据强度 |
|---|---|---|---|---|---|---|
| 1 | **G0.1** `ipc-reachability` 门 | 全部的前置 | `scripts/` + 门清单 | **已派 `6a8c777c`**（即刻；本文作者不做） | S | 【实测】21/34 + ipc-check 零触渲染层 + 21 通道名在门/测试面 0 命中 |
| 2 | **G0.2** 21 条桥逐条删/补裁决 | 同上 | 文档（已交付） | **本文 §13 已交**；裁决归协调会话 | 已完 | 【实测】21 条 handler 全活（`main/index.ts:200-266`）|
| 3 | **G1** 靶场分叉回放 + 外部小任务集 + 真凭据常驻 | 长时程 / 成本（可证性） | `scripts/` `fixtures/` `src/agent/gym` | 主 writer，与 1 并行 | M | 【外部】arXiv 2608.08239 直伤我们的假设 |
| 4 | **G2.1** 缓存断点 + cache 计量喂经济闸 | 成本 | `src/providers/*` `events` | 主 writer（128k 会话收口后） | M | 【外部·强】−41~80% 成本；且激活已入库死参数 |
| 5 | **G2.3a** `$/成功任务` 一等指标（面板 + 门） | 成本 | 内核 + R1c UI | 主 writer / UI 部分入 R1c | S | 【外部·强】40× token 差是只报通过率的盲区 |
| 6 | **G3.5** verify-on-stop 证据闸 + 假完成率指标 | 长时程 | `loop.ts` `gates.ts` | 主 writer | M | 【外部·强】LHTB 79% 超时 + false finish |
| 7 | **G3.1** 语义化截断（失败留尾）+ ledger 回取接线 | 长时程 / 成本 | `tools/run_shell` `agent/ledger` | 主 writer（**与 solpi ①/P1 同案**） | S-M | 【外部·强】2608.26218 近乎翻倍；对手同错 |
| 8 | **G3.3** 双检查点回滚（含 bash 副作用语义洞） | 长时程 | 内核 + R1c UI | 主 writer；UI 入 R1c | L | 【外部·强】+25.6pp 受控对照 |
| 9 | **G5** 技能策展闭环（四闸）+ `deleteMemory` UI | 越用越强 | `agent/` + `scripts/` + R1c | 主 writer | L | 【外部·强】+16.6pp，但自生成 −39.3pp ⇒ 闸是前提 |
| 10 | **G4.1** 网络出口 allowlist（A7）→ **G4.2** 联网两件 → **G4.3** 文档/深调研 | 非代码 | `main/sandbox` `tools/` | 主 writer | M-L | 【外部·中】OfficeEval 代理化翻倍（同一机制） |
| 11 | **G2.3b** 步级路由升级 | 成本 | `routing/` `orchestrator.ts` | 主 writer | M | 【外部·中】Switchyard −74% 成本保 93% |
| 12 | **G3.6** sleep-time 预计算 | 长时程 / 成本 | `scheduler.ts` | 主 writer，**必须在 4 之后** | M | 【外部·中】−5× 算力 /+13~18%（实验室） |
| 13 | **G0.3** 补 §13 判「R1c 补」的 **15** 条桥（含 8 条硬断路） | 门 0 收口 | `src/renderer/` | **R1c**（R1b 之后）；裁决表已交 §13 | M | 【实测】逐条 handler/唯一路径已核 |
| 14 | **G6** 权限单点装配门 + 顺手切模块 | 全部 | `agent-runner` `orchestrator` | 贯穿，不单独立项 | 随改动 | 【实测】5 处判定 |
| — | ~~**G2.2 / A2** 128k 预算认模型~~ | — | 已入库 `d64084e` | 6a8c777c 收口 ⇒ **不列待办**；残余 sidechat 预算归它续做（§4.2） | — | 【实测】 |

**关键读法**：1–2 是「让后面每一项都能被用户碰到和被数据证明」；3 是尺子；4–9 是收益最确定的六件事；10 才开始碰非代码能力（且被 A7 卡着）；13 排最后不是因为它不重要，而是因为 R1b 正在定结构，提前补 UI 会被重做。

---

## 10. 不做清单（省下工程量，含理由）

| 项 | 理由 |
|---|---|
| 自研编辑格式 / 模仿 `apply_patch` | Codex 的补丁格式已长进 RL 分布，**换格式 = 换分布**，第三方 API 模型下是自伤。维持 search-replace + 行号化窗口 |
| 复刻 CC auto-mode 的 LLM 权限分类器 | 它依赖 ~1 万条真实轨迹 + 52 例过度执行语料【外部】。我们没有那个语料；四层规则 + 风险表 + critical 强制已是更强的一层（同 gap 分析 §4.2） |
| 像素级 CUA / 浏览器自动化模型 | 短时程已被官方吃掉（86.1%【外部⚠】），长时程是模型侧 RL 战场，harness-only 追不上 |
| 平权 swarm / 默认 Best-of-N | 新证据偏向单 agent（OneFlow 2601.12307、Cognition、+90.2% 但 15× token）⇒ `spawnRace` 保持显式开启、且**对模型不可达的现状不动** |
| 自建 embedding 索引 | 检索式 vs 索引式无定论（Is Grep All You Need? 的可提取结论是「排序高度依赖 harness」）；我们已有 tree-sitter + PageRank 地图 |
| LLM-as-judge 当主判据 | 前沿模型在偏差测试上失败 >50%【外部⚠ 二手】；我们的「验证器 + sha256 冻结 + 变异测试」方向已被外部证据反向确认 |
| 重写私有事件协议 | 已有 26 事件类型 + append-only 是资产。**只加一层出口映射**（OTel GenAI agent spans / ACP v2 / Agent Receipts 签名回执），继续私有化才是错（同 gap 分析 B5） |
| 更多审批卡 | §5 末「人监督四种策略」的数就是反证 |

---

## 11. 未证与可信度边界（按本仓纪律：未证 ≠ 通过）

- 本文**未跑任何门禁**（宿主正跑 2–3 个 vitest，Electron 类门按协调协议不串行起，避免 CDP 假红）。§2 的实测项是我自己跑的脚本（34/13/21、`PROVIDER_KINDS`、`ipc-check` 零触渲染层、`costUsd` 三处、`skills.ts` 无质量闸、`orchestrator.ts` 行数、`app.js` 0 次 "provider"、`index.html` 2 个 input）。
- **§1/§3–§7 的全部外部数字未经我方复现**，其中厂商/provider 自报项（OSWorld-Verified 86.1%、Qwen-CUA 87.6、Mind2Web 97%、Claude Opus 81.42%、Agents-A1-4B GAIA 95.1%）一律按 ⚠ 处理；「scaffold 移 22 分 / 摆动 36 分」**判为不可引用**（一手来源未取到）。
- Terminal-Bench 具体版本与任务数两份镜像不一致（330 vs 66），本文只引「同模型不同配置 43.33%↔57.88%」这一相对差，不引绝对分作能力断言。
- 「我们的压缩/prune 领先」目前是**结构断言不是效果断言**——它等价于 arXiv 2608.26218 的机制，但我们**没有**那张表里的数字，因为门 0 + G1 未完成。这句话在对外文案里必须先补齐再写。
- §5 3.3「补齐 rewind 成本低于对手」是**推断**（依据：fork 原语 + worktree + append-only 日志三件已在），未做可行性 spike。
- 台账 T2（失败事件类缺失，26 个事件类型无 error 类）【继承】未复验，但它会让 §3.5 的证据闸和 §2 的审批卡同时缺一条可见面——**建议 R1c 之前先闭 T2**，否则「未验证」状态在 UI 上无处显示。

---

## 12. 来源（择要；完整清单见子代理报告，按一手/二手/传闻分组）

**harness 归因与量级**：[Same Model, Different Harness 2608.26218](https://arxiv.org/html/2608.26218) · [Harness Choice as a Hidden Variable 2607.22585](https://arxiv.org/html/2607.22585v1) · [LangChain: harness engineering](https://www.langchain.com/blog/improving-deep-agents-with-harness-engineering) · [NLAH 2603.25723](https://arxiv.org/html/2603.25723v1) · [DeepSWE 2607.07946](https://arxiv.org/html/2607.07946v1) · [Anatomy of coding agents 2609.00006](https://arxiv.org/abs/2609.00006) · [mini-swe-agent](https://github.com/swe-agent/mini-swe-agent) · [SWE-agent ACI](https://arxiv.org/abs/2405.15793) · [OpenHands Index](https://index.openhands.dev/) · [Pi minimal agent](https://mariozechner.at/posts/2025-11-30-pi-coding-agent/)
**对手机制与缺陷**：[Anthropic auto mode](https://www.anthropic.com/engineering/claude-code-auto-mode) · [Apr-23 postmortem](https://www.anthropic.com/engineering/april-23-postmortem) · [prompt caching is everything](https://claude.com/blog/lessons-from-building-claude-code-prompt-caching-is-everything) · [CC checkpointing](https://code.claude.com/docs/en/checkpointing) · [advanced tool use / Tool Search](https://www.anthropic.com/engineering/advanced-tool-use) · [Agent Skills](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview) · [Codex Prompting Guide](https://developers.openai.com/cookbook/examples/gpt-5/codex_prompting_guide) · [Codex subagents/skills docs](https://learn.chatgpt.com/docs/build-skills) · codex[#24366](https://github.com/openai/codex/issues/24366)/[#10390](https://github.com/openai/codex/issues/10390)/[#23296](https://github.com/openai/codex/issues/23296) · claude-code[#35296](https://github.com/anthropics/claude-code/issues/35296) · [wmedia 截断陷阱](https://wmedia.es/en/tips/claude-code-truncated-output-tests)
**成本与路由**：[缓存长任务评测 2601.06007](https://arxiv.org/html/2601.06007v2) · [DigitalOcean 命中率 7%→74%](https://www.digitalocean.com/community/conceptual-articles/prompt-caching-in-practice-hit-rate) · [Switchyard 路由实测](https://www.langchain.com/blog/switchyard-agent-routing-benchmark) · [code execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp) · [MCP schema bloat](https://layered.dev/mcp-tool-schema-bloat-the-hidden-token-tax-and-how-to-fix-it/)
**长时程与验证**：[AgentRewind 2608.14380](https://arxiv.org/html/2608.14380v1) · [Long-Horizon Terminal-Bench](https://www.alphaxiv.org/abs/2607.08964) · [DeepVerifier 2601.15808](https://arxiv.org/html/2601.15808v2) · [sleep-time compute 2504.13171](https://arxiv.org/html/2504.13171v1) · [多 agent 模式与问题](https://www.anthropic.com/research/multiagent-systems) · [Replay Gap 2608.08239](https://arxiv.org/html/2608.08239v1)
**非代码能力面**：[OfficeEval 2606.10956](https://arxiv.org/html/2606.10956v1) · [OSWorld 2.0 2606.29537](https://arxiv.org/html/2606.29537v1) · [OSWorld-Verified 方法论](https://benchlm.ai/blog/posts/osworld-verified-computer-use-benchmark) · [CAP 跨站 2608.08392](https://arxiv.org/html/2608.08392v1) · [OmegaUse-OfficeVal](https://arxiv.org/html/2607.27155v1) · [Ptah 2605.29861](https://arxiv.org/html/2605.29861v2) · [GDP.pdf 2607.11192](https://arxiv.org/abs/2607.11192) · [Text-to-SQL 榜单失效 2601.08778](https://arxiv.org/html/2601.08778v3)
**自我改进**：[SkillsBench 2602.12670](https://arxiv.org/abs/2602.12670) · [SkillRevise 2606.01139](https://arxiv.org/html/2606.01139v2) · [SkillEffect 2608.17007](https://arxiv.org/html/2608.17007) · [Agent Workflow Memory 2409.07429](https://arxiv.org/abs/2409.07429) · [GEPA 2507.19457](https://arxiv.org/abs/2507.19457) · [技能生态质量报告](https://agentman.ai/blog/agent-skills-ecosystem-report-2026) · [Self-Verification Dilemma 2602.03485](https://arxiv.org/html/2602.03485v1)
**安全与监督**：[人监督四策略 2604.04918](https://arxiv.org/html/2604.04918v1) · [编码 agent 注入 84% 2509.22040](https://arxiv.org/html/2509.22040v2) · [AgentDyn 2602.03117](https://arxiv.org/html/2602.03117v1) · [how we contain Claude](https://www.anthropic.com/engineering/how-we-contain-claude) · [沙箱逃逸](https://novee.security/blog/breaking-ai-agent-sandboxes/) · [Agent Receipts 规范](https://agentreceipts.ai/specification/overview/) · [OpenAI 不再评 SWE-bench Verified](https://openai.com/index/why-we-no-longer-evaluate-swe-bench-verified/)

---

## 13. 附 · 21 条孤儿桥逐条裁决（R1b / R1c 的输入；只读产物，非施工面）

**方法**：桥名 ↔ 通道名取自 `src/preload/index.ts`（逐条读出）；handler 存在性与行号取自 `src/main/index.ts:200-266`；「唯一路径」列判据 = 该能力是否有 **模型侧工具** 或 **其他桥** 可达（实测 `automation_*` 五件在 `agent-runner.ts:641,761-777` 覆盖 create/update/delete/run_now/list；`deleteMemory` 的注释直书「模型无删除权 §8.1.7」）。全部 `【实测】`，本轮复跑。

**⚠️ 三条前置纪律**
1. **「孤儿」≠「死码」**：21 条 handler 全活且委托真子系统，所以协调会话「sidechat×4 / schedule×4 若真零调用则随减法删」这一支**在证据上不成立**——它们只是渲染层没人调。判「删」只能靠「产品口径不做」或「后端本身是留位」这两类独立理由。
2. **删桥 = 三段同删**：`preload/index.ts` + `main/index.ts` 的 `ipcMain.handle` + `ipc-protocol.ts` 的 `AgentApi` 类型；漏一处即 `typecheck`/`ipc:check` 红。这与 R1b §6.3「重命名连带面同提交内改完」是同一类断裂，务必一笔收。
3. **删除顺序**：G0.1 门先落地并跑出「21 红 → 逐条豁免或修复」的基线，再动任何一条桥。反向：先删后建门 = 门永远绿，也就永远抓不到下一次。

| # | 桥 | IPC 通道 | handler | 唯一路径？ | 判定 / 批次 | 删掉会空掉什么（影响面） | 严重度 |
|---|---|---|---|---|---|---|---|
| 1 | `providerKeySet` | `agent:provider-key-set` | `:259` | **是**（打包后无 env 通道） | **R1c 必补** | BYOK 录入唯一入口 ⇒ 用户永远拿不到真模型（缺省 `demo`）；连带 commercial-check 的 key 流程在产品上归零 | **P0** |
| 2 | `providerKeyStatus` | `agent:provider-key-status` | `:261` | 是 | R1c 必补 | 无法显示「哪家已配 key」，安全存/取态不可见（safeStorage 拒存不可用无提示） | P0 |
| 3 | `providerKeyDelete` | `agent:provider-key-delete` | `:260` | 是 | R1c 必补 | key 不可撤销（换号/离职场景）＝凭据残留 | P0 |
| 4 | `submitClarify` | `agent:clarify` | `:200` | **是** | **R1c 必补** | 三门之一的澄清门**只能挂 60s 超时默认拒绝** ⇒ 模型问得出、收不回，`clarify` 工具在产品内实质失效 | **P0** |
| 5 | `cardAction` | `agent:card-action` | `:251` | **是** | **R1c 必补** | worker 审批应答 + agent 取消 + **合并控制塔唯一出口**（agent 无合并权是刻意设计）⇒ M3 write/pipeline/supervise 三档交互全不可用 | **P0** |
| 6 | `pluginDecide` | `plugin:decide` | `:228` | 是（手改持久化文件是 workaround） | R1c 必补 | 信任门未批即 hooks/MCP/LSP 一律不激活 ⇒ **所有项目级插件静默永久 pending** | P0 |
| 7 | `runCancel` | `agent:run-cancel` | `:207` | 是 | R1c 必补 | 运行中无停止键（**同台账 T1**，本文按门 0 口径升级）；信号链 `loop.ts` 轮界/门等待透传已就绪 | P0 |
| 8 | `deleteMemory` | `agent:memory-delete` | `:225` | **是**（模型无删除权） | R1c 必补（与 §7 策展闸同批） | 记忆只增不可删 ⇒ **§7 越用越强变成负债**（错记忆/注入内容无法清） | P1 |
| 9 | `sidechatCreate` | `agent:sidechat-create` | `:236` | 是（无模型侧对偶工具） | R1c 补（整组一起做） | M2f 旁路问答不可达；`sidechat-check` 仍绿 ⇒ 典型「门绿 / 面死」 | P1 |
| 10 | `sidechatAsk` | `agent:sidechat-ask` | `:237` | 是 | R1c 补（同组） | 同上；只读白名单三重 fail-closed 的旁路能力无处使用 | P1 |
| 11 | `sidechatPromote` | `agent:sidechat-promote` | `:244` | 是 | R1c 补（同组） | `/promote` 回主链的入口（以 `user_message.origin` 标记）⇒ 旁路结论永远回不到主线 | P1 |
| 12 | `sidechatState` | `agent:sidechat-state` | `:249` | 否（可并入投影） | **合并**：进 sidechat 面板的事件投影，不新开桥 | 与 R1b「单一落点」同向；合并后本桥消失 | P2 |
| 13 | `compact` | `agent:compact` | `:204` | 否（阈值自动压缩仍在） | R1c 补（低优先） | 用户主动压缩/「现在压一次」的出口；成本面板上「为什么还没压」不可解释（与 §4.1 `compaction_deferred` 留账配套） | P2 |
| 14 | `getProviderInfo` | `agent:provider-info` | `:218` | 否（`getSettings` 可读到 provider/model 两项） | **合并**：并入 `StateResponse` 或直接用 `getSettings`，删本桥 | 仅显示；`p3` 注释已自述此前「设置页永远显示 mock」的成因 | P2 |
| 15 | `renameSession` | `agent:sessions-rename` | `:222` | 否，但替代代价高（create+delete 会丢历史日志） | R1c 补（低优先） | 会话改名（会话列表已有 create/open/delete 三条在用桥，UI 位置现成） | P2 |
| 16 | `scheduleSnapshot` | `agent:schedule-snapshot` | `:253` | 半（模型侧 `automation_list` 可读） | R1c 补（面板第一批） | M4a 定时任务面板无数据源；无人值守任务用户看不见 | P1 |
| 17 | `scheduleRunNow` | `agent:schedule-run-now` | `:256` | 半（`automation_run_now` 需模型在会话内） | R1c 补（面板第一批） | 「立刻跑一次」是长时程/无人值守唯一的用户侧调试回路 | P1 |
| 18 | `scheduleUpsert` | `agent:schedule-upsert` | `:254` | **否**（`automation_create/update` 五件覆盖） | **留位**：等 T25 WORKSPACES 真化后随表单一起做 | 表单类；`form ?? true` 分支（用户手建 vs 模型建）是产品口径未定项 ⇒ 现在补 UI 会逼出一个未裁决的口径 | P3 |
| 19 | `scheduleDelete` | `agent:schedule-delete` | `:255` | 否（`automation_delete`） | 随 18 同批 | 同上 | P3 |
| 20 | `checkUpdate` | `agent:update-check` | `:264` | 是，但**后端本身是留位** | **建议删**（R1b §8 出清单即可） | updater「只检查不下载」是已备案边界 ⇒ 检查出结果也没有消费端，接上即假 UI。签名公证到位那轮一起补 | P3 |
| 21 | `openExternal` | `agent:update-open` | `:265` | 是 | **改名解耦后保留**：通道名 `update-open` 说明它当初只服务更新流 | 现在删 = 聊天里任何链接都点不开（`setWindowOpenHandler` 全 deny）。**且 §6 的深调研引用必须靠它**（引用↔来源可点击回溯），改名成通用出口并保 `isSafeExternalUrl` 白名单 | P2 |

**汇总（21 = 13+2+2+3+1）**：R1c 补 **13** —— 其中 **8 条是硬断路**（1–8：真模型三件套 + 澄清门 + 审批/合并出口 + 信任门 + 停止键）· 低优先补 **2**（13、15）· 合并后消失 **2**（12、14）· 留位 **3**（18–20）· 改名解耦 **1**（21）。
**净删除只有 1 条（`checkUpdate`）——** 这与我写 §2 时的直觉相反：**门 0 不是减法能解决的，减法在这里最多省一条桥。** 换言之「走减法」这条既定取向在渲染层 DOM 面上成立（台账 P2 那 13 条真省），但在 IPC 可达性面上不成立，别拿它当门 0 的解法。
⚠️ 一个附带结论给 316c75f9：R1b 的 22 条钩子白名单**不包含任何 preload 桥**（它管的是 DOM 钩子）。若 R1b 期间要顺手删桥，白名单不会保护 IPC 面，得靠 G0.1。

