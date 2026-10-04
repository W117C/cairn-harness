# 人机协作四格取证（能力 8）— HEAD `a6a87627`，2026-10-04

只读取证。未跑判卷 / typecheck / 任何 `scripts/*.ts` 门 / mutate-verify。

## 取料方法与在飞面

- 基线：`git rev-parse HEAD` = `a6a87627b4520c05bb974a3c0dfeaf5586fabd79`。
- 为让 `file:line` 对 HEAD 成立，取料用 `git archive a6a87627 src tests | tar -x -C /tmp/dsh-head-a6a87627`，
  本文所有行号 = `git show "a6a87627:<path>"` 的行号（工作树同路径若脏则**不等于**这些行号）。
- `git status --porcelain -- src/` 现读 30 条脏项。**在隔壁手里**（本文引用过但其工作树不可信）：
  `src/agent/loop.ts`、`src/agent/orchestrator.ts`、`src/agent/orchestrator-types.ts`、`src/agent/recovery.ts`、
  `src/agent/verify.ts`、`src/agent/worktree.ts`、`src/agent/fork-cli.ts`、`src/agent/map/*`、`src/agent/memory/store.ts`、
  `src/agent/metering.ts`、`src/agent/security/{llm-review.ts,+merge-gate.ts}`、`src/agent/eval/task-set.ts`、
  `src/agent/impact/*`、`src/cli.ts`、`src/main/agent-runner.ts`、`src/main/provider-*.ts`、`src/main/settings-handlers.ts`、
  `src/permissions/command-shape.ts`、`src/permissions/risk.ts`、`src/providers/*`、`src/routing/bandit.ts`、
  `src/tools/{process,run_shell,web-search}.ts`。
- **干净**（可直接动，工作树＝HEAD）：`src/tools/snapshot.ts`、`src/agent/diff-review.ts`、`src/agent/write-face.ts`、
  `src/agent/gates.ts`、`src/agent/worker-shell-tools.ts`、`src/tools/{base,write_file,edit_file,apply_patch,index,clarify,propose_plan}.ts`、
  `src/permissions/{index,rules,autonomy,plan-state,modes,tool-registry}.ts`、`src/events/index.ts`、
  `src/main/{ask-gate,ipc-protocol}.ts`、`src/atomic-write.ts`、`src/net.ts`、`tests/snapshot-d7.test.ts`。

---

## 1. 可中断 —— **半**（有通路，但只到「轮界」；且让出时盘上/账上没人收尾）

### 通路是真的，标识符是 `signal`（不是 `interrupt`）

| 环节 | 位置 | 事实 |
|---|---|---|
| 契约声明 | `src/agent/loop.ts:78-80` | `LoopOptions.signal?: AbortSignal`，注释自陈语义：「中止于**轮界**（工具执行中不打断，轮末收束）」 |
| 唯一让出点 | `src/agent/loop.ts:367` | `if (opts.signal?.aborted) return;` —— 在 `for (let step = 0; step < maxSteps; step++)` 的**循环头**（`src/agent/loop.ts:366`） |
| 在途模型调用 | `src/agent/loop.ts:333-336` | `provider.stream(messages, undefined, { signal })`；abort 时流抛错，`src/agent/loop.ts:347` 判定「取消不是失败」，**不落 `error` 事件**，`src/agent/loop.ts:354` 原样上抛 |
| 透传进工具 | `src/agent/loop.ts:488` | `...(opts.signal ? { signal: opts.signal } : {})` 进 `ToolContext`（`src/tools/base.ts:37`） |
| 发出方（主会话） | `src/main/agent-runner.ts:1579-1581` | 每 run 一个 `runAbort`；`signal = AbortSignal.any([opts.signal, runAbort.signal])`；**只有 interactive run** 才把句柄挂到模块面 `interactiveRunAbort`（声明 `src/main/agent-runner.ts:244`） |
| 取消入口 | `src/main/agent-runner.ts:2411-2416` | `handleRunCancel()`：无活动交互 run ⇒ fail-visible `{ok:false,"无活动交互 run（取消不可达）"}`；`c.abort()` |
| IPC 契约 | `src/main/ipc-protocol.ts:161-164` | `runCancel(sessionId?: string)` —— **核心侧 `handleRunCancel()` 无参**（`src/main/agent-runner.ts:2411`），会话级取消在 `src/` 里没有落点（协议写的是 M3-5 kernel-host 的 per-session controller，那在 `apps/desktop`，且 `apps/desktop/src/main/index.ts` 现读在飞） |
| CLI 键盘面 | `src/cli.ts:1159-1170` | 第一次 SIGINT → `handleRunCancel()`（优雅收束）；第二次 → `killAllTrackedChildren(); process.exit(130)`（硬退）。`src/cli.ts:1156-1158` 注释明写硬退会把事件流截断在「tool_call 无 tool_result」 |
| worker 取消树 | `src/agent/orchestrator.ts:132,739-745` | `root = new AbortController()`；root abort 沿树逐个 `handle.controller.abort()`，已 abort 时显式补一刀 |
| 单 worker / 全树 / 模型侧 | `src/agent/orchestrator.ts:907-919` / `946-964` / `930-943` | `cancelAgent`（含在途审批按拒释放）、`cancelAll`、`cancelAgents`（面板/IPC/模型三条路共用同一个 `cancelAgent`，注释自陈「另起一条取消的路＝两处口径必漂」） |
| 链/竞速的界点 | `src/agent/orchestrator.ts:425,514,1088,1294,1378` | 竞速轮、spawn 入口、supervise 环间、chain 环间都读 `root.signal.aborted`（fail-closed 不再派发） |
| 工具是否真吃信号 | 吃：`src/tools/run_shell.ts:61-75`（abort→`killGroup` 收整棵进程树，完成路径摘监听）、`src/tools/wait_for_agents.ts:14,40`、`src/agent/action-fusion.ts:49,61,73,84-85`、`src/agent/solpi-runtime.ts:132,137`。<br>门等待：`src/main/ask-gate.ts:85-98`（D12：pending 立即按拒收束）、`src/agent/gates.ts:6,11-40`（clarify/plan 的 abort/超时三出口） | **不吃**：`src/tools/write_file.ts`、`src/tools/edit_file.ts`、`src/tools/apply_patch.ts` —— 三把写工具全文没有一处读 `ctx.signal`（对 `signal` 的 grep 在这三个文件里零命中） |
| provider 面 | `src/providers/index.ts:25-28`、`src/providers/retry.ts:72,78-89`、`src/net.ts:23-49` | 取消沿在途 fetch；重试窗里按停止会当场收束（`retry.ts:89`）；`net.ts` 是停滞看门狗，不是用户取消 |

### 缺口（这一格为什么只给「半」）

1. **轮内不让出**：`src/agent/loop.ts:366-496` 那个 `for await` 体内**没有任何 abort 检查**（全文 `aborted` 只出现在 `:347` 与 `:367`）。
   模型一次给出 5 个 tool_call，喊停之后这 5 个仍会逐个执行到底 —— 界点是 step，不是 tool call。
2. **主会话的取消不可审计**：`src/agent/loop.ts:367` 是裸 `return`，不 `events.append` 任何东西；
   `runAgent` 外层 `try` 只有 `finally`（`src/main/agent-runner.ts:1916-1952`），`finally` 里也没有取消标记事件。
   `src/events/index.ts` 的 `cancelled` 语义只长在 worker 面上（`src/agent/orchestrator.ts:2039-2049`，含 `hold:"cancelled"`）。
   主会话转录里「为什么停在这里」只能靠反推（末条是 `tool_result` 且无后续 `assistant_message`），不是一条事实。
3. **goal 被取消时不落 `goal_stopped`**：`src/main/agent-runner.ts:2154` `if (args.aborted()) return null;` —— 直接不续、不记；
   对照同函数无人值守那一支（`src/main/agent-runner.ts:2160-2172`）是**会**落 `goal_stopped` 的。目标在盘上仍是「武装」态且无人说明它为什么没跑完。
4. **写了一半的文件没人收尾**：
   - 优雅路径（第一次 Ctrl-C）安全，因为不让出在 `await tool.run()` 中间（`src/agent/loop.ts:492`）。
   - **硬退路径不安全**：`src/cli.ts:1162-1163` 的 `process.exit(130)` 可以落在 `writeFile` 中间
     （`src/tools/write_file.ts`、`src/tools/edit_file.ts`、`src/tools/apply_patch.ts:265` 都是裸 `writeFile`，非原子），
     而**工作区写盘没有走** `src/atomic-write.ts:21-31`（那套 tmp+rename 只服务应用态文件，见 `src/permissions/rules.ts:130`、
     `src/main/settings.ts:286`、`src/routing/bandit.ts:161`、`src/agent/memory/store.ts:237` 等 12 处调用点）。
   - `apply_patch` 两趟式：不可应用的补丁「整笔未写盘」（`src/tools/apply_patch.ts:243-250`），
     但第二趟写循环本身**不是事务**（`src/tools/apply_patch.ts:256-270` 逐文件 `writeFile`），中途抛错前面几个文件已落地。
   - 事件日志侧：`src/events/index.ts:855` 是 `await cur.write(...)`，硬退丢一条在途事件；
     读侧对半行有兜底（`src/events/index.ts:1006` `completeInit` 只取完整行）。
5. **跑中的 run 不接受第二份输入**：`src/main/agent-runner.ts:1590` `isSessionLogBusy` 直接抛「session already running」
   （压缩面同类拒绝 `src/main/agent-runner.ts:901`）⇒ 「喊停」与「换话」之间只有喊停这一档。

---

## 2. 可回滚 / 可审计 —— **半偏无**（快照面有写无读；审批门有名单旁路）

### 快照面：只有 writer，**没有 reader**

- 唯一的快照实现：`src/tools/snapshot.ts:28-47` `snapshotBeforeOverwrite()`，落 `.agent/snapshots/<毫秒>--<callId>/<相对路径>`（`:11`、`:21-23`）。
- 三个调用点：`src/tools/write_file.ts:46`、`src/tools/edit_file.ts:81`、`src/tools/apply_patch.ts:262`。
- 穿到事件流：`src/tools/base.ts:52` → `src/agent/loop.ts:503,554` → `src/events/index.ts:70-72`（`snapshotId`）。
- worker 写侧**显式关掉**快照（worktree 天然可回滚）：`src/tools/base.ts:40-44`、`src/agent/worker-tool-table.ts:59-61,74`。
- **覆盖面**：仅「已存在且非空的文件被覆写」。新建文件、空文件、快照自身失败都返回 null（`src/tools/snapshot.ts:36`，best-effort `:43-46`）；
  `run_shell` / `shell_rw` 经 shell 落盘的改动**完全不进快照面**（那两条不碰 `snapshotBeforeOverwrite`）；
  `apply_patch` 明确拒做 delete/rename（`src/tools/apply_patch.ts:194-200`），所以删除类破坏面来自 shell，正是没快照那一路。
- **回滚面 = 无**。负控与穷举见文末「探针自证」：`src/` 内零处消费 `SNAPSHOT_ROOT`/读回原件；
  唯一真正「还原」的代码是 worker worktree 的逐文件 `git checkout` / 删文件（`src/agent/diff-review.ts:102-122,131-158`，
  入口 `src/agent/orchestrator.ts:2262` 的 failed/cancelled/merged/rejected 四路清理），
  **对直写用户真实工作区的主会话一寸都不适用**（`src/tools/snapshot.ts:5` 注释自己写明本模块就是为主会话而立的）。
- 已登账的缺陷：快照 id 含 `Date.now()` ⇒ 复跑不可复现（`src/agent/reproducibility.ts:91-100`；`.agent/snapshots/**` 会出现在用户 `git status`，`src/tools/snapshot.ts:6`）。
- 判卷只钉「写」不钉「读」：`tests/snapshot-d7.test.ts:25-96` 七条用例全部是关于快照**生成**与失败不改写盘结果，没有一条关于取回原件。

### 审批门：四层管线 + 名单

- 粗档表 `src/permissions/index.ts:15-21`；`checkPermission` `:108-124`；`gate()` 非交互把 `ask` 降 `deny` `:132-136`；方案门一句话 `:139-142`。
- 细档四层（先命中先短路）`src/permissions/autonomy.ts:1-7`；层名穷尽表 `:30-38`；留痕 `GateMeta` `:51-65`（`mode` 「宁缺不编」`:58-60`）。
- 写向名单 `SIDE_EFFECT_TOOLS` `src/permissions/autonomy.ts:213-229` = `write_file / edit_file / apply_patch / diagnose / run_shell / shell_rw / spawn_agent`。
- 生产执行点是 `gatedTool`（`src/main/agent-runner.ts:511`），**不是** loop 里那道 `gate()`：主会话以 `mode:"auto"` 进 loop（`src/main/agent-runner.ts:1778`，注释「真实门在 gatedTool」），所以 `src/agent/loop.ts:453-475` 那段对主会话恒为 allow。
- 包装名单 `GatedName`（`src/main/agent-runner.ts:509`）= `write_file | edit_file | apply_patch | run_shell | web_fetch | web_search | diagnose`；
  挂载处 `:1000-1011`、`:1775`；MCP scoped 名进同一条 `evaluate` 管线 `:625`；`obs_recall` `:1713`；`remember` `:1016-1023`；
  定时五件各带一张卡 `:1196-1204,1218,1241,1258,1271`；无人值守一律即拒 `src/main/ask-gate.ts:61-64`。
- 审计读数面（可审计这一半是有的）：每条 `tool_result` 带 `gate{layer,verdict,risk,mode,scope}`（`src/events/index.ts:70`），
  复跑按 `layer × verdict` 铺矩阵（`scripts/replay/gate-outcomes.ts`、`scripts/replay/ask-density.ts`，`git ls-tree a6a87627 scripts/replay` 现读存在）。
- 既有裁决（本文不动它，也不提议放宽）：**全局层 deny 是不可放宽的地板** —— 立案与判据见 `tests/permissions.test.ts:142-199`（S4，业主 2026-10-04 裁决），
  边界三条也已在判据里（项目层 deny 不获同等优先权；被 `headUnknown`/`consentGap` 降成 ask 的那条不再当地板；不带层归属的手写规则 `floor` 恒假）。

### 高危但**没经过审批门**的动作（现读，四条）

1. **`verify` 系统门跑目标仓的任意构建/测试命令** —— `src/agent/loop.ts:409-424` 显式排在权限门**之前**（注释：「系统门：优先于权限门与 TOOLS」），
   执行体 `src/agent/loop.ts:421 → verifyBeat`，钩子在 `src/main/agent-runner.ts:1804` 注入（`createVerifyHook`，定义 `src/agent/verify.ts:325`），
   命令来源是目标仓 `.agent/config.json` 与 `package.json` scripts / 语言探测（`src/agent/verify.ts:1-3`、`:173-186`，会造出 `cargo test` / `go test ./...` / `make test` / `python3 -m pytest`）。
   同族不一致值得点名：`diagnose` 因为「执行进程」被登进 `SIDE_EFFECT_TOOLS`（`src/permissions/autonomy.ts:219-222`）并走 `gatedTool`，
   而 `verify` 同样执行进程却**不出一张卡**。（唯一补救是 `src/permissions/autonomy.ts:371` 的冻结表 `frozenJudgePaths`，那是禁写不是审批。）
2. **插件 hook 的任意 shell** —— PreToolUse/PostToolUse/SessionEnd 的 shell form 整串交给 `/bin/sh`（`src/agent/plugins/hooks.ts:271-275`、执行点 `:446`），
   唯一前置是**一次性**的插件信任卡（`src/main/agent-runner.ts:2529` `handlePluginDecide` / `src/agent/plugins/trust.ts:125`）；
   之后每条钩子命令逐次执行时不再问人，而 hook 本身无特权、只能加严不能放宽（`src/agent/loop.ts:426-451`）。
3. **工作区自配 LSP server 的子进程执行** —— `lsp` 在 TOOLS 里（`src/tools/index.ts:20-31`）却不在 `GatedName`；
   六个 operation 全是只读（`src/tools/lsp.ts:509`），所以**工具动作面**没有旁路；
   但 server 本体是按工作区 `.agent/lsp.json` spawn 的子进程（`src/tools/lsp.ts:611-620` `loadLspConfig`；`src/tools/process.ts:3-4` 把 LSP server 与 run_shell、verify 脚本并列为「以子进程形态运行的模型侧输入」，env 消毒只挡凭据、不挡执行本身），开一个仓等于跑它的仓配置 —— 这一条无卡。
4. **只读 MCP 注解 = 自证清白即免批** —— `src/permissions/autonomy.ts:283-289`：MCP 只有 server 自己给了 `readOnlyHint` 才算读；
   判据本身 fail-closed，但输入源是被调用方**自己声明**的（`McpGrade.annotated/readOnly`，`src/permissions/autonomy.ts:267-271`），
   标注错/说谎即一路 `L4-pass`（`:471-473` 只拦 critical）。这是设计选择，但它是名单外的一条放行通道，审计时要认得。
5. **`spawn_agent` 无 blanket 卡**（同属名单外，但这是明写裁决不是遗漏）：`src/main/agent-runner.ts:1028-1032`
   ——「派生审批由 orchestrator 按风险分级出卡，此处不再叠一张 blanket 卡」，实测四张卡在 `src/agent/orchestrator.ts:887,1238,1263,2422`
   （租约相交 / pipeline / supervise / merge）；资源不相交的 read worker 在任何档位都无卡派发。

---

## 3. 展示 diff 供审查 —— **半**（worker 有完整审查面，主会话只有摘要行）

### 已有的出口（都是真的）

| 面 | 位置 | 内容 |
|---|---|---|
| 补丁本体生成 | `src/agent/worktree.ts:183-190` | `git add -N .` + `git diff <base_commit>` 出 `--stat` 与 patch（含未提交改动；symlink 目录排除；`:50` 还专门修过多字节切块） |
| diff 收据落事件流 | `src/agent/orchestrator.ts:2077` | 以 `"[diff] v<N> vs <sha>"` 开头的 `tool_result` 正文 |
| 收据识别 | `src/agent/diff-review.ts:22-26` | `isWorkerDiffReceipt`（`callId.startsWith("diff-")` 兜底支 + `[diff] v` 主干标记，两侧同标记有棘轮） |
| 整块渲染给人 | `src/cli.ts:434-440` | 明确不压首行：「看不见的 diff 等于没有审查面」，整块打 |
| 逐文件接受/拒绝 | `src/agent/diff-review.ts:38-60`（认候选）、`:102-122`（还原计划）、`:131-158`（落实：`git checkout` / 删文件 / 改名类标 manual 并如实点名）、`:169-185`（`a`/`r`/`1,3,5` 解析，非法输入**不静默回落成全接受**）、`:190-192`（决议 → `card_action` 动作名）、`:194-199`（`## patch` 段抽取） | 纯逻辑层，交互留在 `src/cli.ts:713` `reviewWorkerDiffs`，入口 `src/cli.ts:1131-1137`（TTY 才弹，被 Ctrl-C 取消的轮次不弹） |
| 行级评审回注 | `src/events/index.ts:427-438` `diff_comment`；producer `src/main/agent-runner.ts:2343`；消费 `src/agent/orchestrator.ts:2358`（定向注入该 worker 子流）；上下文侧不再吞掉它 `src/agent/context.ts:276-277` | 「评论 → 定向修正 → diff 卡 v2」闭环（M3b） |
| 计划展示 | `src/events/index.ts:119-130` `PlanProposal{goal,files[{path,action,summary}],approach,verify}` + `plan_proposed`/`plan_approved`；工具 `src/tools/propose_plan.ts:58-79`（提交即置写禁，`:67`）；CLI 出一次真决策而非一行摘要 `src/cli.ts:1014-1020` + `promptForPlan`；门状态机 `src/agent/gates.ts:1-9` | 这是「展示计划」最强的一格 |
| 澄清 | `src/tools/clarify.ts:1-6,60-76`；`src/events/index.ts:117` `clarify_requested`；`src/cli.ts:1026-1029` `promptForClarify` | 1–4 问 / 每问 2–4 选项，提交值逐字回成 `tool_result` |
| 卡片回写协议 | `src/events/index.ts:415-426` `card_action`；入口 `src/main/agent-runner.ts:2276` `handleCardAction`（merge / reject / resume / cancel / respawn / approve） | 人→机的唯一结构化回执面 |

### 缺口

1. **主会话自己的改动没有 diff 面**。审批卡只显示摘要：`src/cli.ts:508-520` `promptForApproval` 打印的是
   `req.tool + argsDigest(req.args) + 风险 + 理由`，而 `argsDigest`（`src/agent/fork-cli.ts:19-25`）对写工具**只回一个 `path`**、
   对 shell 只回命令首行。人在批 `write_file` 的那一刻看不到「这个文件现在是什么、要变成什么」。
2. **事后也补不出来**：`src/events/index.ts:70-84` 主会话写盘只留 `change:"created"|"modified"` + `snapshotId`，
   没有 before/after 内容面 ⇒ 「这一轮把用户树改成了什么」不能从事件流重建，只能人去 `.agent/snapshots/` 里翻，而没有任何代码替他翻（见第 2 节）。
3. `reviewCandidates` 要求 `agent_spawned.mode === "write"`（`src/agent/diff-review.ts:43-45`）⇒ 审查面天然只覆盖 worker；
   主会话改动与 review 面**结构上不相交**。
4. 硬边界：`assertNotAgentArea` / `resolveInWorkspace`（例如 `src/tools/apply_patch.ts:212-217`）保证了不越界、不写 `.agent/`，
   所以 diff 面的缺失纯粹是「给人看」的缺失，不是安全问题。

---

## 4. 可接管 —— **半**（worker 面可接管；主会话只能「停 + 新起一轮」，续跑不接审批态）

### 通的到哪

| 面 | 位置 | HEAD 通到哪 |
|---|---|---|
| 会话续跑 | `src/cli.ts:303-306`（`--session <id>` ⇒ 落 `<ws>/.agent/sessions/<id>.jsonl`，不抹转录）、`:819-820`、`:834`；压缩 `--session --compact`（`src/main/agent-runner.ts:901` busy 拒绝） | **通**：新 run 以既有转录为上下文（投影读事件流），人可带新任务接着跑 |
| 分叉接管 | `src/cli.ts:254-272`（`--fork`/`--from` 用法闸）、`:931-970`（读源日志→算分叉点→写新会话 `<id>-f<n>`，源只读）；纯函数 `src/agent/fork-cli.ts:36` `forkPointOf`、`:50` `forkSessionName` | **通**（按轮次分叉；注：`src/agent/fork-cli.ts` 现读在隔壁手里，本文行号只按 HEAD） |
| 复看 | `src/cli.ts:234-238` + `--replay`；`src/events/index.ts:978` `replayIncremental`（带 ino/截断兜底 `:1006`） | **通**：转录可读、可增量重放 |
| 长任务目标 | 判据纯函数 `src/agent/goal.ts:105-…`（done 只认 `verified` 证据，散文自述不算数）、投影 `src/agent/goal.ts:239` `projectGoal`；续跑 `src/main/agent-runner.ts:2145-2200`（`:2154` 取消优先于预算；`:2160-2172` 无人值守不自动续并落 `goal_stopped`）；人设/人清 `src/main/agent-runner.ts:2211` `handleGoalSet`（`clear` = 追加一条带理由的 `goal_stopped`，`:2233`）；模型侧只许改措辞 `src/tools/refine_goal.ts` + `src/main/agent-runner.ts:1053-1060`（注释：投影层不因 `set_by:"model"` 挪窗口锚点/轮次帽 ⇒ **模型拿不到续跑额度**） | **通且分权**：帽与钱归人，措辞归模型；`src/agent/goal.ts:217`、`src/agent/goal-trace.ts:26` 都明写「人手发的下一条消息不计入 —— 那是人在接管」 |
| worker 接管 | 卡死暂停：`src/agent/orchestrator.ts:1753`（`triggerStuck` 置 `paused`）+ `:1715-1735` `stuckGate`（在**事件边界**阻塞下一拍）+ `:1884` 调用点；人决继续：`:1701-1713` `resumeAgent`，入口 `src/main/agent-runner.ts:2358-2363`；人决取消：`:2381-2385`；换人重派：`src/agent/recovery.ts:61` `interruptedWorkers` / `:76` `respawnArgsFrom` / `:41` `recoveryParentMode`（重派**只采信这条会话历史上真用过的档**，不拿 `settings.mode` 冒充父档 —— 防 §11.7.6 单调继承被换松一档），落流 `src/main/session-handlers.ts:76-99`、入口 `src/main/agent-runner.ts:2366-2376` | **通**（含崩溃后扫描补发 `failed(interrupted)`）；但 `src/agent/recovery.ts:2` 自陈「V1 **无热恢复**」= 接管 = 全新 `agent_id` 重派，不是接着那个进程跑 |
| 旁路问答再并回主会话 | `src/events/index.ts:13-20` `PromoteOrigin`（`/promote` 以 `user_message.origin` 呈现，零新事件类型、重放无损） | **通**（人可以先在 sidechat 里把事弄明白，再决定往主会话注什么） |

### 缺口

1. **审批态不随续跑走**：`src/permissions/plan-state.ts:34-36` `enterPlanRunScope()` 每次都新造 `{required, proposed:false, approved:false}`，
   调用点 `src/main/agent-runner.ts:1587`。⇒ 续跑一条会话时，上一轮的 plan 批准既不会被恢复（武装 `planRequired` 就得重新提案、重新批），
   **也不需要在**（没武装时续跑开局即写禁解除 —— 上一轮那份「未批准的 plan」在盘上仍是 `plan_proposed` 事件，却不再拦任何人）。
   这是接管时最容易被误读的一格：方案门状态是 run 内存态，不是转录事实。
2. **人工决议的 scope 记忆也不续跑**：`src/permissions/autonomy.ts:237-242` `scopeKey` 的放行集住在 `AutonomySession`（`newAutonomySession`，
   `src/permissions/autonomy.ts:~200-208`），每个 run 新建；只有 `always` 那一支会落盘成规则（`persistAlwaysRule`，`isNetworkCommandCall` 注释 `src/permissions/autonomy.ts:244-257` 解释过为什么网络类不许落）。
   ⇒ 接管一条会话要重新逐笔批。
3. **主会话没有「暂停—接管—放行」那一拍**：`stuckGate`/`resumeAgent` 只长在 worker 上（`src/agent/orchestrator.ts:1701,1715`），
   主 loop 的 stuck 面只产出一句提示文本不改控制流（`src/agent/loop.ts:507-526`，`stuckNudge` 只拼 `[repeat]` 到 `tool_result` 尾部）。
   人在主会话中途能做的只有两件事：回答已经问出来的卡（`handleAgentDecide` `src/main/agent-runner.ts:2257`、`handleClarifySubmit` `:2391`、`handlePlanDecide` `:2396`），或整轮取消（`handleRunCancel` `:2411`）。
   「我自己改两个文件再交回给你跑」这条没有入口 —— 只能靠取消 + 新起一轮（第 4 节的续跑面）近似。
4. **取消后的收尾没人接手**：见第 1 节缺口 2/3/4 —— 被中断的主会话既不落取消事实、也不回滚已落盘；
   worker 侧反而齐备（`src/agent/orchestrator.ts:2039-2049` cancelled 走 `cleanupWrite`、放行等待方、标后环 `dependency_failed`）。
5. **会话级取消在 `src/` 里没接线**：`src/main/ipc-protocol.ts:161-164` 已把契约写成 `runCancel(sessionId?)`，
   但 `handleRunCancel()` 无参且只认唯一的 `interactiveRunAbort`（`src/main/agent-runner.ts:244,1581,2411`）⇒ 并发交互 run 场景下
   「取消的是不是用户点的那一条」在核心面没有判据（unattended/scheduled 的取消走 `over.signal`，`src/main/agent-runner.ts:2088`，另一条路）。

---

## 探针自证（负控 + 换写法）

| 我宣布「没有」的东西 | 换的写法 | 负控（同一条探针必须命中已知存在者） |
|---|---|---|
| 快照回滚面 | `restore\|rollback\|回滚\|恢复原件\|snapshotId`（大小写不敏感全 `src/`），再补 `restoreSnapshot\|revertFile\|undoWrite\|snapshotRestore\|还原原件` | 第一轮命中 42 条，其中真「回滚」语义都在 worker worktree / JSONL 事务语境（`src/agent/orchestrator.ts:789-801`、`src/main/sessions.ts:223,264,298`、`src/main/session-metadata.ts:233`）；第二轮对快照语境**零命中** ⇒ 探针有分辨力，「无」成立。另外正向对照：`grep -rn "SNAPSHOT_ROOT\|snapshots" src/` 命中 12 处（`src/tools/snapshot.ts` 之外只到 `src/events/index.ts:70`、`src/agent/reproducibility.ts:91`、`src/agent/gym/draft.ts:9`），**全是 writer 或注释，无 reader** |
| 主会话 diff 面 | `补丁\|unified diff\|createPatch\|diffText\|renderDiff` | 同探针在 `src/agent/worktree.ts:183-190`、`src/agent/diff-review.ts`、`src/tools/patch-parse.ts` 大量命中 ⇒ 探针有效；命中全落在 worker/补丁解析语境，`src/permissions`＋审批卡路径零命中 |
| 中途插话/steering | `steer\|接管\|插话\|排队\|queue.*message\|already running` | 同探针命中 `src/agent/goal.ts:217`、`src/agent/goal-trace.ts:26`（「人在接管」是记账语义不是通路）、`src/main/agent-runner.ts:1590`（busy 拒绝）⇒ 「人往在途 run 注话」确实没有通路 |
| `interrupt` 这个标识符 | `abort\|interrupt\|取消\|喊停\|中止\|中断\|让出`（大小写不敏感） | 命中 120+ 条，`interrupt` 只以 `interrupted`（worker 崩溃恢复 reason）出现（`src/events/index.ts:338,368`、`src/main/session-handlers.ts:80-98`、`src/agent/recovery.ts:2`）⇒ 概念存在但命名归在「崩溃恢复」，不在「人喊停」 |

---

## 三行小表：哪一格当下最值得做

排序口径 = 补上它的价值 ／ 需要动的文件是否干净（不跟隔壁抢 `loop.ts`/`orchestrator.ts`/`agent-runner.ts`） ／ 改动量级。

| 候选格 | 补上它的价值 | 需要动的文件是否干净 | 改动量级 |
|---|---|---|---|
| **第 2 格（可回滚）**：给 `.agent/snapshots/` 装 reader + 还原计划 | 最高。这是**唯一「已写的数据正在丢失且无人能取回」**的一格：writer 已在三把写工具上默认开（`src/tools/base.ts:40-44`）、正文与事件流都已带路径（`src/tools/snapshot.ts:50-51`、`src/events/index.ts:70-72`），`tests/snapshot-d7.test.ts` 已钉好「原件逐字一致」，只差取回那一步；而现状是原件写进去就**没有任何代码读它**（本文探针实测零 reader） | **全干净**：`src/tools/snapshot.ts`、`src/tools/base.ts`、`src/tools/write_file.ts`、`src/tools/edit_file.ts`、`src/tools/apply_patch.ts`、`src/agent/diff-review.ts`（可借它的 `RevertEntry` 形状，`:91-122`）、`src/events/index.ts`、`tests/snapshot-d7.test.ts` | 小–中。纯函数层（列出一次覆盖的原件 / 算还原计划 / 与 `applyReverts` 同纪律的路径包含性检查）＋一条工具或 CLI 只读出入口；不碰 loop/orchestrator/agent-runner 一行 |
| 第 3 格（主会话 diff 进审批卡） | 高，但价值**排在第 2 格之后**：`diff-review.ts` 的逐文件接受/拒绝已经建好，缺的是把它从 worker 面平移到主会话面 | **抢文件**：卡面在 `src/cli.ts:508-520`（在飞）、挂载在 `src/main/agent-runner.ts:511-660`（在飞）、`argsDigest` 在 `src/agent/fork-cli.ts:19`（在飞） | 中，且必撞隔壁 |
| 第 1 格（中断的可审计性 + 轮内界点） | 中高：取消在主会话不落任何事实（`src/agent/loop.ts:367` 裸 return、`src/main/agent-runner.ts:1916` finally 不记、goal 被取消不落 `goal_stopped` `src/main/agent-runner.ts:2154`），第 8 条要求的「可解释」在这一格断线 | **抢文件**：`src/agent/loop.ts`、`src/main/agent-runner.ts`、`src/cli.ts`、`src/agent/orchestrator.ts` 四件全在隔壁手里；只有 `src/events/index.ts`（加事件字段）干净 | 中，且必撞隔壁 |
| 第 4 格（主会话暂停/接管、审批态随续跑） | 中：需求最硬，但它是**通路**不是缺口 —— 续跑/分叉/goal 三件都已经在跑（本文第 4 节表），缺口全在 run 级内存态与 loop 控制流上 | **抢文件**：`plan-state.ts`（干净）＋ `src/main/agent-runner.ts:1587`、`src/agent/loop.ts`（都在飞）；主会话 stuck 通路要动 `src/agent/orchestrator.ts:1701-1735` 的兄弟面 | 大（并发 run 隔离与 ALS 语义已被 P1/H3 两轮审查钉死，动它要重跑那套判据） |

**提名（只提名，不实施）**：**第 2 格「可回滚」**——给 `src/tools/snapshot.ts` 的 D7 快照面补上 reader/还原计划那一半。
理由三条同向：价值最高（唯一在丢用户数据）、文件全干净（一寸不碰 `loop.ts`/`orchestrator.ts`/`agent-runner.ts` 这三个正在飞的面）、量级最小（纯函数 + 一条判据，`tests/snapshot-d7.test.ts` 已有 7 条现成尺可加）。
第 1、3、4 格不是不该做，是**当下不该由我这笔做** —— 它们的主文件都在隔壁手里。
