# 能力基线（重算版）— 2026-10-07

- **日期**：2026-10-07
- **HEAD**：`46cde6b7`（本文件写盘时 `git rev-parse --short HEAD` 现读）
- **基线对比对象**：`274f165` ＝ `outputs/agent-capability-roadmap-2026-10-01/PLAN.md` 第 1 节的十条能力判定（2026-10-01 版）
- **合并来源**：本轮两份只读审计
  - 能力 1–5：`sessions/.../nodes/cap_audit_exec.out.md`
  - 能力 6–10 + 自进化 / 结果信号回流 / 经验沉淀三节：`sessions/.../nodes/cap_audit_sys.out.md`
- **口径（判据）**：**真接线（追得到调用者）＋ 默认路径能跑 ＋ 有闸兜底 ⇒ 已实现**；缺一项 ⇒ 部分；追不到 ⇒ 缺失。
  （仓库自有口径，见 `docs/CODE-WIKI.md`「门禁纪律」：未证 ≠ 通过。）
- **规模现值（审计实测，非本文件复测）**：`src/` **202 个 .ts**（10-01＝158 文件 / 36,645 行）、`tests/` **362 个 .ts**、
  `scripts/gate-manifest.ts` 的 `GATES` **34 条**（10-01 记 31 道）、`CERT_GATES` 23 道。
- **本轮性质**：两份审计**全程只读**，未跑任何判卷 / 门禁 / bench。故本基线的**全部判定均为代码级证据**，
  没有任何一条带实测回执——「未跑」项集中列在文末诚实清单。

---

## 十条能力总表

> 「差异」列＝相对 10-01 那一份；「缺口」列各一句话，可直接当任务书用。

| # | 能力 | 判定 | 与 10-01 的差异 | 最要紧缺口 |
|---|---|---|---|---|
| 1 | 仓库级代码理解 | **部分** | 新落地：go/java 两种语法、`impact/persist.ts` 持久化索引真接线、`map/retrieve.ts` 词面检索通道三件（10-01 点名要做的）；没变：向量检索 | **无向量/embedding 检索**——`retrieve.ts` 自述「零模型、零依赖、不调 embedding」，只买词面重叠一档，同义改写接不上 |
| 2 | 精确代码生成与编辑 | **部分** | 新落地：`apply_patch` 存在且进 `TOOLS`（10 工具）、带 `patch-parse` 解析器、`risk.ts` 单列闸、三条判卷（10-01「工具一个都不存在」已关闭）；没变：自动重构 | **无 codemod/自动重构迁移工具族**——批量改调用点/重命名全靠模型逐个 `apply_patch`/`edit_file` |
| 3 | 工具调用与环境操作 | **部分** | 新落地：`diagnose`、`web_search` 从差距清单变「已接线＋已登记＋有闸」；没变：浏览器/调试器 0、默认全断网 | **浏览器与调试器仍为 0**（无 DAP、无 browser 文件），无 issue/CI API 客户端；默认沙箱全断网 |
| 4 | 长程规划与任务分解 | **部分** | 新落地：调度器有了生产入口 `--serve` / `serveScheduler`，被 `scheduler-wiring` 判卷钉住（10-01「零生产调用者」已关闭）；没变：仍部分 | **无人值守 run 写类一律 fail-closed 自动拒**——「按点自动跑」跑得起来，但自动跑的写动作默认全被门挡下 |
| 5 | 执行-验证-修正闭环 ★ | **已实现** | 没变（维持已实现）；新落地：多面探测、verify 信任闸/指纹免问、同 digest 升级处置三件（补齐 10-01 挂着的「autoVerify 从未真跑」） | 自动探测只有**测试**与 **typecheck** 两面，`verify.ts` 内无 lint 探测（无 `probeLintCommands`），lint 仍要手配 |
| 6 | 记忆与上下文 | **已实现** | 10-01 判「跨会话从失败轨迹学习无成型机制」→ 现已是全链路（提炼→落盘→注入→复跑面），并多出环境红不入教训、坏文件名不吞整段两个隔离判据 | 教训注入只有「最近 N 条 / 跳过几条」的**条数**读数，**无「注入后被模型用上」的命中率**（`memory/` 全树 grep `命中率|hitRate` 零命中） |
| 7 | 安全与权限 | **已实现** | 10-01 的 `ghost_tool => allow` **fail-open 已翻正**（四档全 ask）；立了名册派生面（`KNOWN_TOOL_NAMES` 由 `TOOL_NAMES∪INJECTED_TOOLS∪worker 表` 派生）+ MCP 归类决定 | 兜底裁决取 **ask 而非 deny**，fail-closed 实际靠下游 `gate()`（非交互时 ask→deny）与 `loop.ts` 会话闸提供 |
| 8 | 人机协作 | **部分**（较 10-01 明显前移） | 10-01 两条差距均已闭合：`--fork`/`--replay` 命令进 CLI、diff 走 `diff-review.ts` 逐文件接受/拒绝；现状只是粒度不够 | 审阅粒度仍是**整文件**接受/拒绝（`parseSelection` 入参只有文件序号），审批仍是 `[y/n]`——无 hunk 级、无行内批注 |
| 9 | 工程化与成本控制 | **部分** | `.github/` 从「不存在」→ 存在但不生效；门 31→34；测试 3,512→`PROGRESS.md` 自报 4,840/4,842（未复验）；`src/` 158/36,645 → 202/47,818（实测） | **CI 一次也没真跑过**（workflow 自述「本仓没有 git remote」）；IDE / PR / issue 集成 = 0（全仓 grep `octokit|pull_request|gh pr` 零命中） |
| 10 | 评估与持续迭代 | **部分**（仍是全十条最接近骨架） | 3 条冒烟 → 12 条 + 3 变体；「无可比读数」→ 有噪声带/合取/身份三闸；「无真模型读数」→ 有（但只在自家靶场） | **外部基准仍没有尺**——SWE-bench 只有解析器（数据集/快照/语言侧判卷三样都不在），Terminal-Bench/Aider 连解析器都没有；自有尺噪声 8–25%，`k<4` 读不出「1 条靶」的提升 |

**★ 注**：能力 5 是本项目最强的一格，本轮只做加固、不重写。

---

## 专题 (a)：自进化（SEMA）

拆成两支，落地程度差一个数量级。

**① `src/agent/evolution/`（策略补丁支）——真接线，默认路径每跑生效。**
- 写：`runEvolution` ← `agent-runner.ts:2200`（会话收束，失败只 warn）→ `.agent/evolution.json`（原子写、损坏即当无补丁）。
- 读：`evolutionPromptNote` ← `agent-runner.ts:1925`，拼进 `systemPromptFor(opts.mode) + evolutionNote`；零补丁时返空串（逐字节不变）。
- **在场产物**：仓库现有一份真 `.agent/evolution.json`（`ts` 对应 2026-10-07 15:17，一条 `cost-throttle`）。
- 闭合到哪：**只到「提示文本」**——补丁是 system prompt 里一段话，**没有回读「这条提示是否真被采纳」**，也没接回路由/预算的动作面。

**② `src/main/evolution/`（CAP Bundle 流水线）——Phase 0–3 只有库 + 判卷，零生产调用者。**
- 文件齐、判卷齐（registry 28 条 / plane 24 条 / install 22 条）。
- **关键事实**：全仓 grep `main/evolution` 的 import **只命中三个 tests 文件**，`src/`（除自身）与 `scripts/` **零调用者**；提案 §12 自认「真实提案管线待真实流量出现时接线」。⇒ 已落地定义仅「指针切上、账本可回滚」；**没有安装面、没有运行面装载**。
- **Phase 4 入口：没有代码入口**（`canary` 只作注释出现），提案 §7 记「待批」；Phase 5（周期 Assess、lesson 库喂 Planner）同样「待批」。

**小结**：SEMA 的**读-写侧提示补丁**是活的；**CAP Bundle 的装载/安装/周期评估面**全部停在库 + 判卷 + 提案，**未接线**。

## 专题 (b)：结果信号回流（M5）

**已闭合的段（都有生产调用者）**：① 路由决策落流 `routing_decision`（`orchestrator.ts:776`，先于 `agent_spawned`，崩溃可回放）；② bandit 选档 + 奖励回灌（`routeFor(bandit)` → `rewardBandit`，`done && 证据不红 ⇒ 1`，真钱折算 + `saveBanditState`）；③ 级联升档 `cascadeLadder/runCascade`；④ 受限 supervisor `decideSupervisor`；⑤ Best-of-N 竞速 `spawn(race)`（N≤3，judge 命中即早停）。

**断点（致命，仅一处）**：**默认路径全关。** `settings.ts` 的 `DEFAULT_SETTINGS` 里 `routingBandit:false`、`routingCascade:false`；`cli.ts:12` 自述这三个最值钱的开关「默认全关且**无处可翻**」（`cli.ts` 内无 `--routing*`/`--bandit*` flag，只有那条注释）。唯一开法是改 settings 存储/桌面端 UI。⇒ **学习面在生产 CLI 上是零流量**——仓库自己就有量这把尺的件：`scripts/replay/cascade-traffic.ts` 专门报「不可测（路径零流量）」。

**第二处半断**：评估→学习的**输入侧**已在收（`loop-eval` 默认只留 FAIL 轨迹），但**转成草稿仍要人手工跑** `scripts/gym-draft.ts --apply`（`loop-eval.ts` 只在注释里提它）；`src/agent/gym/draft.ts:190` 自记 `fixtures/gym/drafts/` 恒为 0 条。

**小结**：M5 的**机制全在、判卷全在**，但**默认全关且无 CLI 开关**，等于在产路径上没跑。

## 专题 (c)：经验沉淀（lessons）

**写读两端都真接线，闭合到「注入」，未闭合到「命中」。**

- **写链**：`distillLessons`（纯函数，硬门＝无 `callId`/无会话 id 不出条目）← `writeLessons` ← `runSessionEndDistill`（放调 provider **之前**）← **`agent-runner.ts:2069`**（每场会话收束一次；`autoMemory` 缺省 true）。
- **读链**：`lessonsSection` ← `buildMemoryInjection` ← `glm-session.ts:965`（**每请求组装重注**）、`worker-prompt.ts:59`、`sidechat.ts:278`；`LESSONS_RECENT_DEFAULT=10`，超限先丢该段；无证据指针的条目直接不注入。
- **真读数**（`outputs/m6-acceptance-2026-10-01/lessons-offline.log`）：21 份日志 → 教训 10 条、覆盖 5/21，按类 `repeat-action 5 / tool-streak 2 / verify-red 3`；`orphanFail=0`（硬门没静默丢东西）；`envRed=0`（「环境红不进教训」未被真语料覆盖）。
- **断在哪**：① 端到端「第二轮同类失败率下降」**无读数**——`lessons-round-ab.ts` 自陈在 mock 靶上不可达（`createMockProvider` 忽略 messages），只读出「一个正确的零」；② 两个复跑面**不在门表、零断言**（`gate-manifest.ts` 与 `tests/` grep `lessons-offline|lessons-round-ab` 零命中；台账记为 `#75`），且 `package.json` 无 `replay:lessons-*` 别名。

**小结**：lessons 的**提炼-落盘-注入**全链路是真的；**「注入被用上」的命中率**和**「同类失败率下降」的端到端读数**都没有，量它的两条复跑面还裸着（无门、无断言）。

---

## 本基线没有覆盖的面（诚实清单）

两份审计本轮的**全部「未跑」「未证」**集中如下：

**能力 1–5**
- 未跑 `impact-multilang` / `impact-persistence`：10-01 要求的 precision=1.0 / recall≥0.9 与「索引命中建图快于冷建」两个读数**没有实测**；go/java 在真仓库入图覆盖未测。
- 未跑 `apply-patch*` 三条判卷：「默认路径能跑」与「行数读数与 `git diff --stat` 一致」只有代码级证据。
- 未跑 `diagnose` / `web-search` / `sandbox` 判卷；「网络类四档一律审批、scope 钉 once」只有代码证据；README「网络与沙箱边界」一节**未核**。
- 未跑 `scheduler-wiring`；「注释掉入口那行判卷必红」反向验证**未做**；未跑任何 ≥30 轮长任务，故完成率/token/漂移次数**无读数**。
- 未跑任何 verify 判卷；「五类归因逐类反向拆解」「环境红不消耗修复额度」「真靶子上多面验证跑通」的实测输出**未取**。

**能力 6–10**
- 未跑 `memory-check` / `memory-lessons.test.ts`；`LESSONS` 段在预算紧张时的**丢弃顺序未实测**。
- 未跑 `autonomy-check`；`shell_ro` 刻意不进 `SIDE_EFFECT_TOOLS` 的**执行期静态白名单未逐命令核**。
- 未跑 `fork-check`；桌面端 UI（`apps/desktop/**`，属另一 agent）是否补齐 hunk 级审阅**没看**。
- 未跑 `gates`、`pnpm prompt-cost`、`mutate-verify`、任何判卷；测试总数取自台账不是实测。
- 未跑 `pnpm bench`（要凭据与真钱）、`eval-report`、任何判卷。
- `tests/evolution.test.ts`（10 条）未跑。

**全局（两份审计共有的空白）**
- 未跑 `pnpm test` / 任何 vitest、`node --test` 单条判卷（共 362 文件）；未跑 34 道门中的任何一道；
  `scripts/*-check.ts` 全部未跑、`scripts/replay/*` 未跑、`scripts/eval/report.ts` 未跑、`tsc`/typecheck 未跑。
- **反向验证一条未做**（拆机制看判卷变红的验证为零）。
- 本基线因此**只有代码级证据，无一条实测回执**。

---

## 两份审计之间的冲突（已按代码核实）

- **门数冲突**：能力 1–5 审计记 `GATES` **35 条**，能力 6–10 审计记 **34 条**。
  **代码核实＝34**：exec 那份把 `gate-manifest.ts` 门表块内**一行注释里的带引号 `"test"`**（「为什么要进默认门表：\`"test"\`那道门量的是工作树…」）
  也数成了条目，实为 35−1＝34。本基线 `GATES` 采用 **34**。
- 其余两份审计覆盖能力不重叠（1–5 vs 6–10），未发现其他互相矛盾的判定。

---

**口径来源**：判据＝**真接线（追得到调用者）＋ 默认路径能跑 ＋ 有闸兜底**（仓库自有口径，见 `docs/CODE-WIKI.md`）。
