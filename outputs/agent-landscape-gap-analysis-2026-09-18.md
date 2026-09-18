# 与外部 agent 生态的能力对比：差距与优势（2026-09-18 调研轮）

**用途**：回答「现在的 agent 项目在做什么、我们缺什么、我们强什么」，并给出可执行的优先级。
**方法**：三路证据交叉——① 联网调研主流编程 agent 产品能力清单（15+ 产品，带来源）；
② 联网调研 2025H2→2026 前沿方向（8 个主题，区分【共识】/【争议】/【未证实】）；
③ 本项目代码实读盘点（97 文件 25,843 行 src；测试以实测 **85 文件 / 814 用例** 为准 + 29 道门禁）。
本报告里所有「我们这边」的断言都带 `路径:行号`；**可信度分级见 §8**（实测 / 继承未复验 / 外部未复现三档）。

**修订记录**：
- 21:29 初版（A2 判为「未修的负资产」、A5 判为「provider 零重试」）。
- 21:45 依 A2 修复的独立验证结果改判 A2 为「主会话已修 + worker 面残留」，补 §8 实测行与 §6 更省修法。
- **23:25 入库前全量重测**（同期 `d64084e`..`f0bf5a5` 落了 8 个提交）：**A5 结论被推翻**（`887ffb6` 已建出网重试层，
  现判「重试已落 / 限流器仍缺」）；A2 由在飞转**已收口 `d64084e`**；变异表 **72→79 条 / 16→22 源文件**；
  缺省开关 **7→8 个**（新增 `autoVerify` 收束闸）；`settings.ts` / `orchestrator.ts` / `app.js` / `openai.ts` 等
  十余处行号按新树校正。**门数仍 29、provider 白名单仍 `demo|glm`、`cache_control` 仍零。**
- **下游若按本报告派单，请只读 23:25 版**：初版第 1 优先项把 A1+A2 捆在一起，现 A2 已收口、只剩 A1，
  且 A1 的前置（cache 断点须按 `budgetConfig()` 移动后的真实裁剪落点定稳定前缀）已明确。

**结论一句话**：我们的**引擎面（上下文/权限/编排/评测纪律）已追平或超过主流**，
缺的是**外围基础设施与对外接口**（缓存、快照、联网、外部 benchmark、协议对齐）；
而最深的一条护城河——**判卷完整性工程**——在行业里没找到同构实现，但它目前**还没发货**。

---

## 0. 事实前提：出厂默认是「演示壳」，不是产品

这一条决定后面所有对比的读法，所以放在最前。

| 项 | 缺省值 | 证据 |
|---|---|---|
| 主对话 provider | `"demo"`（冻结 mock 剧本），且 `PROVIDER_KINDS` 只允许 `demo\|glm` | `src/main/settings.ts:88`、`:103` |
| 工作区 | `null` → 回落 `M0B_WORKSPACE` / `fixtures/todo-app` | `src/main/settings.ts:56,90` |
| **八**个差异化模块 | `routingBandit` / `actionFusion` / `requestMetering` / `observationPack` / `evidenceReceipts` / `economicCompaction` / `impactAnalysis` / **`autoVerify`（能力 5 收束闸，`d60dbcc` 新增）** **全 false** | `src/main/settings.ts:87,91-97` |
| 成本闸 | `maxBudgetUsd: 0` = 无效 | `src/main/settings.ts:81` |
| 遥测 | false，且 V1 无上报实现 | `src/main/settings.ts:47-48` |

⇒ **八模块「有真实调用者、非死码」，但生产默认零行为。** 这是「无真模型证据就不宣称收益」的纪律，
值得保持；但它意味着下文「优势」列的东西，**用户今天一个都拿不到**。

---

## 1. A 档差距：行业已是必备，我们是硬缺失

| # | 缺口 | 行业现状（带来源） | 我们的实测状态 |
|---|---|---|---|
| A1 | **Prompt caching / 缓存边界工程** | 跨三家 provider 的长时程缓存评测：成本 −41~80%、TTFT −13~31%；结论是「**战略性缓存边界控制**优于整段缓存」（[arXiv 2601.06007](https://arxiv.org/html/2601.06007v2)）；Anthropic 已把 cache miss 当生产事故（[Implicator](https://www.implicator.ai/anthropic-says-cache-misses-are-production-incidents-reveals-caching-shaped-claude-code/)） | **零** `cache_control`（全仓 grep 仅 `solpi-runtime.ts` 1 处注释）。openai 只**读** `cached_tokens` 记账（`src/providers/openai.ts:56,127`），不**写**断点 |
| A2 | ~~上下文预算不认模型~~ → **已收口（`d64084e`，21:39）**<br>**worker 面残留未修，见下方 ⚠️** | — | **原缺陷**：`ctxWindow` 在 `src/providers/registry.ts:19` 声明、12 个模型逐个填值（gemini 1_000_000 / anthropic 200_000 / glm 128_000），却**除 registry 自身外零消费者**；主会话无论路由到哪个模型都吃硬编码 `inputLimit: 128_000`（`src/agent/compaction.ts:31`），超预算在 `src/agent/glm-session.ts:554-556` 抛 `context_budget_exceeded` 拒发。<br>**修法（已入库 `d64084e`，6 文件簇）**：新增纯函数 `withModelBudget`（`compaction.ts:47`）+ 双态解析 `findSpecByNameOrId`（`registry.ts:61`，档位 id 与 provider 模型名都认、同名取**最小**窗口）+ `budgetConfig()`（`glm-session.ts:407-411`）；**触发判定 / 硬闸 / 压缩器裁剪目标三处共用同一个 `budgetConfig()`**（`:414`、`:519`、`:551`）——否则 200k 档上「触发按 200k、裁剪仍按 128k」会白丢一段冷细节。<br>钳制语义**分两层，别混**：**第一层** `withModelBudget` 的语义是「窗口可得就**一律取窗口**」——实现是 `{ ...config, inputLimit: ctxWindow }`（**替换，不是取小**），所以它在 200k 档上是**上调**（128k→200k）、在小窗模型上是下调；其唯一保守分支是「窗口不可得 / 非有限 / ≤ 输出预留 ⇒ 原样返回」。**第二层**才是放大保护：`glm-session.ts:410` 的 `Math.min(merged.inputLimit, window)` 专挡「调用方显式 config 越窗」（`:409` 的 `{...base, ...explicit}` 会让显式 900k 覆盖掉第一层的结果，故必须再钳一次）。⇒ **调用方显式 config 只能往下调，绝不许越过模型真实窗口**（超窗交给远端 400 不如本地 fail-closed）。<br>⚠️ **残留（本轮实测，报告初稿没有）**：修复只覆盖**主会话**。worker 走 `createWorkerProvider`（`orchestrator.ts:2852`），其入参是 `model?: WorkerModel`（`:2855`）= **一个闭包函数而非模型名**——`toWorkerModel`（`registry.ts:94-111`）在把 spec 变成流函数时**丢掉了 `ctxWindow`**，故 worker 压缩配置仍是 `DEFAULT_COMPACTION_CONFIG + {ratio:0.95}`（`orchestrator.ts:1901`）= **一律 128k**，且**没有本地硬闸**。⇒ 路由到 gemini-2.5-pro(1M)/o3(200k)/claude-opus(200k)/glm-5.2-pro(256k) 的 worker 依旧提前 ~100k 压缩，超窗直接吃远端 400。sidechat 的 `inputLimit: 32_000`（`sidechat.ts:49-51`）是**有意的保守策略**（辅助短问答早触发），32k < 任何模型窗口，**不算缺陷** |
| A3 | **快照 / rewind** | CC `/rewind` 同时快照文件与对话（[docs](https://code.claude.com/docs/en/checkpointing)）、Gemini git checkpointing、Cline/Roo/Cursor 皆有 | 会话是 append-only JSONL（可重放），但**无 per-turn 文件快照** ⇒「对话回到某点」与「工作树回到同一状态」无法对齐。worktree 只服务 worker 隔离，不服务用户回退 |
| A4 | **网络工具（web search / fetch）** | Copilot/Gemini grounding、Devin、Cursor 内置 | `src/tools/` grep `websearch\|fetch\|http` **零命中**（`src/net.ts` 只是分片停滞看门狗）。模型可见工具仅 12 个。**写代码时查不到文档**，只能靠外挂 MCP |
| A5 | ~~provider 重试 / 429~~ → **重试已落（`887ffb6`）**，**限流器仍缺** | 必备运维面 | **21:29 初判已过期**：当时 HTTP 层零重试、真实负载下首个 429 即整轮红。**现状**：`src/providers/retry.ts`（99 行）三家 provider 共用一条建连链——`retryableStatus` 认 408/409/425/429/5xx（`:8-9`）、`retryAfterMs` 支持秒数与 HTTP-date 两形态并被 `capMs` 钳住（`:12-13`）、`backoffMs` 指数退避 + **full jitter**（AWS 口径，防同批 worker 齐步重试二次打满限流窗，`:24-26`）、缺省 `attempts=3`（`:65`），且**只重试「响应体尚未被消费」的失败**（`:57`、`guard.stalled()` 即放弃 `:79`）。<br>**残余缺口**：**无限流器 / 无并发闸**（`grep rateLimit\|p-limit\|semaphore src/providers/` 零命中）⇒ 只有被动退避、没有主动限速；`maxConsecutiveFailures=2` 的摘要器停用另在 `compaction.ts:39` |
| A6 | **后台长任务进程控制** | CC BashOutput/KillShell、Codex 后台任务 | `run_shell` 32KB / 60s 硬顶（`src/tools/run_shell.ts:5-6`），超限后 `return` 直接丢弃尾字节（`:21-27`）⇒ 跑不了 build / dev-server / 大测试套件 |
| A7 | **网络出口策略（allowlist）** | CC 域名 allowlist 或代理审批；Codex 三档；Gemini profile 化 | Seatbelt `deny default` + **无任何 network 放行 = 默认全断网**（`src/main/sandbox.ts:36-49`）。安全上是最强 fail-closed，代价是 `pnpm install` 类真实工作直接死（AGENTS.md 已自述沙箱内 `pnpm test` 跑不了）。缺的是**「默认断网 + 显式域名放行」**这一层，不是放开 |
| A8 | **路径级权限规则** | 文件/目录粒度批准是常见能力 | `PermissionRule` 只有 `tool` + `pattern`（命令段前缀）+ `scope:"always"`（`src/permissions/rules.ts:11-19`），**无路径匹配字段**。粒度停在工具级/命令级 |
| A9 | **结构化输出 / tool_choice** | 主流支持 | `response_format`/`json_schema`/`tool_choice`/温度 全无（provider 层 grep 仅 `anthropic.ts:100` max_tokens）⇒ 审批卡与 plan 解析依赖散文抽取，是稳定性税 |

## 2. B 档差距：前沿正在收敛，我们已有半截（补齐成本最低）

**B1 · 语义合并闸（最高性价比）。**
多 agent 最大的未解项不是行冲突而是**写时语义冲突**，写时状态检查实证 +18.7（[STORM arXiv 2605.20563](https://arxiv.org/html/2605.20563v1)）；
worktree 隔离只解决物理层。我们**已经有** `impact_report` 的跨文件波及集（`src/agent/impact/index.ts:208,215,256`）
和租约冲突检测（`src/agent/orchestrator.ts:1180`），但 impact 目前只是**回注给模型看的提示**。
把它升级成准入判据（两 worker 波及集相交即串行化/仲裁）= 同一份数据二次变现。

**B2 · 反事实靶场的根基被动摇（最危险的自我认知风险）。**
`fixtures/gym` 是 `fork@event` 静态回放（`src/agent/gym/runner.ts:2-4`）+ **3 个本地冻结 mini-case**
（`fixtures/gym/index.json`：`todo-completed-count` / `sum-clamp` / `config-default`）。
而 2026 实证显示：**同一 prefix 换模型后动作分歧 61–94%、对成功的预测准确率为 0**
（[The Replay Gap, arXiv 2608.08239](https://arxiv.org/html/2608.08239v1)）。
我们的 M5a gym 与 M6 bandit **共享同一个未验证假设**（回放轨迹可用于估值收益）。
不修，「路由省了钱」的全部结论在方法上是自证。
顺带：本仓库 `docs/solpi-port-proposal.md` §P3 已自述「明卷 token 是冻结剧本字节的纯函数，量不到投影侧节省」——**两条证据互指同一处缺陷**。

**B3 · 外部 benchmark 零接入。**
grep `swe-bench|terminal-bench` 全仓 0 命中。注意方向：**别追 SWE-bench Verified**——已被官方判为不再区分前沿
（[OpenAI](https://openai.com/index/why-we-no-longer-evaluate-swe-bench-verified/)）。
但要有一个非自有任务集，否则对外无可信度、对内易过拟合到 `todo-app`。

**B4 · MCP 规范迁移 + registry。**
MCP 2026-07-28 转「无状态核心」、强制 OAuth 2.1/OIDC，Roots/Sampling/Logging 定于 2027-07 废弃
（[迁移说明](https://aaif.io/blog/mcp-2026-07-28-whats-changing-and-how-to-migrate)）。
我们是 client-only、三种 transport 齐（`src/agent/plugins/mcp.ts:4-7`），但**无 registry、无分级信任市场、自动重连留位**（`mcp.ts:147`）。

**B5 · 协议对齐（别自研）。**
ACP v2 draft（Zed/Neovim/Goose 已接）、AG-UI 事件流（已被 Microsoft Agent Framework 集成）、
OTel GenAI agent spans（stable 面仍有限）。我们有 27 个私有事件类型 + 私有观测账本（`src/agent/ledger.ts`）——
**方向应是加一层 OTel/ACP 出口映射**，不是重写，也不是继续私有化。

**B6 · 交付面只有 macOS。**
Seatbelt 无 Linux（Landlock+seccomp）/ Windows 对应。发 dmg 够用，但是明确的增长上限。

## 3. C 档：判为低优先 / 伪需求（省下工程量）

| 项 | 不做的论据 |
|---|---|
| 平权 swarm | 新证据普遍偏向单 agent：多跳任务单 agent 胜 MAS（[arXiv 2604.02460](https://arxiv.org/html/2604.02460v1)）、「强单 agent + 好工具即可」（[arXiv 2601.12307](https://arxiv.org/html/2601.12307v1)）、[Cognition: Don't Build Multi-Agents](https://cognition.com/blog/dont-build-multi-agents) |
| 默认 Best-of-N 竞跑 | orchestrator-worker 的 token ≈ chat 的 **15×**（[Anthropic](https://www.anthropic.com/engineering/multi-agent-research-system)）；收益-成本比无稳定结论。我们的 `spawnRace` 保持显式开启即可（`MAX_CONCURRENT_WORKERS=4`，`orchestrator.ts:82`） |
| 自建 embedding 索引 | 检索式 vs 索引式**无定论**：[Is Grep All You Need?](https://arxiv.org/pdf/2605.15184) 的可提取结论是「排序高度依赖 harness」，一手经验则称 grep 胜 embedding（[Augment](https://jxnl.co/writing/2025-09-11/why-grep-beat-embeddings-in-our-swe-bench-agent-lessons-from-augment/)）。我们零 embedding 且已有 tree-sitter + PageRank 地图（`src/agent/map/`），**维持现状，别补** |
| LLM-as-judge 当主判据 | judge 在偏差测试上前沿模型失败 >50%（[Adaline](https://www.adaline.ai/blog/llm-as-a-judge-reliability-bias)）、因果回放论文里 judge 基线命中仅 ~14%。我们的判卷是「验证器 + sha256 冻结 + 变异测试」，**方向正确，别改** |
| computer use / 浏览器操控 | 读数不可信：OSWorld 人类基线 72.36% vs 学术 agent 12.24% vs 2026 厂商自榜 85.6%（[Zylos](https://zylos.ai/research/2026-02-08-computer-use-gui-agents/)）。renderer 的 browser 面板保持诚实空态（`src/renderer/app.js:779`）即可 |
| 云端容器 / microVM | 重资产，且桌面 agent 的护城河恰在「本地状态 + 审批 UX」。但值得借 OpenHands 的**统一 Workspace 抽象**（local/Docker/remote 同接口，[arXiv 2511.03690](https://arxiv.org/html/2511.03690v2)）作为接口设计参考，留将来 |

---

## 4. 我们的优势（按行业稀有度排序）

### 4.1 判卷完整性工程 —— 行业未找到同构实现（最深护城河）

- **29 道门禁**（`scripts/gate-manifest.ts:12-44`），且**门数不写进文档**，由清单自身作事实源 + 漂移护栏四违例类（孤儿验收脚本 / 无脚本的门 / 陈旧豁免 / 无由豁免，`:73-108`）
- **79 条变异测试表**（`scripts/mutate-verify.mjs:26` 起，22 个源文件；初版记 72/16，`abf6991` +4 与 `f0bf5a5` +3 后为 79/22）：每条 = 一处语义突变 + 必须被杀死的**具体用例标题**；跑前备份、finally 还原、退出前强制 `git diff HEAD --quiet`，还原失败即判红
- **AST 级断言体检**：空断言 / 恒真式 / 析取式弱断言 / 暗卷零断言，豁免必须带行内理由注释（`scripts/assertion-health.ts:5-22`）
- **sha256 冻结判卷文件**（`scripts/frozen-sha256.json`、`src/frozen.ts`）+ 判据缺陷走 `BLOCKED.md` 要求换判据、不许改代码绕
- **fail-visible 沙箱三门**：自动选分支并显式打印走了哪支，不真空通过；还有反向验证通道（`--force-available` / `--bogus-root`）证明 A 相会红

行业普遍有测试，**几乎没人有「防止自己作弊」的机制**。在 agent 时代这是最稀缺的东西：可信的自评。

### 4.2 权限模型比主流细一层

四层固定序、先命中先短路（`src/permissions/autonomy.ts:1-8`）：
L0 硬边界（**被摘除的工具规则库不能复活**）→ L1 deny → **L2 ask 规则（任何档位含自主档都绕不过）**
→ L3 档位/session → L4 风险三通道（**allow 规则也批不掉 critical**）。
断路器 `MAX_AUTO_APPROVALS=50` / `CRITICAL_DENIAL_LIMIT=3`（`:44-47`）；命令链逐段拆分判定（`judgeChain`）。
CC/Codex/Gemini 披露的是「三档模式 + 规则」，未见「ask 层不可被 auto 绕过」的显式分层证明。

### 4.3 模型路由端到端内置（行业多为第三方外挂）

Thompson Sampling + 显式 mulberry32 随机态、**禁用 `Math.random`**（`src/routing/bandit.ts:1-8,16-32`）、
verify 全绿作 reward、用量折进 beta、冷启动 α=β=2、真实价格折算、cascade 无客观判据即 fail-closed 不升级。
学习走侧信道：回灌/持久化失败只 `console.warn`，绝不阻断 worker 终态流。
行业主流是 claude-code-router 这类外挂（[GitHub](https://github.com/musistudio/claude-code-router)），内置在线学习的极少。
⚠️ **诚实附注**：bandit 路由在**离线回放**上估值，撞上 §B2 的 replay gap；且 bandit 路由三大坑（奖励稀疏延迟、非平稳=换模型即臂定义漂移、离线回放高估收益）公开层面**无解法**【未证实】。

### 4.4 插件信任 = 内容指纹绑定（对照 MCP 生态现状是被低估的卖点）

三级作用域（user/project/loose），项目级首载出信任卡，未信任则 hooks/MCP/LSP **一律不激活**，
决议 `abs@fp` 持久化，指纹超帽 / 含软链 → `bounded` → fail-closed 回 pending（`src/agent/plugins/trust.ts:1-4`）；
MCP 工具命名走同一权限门无特权（`src/agent/plugins/mcp.ts:1-3`）；secrets 入 safeStorage，不可用即拒存。
对照行业：仅 **8.5%** MCP server 用 OAuth、15.4% registry 条目无源码，tool poisoning / rug pull 活跃
（[State of MCP Security 2026](https://nimblebrain.ai/blog/state-of-mcp-security-2026/)）。

### 4.5 injection 防御是一整套，不是一句口号

控制标签仿冒转义 + 立场声明 + 密钥脱敏（`src/agent/memory/inject.ts:27-34`、`security/scan.ts`）、
worker 输出扫描（`orchestrator.ts:367`）、被审 diff 视为数据 + findings 严格 schema + FP 二次过滤（`security/llm-review.ts:1-11`）、
`user_message.origin` 来源标记（`src/events/index.ts:15`）、sidechat 只读白名单三重 fail-closed、
路径包含 + `.agent` 区保护（`src/tools/base.ts:67,111`）、Shannon 熵密钥扫描。
背景：编码 agent 的现实攻击面是**仓库内嵌规则**，注入成功率达 **84%**，而「限制终端」类防御失败
（[arXiv 2509.22040](https://arxiv.org/html/2509.22040v2)）；架构级防御（CaMeL / dual-LLM）产业十个月**仍未落地**。
⇒ 我们的「deny 默认 + 全断网 + 分层审批」是目前唯一被验证可行的那一类。

### 4.6 「减少返工」是一个成体系的簇

`verify` 反射循环（上限 3，`src/agent/loop.ts:69,126-136`）+ action fusion（写后同轮跑项目 lint，带快照防陈旧与 `O_NOFOLLOW`，`src/agent/action-fusion.ts:11-25`）
+ impact report 跨文件波及（已把 200 调用点压到 6 文件×4 符号，**最坏 2112→168 token，−92%**）
+ evidence receipts（逐字可回溯、不外呼 reducer）+ observation ledger（内容寻址 + `AuthorizedRedactedText` 品牌类型明示「这是信任断言不是脱敏器」）。
行业主流还在堆 worker；这个组合直指「少犯错/少返工」，与 Auggie 的 harness 重建降本（−53%）属同一思潮，但我们做的是**跨文件波及面**这一维，没人做。

### 4.7 无人值守 fail-closed 早于主流

非交互 ask→deny（`src/permissions/index.ts:131-135`）+ 三闸 + 双轨存储 + tick；
对照 Copilot cloud agent schedule 2026-06 才出现（[GitHub changelog](https://github.blog/changelog/2026-06-02-schedule-and-automate-tasks-with-copilot-cloud-agent/)）。

### 4.8 编排严谨度高于典型 orchestrator-worker

DFS 环检测 + 存在性校验 + 前环终态裁决（`orchestrator.ts:870`）、done 事件驱动解锁**零轮询**、
崩溃后纯扫描重派（`recovery.ts`）、卡死静默窗 + resume 出口（`stuck.ts`）、
pipeline 整链一次审批后 stages 冻结且重复请求即拒（`:1291-1330`）、
supervisor 封闭动作枚举 + 三重有界（maxStages 6 / 预算闸 / 同任务≥3 强制 escalate）且 V1 **纯规则不调 LLM**。
合并唯一出口是 git 面板、**agent 无合并权**（`src/agent/worktree.ts:8-9`）——这条权限设计比多数「自动开 PR」产品保守且正确。

### 4.9 规模与工程纪律

25,843 行 src / 86 测试文件 ≈768 用例 / 101 fixtures；
vanilla renderer **零构建链** + CSP `script-src 'self'` + 万条事件 DOM ≤300，
且用**真 Electron + CDP** 做性能门（`scripts/panels-check.ts:153-248`）而非 mock；
不引 tokenizer（chars/4 + usage 校准）；src 内 **零 TODO/FIXME**，半成品全部以「留位」显式自述。

### 4.10 UI 诚实性

删演示常量、无数据走空态、git 面板无 worker 时诚实空态、门禁摘要区分「通过」与「未证 ≠ 通过」
（`DSH_STRICT_UNVERIFIED` 可让未证判红）。这在 agent 产品里是罕见品。

---

## 5. 能力对照矩阵（一页速览）

| 维度 | 行业 | DSH 现状 | 判定 |
|---|---|---|---|
| 自动上下文压缩 | 必备（CC/Codex/Gemini/OpenHands/Auggie） | 完整（阈值摘要 + 六段模板 + 滚动合并 + 只投影不改日志） | 追平，但预算硬编码（A2） |
| 每轮零 LLM 裁剪 | 少数（CC tool-result clearing 单事件省 163k） | 完整（`prune.ts`，保护 40k / 免剪 skill·remember·memory） | **领先** |
| 仓库地图 / 代码理解 | 必备化中（Aider tree-sitter repo map 是鼻祖；Qoder Repo Wiki、Devin DeepWiki） | 可用（tree-sitter WASM + 个性化 PageRank + token 预算渲染） | 追平 |
| 语义 embedding 检索 | 争议（无定论） | 无 | **不做**（C 档） |
| LSP | opencode 一等集成 | 可用（真 JSON-RPC，6 个**只读**操作 + 诊断缓存；无 rename/codeAction） | 落后半档 |
| OS 沙箱 | 桌面必备（三家各自实现 Seatbelt） | 完整（deny default + 全断网 + 敏感路径拒读 + realpath 纪律）；仅 macOS | 追平，出口策略缺（A7） |
| 权限审批 | 三档模式 + 规则 | 四层管线 + 命令链 + 断路器 + critical 强制 | **领先一层**（缺路径粒度 A8） |
| 快照/回滚 | 必备（CC rewind / Gemini checkpoint） | 无用户态 rewind | **缺**（A3） |
| prompt caching | 头部实践，量化 −41~80% | 零 | **最大缺口**（A1） |
| 联网工具 | 常见 | 零 | **缺**（A4） |
| 子 agent / 编排 | 主流（pi、Amp 明确不做） | 完整（四模式 + worktree + 依赖链 + 恢复 + 卡死） | 追平偏前 |
| 语义合并 | 未解项 | 有数据、只是提示，未成准入 | **可超车**（B1） |
| 跨会话记忆 | 差异化（CC auto memory / Devin knowledge） | 完整（inject 预算 6k + distill 四类型 + 索引硬上限 200 行/25KB） | 追平 |
| 插件 / hooks / skills | SKILL.md 快速收敛 | 完整（三级作用域 + 10 hook 事件 + 渐进披露 + 指纹信任） | 追平，信任面**领先** |
| MCP | client 必备 | client 三 transport，无 server/registry/重连 | 半档落后（B4） |
| 模型路由 | 多为第三方外挂 | 内置纯函数 + bandit + 价格回灌 | **领先**（但未证 + 默认关） |
| 成本计量 | 必备 | 有 metering/ledger/pricing，**价格自述占位**（`registry.ts:5-6`），默认关 | 半成品 |
| 长任务/目标模式 | 2026 主战场 | propose_plan + 档位 + supervise 有；无 persisted goal 文件化 | 落后半档 |
| 后台进程控制 | CC/Codex 有 | 无（60s 硬顶） | **缺**（A6） |
| 验证闭环 / review bot | 从加分→必备 | 完整（verify 门 + security scan + llm-review + 29 门禁） | **领先** |
| 外部 benchmark 成绩 | 营销必备 | 无（3 个自有冻结 case） | **缺**（B3） |
| 可安装包 / license / 更新 | 桌面产品标配 | 有（dmg + safeStorage BYOK + 离线 Ed25519；updater 只检查不下载、license 失败不阻断） | 追平，两处留位 |
| 浏览器 / computer use | 争议（读数不可信） | 无（面板诚实空态） | **不做**（C 档） |

---

## 6. 优先级建议（三件，含落点）

### 第 1 件：缓存边界（A1）— 一周内，最高 ROI
#### ~~上下文预算认模型（A2）~~ **已完成，勿重复开工**（在飞未提交，归属会话 `6a8c777c` 待 `pnpm gates` 收口）

理由：唯一「降本不降智」且有公开量化的杠杆。做法与进度：

1. 三家 provider 写 `cache_control` 断点（`anthropic` 原生、`openai`/`gemini` 各自隐式规则）；**← A1 未动，全仓 `cache_control` 仍为零**
2. ~~`compaction.inputLimit` 改为查 registry `ctxWindow`（消掉那 12 行死元数据）~~ **已落**（主会话面）：
   `withModelBudget` + `findSpecByNameOrId` + `budgetConfig()` 三处共用，`Math.min` 只允许往下钳。
   验证：全量 814 绿 / 定向 62 绿 / **反向验证在无 fix 的 HEAD 上两条新用例双红**（详见 §8）。
   ⚠️ 但 `cache_control` 的断点位置必须与 `budgetConfig()` 商量着来——**压缩触发点一改，稳定前缀就变，缓存必穿**。
   A1 开工前先看这条，否则两件事互相拆台。
3. 压缩/裁剪只在**稳定前缀尾部**发生，系统段与工具表永不变位（`glm-session.ts:35-283` 的 `gateToolSpecs` 规格表是天然稳定前缀，别动它）；
4. 事件流显式记 cache 断点与命中率，miss 当**缺陷**统计并进门禁指标。
   ⚠️ 计量落点用 `#tokenTotal` 之外的新字段——`tokStr()` 会缩写成 `"1.5k"`，**不得写裸数字断言**（AGENTS.md 底栏契约）。

**A2 的残留尾巴（建议另立一项，优先级高于 A3/A4）**：worker 面结构性未修。三个 `model` 字段是**三个不同东西**，别当一处：

| 位置 | 类型 | 含义 |
|---|---|---|
| `orchestrator.ts:477` | `SpawnArgs.model?: string` | 模型/档位**名**（字符串 id） |
| `orchestrator.ts:501` | `WorkerHandle.model?: WorkerModel` | **函数**（闭包），无窗口元数据 |
| `orchestrator.ts:2855` | `createWorkerProvider` 入参 `model?: WorkerModel` | 同上，函数（工厂自身在 `:2852`） |

路由路径上 **spec→函数的唯一转换点是 `orchestrator.ts:993-997`**
（`toWorkerModel(resolveModel(DEFAULT_MODEL_TABLE, routeDecision.picked))`），
`ctxWindow` 就在这里丢——`resolveModel` 手里**本来就拿着完整 spec**。
所以最便宜的修法是：**在 `:997` 原地取 `spec.ctxWindow`**，随 handle 存一份（如 `w.modelCtxWindow?: number`），
`:1901` 的 worker 压缩配置读它即可 ⇒ **一处写、一处读，`toWorkerModel` 返回值一字不动**
（改 `toWorkerModel` 返回对象反而会波及 `:2855` 函数型入参与 `:1892`/`:2882` 两处消费）。
另需给 worker 补与主会话同口径的**最终硬闸**（现在 worker 侧零 `context_budget_exceeded`）。

**行号已按 `d64084e..f0bf5a5` 之后的树重测**（`w.model` 消费点实测仍只有 **1 处** = `:1892`；
归属会话已撤回早先的「13 处」口径）。附带一处文档债：`registry.ts:20` 的注释
「ctxWindow 供预算/路由参考」在 A2 后**已部分兑现但仍不准**——该字段的消费者目前只有
`glm-session.ts:408`（运行时）与 `tests/providers.test.ts` / `tests/session-provider.test.ts`（测试），
worker 面仍无。⚠️ `orchestrator.ts` 正被并发写者持有，本表行号可能再漂，**定位请以符号名为准**。

**撞面状态（23:25 更新）**：`d64084e` 已入库 ⇒ A2 对 `registry.ts` / `glm-session.ts` / `compaction.ts` 的持有已释放，
该修法**只剩 `orchestrator.ts` 一个文件**，无撞面；已由协调会话排给 `6a8c777c`（编号「A2 残留：worker 预算认模型」，
排在其 2 个在飞项之后）。**不要据此直接开工**——以协调会话的派单为准。

### 第 2 件：impact 从提示升级为准入 —— 语义合并闸（B1）— 成本最低、区分度最高

复用已有 `impact_report.up` 与 `leaseConflicts`，波及集相交即串行化/仲裁，走已有审批卡出口。
新增变异条目：波及集相交却未串行化 ⇒ 必红。

### 第 3 件：让自评结论可外推（B2 + B3）— 不修则前两件无法证明

1. gym 补**分叉回放**：同 prefix 真跑 K 分支，记录动作分歧率与终态分布，把「回放可外推性」本身做成一道门禁指标；
2. 接一个非自有任务集（**不追 SWE-bench Verified**，可选 Terminal-bench 或自建多仓小集）；
3. 六开关里至少 `impactAnalysis` + `economicCompaction` 拿到**真模型**收益证据，才允许默认开。

---

## 7. 未证 / 保留（不宣称清单）

- 「我们路由省了钱」——**未证**。bandit 与 gym 同建立在离线回放假设上（§B2），且 bandit 路由三大坑公开无解法【未证实】。
- 「我们的多 agent 有正收益」——未证。`spawnRace` 收益-成本比无稳定结论，在 15× token 乘数下默认应保持关。
- 「28/29 道全绿」——不宣称全部通过。另有联网/凭据限制的未证项（远程 MCP、provider:check 真连、各 check 暗卷段）；严格模式可判红。
- 「harness 极简派是否长期占优」——未证实（pi 四工具、Auggie −53%、mini-SWE-agent 是同一条线索的反证，值得读但没定论）。
- 本报告的「行业现状」全部来自外部二手/一手混合来源（第 9 节），**逐条未经我方复现**；
  产品能力清单可能随版本失效。Terminal-bench 具体版本号与分数抓取有歧义，**未证实**。

## 8. 核验记录（本报告的可信度分级）

**本轮逐条实测核验过（可直接照做）**：

| 断言 | 核验方式 | 结果 |
|---|---|---|
| provider 无 prompt caching | `grep -i cache_control\|cacheControl\|ephemeral src/` | 1 命中，且在 `solpi-runtime.ts` 的注释里，provider 层**零** |
| 上下文预算硬编码（**21:29 快照，已被同日 21:35 的 fix 取代**） | `grep ctxWindow src/ scripts/` | 当时 registry 12 处填值 + 类型声明，**除 registry 外零消费者**；`compaction.ts:31` = `128_000`，`glm-session.ts` 据此抛 `context_budget_exceeded`。→ 21:35 主会话面已接 `ctxWindow`，见本表末四行 |
| 主对话只认 demo\|glm | `src/main/settings.ts:103` `PROVIDER_KINDS` | 确认（初版误记 `:99`，8 个入库提交后行号漂移） |
| 七模块默认关 | `src/main/settings.ts:87,91-96` | 确认全 false（23:25 复核：**新增第 8 个 `autoVerify` 收束闸亦为 false**，`:97`） |
| 无联网工具 | `grep -i 'web_?(search\|fetch)\|http\|fetch(' src/tools/` | 零命中 |
| run_shell 上限与尾字节丢弃 | `src/tools/run_shell.ts:5-6,21-27` | 确认 32KB / 60s / `return` 丢弃 |
| 权限无路径粒度 | `src/permissions/rules.ts:11-19` | 确认只有 `tool` + `pattern`（命令段前缀）+ `scope:"always"` |
| 四层管线 L2 不可绕 | `src/permissions/autonomy.ts:1-8,44-47` | 注释逐字确认（含 `MAX_AUTO_APPROVALS=50`、`CRITICAL_DENIAL_LIMIT=3`） |
| gym 只有 3 个 case | `fixtures/gym/index.json` | 确认 |
| 档位表价格自述占位 | `src/providers/registry.ts:5-6` | 确认「需联网实测校准」 |
| 29 道门 | `scripts/gate-manifest.ts:11-44` | 逐个数，29（六道基建 + 22 验收 + `mutate-verify`） |
| 72→**79** 条变异 | `node scripts/mutate-verify.mjs --list`（21:29 vs 23:25 两次） | 初测 72 条 / 16 源文件；A2 与出网重试等能力入库后 **79 条 / 22 源文件** |
| worker 并发 4 / 租约冲突 | `orchestrator.ts:82,1180` | 确认（租约冲突检测随并发写者从 `:1172` 漂到 `:1180`） |
| 真 Electron + CDP 性能门 | `scripts/panels-check.ts:173` | 确认 `--remote-debugging-port` |
| 未信任则 hooks/MCP/LSP 不激活 | `src/agent/plugins/trust.ts:1-3` | 确认 |
| **A2 fix 的三处共用是否真共用** | 读 `git diff src/agent/glm-session.ts` + `grep -n budgetConfig() src/` | 确认触发判定（`:519`）、最终硬闸（`:551`）、压缩器构造（`:414`）**三处同一 `budgetConfig()`**——不是只改一处留两处旧帽 |
| **不钳制时超窗请求静默放行（真缺陷，非未覆盖分支）** | 把新测试放入无 fix 的 HEAD worktree 反跑 | 无 `Math.min` 钳制时，`compaction.config.inputLimit: 900_000` 在 128k 窗口模型上**promise resolved 而非 reject** ⇒ 本地不拦、把注定 400 的超窗请求发给远端。这是**行为缺陷**，不只是"某分支没测到" |
| **A2 只修了主会话，worker 面结构性未修** | `grep -rn "withModelBudget\|budgetConfig()" src/`（调用点全在 `glm-session.ts`）+ 读 `createWorkerProvider`（`orchestrator.ts:2852`）签名 `model?: WorkerModel` + `toWorkerModel`（`registry.ts:94-111`）| worker 入参是**闭包不是模型名**，`ctxWindow` 在 spec→函数转换处被丢弃；worker 配置仍是 `DEFAULT_COMPACTION_CONFIG + {ratio:0.95}`（`orchestrator.ts:1901`）= 一律 128k，**且无本地硬闸** |
| A2 fix 的全量回归 | 主树 `vitest run --config tests/vitest.config.ts`（21:37） | **85 文件 / 814 用例全绿，exit=0**，50.8s；定向 5 文件 62 绿；`pnpm typecheck` exit=0；`pnpm compaction-check` exit=0（1 项未证：真实 GLM 暗卷需 `M0_API_KEY`） |
| `withModelBudget` 是「替换」不是「取小」（放大保护只在 `:410`） | 读 `compaction.ts:47-50` 与 `glm-session.ts:409-410` 原文 | 确认：前者 `{ ...config, inputLimit: ctxWindow }`；后者 `{ ...merged, inputLimit: Math.min(merged.inputLimit, window) }`。`:409` 展开序 `{...base, ...explicit}` 决定显式值会覆盖第一层 ⇒ 两层缺一不可 |
| worker 侧「三个 model 字段」的类型区分 | 读 `orchestrator.ts:477`（`string`）/ `:501`（`WorkerModel`）/ `:2855`（`WorkerModel`）/ `:993-997` 唯一转换点 | 确认 `w.model` 是函数不是名字 ⇒ 窗口无处可取；`resolveModel` 在 `:997` 手里有完整 spec，原地取最省。**协调会话已复核并采纳此口径**（其早先「13 处 `w.model`」实为误计 `routeDecision.picked`） |
| **本报告自纠一处过期结论：A5「provider 无重试」已被 `887ffb6` 推翻** | `grep -rln "retry\|backoff\|jitter\|429" src/providers/` → 新文件 `retry.ts`；读 `retry.ts:8-9,12-13,24-26,57,65,79` | 21:29 判定「零重试」在当时为真；23:08 入库出网重试层后**该结论过期**，已把 A5 改判为「重试已落 / 限流器仍缺」。**教训**：本仓并发推进速度下，报告的时效窗口以小时计——入库前必须重测（见顶部修订记录） |

**继承自代码盘点轮、本轮未复验（读时打折）**：各模块的行内细节行号（如 `orchestrator.ts:870` 的 DFS 环检测、
`loop.ts:126-136` 的 verify 反射上限、`impact` 的 `:208/:215/:256`）、规模计数（25,843 行 src；
用例数以本表「全量回归」行的 **85 文件 / 814 用例**为准，早期静态 grep 得到的 ≈768 系少计且已被并发会话的新增用例推翻）、
`compaction` 的 0.9× 阈值与 tail 预算公式、`prune` 的 40k/20k/2 轮参数、`inject` 的 6k 预算与
`writePruneAttachments` 零生产调用者。这些来自同一路径的系统性盘点，抽样一致性良好，但**不构成本轮独立证据**。

**外部来源一律未复现**：第 1/2/3 节的行业与论文论断全部来自公开材料（第 9 节链接），
产品能力清单**随版本失效风险高**；论文数字（−41~80%、+18.7、61–94%、15×、84%）按原文引用，未验证实验方法细节。
凡标注【未证实】的条目不得用于对外宣称。

## 9. 来源

产品能力：[Claude Code checkpointing](https://code.claude.com/docs/en/checkpointing) ·
[sandboxing](https://code.claude.com/docs/en/sandboxing) ·
[agent-teams](https://code.claude.com/docs/en/agent-teams) ·
[Codex 指南](https://blakecrosley.com/guides/codex) ·
[长时程任务](https://developers.openai.com/blog/run-long-horizon-tasks-with-codex) ·
[Codex 2026-04 changelog](https://www.developersdigest.tech/blog/codex-changelog-april-2026) ·
[Gemini CLI sandbox](https://google-gemini.github.io/gemini-cli/docs/cli/sandbox.html) ·
[Plan mode GA](https://developers.googleblog.com/plan-mode-now-available-in-gemini-cli/) ·
[Jules changelog](https://jules.google/docs/changelog/) ·
[OpenHands 架构](https://arxiv.org/html/2511.03690v2) ·
[SWE-bench](https://www.swebench.com/) ·
[Aider repo map](https://aider.chat/2023-10-22/repomap.html) ·
[Amp docs](https://ampcode.com/docs) ·
[Cursor 指南](https://www.deployhq.com/guides/cursor) ·
[Cursor security agents](https://cursor.com/blog/security-agents) ·
[Devin release notes](https://docs.devin.ai/release-notes/overview) ·
[Factory 指南](https://sidbharath.com/blog/factory-ai-guide/) ·
[droid 审批面](https://agent-safehouse.dev/docs/agent-investigations/droid) ·
[Cline](https://github.com/cline/cline) ·
[pi（badlogic 一手）](https://mariozechner.at/posts/2025-11-30-pi-coding-agent/) ·
[pi 仓库](https://github.com/earendil-works/pi) ·
[opencode 指南](https://www.developersdigest.tech/blog/opencode-developer-guide-2026) ·
[Goose](https://goose-docs.ai/) ·
[Kiro specs](https://kiro.dev/docs/specs/) ·
[Auggie harness 重建 −53%](https://www.augmentcode.com/blog/auggie-cli-harness-rebuild-53-percent-cheaper) ·
[Qoder Repo Wiki](https://docs.qoder.com/user-guide/repo-wiki)

前沿研究：[Effective context engineering（Anthropic）](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) ·
[Multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system) ·
[Cognition: don't build multi-agents](https://cognition.com/blog/dont-build-multi-agents) ·
[跨 provider 缓存评测 arXiv 2601.06007](https://arxiv.org/html/2601.06007v2) ·
[Replay Gap arXiv 2608.08239](https://arxiv.org/html/2608.08239v1) ·
[STORM arXiv 2605.20563](https://arxiv.org/html/2605.20563v1) ·
[AgentRewind arXiv 2608.14380](https://arxiv.org/html/2608.14380v1) ·
[Self-correction 不成立 arXiv 2310.01798](https://arxiv.org/abs/2310.01798) ·
[Lost in the Middle](https://arxiv.org/abs/2307.03172) ·
[METR 时间地平线](https://metr.org/time-horizons/) ·
[RouteLLM](https://openreview.net/forum?id=8SqNntaMr) ·
[编码 agent 注入 84% arXiv 2509.22040](https://arxiv.org/html/2509.22040v2) ·
[CaMeL 十个月](https://neuraltrust.ai/blog/camel-prompt-injection) ·
[MCP 安全现状](https://nimblebrain.ai/blog/state-of-mcp-security-2026/) ·
[MCP 2026-07-28 迁移](https://aaif.io/blog/mcp-2026-07-28-whats-changing-and-how-to-migrate) ·
[OTel GenAI semconv](https://opentelemetry.io/docs/specs/semconv/gen-ai/) ·
[ACP v2 draft](https://agentclientprotocol.com/announcements/acp-v2-draft) ·
[AG-UI events](https://docs.ag-ui.com/concepts/events) ·
[A2A（Linux Foundation）](https://www.linuxfoundation.org/press/a2a-protocol-surpasses-150-organizations-lands-in-major-cloud-platforms-and-sees-enterprise-production-use-in-first-year) ·
[沙箱技术对比 2026](https://grigio.org/ai-agent-sandbox-technologies-a-complete-2026-comparison/) ·
[SWE-bench Verified 失效（OpenAI）](https://openai.com/index/why-we-no-longer-evaluate-swe-bench-verified/) ·
[评测 harness 对比](https://appliedtechnologyindex.com/research/2026-comparative-analysis-coding-agent-evaluation-harnesses-after-swe-bench/) ·
[沙箱逃逸研究](https://novee.security/blog/breaking-ai-agent-sandboxes/)
