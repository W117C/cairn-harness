# M0 桌面编程 Agent · Code Wiki

> 本 Wiki 是仓库的工程代码地图，覆盖整体架构、模块职责、关键类与函数、依赖关系与运行方式。
> 权威方案见 `agent-plan.md`（只读）；工程纪律见 `AGENTS.md`；里程碑验收见 `docs/m{2,3,4}-acceptance.md`。

> ⚠️ **渲染层已迁移，本 Wiki 的第 5.8 节与第 1 节「形态/样式」两行已过时**（2026-09-17 注）。
> 本 Wiki 描述的是 **vanilla 迁移之前的 React 渲染层**。今天发货的是手写 vanilla：
> `src/renderer/index.html`（单文件，全部 CSS 在一个 `<style>` 里）+ `src/renderer/app.js`（纯 ESM），
> **没有 React / Tailwind 运行时 / shadcn 运行时**。`main.tsx`、`styles.css`、`error-boundary.tsx` **已删除**。
> 当前权威现状见 `AGENTS.md` 与 `outputs/frontend-refactor-2026-09-17/`；下方正文为**存档**，未逐行改写。
> 例外：`projections.ts` 仍被 `scripts/panels-check.ts` 消费，**不是**死代码。

---

## 1. 项目概览

一个 **Electron 桌面编程 Agent**：用户在桌面 UI 里发起任务，Agent 以「事件流 → 模型 → 工具 → 事件流」的循环驱动大模型读代码、改代码、跑测试，完成编程任务。

| 项 | 值 |
|---|---|
| 包名 | `m0-agent-loop`（version 0.0.1，private） |
| 形态 | Electron 44 + TypeScript 5，electron-vite 5 构建；渲染层为**手写 vanilla**（非 React）——见顶部过时提示 |
| 样式 | `index.html` 内单块 `<style>` + CSS 自定义属性令牌（无 Tailwind 运行时、无 shadcn 运行时） |
| 工具链 | pnpm / vitest 5 / tree-sitter-wasms / @vscode/ripgrep / croner / @modelcontextprotocol/sdk |
| 核心模型 | M0a 内核（agent loop）+ M0b 桌面壳（Electron） |
| 里程碑 | M0–M2g 内核收口 → M3a/b/c 多 agent 编排 → M4a/b 商业化（定时任务、可安装包、BYOK、license、更新检查） |

### 1.1 技术栈与运行时注意

- 模块格式：`package.json type=module`，main/preload 均输出 ESM；**ESM preload 需要 `sandbox: false`**（`contextIsolation` 仍开启，renderer 拿不到 Node 能力）。
- 在 DSH 环境里，pnpm 脚本内的 `node` 解析到 DSH 的 Electron-as-node（v24.18.1），与 `/usr/local/bin/node`（v24.19.0）不同；两套运行时门禁实测都过。
- 跑验收一律 `TERM=dumb`（`TERM=xterm-256color` 会让 vitest 输出 ANSI 序列导致摘要正则假红；gates.ts 已自动注入 `TERM=dumb NO_COLOR=1`）。
- 沙箱内跑不了 `pnpm test`（pnpm 依赖检查失败），用直连 vitest 命令；`src/main/agent-runner.ts` 已自动把冻结剧本里的 `pnpm test` 映射成直连命令。

---

## 2. 总体架构

### 2.1 分层

```
┌─────────────────────────────────────────────────────────────┐
│  M0b Electron 壳                                            │
│  ┌────────────┐   IPC (contextBridge)   ┌────────────────┐  │
│  │ renderer   │ ◄──────────────────────► │ main           │  │
│  │ vanilla UI │   window.agent (preload) │ agent-runner   │  │
│  │ 侧栏/抽屉    │                          │ AskGate/沙箱/…  │  │
│  └────────────┘                          └───────┬────────┘  │
└──────────────────────────────────────────────────┼───────────┘
                                                   │ 直接调用（无 IPC）
┌──────────────────────────────────────────────────▼───────────┐
│  M0a 内核（electron-free，可脱离 UI 直跑）                      │
│  agent loop → tools → permissions → providers → events        │
│  + context/compaction/prune/map/memory/plugins/security       │
│  + orchestrator/sequencer/stuck/recovery/worktree/sidechat    │
└───────────────────────────────────────────────────────────────┘
```

- **M0a 内核**（`src/agent/`、`src/events/`、`src/tools/`、`src/permissions/`、`src/providers/`）：不依赖 Electron，单一入口 `runLoop`；既可被桌面壳调用，也可被 headless 验收脚本（e2e / 各 check）直调。
- **M0b 壳层**（`src/main/`、`src/preload/`、`src/renderer/`）：窗口、IPC 接线、审批门、Seatbelt 沙箱、会话/设置/记忆存储、定时任务、license/updater。
- **验收体系**（`scripts/`、`tests/`、`fixtures/`）：门禁清单见 `scripts/gate-manifest.ts`（**唯一事实源**）+ 测试文件见 `tests/` + 冻结判卷剧本。
  ⚠️ 本文件**不写死门数与测试文件数**——两者都在动（曾写死「23 道」而实际已 28 道；测试文件数亦随开发漂移）。

### 2.2 一次任务的数据流

```
用户输入 (renderer)
  → IPC agent:run (main index.ts) → handleAgentRun (agent-runner.ts)
  → runLoop (agent/loop.ts)
      事件流 events (append-only JSONL)
      provider.stream(projectContext(seen))  → ModelOutput 事件
      tool_call → [verify 系统门] → [allowedTools 硬闸] → [PreToolUse hook]
               → [权限门 gate()] → tool.run(args, ctx) → tool_result 落流
  → 每事件经 onEvent → IPC agent:event → renderer 流式渲染
  → 权限未决 → onAsk → agent:ask → 审批卡 → agent:decide → 继续
```

---

## 3. 目录结构总览

```
src/
├── agent/           M0a 内核：loop、context、gates、compaction、prune、verify、
│   │                glm-session、recovery、sequencer、stuck、sidechat、worktree、orchestrator
│   ├── map/         代码地图（build/parse/rank/render）
│   ├── memory/      记忆系统（store/distill/inject）
│   ├── plugins/     插件系统（discover/hooks/manifest/mcp/secrets/skills/trust）
│   └── security/    产出代码安全审查（scan 静态 + llm-review LLM 第二段）
├── events/          事件流：24 种事件类型 + append/replay/增量重放/fork
├── main/            M0b 壳：index、agent-runner、ask-gate、sessions、settings、sandbox、
│                    scheduler、automations、license、updater、provider-keys、ipc-protocol
├── preload/         contextBridge 桥（window.agent）
├── providers/       模型适配器：anthropic/gemini/glm/openai/mock + 统一接口
├── permissions/     权限系统：rules（规则库）/ risk（风险三通道）/ autonomy（四层评估）
├── renderer/        vanilla UI：index.html + app.js（发货层）；React 树 main/conversation/store/theme/onboarding + panels + cards + ui 正在归档
├── tools/           工具层：base + 9 注册工具（含 LSP/进程管理）
├── net.ts           （网络工具）
└── frozen.ts        （冻结常量）
scripts/             门禁清单与各 *-check（清单即事实源：scripts/gate-manifest.ts 的 GATES）
tests/               57 个 vitest 文件（fileParallelism:false，共享靶子目录）
fixtures/            冻结判卷区：mock/（模型剧本）、todo-app/（验收靶子）、agents/、autonomy/
                     demo/、gate/、lsp/、plugins/、providers/、security/
docs/                m{2,3,4}-acceptance.md（三态验收表）+ audit + UI 截图
```

---

## 4. 核心执行链路

### 4.1 Agent Loop（`src/agent/loop.ts`）

`runLoop(opts: LoopOptions)` 是内核唯一主入口（L53）。主循环语义：

- **统一事件源**：新形态 `provider.stream(messages, tools, {signal})` 与旧形态 `LegacyNextProvider.next()` 收敛成同一条 for-await 事件管线（`streamFromNextSource` 包装旧源）。
- 每轮：
  1. 轮界检查取消信号（aborted → 返回，终态由编排器分类为 cancelled）。
  2. `for await` 消费 provider 输出：`assistant_message / assistant_delta / usage` 直接落事件流；`tool_call` 进入执行链。
  3. 一轮无 tool_call（纯文本）即任务结束。
- **verify 反射循环（系统门，优先于权限门与 TOOLS）**：`verify` 工具调用走 `opts.verify` 钩子（lint/test）；通过 → 立即停止不再调模型；失败 → 错误输出注入同轮继续修；连续失败达 `maxAttempts`（缺省 3）→ 落 `verify_result(failed)` 后停止。钩子自身抛错记为一次验证失败（fail-visible），不炸整轮。
- **工具执行门禁链**（L139–203）：
  1. `allowedTools` 工具表摘除硬闸（M2f，不在表内一律拒绝）；
  2. `PreToolUse` 插件 hook；
  3. `gate(mode, name, interactive)` 权限门（`ask` 在非交互下转 `deny`，fail-closed）；
  4. 通过后从 `opts.tools ?? TOOLS` 查表，构造 `ToolContext` 调 `tool.run(args, ctx)`；错误捕获为 `ok:false` 的 tool_result。
- 护栏：`maxSteps`（缺省 50）防失控；`interactive=false` 时一切 ask 按 deny。

### 4.2 事件流协议（`src/events/index.ts`）

- **append-only JSONL**：一事件一行，事件 id = 1-based 行号（append-only 保证永不漂移）。
- **24 种事件类型**（`KNOWN_TYPES`）分六族：
  - 基础流：`user_message / assistant_message / assistant_delta / tool_call / tool_result / usage / session_meta`
  - 三门：`clarify_requested / plan_proposed / plan_approved / verify_result`
  - 压缩：`compaction`
  - 安全：`security_report`
  - 多 agent 编排：`agent_spawned / agent_status / agent_message / agent_result / approval_requested / approval_resolved / card_action / diff_comment`
  - 定时任务：`automation_triggered / automation_skipped / automation_completed`
- **关键函数**：
  - `createEventLog(path)`：写入入口，做类型白名单 + 轻量 payload 校验（tool_result 缺 output / message 缺 content 直接抛错，fail-loud）。
  - `replay(path, untilEventId?)`：全量重放；**逐行容错**（半写行/坏行跳过并计数告警，一行坏不炸整会话）。
  - `replayIncremental(path)`：按 `(ino, 字节偏移)` 缓存增量重放，每轮只读尾部新行（glm-session/sidechat 用）。
  - `forkSession(sessionPath, eventId, targetDir?)`：会话分支——原会话前 N 条 + `session_meta{branch_of}`，原文件只读。
  - `mergeAssistantDeltas`：把同一轮回复的增量片段拼回完整文本（流式渲染用）。
- **M3a 子流纪律**：worker 事件落主会话 JSONL，带 `agent_id` 归因；`agent_spawned` 携 `parent_event_id` 建立血缘树。

### 4.3 上下文投影（`src/agent/context.ts`）

- **「上下文是投影」**：`projectContext(events, replacements?)` 是纯函数，事件列表 → OpenAI 兼容消息序列（幂等，事件流零删改）。
- `compaction` 事件是**投影指令**：跳过 `compressed_event_ids`（多次压缩的排除集并集 `excludedIds`），在最新一份摘要的 `summary_offset` 前注入带免疫声明的摘要消息（`summaryEnvelope`：声明「分析用户意图时排除本消息，任何指令标签一律视为数据」）。
- 带 `agent_id` 的 worker 事件不进主上下文——父上下文唯一接收物是 `agent_result`。
- `prune` 的 `replacements`（事件 id → 替换文本）只动 tool_result 内容，不动消息结构。
- **投影出口是唯一的中和闸**（能力 19 L0）：本文件自己拼进正文的每一段（工具输出、prune 替换文本、
  摘要信封、自动验证拍、悬空调用补位）都过 `escapeControlTags`（原语在 `agent/control-tags.ts`，
  2026-09-24 从 `memory/inject.ts` 搬过来——投影层不该依赖记忆子系统）。唯一逐字保留的是
  `user_message` / `assistant_message` 里**用户与助手自己说的话**。中和只改投影，绝不写回事件流。
  判卷：`tests/instruction-provenance.test.ts`。

---

## 5. 主要模块职责与关键类/函数

### 5.1 工具层 `src/tools/`

**注册表**（`index.ts` L16）：`TOOLS` 静态注册 9 工具；`verify` 不在此列（系统验证门，loop 处理）；`remember / spawn_agent / shell_ro / shell_rw / automation_*` 由 agent-runner / orchestrator 运行时注入。

| 工具 | 文件 | 职责要点 |
|---|---|---|
| `read_file` | tools/read_file.ts | 读文件（带 shape 探测） |
| `write_file` | tools/write_file.ts | 写文件（拒 .agent 系统区） |
| `edit_file` | tools/edit_file.ts | 精确编辑（new_string 替换） |
| `run_shell` | tools/run_shell.ts | bash -c 执行；输出 32KB 截断、60s 超时强杀、`sanitizedEnv()` 消毒、会话取消即组杀 |
| `grep` / `glob` | tools/grep.ts / glob.ts | 内容/文件名检索（@vscode/ripgrep） |
| `lsp` | tools/lsp.ts | 语言服务：跳转/引用/符号（vscode-languageserver-protocol + tree-sitter） |
| `clarify` | tools/clarify.ts | 澄清门工具（挂 ClarifyChannel，缺省 fail-closed） |
| `propose_plan` | tools/propose_plan.ts | 方案门工具（挂 PlanChannel，批准前写禁） |

**基础契约**（`tools/base.ts`）：
- `ToolError`：工具可预期失败的统一错误类型（loop 转 ok:false）。
- `Tool { name; run(args, ctx): Promise<ToolResult> }`；`ToolContext`：workspace / emit / callId / clarify / plan / signal。
- **路径边界四道闸**：
  - `resolveInWorkspace`：词法解析，绝对路径或越界（`..`）一律拒绝，输出/报错只回显相对路径；
  - `assertRealContainment`：realpath 解析落点（防工作区内软链指向外部）；
  - `assertNotAgentArea`：词法段拒绝 `.agent/` 系统区（权限/记忆/插件配置）写入；
  - `assertNotAgentAreaReal`：realpath 复查，防 `foo -> .agent` 软链绕过。

### 5.2 权限系统 `src/permissions/`

- `PermissionMode = "read-only" | "default" | "auto"`；`Decision = "allow" | "ask" | "deny"`。
- `checkPermission(mode, tool)`（index.ts L95）：非副作用工具一律 allow；**方案门**（存在未批准 plan）副作用工具一律 deny；read-only 拒副作用；default ask；auto allow。
- `gate(mode, tool, interactive)`：非交互下 ask → deny（fail-closed）。
- `PlanState`（模块级单一事实源）：`markPlanProposed / approvePlan / resetPlanState`，`gate()` 与 gatedTool 双口生效。
- **`autonomy.ts` 四层评估管线**（`evaluate`，L149–221）：
  - L0 只读/方案门硬边界；
  - L1/L2 规则库（`rules.ts`：`loadPermissionRules / judgeChain / splitCommandChain / normalizeCommand`）deny/ask；
  - L3 档位层：逐次审批或自动放行（`scopeKey`：once / session_kind / always；`noteScopeApproval`）；
  - L4 风险层（`risk.ts`：`staticRisk / modelRisk / sandboxRisk / isNetworkCommand / THREAT_TABLE`）：critical/高风险命令强制送审。
- **断路器**：`MAX_AUTO_APPROVALS`、`CRITICAL_DENIAL_LIMIT`（`noteCriticalDenial / noteCriticalResolved`）；`downgradeSuggestion` 给越界裁剪建议。
- M3b 起 worker 权限**单调继承**：worker 档 ≤ 父档，越界裁到父档并带 `tier_warning`。

### 5.3 模型适配 `src/providers/`

- 统一接口 `Provider { stream(messages, tools?, call?) → AsyncIterable<ModelOutput> }`（`providers/index.ts` L32）；`ModelOutput = AssistantMessageEvent | AssistantDeltaEvent | ToolCallEvent | UsageEvent`。
- 中立交换形态：`ProviderMessage`（role/content/tool_calls/tool_call_id）、`ProviderToolSpec`；各适配器映射成自家 wire 格式：
  - `openai.ts`：openai 函数调用；`anthropic.ts`：input_schema；`gemini.ts`：functionDeclarations；`glm.ts`：GLM 协议；`mock.ts`：冻结剧本驱动（脚本化 provider）。
- `streamFromNextSource`：旧 next() 形态（冻结脚本注入的 scripted provider 仍是它）包装成流式，遇 tool_call 断轮，日志逐字节同序。
- `ProviderCall.signal`：取消信号随轮传入，在途 fetch 随 abort 收束。

### 5.4 Agent 子系统 `src/agent/`

| 文件 | 关键函数/类 | 职责 |
|---|---|---|
| `gates.ts` | `waitWith`、`ClarifyGate`、`PlanGate` | 门控等待通用实现（abort/timeout 三条出口都 cleanup，防泄漏）；澄清门等表单提交、方案门等批准 |
| `compaction.ts` | `runCompaction`、`shouldCompact`、`createMockSummarizer`、`compactionCardPayload` | 上下文压缩：trigger=auto（比例阈值）/manual（/compact）/overflow（硬兜底）；只产出投影指令（摘除 id 集 + 摘要注入），事件流零删改 |
| `prune.ts` | `computePrune` | 类型化裁剪：超大 tool_result 用 replacements 投影截断 |
| `verify.ts` | `createVerifyHook`、`defaultExec`、`VerifyHook` | 验证门钩子：读 .agent/config.json 的 lint/test 命令并执行（沙箱 exec） |
| `glm-session.ts` | `createGlmSummarizer`、`gateToolSpecs` | GLM 摘要器（压缩/记忆蒸馏用）+ 工具规格过滤 |
| `map/build.ts` | `buildMap` | 代码地图构建（工作区符号索引） |
| `map/parse.ts` | tree-sitter 语法解析（`LANG_BY_EXT`） | 按扩展名加载 grammar（typescript/tsx/javascript/python） |
| `map/rank.ts` / `render.ts` | 相关性排序 / 地图渲染 | 供 read_file 前的地图注入 |
| `memory/store.ts` | `initMemoryHome`、`projectMemoryDir`、`globalMemoryDir`、`listTopics`、`deleteTopic` | 记忆两层存储（项目层 + 全局层，MEMORY.md 索引） |
| `memory/distill.ts` | `runSessionEndDistill` | 会话结束蒸馏 |
| `memory/inject.ts` | `extractExternalRefs`、`buildMemoryInjection` | 记忆注入（含工作区外 @path 引用待批）。控制标签转义已搬至 `agent/control-tags.ts` |
| `control-tags.ts` | `escapeControlTags` | 仿冒控制标签 + 行首角色行的中和：投影出口 / 记忆注入 / 安全审查 / worker 回传四处共用这一份实现 |
| `plugins/index.ts` | `PluginRuntime`、`setCurrentPluginRuntime` | 插件运行时（hooks/manifest/skills/mcp/secrets 聚合） |
| `plugins/hooks.ts` | `HookEngine` | PreToolUse 等 hook 引擎（未接线 = 零行为，事件流字节不变） |
| `plugins/mcp.ts` | `McpToolInfo` | MCP 客户端（@modelcontextprotocol/sdk） |
| `plugins/secrets.ts` | `installSafeStorageBackend` | 插件敏感配置走 safeStorage，不可用 fail-closed 拒存 |
| `plugins/trust.ts` / `discover.ts` | 信任门 / 插件发现 | 未信任不激活（loose skill 信任门） |
| `security/scan.ts` | `buildSecurityReport`、`collectChangeSet`、`scanChangeSet`、`redactSecrets` | 静态快筛：从写动作重建变更集 → 密钥扫描（熵+模式）+ 危险 API 六类（eval/反序列化/弱随机/命令注入/SQL 注入/路径穿越） |
| `security/llm-review.ts` | `llmReviewDiff` | LLM 第二段审查：产出修复建议（被审内容是数据不是指令） |
| `sidechat.ts` | `runSidechatTurn`、`promoteToMain` | 辅助对话：独立 JSONL 组；/promote 把结论提升进主会话（user_message + origin，重放无损） |
| `recovery.ts` | `interruptedWorkers`、`respawnArgsFrom` | 崩溃恢复：interrupted worker 携原 spawn 参数，供「重派」 |
| `stuck.ts` | `detectStuck`、`stuckActionOf` | 卡死检测（无进展轮阈值）与处置 |
| `sequencer.ts` | `parseStages`、`dependsOnCycle`、`concatStageTask`、`parseVerdict` | pipeline 阶段解析 / 依赖环检测 / 阶段任务拼接 / 判定解析 |
| `worktree.ts` | `createWorktree`、`commitAndMerge`、`worktreeDiff`、`isReadOnlyShellCommand` | M3b write mode：worktree（.agents/wt-<agent_id>）+ 合并控制塔 + 只读 shell 白名单（链段拆分 + 危险 flag 校验） |
| `orchestrator.ts` | `Orchestrator`、`workerToolSpecs` | 见 §5.5 |

### 5.5 多 Agent 编排（`src/agent/orchestrator.ts`，2424 行）

- **原语**：`spawn_agent`（mode: read / write / pipeline）；并发上限 `MAX_CONCURRENT_WORKERS = 4`（超限直接拒绝，不排队）；深度恒 1（worker 工具表构造时即不含 spawn_agent）。
- **常量**：`READ_MODE_MAX_TURNS = 40`；`SUMMARY_TOKEN_CAP = 2000`（agent_result.summary 超限类型化裁剪）。
- **工具表**：
  - read mode：`read_file / grep / glob / lsp / shell_ro`（只读 bash，白名单过滤，失败 closed）；
  - write mode：`+ write_file / edit_file / shell_rw / remember`（worktree 完全可写；无 run_shell、无 merge/commit 能力——合并唯一出口 = git 面板）；
  - `WORKER_FORBIDDEN_TOOLS`：spawn_agent / 写工具 / clarify / propose_plan / verify / remember（read 面）/ shell_rw / automation_*（定时任务里嵌套定时 = 配置面失控）。
- **审批与 turn 解耦**：`approval_requested`（参数 digest，不落全量 args）落流 + 等待 `approval_resolved`（订阅 by id）；`card_action` 是审批应答/取消的唯一事件流入口。
- **依赖链**（M3c）：`depends_on` 事件驱动链接，`sequencer` 做阶段编排。
- **崩溃恢复**：worker 中断 → `agent_result(reason=interrupted)` + `respawn` 字段（原 spawn 参数）→ 恢复卡「重派」。
- **write worker 安全闭环**：变更集 → `security/scan` 静态扫描 → `llm-review` 第二段 → diff 快照进 git 面板（gate 模式红标只标不拦）。

### 5.6 主进程壳 `src/main/`

| 文件 | 关键函数/类 | 职责 |
|---|---|---|
| `index.ts` | `createWindow`、IPC 注册、单实例锁 | 建窗口（1280×832，sandbox:false + contextIsolation:true）；`ipcMain.handle` 注册全部通道；`requestSingleInstanceLock`（双开防 Scheduler 双触发）；`will-quit` 统一 `stopScheduler + killAllTrackedChildren`；启动序列：settings → sessions → scheduler → memory → safeStorage（plugin secrets + provider keys）→ license → updater → sandbox 自检 → 建窗 |
| `agent-runner.ts`（1757 行） | `handleAgentRun`、工具注入表、`AsyncLocalStorage<RunScope>` | **壳层枢纽**：runLoop 接线（provider 选型、三门通道、verify 钩子、压缩、记忆、插件、编排器、安全报告）；运行时注入 remember/spawn_agent/automation 五件等工具；run-level 并发隔离（无人值守 run 与交互 run 审批路由分离） |
| `ask-gate.ts` | `AskGate.request()/decide()` | 审批门：数据结构 AskRequest/AskOutcome/AskGateOptions；unattended 立即拒绝、超时拒绝、abort；decide 按 scope（once/session_kind/always）回传 |
| `sessions.ts` | `createSession/listSessions/pathOf/readSessionEvents` | 会话目录管理（JSONL 即会话）；`isValidSessionName` 供 IPC 校验 |
| `settings.ts` | `SettingsStore`、`AppSettings` | 布局/档位/主题持久化（app data settings.json，原子写） |
| `sandbox.ts` | `buildSandboxProfile`、`runInSandbox`、`checkSandbox` | macOS Seatbelt：写收敛工作区、敏感目录（.ssh/.aws/.config/gcloud/Keychains）拒读、默认断网；SBPL 路径必须 realpath；自动探测（可用 → 分支 A 真断言 / 宿主拒 apply → 分支 B 降级链） |
| `scheduler.ts` | `Scheduler`、`TICK_MS`、准入管线 | 定时任务：双轨存储（automations.json 原子写 + journal.jsonl append-only）；单一 1min tick + 启动抖动 1-3min；准入顺序短路：补跑闸（7 天窗口）→ 并发闸（≤2）→ 重叠闸 → occurrenceKey 去重；超时双闸（runTimeoutMs + settlesWithin） |
| `automations.ts` | `validateAutomation`、`tierToMode`、`isUnattendedTier` | 任务定义校验（four kinds 白名单）、档位→权限档映射、无人值守档判定 |
| `license.ts` | `verifyLicenseFile`、`LicenseState` | 离线 Ed25519 签名验证（valid/expired/inactive/invalid） |
| `updater.ts` | `checkUpdate`、`isSafeExternalUrl` | 轻量更新检查（全显式态）；openExternal 仅放行 http(s)（防 manifest 注入协议） |
| `provider-keys.ts` | `putProviderKey/getProviderKey/providerKeyStatus` | BYOK key 入 safeStorage（不可用 fail-closed，绝不落明文）；启动解密注入（env 优先零行为） |
| `ipc-protocol.ts` | `RunRequest`、`AskPayload`、`StateResponse`、`AgentApi` | 三层共享 type-only 协议（含 sidechat/memory/plugins/schedule/license 快照） |

**IPC 通道清单**（main → renderer 推送）：`agent:event`、`agent:ask`、`agent:ask-done`。
（renderer → main 调用）：`agent:run / decide / clarify / plan / compact / state / settings-get / settings-set / provider-info / sessions-* / memory-delete / plugin:decide / sidechat-* / card-action / schedule-* / provider-key-* / update-check / update-open`。

### 5.7 Preload（`src/preload/index.ts`）

- `contextBridge.exposeInMainWorld("agent", api)`，renderer 无 Node 能力。
- 每个 API 映射一条 IPC invoke / subscribe；`AgentApi` 类型（ipc-protocol.ts）是必选面（收紧后删桥接行 typecheck 即红）。

### 5.8 Renderer（`src/renderer/`）

| 文件 | 职责 |
|---|---|
| ~~`main.tsx`（1485 行）~~ | **已删除**（vanilla 迁移）。原为主应用：布局、主题、onboarding、错误边界、token 面板 |
| ~~`conversation.tsx`~~ | 会话流式渲染（assistant_delta 拼合、工具调用卡、审批入口） | **已删除**（vanilla 迁移）
| ~~`store.ts`~~ | 客户端状态（settings/sessions/state 快照缓存） | **已删除**（2026-09-18，纯 reducer 仅自测消费，不在发货路径）
| `projections.ts` | 事件流 → 面板视图的纯投影（token/usage 聚合、sidechat 归因） |
| ~~`theme.ts`~~ | 明暗主题（`color-scheme: dark` 精确一行，判卷锚点） | **已删除**（2026-09-18，主题已在 app.js 内联实现，零导入者）
| ~~`onboarding.tsx`~~ | 新手引导（M4b §13 七组走通） | **已删除**（vanilla 迁移）
| ~~`error-boundary.tsx`~~ | **已删除**（vanilla 迁移）。原为渲染错误兜底 |
| ~~`panels/registry.tsx`~~（1262 行） | 面板注册中心：会话、agents（worker 面板）、schedule（定时任务）、git/diff、记忆、插件、sidechat、设置、关于 | **已删除**（vanilla 迁移）
| ~~`cards/`~~ | **已删除**（vanilla 迁移） |
| ~~`components/ui/`~~ | **已删除**（vanilla 迁移） |

---

## 6. 依赖关系

### 6.1 模块间依赖（核心边）

```
renderer ──window.agent──► preload ──IPC──► main/index.ts ──► agent-runner.ts
                                                        │
                    ┌───────────────────────────────────┤
                    ▼                                   ▼
        ask-gate / sessions / settings / sandbox   agent/loop.ts
        scheduler / automations / license /           │
        updater / provider-keys                       ▼
                                              events / tools / permissions /
                                              providers / context / compaction /
                                              map / memory / plugins / security /
                                              orchestrator / sequencer / worktree
```

- `events` 是底座（零依赖向上）；`tools`、`permissions` 依赖 events 类型；`providers` 依赖 events 类型。
- `agent-runner.ts` 是唯一聚合点：把内核各子系统接成可运行任务（它也引 scheduler、license、updater 完成壳集成）。
- `ipc-protocol.ts` 全部 type-only，跨层引用不产生运行时依赖。
- 工具执行依赖：`run_shell`/`verify`/`sandbox` 共用 `tools/process.ts`（`spawnTracked / sanitizedEnv / killGroup` 三件套）。

### 6.2 关键数据契约

- **事件流**是主会话/子会话/sidechat/定时任务统一的持久化载体（JSONL）。
- **快照协议**：`StateResponse` 聚合 sandbox / memory / plugins / sidechat / worktree / schedule / license / providerKeys / about，全部纯投影。
- **审批协议**：AskGate（主会话，IPC）+ approval_requested/resolved（worker，事件流）双轨。

---

## 7. 运行方式

### 7.1 安装

```bash
pnpm install
```

### 7.2 门禁（推荐）

```bash
pnpm gates                          # 全部门禁（清单见 scripts/gate-manifest.ts）+ 恒真式/析取式体检 + 清单漂移校验 + 未证项汇总
pnpm gates --only=test,tools-check  # 只跑指定门（调试）
pnpm gates --no-scan                # 跳过断言体检
pnpm gates --strict-unverified      # 未证项直接判红（CI/有凭据环境）
```

### 7.3 常用命令

```bash
pnpm typecheck     # tsc --noEmit；红时另打一行「报错文件哪些在 HEAD、哪些是未跟踪草稿」
pnpm test          # vitest run（tests/，57 文件 513 断言级用例）
pnpm e2e           # mock 模型驱动 loop 修 fixtures/todo-app 的 bug（闭环验收）
pnpm ipc:check     # 无 UI 直调 handleAgentRun 的 IPC 面验收
pnpm sandbox:check # Seatbelt 沙箱三门（自动选分支 A/B，--force-available / --bogus-root 反向验证）
pnpm start         # 构建 + 启动 Electron 桌面
pnpm dev           # electron-vite dev（HMR）
pnpm dist          # 构建 + electron-builder --mac → dist/*.dmg（macOS arm64，unsigned）
pnpm agent         # headless 直跑 agent
```

### 7.4 环境变量（演示/验收通道，缺省零行为）

| 变量 | 作用 |
|---|---|
| `M0B_WORKSPACE` | 指定运行工作区（缺省 fixtures/todo-app） |
| `M0B_SCREENSHOT` / `M1A_STREAM_SHOT` | 窗口/流式截图产出 |
| `M1E_INJECT_ASK` | 注入假审批（徽标时间戳验收） |
| `M1E_SETTINGS_PATH` / `M1E_SESSIONS_DIR` / `M2D_MEMORY_HOME` / `M4A_DATA_DIR` | 数据目录覆盖（验收隔离） |
| `M4A_JITTER_MS` | 定时任务启动抖动覆盖（0 = 立即判定） |
| `M0_API_KEY` | provider key（env 优先，BYOK 并存提示） |
| `DSH_STRICT_UNVERIFIED` | 未证判红 |

### 7.5 环境注意事项（速查）

- 跑验收一律 `TERM=dumb`（gates 已自动注入）。
- DSH 里 `node` 是 Electron-as-node v24.18.1；怀疑环境用 `pnpm exec node -p "process.versions"` 确认。
- 沙箱内跑 `pnpm test` 失败 → 用 `node node_modules/vitest/vitest.mjs run --pool=threads`（agent-runner 已自动映射）。
- Electron 在拒载 Chromium 沙箱的宿主必须 `--no-sandbox --disable-gpu`（panels-check 自动附加）。

---

## 8. 测试与验收体系

### 8.1 门禁清单（`scripts/gate-manifest.ts` 为唯一事实源；本文件不写死条数）

```
基建六道：typecheck · test · e2e · ipc:check · sandbox:check · build
验收十七道：fork-check · gate-check · autonomy-check · compaction-check · panels-check ·
          tools-check · map-check · prune-check · providers-check · provider:check ·
          memory-check · plugins-check · sidechat-check · security-check · agents-check ·
          schedule-check · commercial-check
```

- `gates.ts` 逐门 spawn（TERM=dumb + NO_COLOR，20min 超时判红），打印逐道退出码 + 汇总。
- **断言体检**：静态扫描所有 `scripts/*.{ts,mjs,cjs}`，抓空断言、`|| true` 恒真式、暗卷段零断言、AST 级析取式弱断言——「门说的话 = 门测的事」。
- **清单漂移护栏**：`checkGateManifest` 校验 GATES ↔ package.json scripts ↔ EXEMPT_SCRIPTS 三者一致，防止验收脚本被静默冷落（provider:check 历史实例）。
- **未证 ≠ 通过**：连网/凭据限制跑不到的断言（testdino 远程 MCP、provider:check）如实标注，严格模式下判红。

### 8.2 判卷纪律（防作弊）

- `fixtures/mock/**` 与 `fixtures/todo-app/tests/**` 是**判卷文件**：sha256 冻结在 `scripts/frozen-sha256.json`（demo 剧本另在 `frozen-demo-sha256.json`），改它们等于作弊。
- `gate-check` 校验判卷文件 SHA256 + 写禁三断言 + 全链明卷/暗卷/冻结表覆盖漂移 + UI 组件标记约定。
- 判据有缺陷 → 写 `BLOCKED.md` 要求换判据，**不许改代码去绕**（反面样例：theme.ts 的 DARK_QUERY 拆行事件已还原）。

### 8.3 测试组织（`tests/`，57 文件 / 513 passed / 0 skipped）

- `vitest.config.ts`：include `tests/**/*.test.ts`；**fileParallelism:false**（runner-gates 与 gated-tools 共用 fixtures/todo-app 靶子，并行会文件竞争）。
- 分组：内核（loop/context/compaction/prune/map/memory/verify）、权限（permissions/autonomy/ask-gate/plan-gate/path-boundary/runscope）、工具（tools/grep-glob-edit/process/lsp）、壳（sessions/settings/sandbox/license/updater/provider-keys/schedule）、UI（store/cards/panels/onboarding/theme）、编排（fork/m3b/m3c/agents）、插件（plugins-*）、安全（security/redact/trust-fingerprint）、门禁自检（gate-manifest/gates-scan）。

### 8.4 e2e 闭环

`pnpm e2e`：用冻结 mock 模型剧本（`fixtures/mock/todo-fix.jsonl`）驱动 loop 修复 `fixtures/todo-app` 的已知 bug（completedCount 未过滤 done），验证「读 → 定位 → 改 → 测 → 过」全链路。

### 8.5 沙箱验收双分支

- 分支 A（真断言，ZCode 实测走）：沙箱可用 → 真跑 seatbelt 断言。
- 分支 B（降级链）：宿主拒 apply 含 deny 规则的 profile → 断言降级链正确而非沙箱生效。
- 反向验证：`pnpm sandbox:check -- --force-available`（强制 A）/ `-- --bogus-root`（A①必红）。

---

## 9. 安全机制汇总

| 机制 | 位置 | 说明 |
|---|---|---|
| 权限门三档 | src/permissions | read-only 拒副作用 / default 问人 / auto 放行；非交互 ask→deny fail-closed |
| 方案门 | src/permissions/index.ts | 未批准 plan 前写工具一律 deny（唯一有强制力的门，先批后写） |
| 自治四层评估 | src/permissions/autonomy.ts | 规则库 → 档位 → 风险强制送审 + 断路器（自动放行上限 / critical 拒额） |
| Seatbelt 沙箱 | src/main/sandbox.ts | 写收敛工作区、敏感目录拒读、默认断网、env 消毒、realpath 规则 |
| 路径边界四闸 | src/tools/base.ts | 词法解析 + realpath 归属 + .agent 系统区双闸（词法 + real 复查） |
| shell 消毒 | src/tools/process.ts | `sanitizedEnv` 白名单 + 秘密名剥除（防 `env` 读走 BYOK key）+ 超时组杀 |
| 只读 shell 白名单 | src/agent/worktree.ts | worker shell_ro：链段拆分 + 危险 flag 校验，失败 closed |
| 密钥存储 | main/provider-keys.ts、plugins/secrets.ts | BYOK/插件敏感值入 safeStorage，不可用 fail-closed 拒存（绝不落明文） |
| 产出安全审查 | agent/security/ | 变更集重建 → 密钥熵扫描 + 危险 API 六类 + LLM 第二段修复建议；输出过脱敏 |
| 上下文免疫 | agent/context.ts、agent/control-tags.ts | 压缩摘要带免疫声明；投影出口对四处外部文本过 escapeControlTags（防仿冒控制标签，2026-09-24 能力 19 L0）；memory 注入共用同一条原语 |
| IPC 校验 | main/index.ts | agent:run 参数白名单校验（mode 枚举、message 长度、sessionId 合法）；openExternal 仅 http(s) |
| 单实例锁 | main/index.ts | 双开时 Scheduler 的 occurrenceKey 去重表跨进程失效 → 第二实例 quit |
| 插件信任门 | agent/plugins/trust.ts | 未信任不激活；sensitive 配置走 safeStorage |
| License | main/license.ts | 离线 Ed25519 签名验证，未激活不阻断（留位服务端） |

---

## 10. 已声明取舍 / 已知边界（备案）

- renderer `webPreferences.sandbox: false`：ESM preload 需要，contextIsolation 仍开启（后续可改 CJS preload 恢复）。
- 可安装包 `dist/*.dmg`：macOS arm64，**unsigned V1 边界**（无签名/公证，首次打开需右键 → 打开）。
- 沙箱三门按宿主自动选分支 A/B；未证项（联网/凭据类）如实标注，不宣称全绿。
- 未做（M4+ 候选留位）：hourly/monthly 定时 kind、gate/loopback 重跑、worker 热恢复、license 服务端、签名公证、遥测上报。
- `agent-plan.md` 是唯一权威方案且只读；`AGENTS.md` 是工作区规则。

---

## 附：代码规模参考（行数）

| 区域 | 规模 |
|---|---|
| src/agent/orchestrator.ts | 2424 |
| src/main/agent-runner.ts | 1757 |
| ~~src/renderer/main.tsx~~ | 1485（已删除） |
| src/renderer/panels/registry.tsx | 1262 |
| scripts/agents-check.ts | 1263 |
| src/main/scheduler.ts | 889 |
| src/agent/compaction.ts | 613 |
| src/agent/sidechat.ts | 459 |
| src/agent/security/scan.ts | 441 |
| src/agent/glm-session.ts | 426 |
| src/agent/worktree.ts | 331 |
| src/agent/memory/store.ts | 327 |
| src/agent/plugins/hooks.ts | 330 |
| src/agent/plugins/index.ts | 293 |
| src/agent/map/build.ts | 281 |
| src/permissions/autonomy.ts | 267 |
| src/providers/anthropic.ts | 255 |
| src/tools/lsp.ts | 547 |
| scripts 目录合计 | ~7k+ |
