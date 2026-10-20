# 声称 vs 现实：对账报告（README / AGENTS / 工具面 / 模块可达性）

- **审计人**：claims-auditor（team task-3）
- **对象**：`/Users/ze/Downloads/deepseek harness`（TypeScript 事件溯源 agent harness，包名 `m0-agent-loop`，CLI `m0`，core-only）
- **时间**：2026-09-29
- **只读声明**：本次审计**未改动工作树任何文件**。所有分析脚本与探针写在 `/tmp/reach-audit/`；只用了 read/grep/只读命令，外加 4 个单测文件与 2 个门脚本（`typecheck`、`tools-check`）的实跑。
- **基线**：工作树 = HEAD（`src/*.ts` 34363 行）+ 别处在飞的改动（`git status` 共 37 条：33 个已修改 + 4 个未跟踪目录）= `src/*.ts` **35000 行 / 152 文件**。README/AGENTS 都在已修改文件里，但下文两条关键声称（33k 行、deepseek 0 次）在 HEAD 版本里逐字相同，不是这次改动引入的。

---

## 一、总结论（先看这张）

必查 10 项拆成 11 行：**✅ 一致 9 行，❌ 不符 2 行，⚠️ 夸大 0 行**（另有 7 条"字面为真但会误导"的表述，见第三节）。
模块可达性一句话：**`src/agent/` 79 个模块里，68 个在 `src/cli.ts` 的值导入闭包内，11 个不在；再把"在依赖图里但 CLI 没有任何出口"的算上，CLI 用户实际拿不到的比例明显大于 11/79。**

| # | 声称 | 现实 | 证据（file:line / 命令） | 判定 |
|---|---|---|---|---|
| 1 | README:221 "33k 行 `src/`" | 工作树 **35000 行**（152 个 .ts）；HEAD **34363 行** | `find src -name '*.ts' -print0 \| xargs -0 wc -l \| tail -1` → `35000`；HEAD 逐文件 `git show` 求和 → `34363` | ❌ 不符（低报约 1.4k–2k 行） |
| 2 | README:221 "strict 零报错" | tsc --noEmit 0 报错 | `node --import tsx scripts/typecheck.ts` → `typecheck: tsc --noEmit 通过（0 条报错）✅`，exit 0 | ✅ 一致 |
| 3a | README:185 "静态注册表 9 个（`src/tools/index.ts`），`tools-check` 钉着这个数" | 恰好 9 个，且被断言钉住 | `src/tools/index.ts:16-26`（read_file/write_file/edit_file/run_shell/grep/glob/lsp/clarify/propose_plan）；`scripts/tools-check.ts:55`；实跑 `node --import tsx scripts/tools-check.ts` → `✅ 注册表含 9 个工具 — 实际 9`，exit 0 | ✅ 一致 |
| 3b | README:190-192 运行时注入 `remember` / `spawn_agent` / `wait_for_agents` / `cancel_agents` / `refine_goal`（"CLI 上真能派 worker"） | CLI 路径上五个都真注入；模型面 15 件、执行面 14 件 | 注入点 `src/main/agent-runner.ts:904-971`（installAppTools），唯一调用者 `runAgent`（agent-runner.ts:1331）；CLI 走 `handleAgentRun`（cli.ts:697）；编排器每场 run 都建（agent-runner.ts:1414-1426）。探针实测：执行面 = 9 静态 + 这 5 件；规格面 = 15（另含 verify） | ✅ 一致 |
| 4 | README:202-205 "CLI 上没有 `automation_*` 那五个…规格面与执行面一起摘；调度器与 `Scheduler` 类本身原样保留" | CLI 两面实测 0 个 `automation_*`；`scheduler.ts` 1016 行仍在、被 import，但**全树零调用者** | `src/cli.ts:728 automationTools: false`；规格面过滤 `agent-runner.ts:672-675`；执行面跳过 `agent-runner.ts:972-977`。探针：`sessionToolFace(...,{automationTools:false})` → `automation_*` 0 个；`installAppTools({automation:false})` → TOOLS 里 0 个。`src/main/scheduler.ts` 1016 行；`initScheduler/startScheduler/stopScheduler/getScheduler` 在 `src/`、`tests/`、`scripts/` 中调用者均为 **0** | ✅ 一致（附注见第三节 #4：Scheduler 是"保留"也是"死代码"） |
| 5 | README:112-121 权限四档 `read-only/default/guided/auto`，默认 fail-closed，`auto` 必须显式 | 四档唯一事实源；缺省 `default`；非交互 ask→deny；无任何产品代码把档位自动改成 auto | `src/permissions/modes.ts:8`；缺省档 `src/main/settings.ts:96 mode:"default"`、`src/cli.ts:107 pick("--mode") ?? "default"`；裁决表 `Record<PermissionMode,Decision>` `src/permissions/index.ts:15-21`；非交互降级 `index.ts:118-123`；CLI 交互判据 `cli.ts:599-600`（stdin 非 TTY ⇒ unattended）。`"auto"` 在产品代码里只作字面值出现，唯一硬编码用例在 `src/agent/gym/runner.ts:79,162,193`（gym 实验） | ✅ 一致 |
| 6 | README:135 `run_shell` 在 macOS 走 Seatbelt：写收敛工作区、`.ssh`/`.aws` 拒读、默认断网 | 三条全部实测成立 | 实现 `src/main/sandbox.ts:44-64`（profile）、`:116-159`（runInSandbox）；接线 `cli.ts:589 initSandbox` + `agent-runner.ts:544-562`。**行为探针**（/tmp，真起 sandbox-exec）：① 工作区内写 `ok=true` 且文件真存在；② 工作区外写 `EPERM`、文件不存在；③ `cat ~/.ssh/known_hosts` → `Operation not permitted`；④ `curl https://example.com` → `NET_BLOCKED`；⑤ 显式 `network:"allow"` → `NET_OK`（一次性放行支有效）；⑥ `checkSandbox()` = `{"available":true}` | ✅ 一致 |
| 7 | README:3/140-160/226 append-only JSONL + 重放 / 分叉 | `replay` 与 `forkSession` 都真实存在且被测；fork 对 CLI 用户无出口 | `src/events/index.ts` 925 行：`replay` :742、`replayIncremental` :804、`forkSession` :912。实跑 `tests/fork.test.ts` 3/3 通过（前缀一致、原文件 sha256 不变、非法 eventId 拒绝）。`forkSession` 的 src 内唯一调用者是 `src/agent/gym/runner.ts:181`；CLI 帮助文本无 fork/replay 命令（`cli.ts:533-565`） | ✅ 一致（能力真；**fork 不在 CLI 面上**，见第二节） |
| 8 | README:164-179 设置默认：`impactAnalysis` 开 / `promptCache` 开 / `autoVerify` 开 / `routingBandit` 关 / `maxBudgetUsd` 关 | 五项逐字对上，且都有消费点 | `src/main/settings.ts`：`maxBudgetUsd: 0` :101、`routingBandit: false` :107、`promptCache: true` :113、`impactAnalysis: true` :122、`autoVerify: true` :127；0=关的语义见 `agent-runner.ts:295`（`>0` 才装闸）与 `orchestrator-types.ts:235`；消费点 `agent-runner.ts:297/307/317/1506-1514`；实跑 `tests/settings.test.ts` 17/17 通过 | ✅ 一致 |
| 9a | README:69-79 provider 表 glm/openai/anthropic/gemini + 四个环境变量 | 表与代码逐字一致 | `src/providers/env-keys.ts:7-12`（M0_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY / GEMINI_API_KEY）；`registry.ts:22 PROVIDER_IDS`；`cli.ts:261-262` 无 key ⇒ ConfigError（经 `cli.ts:140` 在 `parseArgs` 内抛出，由 `main` 的 catch `cli.ts:571-577` 映射为 exit 2）；`openai.ts:106-111,128` 的 `/chat/completions` 自动补齐与 `OPENAI_BASE_URL` 可配 | ✅ 一致 |
| 9b | README:80（及 `src/cli.ts:16`）"`src/` 里 deepseek 出现 0 次" | 实际出现 **5 次**，分布在 `src/cli.ts` 两行 | `grep -roi deepseek src/ \| wc -l` → `5`；`grep -ril deepseek src/` → `src/cli.ts`；行号 `src/cli.ts:16`（正是写下这句断言的注释本身）、`src/cli.ts:264`（帮助文本） | ❌ 不符（自我否证） |
| 10 | "28 道门"（PROGRESS 尾页与验收口径），且孤儿护栏真覆盖 package.json scripts | GATES 恰好 28 条；护栏按词根扫描 package.json scripts 并在真表上判 0 违例 | `scripts/gate-manifest.ts:13-49` 共 28 项（typecheck…mutate-needles-check）；护栏 `:54 ACCEPTANCE_SHAPE = /check/i`、`:81-98 checkGateManifest`；`tests/gate-manifest.test.ts:41 expect(checkGateManifest(pkg.scripts)).toEqual([])`，实跑 9/9 通过；PROGRESS 尾页自述"门表：28 道" | ✅ 一致 |

补充跨条证据：`tests/` 下 241 个测试文件（与 PROGRESS 尾页 "Test Files 241 passed" 相符）；`outputs/` **207** 个条目（与简报一致）；`PROGRESS.md` 5705 行 / 766KB（"数百页"是叙述体，不是真实分页）。本轮实跑 4 个单测文件共 34 条全绿，外加 `tools-check`、`typecheck` 两个门脚本 exit 0；**未跑全量 `pnpm test`**（按要求，另有一处在跑）。

---

## 二、模块可达性：CLI 用户到底拿到 35k 行里的多少

**方法**：以 `src/cli.ts` 为根，对 `src/` 全部 152 个 .ts 建**值导入**闭包（处理 NodeNext 的 `./x.js` → `x.ts` 映射；类型导入单列）。工具是 `/tmp/reach-audit/graph2.mjs`（只读）。**注意**：「在闭包内」= 该模块随 CLI 一起被加载/编译，不等于每次运行都执行到；带 ⚙️/⚠️ 的行是我逐点核实过调用点的。

### 2.1 大盘数字

| 口径 | 数量 |
|---|---|
| `src/` 全部 .ts | 152 |
| 在 `cli.ts` 值导入闭包内 | **139** |
| 不在闭包内 | **13**（11 个在 `src/agent/`，1 个 `src/main/ipc-protocol.ts` 仅类型引用，1 个 `src/providers/byok.ts` 零引用） |
| `src/agent/` 模块 | **79** |
| `src/agent/` 在闭包内 | **68** |
| `src/agent/` 不在闭包内 | **11**（其中 4 个只被同样不在闭包内的 `gym/runner.ts` 引用，7 个连 src 内都没有引用者） |

不在闭包内的 13 个文件合计 **2387 行**（占 `src/` 35000 行的 6.8%）。但"CLI 拿不到"的真账要比这大：`src/main/scheduler.ts`（1016 行）、`src/agent/sidechat.ts`（483 行）、`src/main/ipc-protocol.ts`（235 行）等都在闭包内，却没有任何 CLI 出口或实例化入口。

### 2.2 点名模块逐条判定（简报要求的部分）

| 模块 | 行数 | 状态 | 证据 |
|---|---|---|---|
| `src/main/scheduler.ts` | 1016 | **⚠️ 在依赖图内，但执行面完全没接** | `src/main/agent-runner.ts:89 import { Scheduler }`；但 `initScheduler`（agent-runner.ts:992 定义）在 `src/`、`tests/`、`scripts/` 里**零调用者**，`startScheduler/stopScheduler/getScheduler` 同样为 0。没有实例化入口 ⇒ 60s tick、补跑、并发闸一次都不会跑 |
| `src/agent/automation-surface.ts` | 79 | **✅ 主路径（只作"被摘除清单"与规格构造）** | `agent-runner.ts:32` 取 `AUTOMATION_TOOL_NAMES` 用于过滤；`glm-session.ts:16,361` 无条件 `push(automationToolSpecs())`，随后被 `sessionToolFace` 摘掉（agent-runner.ts:672-675）。实测 CLI 模型面 `automation_*` = 0 |
| `src/agent/gym/`（6 文件） | 1028 | **🧪 只被脚本/测试引用** | `gym/runner.ts` 连 src 内引用者都没有；使用者是 `scripts/gym-run.ts`、`gym-long.ts`、`gym-check.ts`、`tests/gym-*.test.ts`。且 `gym-run.ts`/`gym-draft.ts` 根本不在 package.json 里 |
| `src/agent/eval/task-set.ts` | 244 | **🧪 只被脚本引用** | 唯一使用者 `scripts/loop-eval.ts:24`，而该脚本不在 package.json scripts 里（无门、无命令） |
| `src/agent/sidechat.ts` | 483 | **⚠️ 在依赖图内，CLI 无产品出口** | 唯一 src 引用者 `agent-runner.ts:90`；调用点只有两个：`runSidechatDemo`（`:1595` 由 `M2F_SIDECHAT_DEMO=1` 门控的演示通道）与 `handleAgentState`/`handleSidechat*`（旧 Electron UI 聚合器与 IPC handler，CLI 一个都不调）。`handleSidechatCreate`/`handleSidechatPromote` 全仓零调用者 |
| `src/agent/plugins/`（10 文件） | 3092 | **✅ 主路径** | `agent-runner.ts:1431 PluginRuntime.load(...)` 在 `runAgent` 里无条件执行（零插件环境 = 空清单 = 零行为）；`:1433-1435` 连 MCP、LSP、工具注入 |
| `src/agent/map/`（4 文件） | 895 | **✅ 主路径** | `glm-session.ts:14,618` 建 mapBuilder、`:752-814` 在会话循环里用；另有 `tools/impact-query.ts` 与 agent-runner 的演示通道引用 |
| `src/agent/memory/`（3 文件） | 745 | **✅ 主路径** | `inject.ts` 经 `glm-session.ts:10` 进主循环；`store.ts` 经运行时注入的 `remember` 工具与 memory-handlers；`distill.ts` 经 `agent-runner.ts:79,1637 runSessionEndDistill`（会话尾沉淀，`autoMemory` 缺省 true） |
| `src/agent/security/`（2 文件） | 624 | **✅ 主路径** | `scan.ts` 被 loop/orchestrator/worker-report 等 7 处引用（含 `redactSecrets`）；`llm-review.ts` 经 `orchestrator.ts:59,2198`，只在真的产出 worker diff 时执行；另有 `runSecurityReportHook`（agent-runner.ts:1592，条件：`safeMode==="report"` 且有一次 verify 通过） |
| `src/routing/`（4 文件） | 511 | **⚙️ 在依赖图内，默认不激活** | `orchestrator.ts:14-17` 引用 policy/cascade/bandit/pricing；但 `agent-runner.ts:307-313` 只在 `routingBandit=true` 或 `routingCascade=true` 时才把 `routing` 交给编排器，两项缺省皆 false（settings.ts:107-108）⇒ 默认这条代码路径整段不接线 |
| `src/agent/roles/user-agents.ts` | 119 | **✅ 主路径（有插件才有效）** | 唯一引用者 `plugins/index.ts:21`；插件运行时在 runAgent 里无条件装载，但没有插件时零角色 |
| `src/agent/impact/index.ts` | 417 | **✅ 主路径** | `agent-runner.ts:1506-1514`（`impactAnalysis` 缺省 true）挂 `defaultImpactHook` 与 `impact_query` 工具；`tools/impact-query.ts` 是 worker 侧挂载点 |

### 2.3 `src/agent/` 全部 79 个模块状态表

图例：**✅** 在 CLI 值导入闭包内（随主路径加载）｜**⚙️** 在闭包内但默认关（需 settings/env）｜**⚠️** 在闭包内但 CLI 无出口/无实例化入口｜**🧪** 不在闭包内，只被脚本或测试使用｜**⛔** 连 `src/` 内都没有引用者。

| 模块 | 状态 | 说明 |
|---|---|---|
| action-fusion.ts | ⚙️ | `actionFusion` 缺省 false（settings.ts:112），仅 `opts.actionFusion === true` 时接线（agent-runner.ts:1349） |
| automation-surface.ts | ✅ | 只用于生成规格与该被摘除清单，模型面实测 0 个 |
| call-id-index.ts | ✅ | — |
| compaction-cost.ts | ✅ | — |
| compaction.ts | ✅ | 手动 `--compact` 与自动压缩都走它 |
| context.ts | ✅ | — |
| control-tags.ts | ✅ | — |
| cost-per-progress.ts | 🧪 | 使用者仅 `scripts/cost-per-progress-check.ts`（一道门）与变异锚点；产品路径无引用 |
| economics.ts | ✅ | — |
| eval/task-set.ts | 🧪 | 仅 `scripts/loop-eval.ts`（该脚本不在 package.json） |
| evidence.ts | ✅ | — |
| gates.ts | ✅ | clarify/plan 门状态机 |
| glm-session.ts | ✅ | 规格面与历史装配 |
| goal-trace.ts | ✅ | — |
| goal.ts | ✅ | `--goal` 续跑判据 |
| gym/case.ts | 🧪 | 仅 gym/runner.ts、gym/score.ts |
| gym/draft.ts | ⛔ | src 内零引用；使用者是 scripts/gym-draft.ts |
| gym/probe.ts | 🧪 | 仅 gym/runner.ts |
| gym/runner.ts | ⛔ | src 内零引用；使用者是 scripts/gym-run.ts / gym-long.ts / gym-check.ts / tests |
| gym/score.ts | 🧪 | 仅 gym/runner.ts |
| gym/script.ts | 🧪 | 仅 gym/probe.ts、gym/runner.ts |
| impact/index.ts | ✅ | 见 2.2 |
| lease-conflicts.ts | ✅ | — |
| ledger.ts | ✅ | — |
| loop.ts | ✅ | 主事件循环 |
| map/build.ts | ✅ | — |
| map/parse.ts | ✅ | — |
| map/rank.ts | ✅ | — |
| map/render.ts | ✅ | — |
| memory/distill.ts | ✅ | 会话尾沉淀 |
| memory/inject.ts | ✅ | — |
| memory/store.ts | ✅ | — |
| metering.ts | ✅ | — |
| model-surface.ts | ✅ | — |
| no-progress.ts | 🧪 | 使用者仅 `scripts/no-progress-check.ts`（门）与注释；产品路径无引用 |
| orchestrator-config.ts | ✅ | worker 工具禁入名单 |
| orchestrator-join.ts | ✅ | — |
| orchestrator-types.ts | ✅ | — |
| orchestrator.ts | ✅ | 每场 run 建会话级编排器（agent-runner.ts:1414） |
| plugins/discover.ts | ✅ | — |
| plugins/frontmatter.ts | ✅ | — |
| plugins/hooks.ts | ✅ | — |
| plugins/index.ts | ✅ | `PluginRuntime.load` 在 runAgent 内无条件执行 |
| plugins/manifest.ts | ✅ | — |
| plugins/mcp.ts | ✅ | — |
| plugins/secrets.ts | ✅ | — |
| plugins/skills.ts | ✅ | — |
| plugins/trust.ts | ✅ | — |
| plugins/types.ts | ✅ | — |
| prefix-churn.ts | ✅ | — |
| prune-batching.ts | ✅ | — |
| prune.ts | ✅ | — |
| recall-path.ts | ✅ | — |
| recovery.ts | ✅ | — |
| reproducibility.ts | 🧪 | 使用者仅 `scripts/gym-check.ts`（门） |
| roles/user-agents.ts | ✅ | 随插件运行时 |
| security/llm-review.ts | ✅ | worker diff 审查路径 |
| security/scan.ts | ✅ | 脱敏/安全报告，7 处引用 |
| sequencer.ts | ✅ | — |
| shape.ts | ✅ | — |
| sidechat.ts | ⚠️ | 仅 `M2F_SIDECHAT_DEMO=1` 演示通道 + 已无产品调用者的 UI 聚合器 |
| solpi-runtime.ts | ⚙️ | `solpiEnabled` 需四个开关任一为真，四项缺省全 false（settings.ts:114-117） |
| spawn-surface.ts | ✅ | — |
| stuck.ts | ✅ | — |
| supervise-contract.ts | ✅ | — |
| supervisor.ts | ✅ | supervisor 模式的 worker 路径 |
| text-budget.ts | ✅ | — |
| tool-choice.ts | 🧪 | 使用者 `scripts/tool-choice.ts`、`scripts/ga-strategy.ts`、若干测试；该 script 不在 GATES 且名不含 check ⇒ 孤儿护栏不覆盖 |
| tool-surface.ts | ✅ | 注入工具对账清单，与 `tests/tool-surface-parity.test.ts` 共读 |
| usage-attribution.ts | ✅ | — |
| verify.ts | ✅ | 验证门钩子 |
| worker-model.ts | ✅ | — |
| worker-projection.ts | ✅ | — |
| worker-prompt.ts | ✅ | — |
| worker-report.ts | ✅ | — |
| worker-shell-tools.ts | ✅ | — |
| worker-tool-table.ts | ✅ | — |
| worktree.ts | ✅ | 经 `orchestrator.ts:67` 进 worker worktree 路径（`scanOrphanWorktrees` 本身只被已死的 `handleAgentState` 调用） |
| write-face.ts | ✅ | — |

### 2.4 闭包外/半死清单（`src/` 层面）

| 文件 | 行数 | 状态 |
|---|---|---|
| `src/agent/gym/*.ts` (6) | 1028 | 🧪 靶场/基准，脚本与测试专用 |
| `src/agent/eval/task-set.ts` | 244 | 🧪 仅 `scripts/loop-eval.ts` |
| `src/agent/cost-per-progress.ts` | 151 | 🧪 仅门脚本 |
| `src/agent/no-progress.ts` | 248 | 🧪 仅门脚本 |
| `src/agent/reproducibility.ts` | 152 | 🧪 仅 `scripts/gym-check.ts` |
| `src/agent/tool-choice.ts` | 279 | 🧪 仅非门脚本与测试 |
| `src/main/ipc-protocol.ts` | 235 | ⚠️ 只被 `import type` 引用（旧 Electron IPC 形状） |
| `src/providers/byok.ts` | 50 | ⛔ 零引用（仅测试间接覆盖） |
| `src/main/scheduler.ts` | 1016 | ⚠️ 被 import、零实例化入口 |
| `src/agent/sidechat.ts` | 483 | ⚠️ 只有演示通道出口 |

另有一类"导出但没人调"的死点（逐个 grep 调用语法确认，非注释命中）：
`initScheduler` / `startScheduler` / `stopScheduler` / `getScheduler` / `handleScheduleUpsert` / `handleScheduleDelete` / `handleScheduleRunNow` / `handleSidechatCreate` / `handleSidechatPromote` / `handlePluginDecide` 在 `src/`、`tests/`、`scripts/` 中**调用者均为 0**；`handleAgentState`、`handleCardAction` 只被测试调用（`agent-runner.ts` 共 51 个导出，CLI 只 import 9 个）。

---

## 三、夸大或误导的表述

1. **❌ "`src/` 里 deepseek 出现 0 次"**（README.md:80，同一句也写在 `src/cli.ts:16`）——实测 5 次，全在 `src/cli.ts`。**这句话本身就在 `src/` 里，自我否证。** 实质意图（没有 deepseek 专用适配器、走 OpenAI 兼容通道）经查成立：`src/providers/` 下无 `deepseek.ts`，`openai.ts` 的 baseURL 可配。
2. **❌ "33k 行 `src/`"**（README.md:221）——工作树 35000 行、HEAD 34363 行。方向上属于**低报**，但既然是"产品面刚补上"的自我描述，数字不该偏 6%。
3. **⚠️ "`scripts/` — headless 闸（`pnpm gates` 全跑，清单在 `scripts/gate-manifest.ts`，即事实源）"**（README.md:231）——门表本身真实且 28 道被测试钉住；但 `scripts/` 目录 46 个脚本里有 **16 个从未被任何 package.json script 引用**（`gym-run.ts`、`gym-draft.ts`、`loop-eval.ts`、`assertion-health.ts`、`ga-strategy.ts`…）。孤儿护栏只扫 package.json 的 scripts 表（`:89-98`），看不见 scripts/ 目录里的孤儿文件。"全跑"只对门表内成立。
4. **⚠️ "调度器与 `Scheduler` 类本身原样保留，长驻服务时再接"**（README.md:205）——字面为真，但**不完整到会误导**：`Scheduler` 在 CLI 主路径模块里被 import，可是 `initScheduler` 在全树零调用者 ⇒ 1016 行调度器在当前这棵树里没有任何实例化入口，不是"保留待接"，是"当前不可达"。桌面层移除后，原先调它的那一层已经不在了。
5. **⚠️ "`verify` … 不在工具表里"**（README.md:196）——在"静态注册表 9 件"这个意义上为真，但实测**模型可见规格面 15 件里含 `verify`**。容易被读成"模型看不见 verify"，而事实是它可见、由 loop 特判处理。
6. **⚠️ "内核质量很高、产品面刚补上"**（README.md:221）——产品面确实补上了（CLI + 9 工具 + 沙箱 + goal），但**旧的 Electron 面残留仍占相当体量**：`src/main/ipc-protocol.ts` 235 行只作类型引用、`scheduler` 全族 1016 行零入口、`sidechat` 483 行只剩演示通道、`agent-runner` 里 10+ 个导出零调用者。这些代码都被算进"35k 行"的分母。
7. **⚠️ 陈旧注释（不影响功能，但会误导读者/审计者）**：
   - `src/cli.ts:12` 写"routingBandit / maxBudgetUsd / impactAnalysis 默认全关且无处可翻"，与 `src/main/settings.ts:122`（`impactAnalysis: true`，2026-09-27 用户裁决翻默认）冲突；
   - `src/main/onboarding-groups.ts:8` 写"`scripts/gate-manifest.ts` 的 26 道"，现状 28 道；
   - `src/cli.ts:11` 写"9 个 settings 开关"，实际 settings 字段远多于此。

**没被判为问题的近似项**（避免误伤）：`grep` 真 ripgrep、`lsp` 真起语言服务器，由 `tools-check` 实跑 36 条断言全绿间接佐证；`goal` 管道不续跑的声称与 `cli.ts:726 noAnswerer` + `agent-runner.ts:1855` 一致；AGENTS.md 的 core-only 声称成立（`package.json` 无 electron，无 `src/renderer`/`src/preload`，15 处 "electron" 全是"不依赖 electron"的注释）。

---

## 四、方法与边界（不夸大本报告自己的证据强度）

- **导入图**：自建解析器读 `src/**/*.ts` 的 `import/export ... from`、动态 `import()`、`require()`，把 `.js` 说明符映射回 `.ts`，从 `src/cli.ts` 做 BFS。它证明"模块在不在依赖图上"，**不证明运行期执行**；运行期结论只对我逐点核对并写了 file:line 的条目负责。
- **实跑过的东西**：`scripts/typecheck.ts`（exit 0）、`scripts/tools-check.ts`（exit 0）、`tests/{fork,gate-manifest,tool-surface-parity,settings}.test.ts`（34/34 绿）、两个自建只读探针（Seatbelt 行为、工具面规格/执行面）。
- **没跑的东西**：全量 `pnpm test`（按要求回避，另一处在跑）、`pnpm gates` 全表、`sandbox:check`（它会往仓库 `/.tmp/sandbox-check-ws` 写临时文件，为守住"绝不改工作树"我改用 /tmp 探针复现了它的四项断言）、`mutate-verify`。
- **未覆盖的 README 声称**：`--compact` 的 fail-closed 细节、退出码 0/1/2 的逐条触发条件、`--model` 自由档的 `--ctx-window` 缺省、`allowedTools` 硬闸的逐格行为、`propose_plan`/`clarify` 的无人应答口径——这些我只做了源码层面抽检，没有端到端实测，**不应被视为已验证**。
