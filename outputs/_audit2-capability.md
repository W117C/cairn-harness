# 功能完整度核查：业主 10 大能力 × 当前主树现状

- **审计人**：capability2（team 审计员，归 lead）
- **对象**：`/Users/ze/Downloads/deepseek harness` — TypeScript 事件溯源 AI agent harness（包名 `m0-agent-loop`，CLI `m0`，**core-only**：无 Electron / 无 renderer / 无 preload）
- **时间**：2026-10-01
- **基线**：分支 `zcode` @ `bd5ec44`；工作树 = HEAD + **18 条未提交改动**（2 个已修改：`src/agent/impact/index.ts`、`src/tools/impact-query.ts`；另新增未跟踪 `src/agent/impact/persist.ts`、`tests/impact-persistence.test.ts` 等 —— 隔壁会话在飞「影响面持久化索引」）
- **只读声明**：本次**未改动工作树任何文件**；没有 reset / stash / checkout。只用了 read/grep/只读 git 命令，外加**单文件**测试 4 个（`user-agent-roles` / `goal-stop-decision` / `plan-required` / `no-progress`，68 条全绿）。**未跑全量测试**（按要求，另有一处在跑）。
- **规模读数**：`src/**/*.ts` = **158 文件 / 36,177 行**；`tests/*.test.ts` = **258 个**；`scripts/gate-manifest.ts` 的 GATES = **31 道门**。

判定口径：**已实现** = 真接线、默认路径能跑、有闸或判卷兜底；**部分实现** = 主干真能干活但有明确缺口；**只有骨架** = 数据面/判据在、执行端不消费；**没有** = 不存在。

---

## 〇、总表（10 行）

| # | 能力 | 判定 | 关键证据（file:line） | 一句话：它到底能干什么 |
|---|---|---|---|---|
| 1 | 仓库级代码理解 | **部分实现** | `src/agent/impact/index.ts:1-9`（跨文件调用边 def/ref）、`src/agent/map/build.ts:1-5`（tree-sitter+PageRank 符号地图）、`src/tools/impact-query.ts`、`src/tools/lsp.ts:1-6`；注入 `src/main/agent-runner.ts:1538-1541` | 能建**跨文件调用图**并回答「谁调用它 / 我调用了谁」，写盘后自动回注波及面；但只认 ts/tsx/js/jsx/py，没有向量 RAG |
| 2 | 精确代码生成与编辑 | **部分实现** | `src/tools/edit_file.ts:1-5`（old_string 精确替换+最近似位置提示）、`src/tools/line-delta.ts:1-9`（改了几行）、`src/tools/snapshot.ts:1-5`（覆盖前快照）、`src/tools/index.ts:16-26` | 编辑是**补丁级**（替换+行增减读数+LSP 诊断），不重写整文件；但没有 `apply_patch`/统一 diff 工具，重构/迁移无专门支持 |
| 3 | 工具调用与环境操作 | **部分实现** | `src/tools/index.ts:16-26`（9 把静态）、`src/agent/tool-surface.ts:20-45`（15 件运行时注入）、`src/tools/run_shell.ts:1-9`、`src/tools/process.ts:1-13`、`src/tools/lsp.ts`、`src/tools/web_fetch.ts` | 文件系统/终端/Git/包管理/测试/LSP/抓单页 URL 全能干；**没有浏览器、没有调试器、没有数据库/issue 集成**，沙箱默认断网（要网得逐次人工批） |
| 4 | 长程规划与任务分解 | **部分实现** | `src/agent/goal.ts:105`（续跑判据）、`src/agent/orchestrator.ts:300-361`（spawn 四档）、`src/agent/sequencer.ts`（pipeline/depends_on）、`src/agent/recovery.ts:61-76`（崩溃重派）、`src/agent/compaction.ts:1-4` | 目标模式自动续跑、四档派活、依赖链、崩溃重派、压缩保上下文都在；**自动化的调度器没人启动**（`initScheduler` 零调用者） |
| 5 | 执行-验证-修正闭环 | **已实现** | `src/agent/verify.ts:1-3`、`src/main/agent-runner.ts:1559-1565`、`src/agent/loop.ts:511-540`（收束闸）、`src/main/settings.ts:127 autoVerify:true` | 写完盘没自测 → harness **自动补一拍 lint/test**；红字回注同轮修；环境红（工具链没装/包管理器自己炸）与代码红分开归因，不冤枉模型 |
| 6 | 记忆与上下文管理 | **已实现** | `src/agent/memory/store.ts:1-4`（两层）、`inject.ts:1-9`（6K token 预算注入）、`distill.ts:1-6`（会话末沉淀）、`src/main/agent-runner.ts:1665-1690`；压缩 `compaction.ts` + 裁剪 `prune.ts` | 项目层 `.agent/*.md` + 全局 `memory/` 两层记忆，每轮按预算回注，会话结束自动沉淀；跨会话能记住用户偏好与项目决策 |
| 7 | 安全与权限控制 | **已实现** | `src/permissions/modes.ts:8`（四档）、`src/permissions/risk.ts:1-4`（风险三通道）、`src/main/sandbox.ts:1-4,44-64`（Seatbelt）、`src/main/ask-gate.ts:1-2`、`src/agent/loop.ts:106-145`（落盘脱敏）、`src/agent/worktree.ts:1-7` | 默认 fail-closed、四档权限、审批超时即拒、macOS 沙箱写收敛+敏感目录拒读+默认断网、写前快照可回滚、worker 走 worktree 且**合并权只在人手里** |
| 8 | 人机协作 | **部分实现** | `src/tools/clarify.ts`、`src/tools/propose_plan.ts`、`src/main/ask-gate.ts`、`src/cli.ts:307-311`（diff 整块打印）、`src/tools/cancel_agents.ts` | 能澄清歧义、能提交方案等批准、能给出 worker diff 供审查、能在轮界取消；但 core-only 树**没有 UI**，审批是终端 y/n，diff 是整块文本不是可点选的审查面 |
| 9 | 工程化与成本控制 | **部分实现** | `src/agent/orchestrator-config.ts:5`（≤4 worker）、`src/main/scheduler.ts`（未启动）、`src/main/settings.ts:113 promptCache:true`、`src/routing/policy.ts:72`+`bandit.ts`+`cascade.ts`（**默认关**）、`src/agent/usage-attribution.ts:1-8` | 能并行派 worker、有前缀缓存与符号缓存、有路由/老虎机/级联（缺省关）、usage 带模型名可折钱；**没有 IDE/CI/CD/PR 集成**，没有每轮固定开销的常驻尺 |
| 10 | 评估与持续迭代 | **部分实现**（最接近骨架的一格） | `src/agent/eval/task-set.ts:117-119`（SWE-bench JSONL→TaskSpec）、`scripts/loop-eval.ts:1-19`、`fixtures/gym/**`+`src/agent/gym/*`、`scripts/replay/*`（12 把复跑尺）、31 道门 + 变异测试 | 有**靶场**（4 个 case + 基线与反例控制）、有 SWE-bench 形态的解析器、有闭环评测脚本与失败轨迹复跑面；**但没有一次真模型基准读数**（凭据环境三 env 全 absent，见 PROGRESS 第 258 页） |

**汇总：已实现 3 条（5/6/7），部分实现 7 条（1/2/3/4/8/9/10），只有骨架 0 条，没有 0 条。**
诚实补充：把「运行时真的消费了吗」当尺子量，**`no-progress.ts` 与 `scheduler.ts` 是两处「装载/写好但不消费」**（详见第二节第 5、7 项），这不是整条能力归零，但是该能力里最名不副实的一格。

---

## 一、逐条展开

### 能力 1 · 仓库级代码理解 — 部分实现

**能干什么（真跑得通的）：**
- **跨文件调用图**：`impact/index.ts` 用 tree-sitter tags 抽 def/ref 双端点，建 `ImpactEdge`（谁在哪一行调用了定义在哪一行的符号），支持向上/向下查询；缓存写应用数据目录，绝不写用户仓库（`impact/index.ts:1-9`）。
- **符号地图**：`map/build.ts` 扫描 → per-file tags（{mtime,size} 缓存）→ 加权图 → 个性化 PageRank → 预算渲染（默认 1024 token，夹在 [1024,4096]）；`map/rank.ts:49` 照抄 aider 的边权规则（mentioned×10、referencer×50）。
- **写后回注**：`impactAnalysis` 默认**开**（`src/main/settings.ts:122`），写完一个文件就把「谁调用了它」回注给模型——这正是业主说的「这个改动会影响哪里」（`agent-runner.ts:1538-1541` 同时挂读端 `impact_query` 工具）。
- **LSP 读面**：`tools/lsp.ts` 真 spawn 语言服务器（定义/引用/符号/悬停/诊断），配置来自 `.agent/lsp.json`。

**缺口（为什么不是「已实现」）：**
- 语言面窄：`map/parse.ts:34-42` 只有 4 个 grammar（ts/tsx/js/jsx/py）；Java/Go/Rust/C++ 一律不进图。
- 大库有帽，但帽很宽：`map/cap.ts:20-21` 的 `MAX_FILES_DEFAULT = MAX_FILES_CEILING = 5000`（09-30 刚从 400 改成缺省＝上限，因为按 mtime 降序切片时「400」的真实语义是「最近动过的 400 个」，实测会让入图集合漂 21–28%）。本仓 512 个候选全收，代价 ＋176ms/次建图。
- **没有向量 RAG**：检索靠 grep/ripgrep + 符号图 + LSP，没有 embedding/语义检索。带点 RAG 味道的是 `obs_recall`（观察回捞，`solpi-runtime.ts`），但它挂在 `observationPack/evidenceReceipts/...` 那几个开关下，`settings.ts:114-117` **全部默认关**。
- 「长上下文」不是靠大窗口，是靠压缩（`compaction.ts` 阈值摘要）+ 裁剪（`prune.ts` 40k 保护区）+ 记忆注入拼出来的。
- **隔壁在飞**：未提交的 `src/agent/impact/persist.ts` + `tests/impact-persistence.test.ts` 正在给影响面加持久化索引（本次审计时未合入 HEAD 的这两处改动是工作树里的真实状态）。

### 能力 2 · 精确代码生成与编辑 — 部分实现

- **补丁级**：`edit_file` 按 `old_string` 精确匹配替换（不是重写整文件）；0 匹配时给「最像的位置」提示（缩进丢了 / 词级相似度 ≥0.5），把「读错→重读全文→再改」的三轮压成一轮（`edit_file.ts:1-5`）。
- **改动量有读数**：`line-delta.ts` 报这次写盘 added/removed 多少行——直接对着业主那句「改动最小、别重抄整文件」。
- **写前快照**：覆盖已存在文件前把原件按字节抄进 `.agent/snapshots/<ts>--<callId>/`，快照 id 随 tool_result 落事件流，事后可回滚（`snapshot.ts:1-5`）。
- **写后诊断**：`edit_file` 收 `collectDiagnostics`（LSP），改完立刻能看见自己捅出来的类型错。
- **worker 的 diff 走 git**：写 worker 在专属 worktree 里干活，产出 stat+patch，经 `callId: "diff-<agentId>"` 的 tool_result 落流，CLI 整块打印（`cli.ts:307-311`、`worktree.ts:1-7`）。

**缺口**：没有 `apply_patch` 式的统一 diff 输入工具（`write-face.ts:7` 提到的那几个名字只在**检测名单**里，`src/tools/` 里并不存在）；没有自动重构/迁移能力（只能靠模型+编辑原语）；「多语言多框架」受同一批 grammar 与文本编辑限制——文本编辑与语言无关，诊断依赖用户自己配 LSP。

### 能力 3 · 工具调用与环境操作 — 部分实现

- **静态 9 把**（`src/tools/index.ts:16-26`）：`read_file` `write_file` `edit_file` `run_shell` `grep`（真 ripgrep）`glob` `lsp`（真语言服务器）`clarify` `propose_plan`；`verify` 不是普通工具，是 loop 的系统门。
- **运行时注入 15 件**（`src/agent/tool-surface.ts:20-45` 是唯一清单）：`spawn_agent` / `wait_for_agents` / `cancel_agents` / `refine_goal` / `remember` / `impact_query` / `obs_recall` / `skill` / 定时五件 / `web_fetch`。
- **环境操作**：`run_shell`（60s 强杀、32KB 头尾环截断、进程组回收防孤儿、env 白名单剥密钥）——装依赖、跑测试、起服务、调 API、操作数据库都是它一条通道；Git 由 shell 跑，写 worker 的 git 写子命令被静态拦截（`worker-shell-tools.ts:129-167`）。
- **文档检索**：`web_fetch` 只按 URL 取，不做检索、不翻页；私网/回环/云元数据拒，四档一律审批。
- **没有的**：浏览器（全仓 0 处 playwright/puppeteer/browser）、调试器（0 处 debugger/DAP/breakpoint）、issue 跟踪器、CI API、专用数据库工具。
- **网络边界**：默认 Seatbelt 闭箱**全断网**，只有「被认成网络类 + 真的问过 + 人批了」三条同时成立才给一次性 allow（`sandbox.ts:73-90`）——所以「装依赖/调 API」在默认档下是走不通的，得用户放行。

### 能力 4 · 长程规划与任务分解 — 部分实现

- **目标模式真能续跑**：`--goal "…" --max-turns N --max-usd X`，一轮收束后 `goalNextTurn` 按证据态决定 done/continue/stop（`agent-runner.ts:1917-1976`）；`goal_set`/`goal_stopped` 落事件流，终端打印停止理由。轮次帽 1–25（默认 8，`goal-trace.ts:12-14`）。
- **分解与并行**：`spawn_agent` 四档 read/write/pipeline/supervise（mode 校验 `orchestrator.ts:300-304`，分派 `:345-361`）；pipeline 有 `depends_on` 事件驱动链（前环 done 自动触发后环，无轮询）；supervise 有封闭动作空间的纯规则决策（`supervisor.ts:49`）。
- **失败换路**：建连重试 408/409/425/429/5xx + Retry-After + 全抖动退避（`providers/retry.ts`）；级联升档（默认关）；崩溃恢复「重派」（`recovery.ts:61-76` + `session-handlers.ts:78-97` 的 `applyCrashRecovery`，按会话历史真用过的档位继承，不读全局默认）。
- **不遗忘**：压缩 + 裁剪 + 记忆注入（见能力 6）。
- **缺口**：**定时任务调度器没人启动**——`initScheduler/startScheduler` 定义在 `agent-runner.ts:1024-1069`，全树（src/scripts/tests）**零调用者**，只有测试直接 `new Scheduler`；CLI 上那五把 `automation_*` 工具是规格面与执行面一起摘掉的（README 自己也写了）。也就是说「长任务自动按点跑」这套只有实现、没有在产入口。

### 能力 5 · 执行-验证-修正闭环 — 已实现

- **主动补验证**：`autoVerify` 默认**开**（`settings.ts:127`）。一轮里写过盘却没自调 verify → 收束前 harness 自动补一拍（每 run 至多一拍、无可验面则整段跳过、探针炸了也不阻断），红字以 `verify_result{auto:true}` 落流（`loop.ts:511-540`）。
- **同轮修复**：模型自调 verify 失败 → `failureDigest` 原文注回同轮继续修，连败 3 拍（可配）收束；逐字相同的第二拍只注一行提示不重发整段（`loop.ts:253-273`）。
- **归因**：`classifyVerifyFailure` 把 timeout / not-run / 127 工具链缺失 / pnpm 自身错误码 / 代码红五类分开，**环境红不占模型的修复额度**（`verify.ts:29-40`、`loop.ts:160-168`）——这条直接防「模型照着假红改本来正确的代码」。
- **验证面从哪来**：`.agent/config.json` 的 verify 字段，缺省探测 `package.json` 的 lint/test；两者皆无 → fail-closed（`verify.ts:1-3`）。
- **静态面**：31 道门里有 `typecheck`（tsc --noEmit）、`test`（vitest）、`e2e`、`sandbox:check`、`mutate-verify` 变异测试、`head-cert-check`（干净 HEAD 整树认证，实测 123.7s）。**但那是仓库自己的门，不是被改项目上的 CI**：跑 `pnpm gates` 是开发者的动作，harness 里没有「推 PR 触发 CI」这一步。
- 可选加强：`autoVerifyRepair`（红后再要一轮修，上限 1 次返修/2 拍）**默认关**（`settings.ts:128`）——文档写明理由：多一轮是真钱，等读数裁。

### 能力 6 · 记忆与上下文管理 — 已实现

- **两层存储**：项目层 `.agent/{ARCHITECTURE.md,DECISIONS.md,preferences.md,memory/}`（团队共享）+ 全局层 `<appData>/memory/`（`store.ts:1-4`）；索引硬上限 200 行/25KB。
- **每轮注入**：固定回注名单 + **6K token 预算**（判定按 token 不按字符，中文一字≈一 token 这个坑踩过）、超限整行丢弃保尾部、块首立场声明 + 仿冒控制标签转义 + `@path` 工作区外首次批准；读的地方在真 provider 的装配里（`glm-session.ts:775-781`），所以压缩后自然重注。
- **跨会话沉淀**：会话结束自动跑一次沉淀轮（`autoMemory` 默认开；read-only 档与无人值守不触发），四类型纪律（user/feedback/project/reference），写入只经 `remember` 工具、**合并成一次审批**防审批疲劳（`distill.ts:1-6`、`agent-runner.ts:1665-1690`）。
- **上下文管理**：阈值摘要压缩（事件流永不删改，压缩只产出投影）+ prune 类型化裁剪（保护区 40k、最小 20k、最近 2 轮免剪、被裁原文可回取）+ 经济闸（economics.ts 前进边界选点）。
- 已知缺口（port2 才有、主树没有）：沉淀轮的 provider 与主会话**不同前缀**，前缀缓存基本不命中（port2 实测 2.2% → 98.8%）；主树这条每会话都要付一次全价。

### 能力 7 · 安全与权限控制 — 已实现

- **四档**：`read-only / default / guided / auto`（`modes.ts:8` 是唯一事实源），缺省 `default`，`auto` 必须显式点名；非交互（管道/CI）时 `ask` 当场降级为 deny，**不等超时**。
- **风险三通道**：静态威胁表 ⊕ 模型 requires_approval ⊕ 沙箱装不下；`critical` 任何档位强制审批（`risk.ts:1-4`）。
- **沙箱**：macOS Seatbelt——写收敛到 workspace（realpath 解析防 `/tmp`→`/private/tmp` 坑）、`.ssh`/`.aws`/`gcloud`/Keychains 拒读、**默认断网**；沙箱不可用时 CLI 明说，不假装有。
- **敏感信息**：所有子进程 env 白名单 + 名字含 KEY/TOKEN/SECRET/PASSWORD/CREDENTIAL 一律剥除（`process.ts:1-13`）；事件日志落盘前对 tool_call args / tool_result output / verify 输出做凭据脱敏（`loop.ts:106-145`）——JSONL 是可重放的，这条不做就等于把密钥永久留盘。
- **可回滚**：覆盖前快照 `.agent/snapshots/`；写 worker 在 worktree 里，天然可丢弃。
- **可审计**：append-only JSONL，每一步都是事件；权限判定逐次留痕（layer/verdict/gate）。
- **高风险需确认**：ask 门（60s 无响应按拒绝）、`web_fetch` 四档一律审批、网络放行永不免批。
- 唯一提醒：core-only 树里没有 UI，审批要宿主进程接 `appAskGate`；headless 走 `unattendedAskGate`（fail-closed）。

### 能力 8 · 人机协作 — 部分实现

- **澄清**：`clarify` 工具（2–4 选项或自由文本）；没人能答时提交**空答案 `{}`**并如实告诉模型「没人答，自己拿主意」——不编答案是这里唯一的红线。
- **展示计划 + 供审查 diff**：`propose_plan` 提交目标 + 每文件动作/路径/摘要，批准前写禁；worker diff（stat+patch）整块打印，看不见的 diff 等于没有审查面。
- **可中断**：AbortSignal 树，取消于轮界收束（工具执行中不打断）；`run_shell` 随会话取消终止；`cancel_agents` 撤自己派出去的活（worker 不给这把，防撤兄弟）。
- **缺口**：`core-only` 明确删掉了桌面层，所以**没有 UI**：方案审批是终端 `[y]批准 [n]拒绝`，diff 是终端整块文本，没有行内批注/接受部分改动/接管编辑这些协作面；`forkSession`（从事件流分叉重跑）在 src 里唯一调用者是 gym，CLI 帮助里没有 fork/replay 命令。

### 能力 9 · 工程化与成本控制 — 部分实现

- **并行**：worker 并发帽 `MAX_CONCURRENT_WORKERS = 4`（`orchestrator-config.ts:5`），每个写 worker 一个 git worktree，`node_modules` 软链回来避免重复安装；`wait_for_agents`/`cancel_agents` 收放；定时调度器并发 ≤2（可配）——但**调度器没启动**。
- **缓存**：`promptCache` 默认开（唯一有语义的是 Anthropic 的显式 `cache_control`，`providers/anthropic.ts:117-129`）；符号图 tags 缓存（{mtime,size}）；影响面 tags 缓存；均为「不写用户仓库、只写应用数据目录」。
- **模型路由**：`routing/policy.ts:72` 静态档位 + Thompson 采样老虎机（`bandit.ts`，状态持久化）+ 级联升档（`cascade.ts`）——`routingBandit:false` / `routingCascade:false`（`settings.ts:107-108`），**默认关**，理由写得很直白：每轮换模型会改花钱行为，仓里还没有基准读数可依。
- **预算闸**：`maxBudgetUsd` 默认 **0 = 闸关**；开了之后只拦「编排扩张」（新 spawn/新 stage），主 loop 不受闸；价格查不到时明写「闸不生效」，绝不按 $0 继续烧。
- **成本可观测**：`usage` 事件带 `model` 字段（`usage-attribution.ts:1-8` 修的就是「166 条 usage 一条都没有模型名」这个洞），可按 agent 归因、按桶计价；`cost-per-progress.ts` 算「每前进一份花多少钱」，并强制分子分母同面；`scripts/replay/*` 12 把复跑尺（含 `prompt-fixed-cost.ts` 每请求固定面开销）。
- **缺口**：**IDE / CI/CD / PR 集成 = 0**（全仓无 github/PR/CI 相关代码）；`requestMetering`（逐请求字节/sha/耗时）默认关；主树没有 `pnpm bench` 这样「一键出成功率/token/耗时」的常驻度量台（port2 才有）。

### 能力 10 · 评估与持续迭代 — 部分实现（最接近骨架）

- **靶场（gym）**：`fixtures/gym/` 有 4 个 case（`config-default`/`order-pricing-triple-fix`/`sum-clamp`/`todo-completed-count`）+ `index.json` + `baseline.json`（scripted 基线：成功率 1、1416 token），`gym-run.ts` 支持跑 case、对比基线、fork/resume；case 与 index 进 `frozen-sha256.json`，改 case = 改判据 = 作弊的漂移守卫。
- **外部基准的数据层**：`src/agent/eval/task-set.ts:117-119` 的 `fromSweBenchJsonl` 把 SWE-bench 形态 JSONL 读成统一 `TaskSpec`，规矩是「要么收进 tasks，要么进 errors 并点名行号」，并且**把「缺仓库快照/缺凭据」与「跑出来是红的」分成两种读数**（前者是「没有尺」，后者才是失败）。
- **闭环评测脚本**：`scripts/loop-eval.ts` 把**生产那条会话装配**接真模型，跑「感知→规划→执行→验证→修正」，读数一律并列「准确率」与 `$/成功任务`，跑完还比对判卷面是否被越界改动。
- **从失败轨迹学习**：`scripts/replay/` 12 把尺（`stagnation-burn` 停滞烧钱、`verify-cause-mix` 红因分布、`run-scorecard` 记分卡、`prune-promise`、`cascade-traffic`…）+ `fixtures/no-progress/` 的真实录制语料 + 变异测试针脚（`mutate-verify`／`mutate-needles-check`，PROGRESS 第 259 页自报「针脚体检 1118 条」）——**离线从轨迹里读数**这条是真的；**在线学习**只有 bandit（默认关）。
- **关键缺口（业主最该知道的一条）**：**没有一次真模型的外部基准读数**。PROGRESS 第 258 页原文：「能力 10 凭据确实不在：环境三 env 全 absent，loop-eval 无法对真模型跑——**不造假读数**，保持「没有尺」登记」。gym 现有的 `baseline.json` 是 `"model": "scripted"`（脚本模型）的基线，不是能力读数。
- 另外：本仓的「持续迭代」主力其实是自己的 31 道门 + 258 个测试文件 + 变异测试，**不是 SWE-bench 分数**——工程质量很高，但那量的是 harness 自己，不是它在外部基准上的水平。

---

## 二、业主特别点名的 7 项

### ① 用户自定义子智能体 — **部分实现（有正式路径，但不是你想的那两条）**

文件：`src/agent/roles/user-agents.ts`（119 行）。

| 问题 | 答案 | 证据 |
|---|---|---|
| 支持什么？ | 读 home 下两个目录的 `*.md`，解析 frontmatter + 正文，产出 `{name, description, path, frontmatter, body}` 角色 | `user-agents.ts:22-46, 53-92` |
| 支持 `~/.claude/agents/*.md` 吗？ | **支持**，作为「Claude Code 兼容目录」，优先级 1 | `user-agents.ts:31-34` |
| 支持项目级 `.agent/agents/` 吗？ | **不支持**，而且是**刻意不做** | `user-agents.ts:8-11`：「项目目录会随仓库带来，一份 `agents/x.md` 就能决定 worker 的工具面与提示词 ⇒ 它需要一次信任设计（与散装 skill 同一类问题），没设计之前不开这个口」 |
| 为什么？ | 用户自己的 home 没有这个问题——**放文件的人就是授权的人**；项目级随仓库克隆而来，等于免审批注入提示词与工具面 | 同上 |
| 装载期的坏情况出声吗？ | 出声：软链跳过、非普通文件跳过、空文件跳过、读失败跳过、同名冲突保留高优先级并点名被盖的那条 | `user-agents.ts:64-81, 104-108` |
| 接通到消费端了吗？ | 接通，且与插件角色**共用同一条查找面与路由清单**：`user:<name>` 可直接用于 `spawn_agent(role=…)` 与 `pipeline.stages[].role` | `plugins/index.ts:192-195, 386-401, 407-413`；`orchestrator.ts:1541-1561`；装配 `agent-runner.ts:306` |
| 模型怎么知道有哪些角色？ | 角色行进系统提示的渐进披露路由清单（同一份 1536 预算，与 skill 共用） | `plugins/index.ts:407-413` |
| 测过吗？ | `tests/user-agent-roles.test.ts` 11 条：两来源都读、同名冲突、目录缺席零警告、非 .md 跳过、软链不跟随、发现面与查找面同集合、警告进快照（本次实跑 11/11 绿） | — |

**一句话**：`~/.dsh/agents/*.md` 与 `~/.claude/agents/*.md` 是**真路径**，模型能在路由清单里看见、能直接 spawn；项目级 `.agent/agents/` 是**被明确拒绝的边界**，理由（信任设计）写在文件头。

### ② skill / MCP / 插件 — **已实现（真接通，不是只装载）**

`src/agent/plugins/` 10 个文件共 3092 行，**每一条激活面都有生产消费点**：

| 面 | 装载 | 消费（生产代码） |
|---|---|---|
| skill | `discover.ts` 三级作用域 + 散装 skill + 信任门 | `triggerSkill()` 全文进上下文（`index.ts:432-453`）、压缩后 `remountFromEvents()` 重挂（`:456-471`）、渐进披露路由清单进 system（`:407-413`）；用户侧 `/skill` 触发面 `agent-runner.ts:1483-1495` |
| prompt command | `commands/*.md` | `expandPromptCommand` 在 **UserPromptSubmit hook 之前**换正文（`agent-runner.ts:1475-1479`） |
| MCP | `mcp.ts` 真连（@modelcontextprotocol/sdk） | `rt.connectMcp()` 只连受信插件（`agent-runner.ts:1465`），工具以 scoped 名进模型面与执行面（`pluginToolSpecsFromRuntime` `agent-runner.ts:727-731`） |
| hooks | `hooks.ts`（SessionStart/UserPromptSubmit/PreToolUse/PostToolUse/PostToolUseFailure/PreCompact/SessionEnd/Subagent*） | 主会话 `agent-runner.ts:1500-1517`、loop 里 PreToolUse 阻断 + PostToolUse 回注（`loop.ts:374-397, 467-483`）、worker 走同一引擎按档降权（`agent-runner.ts:309`） |
| LSP | `.lsp.json` | `rt.activateLsp()` 真注册进 LSP 运行时（`index.ts:312-335`），面板分别报「声明数」与「已注册数」 |
| agent 角色 | `agents/*.md` | 见 ① |
| 信任 | `trust.ts` 内容指纹 + bounded 位 | 未信任只列出不激活；`trustDecide` 按指纹重建激活面（`index.ts:272-288`） |

**边界（诚实说）**：项目级插件目录要 `M2E_USER_PLUGINS` 才生效（`agent-runner.ts:2275`）；散装 skill 同样过信任门（description 直进 system prompt = 注入面）。判卷有 `plugins-check`、`plugins-hooks`、`plugins-mcp`、`plugins-skills`、`plugin-lsp-activation`、`plugin-commands-dispatch`、`plugin-role-discoverability`、`trust-fingerprint` 等 8+ 个测试文件。

### ③ goal 模式 — **已实现（真接线、真测过、边界清楚）**

- **入口**：IPC `agent:goal-set`（`agent-runner.ts:1983-2026`）/ CLI `--goal --max-turns --max-usd`（`cli.ts:550-552, 679-690`）。
- **判据**：`goalStopDecision`（`goal.ts:105`）次序 = 先认绿证据 done → 轮次闸 → 美元闸 → 「没写盘也没证据」→ 续跑。**done 只认机器凭据**（worker 四态 verified/failed/stale/absent），散文自述不算数。
- **每轮提醒块**：目标 + 第几轮 + 上一轮证据态 + 预算口径 + 收束条件，整块帽 700 token（`goal.ts:22, 191-212`）；按证据态给不同的「下一步」指令，不写死一句。
- **测过吗**：5 个测试文件——`goal-stop-decision`（21 条，本次实跑绿）、`goal-continue`（**走生产入口**：`handleGoalSet` 真写 goal_set，`handleAgentRun` 真跑再自己决定续不续）、`goal-price`、`goal-trace`、`refine-goal-tool`。
- **边界**（它不能干什么，逐条都有代码理由）：
  - 轮次帽 1–25、缺省 8；超界**钳制并回条点名**，不静默改用户预算（`goal.ts:78-90`）。
  - 美元闸只量**本目标窗口**（最后一条 goal_set 之后）；worker 的钱只在终态回执入账 ⇒ 在途那一拍不计（有界滞后，明写出来）；价查不到 ⇒ 闸惰掉并明写「不生效」，绝不按 $0 继续烧。
  - **无人值守不自动续跑**（审批 fail-closed ⇒ 写不了盘验不出绿，续跑白烧钱），并把这个理由落流（`agent-runner.ts:1930-1945`）。
  - 纯问答/查代码类目标：没写盘也没证据 ⇒ 停，并告诉用户「请关掉 goal 模式」。
  - 上一轮被 max_tokens 砍断 ⇒ continue（把「被打断」和「说完了」分开）。
- **没测到的**：真模型长跑（`goal-cost-probe.ts` 需要凭据）。

### ④ plan 模式 — **已实现（状态面已 run 级隔离，模型无法自行武装）**

- **武装者只有用户**：`RunRequest.planRequired` ← `settings.planRequiredByDefault`（默认 **false**，`settings.ts:129`）；模型侧无入口。
- **唯一判据**：`planGateBlocks = (required || proposed) && !approved`（`plan-state.ts:22`），曾抄在五处，现在全仓只此一份，判卷锁「src 内不得再出现该比较式」（`tests/plan-required.test.ts`）。
- **活委托而非镜像布尔**：状态挂 `AsyncLocalStorage`（run 级隔离，并发 run 互不干扰），权限会话默认挂 `planGateLive` **函数**（`autonomy.ts:201`）⇒ worker / 级联 / 主会话读到同一份活事实，调用方忘不掉接线。
- **测过吗**：`plan-required`（11 条，本次实跑绿）+ `plan-gate` + `permissions` + `cli-surface`。
- **边界**：非交互下方案门 fail-closed 拒绝（写禁不解除，模型可修订重提）；写禁只由 `propose_plan` 落下、只由批准解除；`propose_plan` 的 gate 留痕不走 gate 包装 ⇒ 退出码口径由 `plan_approved{approved:false}` 单独计数（这条正是 port2 修的）。
- **与 goal 模式交界的边界（值得单说）**：plan 态是 **run 级** 的——`enterPlanRunScope(opts.planRequired === true)` 在每次 `runAgent` 入口重建作用域（`agent-runner.ts:1402`），而 goal 的每一轮续跑都是**新的一次 run**（`agent-runner.ts:1847-1890` 的循环）。所以**模型自愿提出、但没人批的方案，其写禁不会带进下一轮 goal 续跑**；只有用户武装的 `planRequired`（settings 默认 false）才使写禁逐轮成立。这是「run 级隔离」换来的代价，`tests/plan-required` 锁的是同一 run 内的口径一致。

### ⑤ 防降智 — **六个机制，四个真接线、两个只有判据**

| 模块 | 防的是什么 | 接线状态 | 证据 |
|---|---|---|---|
| `stuck.ts` | 同一动作+同一观察连续 N 轮（或同动作连续 N 轮全错）——模型原地打转 | **真接线**：worker 命中 → `waiting_input` 暂停等人（`orchestrator.ts:1764-1788`）；主会话命中 → 只在那条 tool_result 尾部加一行换路提示，**不动终止语义**（`loop.ts:453-466`，`stuckNudge:true` 只有人直用的主会话开） | `stuck.ts:36-40` |
| `no-progress.ts` | R1 验证停滞（连续红 verify 且 signature 全同、中间没写过盘）+ R3 A/B 往返抖动，合成一只干预阶梯 | **未接线**：`grep -rn "no-progress" src/` 只命中注释；全仓唯一消费者是 `scripts/no-progress-check.ts` 与 `fixtures/no-progress/` 语料。判据本身很扎实（有真实录制语料、绿跑零误报才允许 escalate），但**运行时没有一处会调它** —— 这是本次核查最该点名的一格 | `no-progress.ts:114-244`；`scripts/gate-manifest.ts:49` |
| `recovery.ts` | 进程崩溃后「派出去的 worker 没有终态」——活丢了没人知道 | **真接线**：`applyCrashRecovery` 扫无终态 worker → 补发 failed(interrupted) → 恢复卡可重派（全新 agent_id 按原 spawn 参数）；父档位只采信本条会话历史上真用过的档（`recoveryParentMode`），不读全局 settings（读错会把只读会话重派成 auto） | `recovery.ts:28-76`；`session-handlers.ts:78-97`；`agent-runner.ts:110` |
| `supervisor.ts` | 环（stage）失控：无限 spawn、重复同 (role, task) 死循环、畸形输出 | **真接线**：`spawn_agent(mode="supervise")` 走纯规则决策（不调 LLM），动作空间封闭五值 spawn/retry/accept/escalate/abort；有界三重保险 = maxStages 6 + 预算闸 + 同 (role,task-hash) ≥3 次强制 escalate；环裁决**有机器凭据就只认凭据**，`stale` 不回落到散文 | `supervisor.ts:11-107`；`orchestrator.ts:48, 348` |
| `model-surface.ts` | 工具面/系统块把每请求固定成本撑爆，以及**降配时把前缀缓存打掉**（中间摘工具 = 之后全重写，写价 1.25×） | **真接线**：`planSurfaceBudget` 在每条装配路径的汇合点（真 provider 的流函数）跑——池子帽 24000 字符，先降描述（600 字符）再从**尾部**整条丢，**core 永不被自动砍**（走到那步报 unresolvable 交人），砍了谁一定点名给模型看 | `model-surface.ts:17-145`；`glm-session.ts:757-772` |
| `prefix-churn.ts` | 历史层不纯追加、易变块牵连可缓存前缀、工具面自己变了不说、超限降配结果抖动——都是**把省下的字节又花回去** | **半接线**：运行时只用了 `serializeLayer`（给压缩后的「头部存活率」记账，`glm-session.ts:865-873`）与 `lcpChars`；PC1–PC6 六条判据的**唯一消费者是 `scripts/prefix-churn-check.ts`**（进 GATES），也就是说「抖了却没人说自己抖过」这件事在运行时不会被拦，只在门里被量 | `prefix-churn.ts:96-141`；`scripts/prefix-churn-check.ts:29-40` |

**一句话总结防降智**：真正在跑的是「原地打转 → 提示/暂停」「崩溃 → 重派」「环失控 → 纯规则裁决」「工具面膨胀 + 缓存前缀 → 降配梯」；「验证停滞/往返抖动」和「前缀抖动归因」这两族**判据写得很好、门也在跑，但运行时没有消费者**——是「有尺没接线」，不是「没有」。

### ⑥ 省钱省 token — **部分实现：省法很多，闸与尺一半默认关**

**默认开着的（`settings.ts:90-130`）**：
- `promptCache: true` —— Anthropic 显式 `cache_control` 打在静态段（末个 tool + system 首块）。
- `impactAnalysis: true` —— 每写一次多扫一遍跨文件调用点（花 CPU 换少返工；注释写明这是三个「省钱/少返工」开关里**唯一**被翻默认的一个）。
- `autoVerify: true` —— 收束前补一拍 lint/test（花时间换「别把说了当验了」）。
- `autoMemory: true` —— 会话末沉淀。

**默认关着的（改花钱行为，要手开）**：
- `maxBudgetUsd: 0`（总闸关）、`budgetPricePerMTok: 0`。
- `routingBandit: false`、`routingCascade: false`（每轮换模型 / 升档重跑）。
- `actionFusion: false`（把「读→改→验」融成一拍，注释说要等准确率与 `$/成功任务` 的对照数）。
- `requestMetering / observationPack / evidenceReceipts / economicCompaction` 全 false。

**计量与可观测量**：`usage` 事件带 model 字段（否则 `$ / 成功任务` 恒不可测）、按 agent 归因、按桶计价；`cost-per-progress` 报「每前进一份花多少钱」并强制分子分母同面；`goal` 的美元闸；31 道门里的 `cost-per-progress-check` / `model-surface-check` / `prefix-churn-check`。

**真正的缺口**：
- **没有常驻的「每轮固定开销」尺**。主树里只有 `scripts/replay/prompt-fixed-cost.ts`（复跑面尺），没有 `pnpm prompt-cost` 这样随手可跑的一条。port2 才补上（并实测出 2286 → 1746 tok/轮的固定开销优化）。
- **没有统一成本面板/预算告警**（core-only 无 UI；`maxBudgetUsd` 只拦编排扩张，主 loop 不受闸）。
- **缓存命中率只在 port2 被真正优化过**；主树蒸馏轮前缀与主会话分叉。

### ⑦ 多 agent 并行的 CPU / 内存占用 + 架构简单清晰

- **并行上限是硬的**：`MAX_CONCURRENT_WORKERS = 4`（`orchestrator-config.ts:5`），best-of-N 上限 3（留 1 给审查环），定时任务并发 ≤2 且与 worker 计数独立——多开 agent 不会无限繁殖。
- **CPU/内存的省法**：写 worker 用 `git worktree` + `node_modules` 软链，**不重复装依赖**；符号图 tags 缓存按 {mtime,size} 命中，版本变化才重解析；图形/地图/影响面全部「不写用户仓库、只写应用数据目录」。
- **实测读数（主树已有的）**：`gate-manifest.ts:152-184` 记录了一批门的实测耗时与认证预算（<1.5s 才进 CERT_GATES）；`head-cert-check` 实测 123.7s 是重的一笔，所以不进常跑面。**CPU/内存的常驻采样在主树没有**——port2 才把「CPU/内存占用」变成落盘读数（见第三节）。
- **架构简单清晰**：事件溯源单一事实源（append-only JSONL，可重放/分叉）；`src/` 只有 7 个目录（agent/events/main/permissions/providers/routing/tools）+ 4 个顶层文件；没有构建步骤（tsx 直接跑）；生产依赖只有 6 个（MCP SDK、ripgrep、croner、tree-sitter-wasms、vscode-languageserver-protocol、web-tree-sitter）；判据一律抽纯函数、能被离线判卷（goal/plan/no-progress/model-surface/prefix-churn 全是纯函数）。
- **要注意的一处复杂度**：`agent-runner.ts` 2533 行 + `orchestrator.ts` 2564 行，两个巨型装配/编排文件承接了大量「口径唯一」的职责——可读性靠注释密度撑着，新人上手成本高。

---

## 三、`port2` 分支（**未并入主树**，截至本次审计）

- **状态**：`port2` 相对 `zcode`(bd5ec44) 有 **15 笔未合并提交**（14 笔改动 + 1 笔交接说明），基点 `6022571`。`git branch --contains port2` 只列出 `port2` 自己 ⇒ **确实没进主树**。
- **交接文档**：`outputs/port2-merge-handoff-2026-10-01.md`（并行会话写的，声称在 `bd5ec44` 上实测 0 冲突、typecheck 0 报错、260 文件/3397 条全绿、`pnpm bench` 3/3）。**我没复现这些读数**（那要动工作树，本次只读）。
- **内容按影响排序**（我逐笔看过 diff，不是照抄交接文档）：
  1. **方案门在 `--mode auto` 下锁死任务**（最要紧）：`promptForPlan` 过去在非交互时**不看档位**无条件拒，于是显式 `--mode auto` 的会话里模型一提方案就被拒、写禁不解除、连读工具都进不去。抽成纯函数 `planDecisionFor({mode, ask})`（auto→批准 / 交互→问人 / 管道非 auto→拒绝），`src/cli.ts` +114 行，新增 `tests/cli-plan-auto.test.ts`。
  2. **退出码把失败报成成功**：写盘被门拒掉时退出码仍是 0。新增纯函数 `runFailed(五个计数器)`，全部取自事件流（门拒绝/plan 被拒/error/verify 红/普通工具失败），会按 `X-` 前缀排除会话末记账轮。新增 `tests/cli-exit-code.test.ts`。
  3. **流内 5xx 打死整轮**：对端把 5xx 塞进 SSE 体（HTTP 200 + error 帧）时旧 `establishStream` 管不着。`src/providers/openai.ts` +277/-… 加流内重试，安全边界是**吐过输出就不再重放**。
  4. **verify 假红**：harness 把靶子的 `pnpm test` 无条件换成自己的 vitest ⇒ 项目自称全过、verify 报红且报原始命令（模型无法归因）。改成按工作区自己声明的 `scripts.test` 判。
  5. **省 token**：能力没开的工具不再挂说明书（`OPTIONAL_TOOL_NAMES`，固定开销 2286 → 1746 tok/轮）；**子代理三件套做成用户开关** `settings.subagentTools`（缺省开，关掉省 857 tok/轮，新增 `tests/optional-tool-surface.test.ts`）。
  6. **小窗口模型开箱即坏**：输出预留跟着窗口缩（`src/agent/compaction.ts` +22）。
  7. **沉淀轮的两处**：给 session provider 开临时 user 通道（`ephemeralUserTurn`，修「真 provider 以事件日志为唯一事实源、忽略 messages 入参 ⇒ 沉淀指令到不了模型」）；沉淀轮与主会话同前缀（缓存命中 2.2% → 98.8%，`src/agent/memory/distill.ts` +28）。
  8. **观测**：新增 `scripts/prompt-cost.ts`（每轮固定开销的尺）、`scripts/session-cost.ts`（会话有效代价的尺）；`scripts/loop-eval.ts` 加资源采样与凭据回退；新增 `fixtures/bench/**`（3 条自包含基准任务，`node --test` 判卷、不联网）+ `pnpm bench` / `pnpm prompt-cost`。
- **分支自己声明的局限**（交接文档第六节，值得原样转述）：成功率**没有提升的证据**（单次跑的方差比改动幅度大，只声称「没有退化」）；「≤1300 tok 且能力无损」不成立；`pnpm bench` 的 3 条任务只够冒烟。
- **注意方向**：`git diff zcode port2` 里会看到 `scripts/evidence-typecheck-check.ts`、`scripts/mutate-verify.mjs`、`tsconfig.evidence.json` 等呈「删除」——那是 port2 基点早于主树这些新门，**不是** port2 把它们删了，合并时是主树侧保留。
- **对本报告的影响**：本报告所有判定**都是主树当前状态**；上面第 1/2/3/4/7 条在合并后会明显改善能力 5、8、9 与「省钱」这几格。

---

## 四、核查方法与边界（我做了什么、没做什么）

**做了**：
- 通读 `src/agent/`（全部 158 个 src 文件的模块头 + 关键实现）、`src/tools/`、`src/permissions/`、`src/routing/`、`src/main/` 的装配链。
- 对每个「点名模块」做**双向核对**：模块自己写了什么 + 谁 import 它 + 谁在产线路径上调用它（`grep -rn` 逐条核消费点，不靠注释与文档）。`no-progress.ts` 与 `scheduler.ts` 的「写好没消费」就是这么查出来的。
- 只读 git：`git status` / `git log` / `git diff zcode port2` / `git branch --contains`（未做任何写操作）。
- 单文件测试 4 个共 68 条全绿；数了 GATES(31) / 测试文件(258) / src 行数(36,177)。

**没做（因此本报告在这些地方不下结论）**：
- 未跑全量测试、未跑门禁、未跑 typecheck（另有一处在跑，且工作树有别人的 2 处改动）。
- 未在真模型上跑任何东西（本会话无凭据，也就无法给能力 10 任何真实读数）。
- 未验证 port2 的验证读数（交接文档的 0 冲突 / 3397 条全绿 / bench 3/3 均为**其自述**，我未复现）。
- 未评估桌面层能力（本树 core-only，UI、IDE 集成、成本面板一类**结构性不在**，不是「忘了做」）。
