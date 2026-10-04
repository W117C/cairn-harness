# 人机协作那一格：可中断 / 可解释 / 可接管 —— 现读取证报告

- 日期：2026-10-05 ｜ 只读取证（handoff face）
- 口径：**一律 HEAD = `513d4d7d10f9296ef8f0086dd33f585c955ccf9f`**（`git show HEAD:<path>`）。工作树有 168 项未提交改动，凡引用工作树处均标「未入库」。
- 允许的取证手段：Read / Grep / Glob / `git show HEAD:` / `git status --porcelain <path>` + 一支自写只读探针（`outputs/handoff-face-2026-10-05/probe-interrupt.ts`，`node --import tsx` 跑，不写盘、不起服务、不读凭据、不调模型）。
- 未跑任何 vitest / typecheck / mutate-verify / head-cert / `*-check` / 真模型评测。
- 本人**没有**修改任何 `src/`、`tests/`、`scripts/`、`docs/`、`PROGRESS.md`、`.agent/` 文件；未做 `git add/commit/stash/checkout`。`plan-state.ts` / `agent-runner.ts` 的在飞改动只读不碰。

---

## 1. 可中断

### 1.1 链路（HEAD 实况）

```
CLI SIGINT (src/cli.ts:1160-1170)
  └─ handleRunCancel()  src/main/agent-runner.ts:2449-2454
       └─ interactiveRunAbort.abort()   （模块级单例，:248 / 置位 :1592 / finally 摘除 :1943）
            └─ signal = AbortSignal.any([opts.signal, runAbort.signal])   :1591
                 └─ runLoop({ signal })  :1795   → src/agent/loop.ts:80
```

桌面端**不走这条链**：`apps/desktop/src/main/kernel-host.ts:226-231` 自建 per-session `AbortController`，经 `RunOverrides.signal` 注入（`index.ts:159 runCancel(sessionId) → host.cancel`）。`kernel-host.ts:55` 明写「M2 全局缝 handleRunCancel 不再经此出口」——并发会话下它杀的是最后启动的那一场。

⇒ **`handleRunCancel` 的唯一产品调用方是 CLI 的 Ctrl-C**（其余是 `tests/session-wiring.test.ts`、`tests/cli-surface.test.ts`）。

### 1.2 signal 落到的地方（HEAD 逐个点名）

| 落点 | 位置 | 语义 |
|---|---|---|
| 轮界 | `loop.ts:369` `if (opts.signal?.aborted) return;` | **静默 return，不落任何事件** |
| 模型流 | `loop.ts:337` → `providers/{openai,anthropic,gemini,glm}.ts` 的 `call.signal`；`retry.ts:72-88` | 在途 fetch 随 abort 收束 |
| 工具上下文 | `loop.ts:490` → `ToolContext.signal`（`tools/base.ts:12`） | 只有自觉读它的工具可中断 |
| 长驻 shell | `tools/run_shell.ts:61-77` 组杀进程树，回执 `exitCode:null` | ✅ 真中断 |
| 审批门 | `main/ask-gate.ts:88-96`（`gatedTool:555` / `gatedMcpTool:646` / 安全模式 `:530` / automation 四件 `:1225-1278` / `obs_recall`） | abort ⇒ 按 `rejected(reason=user)` 收束 |
| 澄清门 / 方案门 | `agent/gates.ts:34-37`，`agent-runner.ts:1808,1816` | abort ⇒ 抛 `ToolError("…随会话中止而取消")`，被 loop 的 catch 折成 `tool_result{ok:false}` |
| 沙箱复检 | `agent-runner.ts:604` `cancelled before sandbox lint` | ✅ |
| action-fusion | `agent/action-fusion.ts:49,61,73,84,85` | ✅ |
| verify 门 | `loop.ts:216` `opts.verify.run(opts.signal)`；`agent/verify.ts:170` | ✅ |
| wait_for_agents | `tools/wait_for_agents.ts:40` → `orchestrator.ts:1655` | **只结束等待，不动 worker**（:1653 注） |
| 会话末沉淀 | `agent-runner.ts:1912,1921`；`memory/distill.ts:217-237` `throwIfAborted` | ✅ 不再花钱，但失败只 `console.warn`（`:1936`） |
| 压缩 | `agent/glm-session.ts:600,1063,1076,1122` | ✅ |

**未接线的两处**：
1. **MCP 工具**：`agent-runner.ts:660` `await rt.mcp.callTool(...)` 不传 signal（`agent/plugins/mcp.ts` 全文无 `signal`）⇒ 一次在飞的 MCP 调用**打不断**，只能等它自己返回。
2. **worker 树**：见 1.3。

### 1.3 worker 那一树 **不是**同一条链（缺口）

`Orchestrator.root` 是它自己的 `AbortController`（`orchestrator.ts:134` HEAD），worker 的 controller 只挂在 `root.signal` 上（`:742-747`），worker 的 loop/provider 只吃 `w.controller.signal`（`:1827,1865`）。

- `root.abort()` 的**唯一**调用点是 `cancelAll()`（`:965`）；
- **`cancelAll()` 在产品代码里零调用方**（全仓只有测试与 `PROGRESS.md` 提到；`card_action cancel → cancelAgent(单个)`，`cancel_agents 工具 → cancelAgents(ids)`）。
- `buildSessionOrchestrator`（`agent-runner.ts:390-421` HEAD）**没有 signal 形参**，`OrchestratorOptions`（`orchestrator-types.ts:188+`）也没有 signal 字段 ⇒ run 的取消信号没有任何桥接到编排器。

⇒ 用户按停止后：主 turn 收束，**已派出的 worker 继续跑、继续写自己的 worktree、继续花自己的钱**；`wait_for_agents` 那侧只把等待解掉。要停 worker 只有逐条 `card_action cancel` / `cancel_agents` 点名。

### 1.4 中断发生在轮界还是工具执行中？

**轮界**（`loop.ts:369` 在每个 step 顶部判一次）。工具执行中**不打断**，除非该工具自己读 `ctx.signal`（shell/verify/fusion/门/压缩读；MCP 与「工具跑完后 loop 继续消费同轮剩余 tool_call」不读）。

探针实测（只读，输出在下面 §6）：

- 轮界取消：`runLoop` **正常返回**（不抛），事件流 = `[user_message]`，取消/中止字样事件 0 条；
- 一轮说完后取消：`[user_message → assistant_message ×2]`，无 `error`、无取消留痕；
- 工具执行中取消（工具自己 abort 再返回成功）：`[user_message → tool_call → tool_result{ok:true, gate 缺席, blockedBy 缺席}]`，随后轮界收束 —— **已写盘的那一条改动在流里长得和「顺利完成」一模一样**，没有任何「这条是取消那一轮写的」的标注。

### 1.5 取消时已写盘的改动 / 「这一轮被取消」的可见性

- 逐条改动**有**留痕：`tool_result{ok, output, snapshotId?, change?, exitCode?, timedOut?, blockedBy?, hold?}`（`events/index.ts:70-84`）。
- **轮级取消留痕没有**：`AgentEvent` 联合（`events/index.ts:628-660`，30 型）里**不存在**任何 run/turn 级取消事件型；`loop.ts:349` 还刻意**不**为 abort 落 `error`（`tests/loop-error-event.test.ts:62` 钉死这条语义）。
- `src/cli.ts:1156-1157` 那句注释写着「轮界收束、门等待按拒结算、**落一条可审计的取消**」——**这半句在 HEAD 不成立**（没有任何东西落盘）。
- 用户看得见吗：
  - CLI：只看得见 SIGINT 时自己打的那行黄字（进程内），以及门取消折成的 `tool_result` 散文；退出码 = `EXIT_FAILED`（`cli.ts:1153` + `runFailed` 把 `plainToolFailures` 也算失败，`:1037`）⇒ **一次正常停止被记成「运行失败」**，脚本无从分辨。
  - 桌面：`■ 已停止` 来自 run 收束响应的 `aborted` 真值 + 本地乐观标记（`App.tsx:237-241`、`kernel-host.ts:231`），**内存态**，不在事件流里（见 §4）。

---

## 2. 可解释

### 2.1 事件流里「我在干什么」的型（HEAD 30 型，`events/index.ts:628-660`）

`user_message(origin/skill) / assistant_message / assistant_delta / tool_call / tool_result(auto,gate,snapshotId,change,exitCode,timedOut,blockedBy,hold) / usage(model,agent_id) / session_meta / clarify_requested / plan_proposed / plan_approved / verify_result / compaction / security_report / impact_report / agent_spawned / agent_status / agent_message / agent_result / approval_requested / approval_resolved / card_action / diff_comment / routing_decision / automation_triggered / automation_skipped / automation_completed / goal_set / goal_stopped / turn_truncated / surface_account / error`

结构化的「被谁拦的」三列**是齐的**（这是本仓做得最好的部分）：
- `TOOL_BLOCK_REASONS`（`events/index.ts:46`）= `tool-table / skill-denial / verify-unwired / hook / permission / unknown-tool`，六道执行前闸各落一处；
- `HARNESS_HOLD_REASONS`（`:57`）+ `HARNESS_HOLD_PROSE_TOKEN` = `budget / concurrency-limit / cancelled / dependency-failed / chain-failed`，「压根没起」与「起了但失败」分列；
- `GATE_LAYERS`（`permissions/autonomy.ts:30-44`，11 层含 `X-distill`）× `GATE_VERDICTS`（`:45`，6 态）⇒ `tool_result.gate: GateMeta{layer,verdict,risk?,mode?,scope?,ruleId?}`，落点在 `gatedTool`（`agent-runner.ts:535,544,563-564,584-587`）与 `gatedMcpTool`（`:634,637,649,656-659`）；
- 读数面 `scripts/replay/gate-outcomes.ts` 按 `layer × verdict` 铺矩阵。

### 2.2 呈现面

- **CLI**（`src/cli.ts` HEAD 427-500）：`⚙ <tool> <args>`（:432）、`✓/✗`（:441）、**`[gate.verdict]`**（:442，只 verdict 不 layer）、`✗ 第 N 轮出错`（:452）、worker 生命周期 `◆/→status`（:461,477）、`goal_set`/`goal_stopped`（:486-489）。
- **桌面**（`apps/desktop/src/renderer/projections.ts:46-83`）：`StreamRow` 只有 4 型（user/assistant/tool/error）。`tool_result` 只回填 `{pending, ok}`（:69-72）；`default: break`（:82）。

### 2.3 「许诺过但没落」的解释面（逐条）

| # | 许诺 / 出处 | HEAD 实况 |
|---|---|---|
| E1 | `src/cli.ts:1156` 「落一条可审计的取消」 | **无此事件型**（取消那一轮在 JSONL 里与正常结束同形） |
| E2 | `docs/superpowers/specs/2026-10-02-desktop-shell-design.md:552` 「来源徽标：goal →『自动续跑』」「skill 徽标」 | `projectStream` 不带 `origin/skill`（`projections.ts:49`）⇒ **桌面里 agent 自己发的续跑轮，看上去是用户发的** |
| E3 | `events/index.ts` 里 `gate/blockedBy/hold/snapshotId/exitCode/timedOut` 的结构化留痕 | 桌面投影一格都不读 ⇒ 「被哪一层拦的」在**桌面 UI 里读不出**；只有 CLI 能看到 `verdict`（连 `layer` 都不显） |
| E4 | `verify_result` 是 goal 判据里的「证据」，也是能力 5 的收束闸 | 桌面渲染**零引用** `verify_result`（全 renderer grep 无命中）⇒ 用户在 UI 里看不见「验了没有」 |
| E5 | `goal_set / goal_stopped`（「为什么不跑了」的唯一载体，`agent-runner.ts:2178-2181`） | 桌面零渲染；`setGoal` 通道在 `channels.ts:19` + `index.ts:194` 已接，但 renderer 没有任何 goal 入口 ⇒ **goal 模式在桌面不可设、不可见**，CLI-only |
| E6 | `compaction / security_report / impact_report / turn_truncated / routing_decision / surface_account / automation_*` | 桌面 `default: break` 全丢；CLI 只渲染 `security_report / impact_report / turn_truncated / usage`，其余 `default: null` |
| E7 | `agent_status{cancelled}`（worker 有取消留痕，`events/index.ts:287,338`） | 桌面 `isWorkerSubflowEvent` 把 `agent_status/agent_message/agent_result` **整族滤掉**（M3 裁定「worker 子视图留 M4+」）⇒ 主会话取消后 worker 的结局在人这边根本读不到 |
| E8 | 目标漂移读数（能力 4 的真读数） | `agent-runner.ts:1984-1991` 只 `console.warn`，明写「不落事件流」⇒ 桌面（无 stderr 面）**永不现** |
| E9 | `HISTORY_STATES` 含 `"cancelled"`（`main/scheduler.ts:366-368`） | 注释自己写着「cancelled 为保留态：**V1 无取消入口**」；`runOccurrence` 只写 `succeeded/failed` ⇒ 定时任务在飞时人**没有任何停止按钮** |
| E10 | 门被取消收束的 `GateMeta.verdict` | `agent-runner.ts:563-564`：abort ⇒ `askGate` 回 `reason="user"` ⇒ 落 `verdict:"rejected"` ⇒ **「人按了停止」与「人拒了这个动作」在 `layer × verdict` 矩阵里同一格**（免批率/人拒计数的口径污染） |

---

## 3. 可接管

结论：**上下文与目标接得上；方案门、skill 工具禁令、快照回滚这三样接不上。**

| 状态 | 跨 turn 取法 | HEAD 判定 |
|---|---|---|
| 会话上下文 | `projectContext(events)` 从 JSONL 重放（append-only，一事件一行） | ✅ 从头不算 |
| goal 轮次 | `projectGoal`（`agent/goal.ts:239-253`）→ `traceGoal`：`turn` 取自 `user_message.origin.kind==="goal"` 事件，窗口切片 `events.slice(trace.at+1)`，usage/证据/写盘全从流重算（`goalWindowSpend:263`、`sumWindowUsage:298`「不留第二份账」） | ✅ 范例，符合不变量；且「人手发的下一条消息不计入轮次」（`goal.ts:217`）⇒ 人插话不被记成 agent 烧的一轮 |
| plan 门布尔 | **只在内存**：`enterPlanRunScope()`（`permissions/plan-state.ts:34-37` HEAD）每条用户消息从 `{required,proposed:false,approved:false}` 重武装；`markPlanProposed()`/`approvePlan()` 只写 ALS | ❌ **HEAD 空转**：`propose_plan` 给模型的回执写着「写禁保持（存在未批准 plan）」，而下一条消息就把写面敞开。修法正是在飞的那支（`planPendingFromEvents`/`seedPendingFromEvents`，工作树 `plan-state.ts:80-101` + `agent-runner.ts:1612` hunk，**未入库**；配套 `tests/plan-persist-cross-run.test.ts` 未跟踪）⇒ 本报告不重复给方案 |
| 已激活 skill | `PluginRuntime` **每 run 重装**（HEAD `agent-runner.ts:1660`），`skillScopes`（`plugins/index.ts:158`）只在 `triggerSkill`（`:231`）当轮写；`skillDenial()`（`:245`）与规格面同源（`sessionToolFace:704-708`） | ❌ **禁令跨 turn 失效**：skill 声明的 `disallowed-tools` 在下一条用户消息后归零（skill 正文还在流里，因为它是 `user_message.content` + `skill` 元数据，`remountFromEvents:456` 只服务压缩重挂，不回填 `skillScopes`）。同一族坑刚在 plan 门被点名（C6），这一支还没人修 |
| 快照 / 回滚点 | `snapshotBeforeOverwrite`（`tools/snapshot.ts:29-47`）按字节抄进 `.agent/snapshots/<ts>--<callId>/<rel>`，`snapshotId` 随 `tool_result` 落流（`:70-72`） | ⚠️ 有原件、无入口：**全仓没有 restore 工具/UI 动作**，`snapshotNote` 只教模型「复制该文件取回」。且 `snapshotId` **缺席 = 三因合一**（新建 / 空文件 / 快照失败，`snapshot.ts:26-27,44-46` 失败只 `console.warn`）⇒ 人在取消后想回滚，无法从流里判断「当时到底保没保住」 |
| worker 现场 | 编排器随 run 重建（`workers = new Map()`，`:129`），**无 rehydrate**；只有 `handleSessionOpen → applyCrashRecovery`（`session-handlers.ts:76-98`）把无终态 worker 补成 `failed(reason=interrupted)` + 恢复卡 `artifacts.respawn`，`respawn` 走**全新 agent_id**（`orchestrator.ts` respawn） | ⚠️ 接管 = 重派，不是接上；且 §1.3 的「取消不停 worker」会让老 worker 在**已被替换的编排器**里继续往同一份 JSONL 追加（`events/index.ts:829-831`：close 后 append 会重开句柄）⇒ 转录边收口边长新行 |

---

## 4. 中断后的诚实性：「只写成功态、不写失败态」的格子

HEAD 上点名如下（按用户真会撞上的顺序）：

1. **轮界取消 = 零留痕**（`loop.ts:369`）。探针 A/B/C 实测：不抛、不落 `error`、不落任何取消事件；`runAgent` 正常返回 `replay(logPath)`（HEAD `:1987`）。
2. **取消后 goal 照续跑（最严重）**。`handleAgentRun` 的续跑闸门是 `aborted: () => over.signal?.aborted === true`（HEAD `:2153`，谓词体 `:2192`），而 `over.signal` **只**由桌面 kernel-host 注入；CLI 那条路 `over.signal` 缺席（HEAD `src/cli.ts:1091-1145` 不传 signal），`handleRunCancel` 拨的是**内部** `runAbort`（`:1590`）。`tests/session-wiring.test.ts:219` 甚至把这条不对称钉成了断言：`expect(caller.signal.aborted).toBe(false)`。⇒ CLI `--goal` 场景：轮界取消 ⇒ `runAgent` 正常返回 ⇒ `goalNextTurn` 读到的 `aborted()` 恒 false ⇒ `goalStopDecision`（`goal.ts:105-145`）在 `wrote=true` 或 `truncated=true` 时返回 `continue` ⇒ **用户按了停止，agent 立刻起新一轮**（并且 `interactiveRunAbort` 在 finally 已被摘掉（`:1943`），新一轮再置位（`:1592`），第二次 Ctrl-C 落在的正是这场新 run）。
3. **异常/取消收场时 goal 不落终态**。`goal_stopped` 只有四处写入点：硬上限 `:2164-2170`、无人值守 `:2205-2215`、判据 stop `:2237-2238`、用户 `clear` `:2277`。**取消（`handleRunCancel` 生效）与 runAgent 抛错（`catch → return {ok:false}`，HEAD `:2168`）两条收场都不写** ⇒ `projectGoal().stopped` 仍为 null ⇒ 目标在盘上「还活着」，下一条用户消息会把它复活。这正是本仓自己写过的那句形状：「只 return ok:false 的话芯片仍显示『续跑中』」（`:2165-2166`）——同一族坑补了一条支路，另外两条还开着。
4. **已停止态是内存真值**。`stoppedIds`（`App.tsx:240`）来自 run 的 promise 返回值，不落流 ⇒ 重开会话后 `deriveRunPhase(events)`（`projections.ts:96-121`）从尾扫：**未收口的 `tool_call` ⇒ 相位恒 `"tool"`** ⇒ UI 标签回到「● 执行工具」。取消恰是最容易留下未收口 `tool_call` 的路径（provider 流被 abort 在 `tool_call` 之后）。
5. **MCP 工具打不断**：`callTool` 无 signal（§1.2）⇒ 取消后这条回执要等它自己回来。
6. **worker 树不受 run 取消**（§1.3）：`hold:"cancelled"` / `agent_status{cancelled}` 只有点名取消才写；run 取消后 worker 继续跑，主会话已收口 ⇒ 「看起来停了、其实还在跑」的另一半。
7. **护栏缺位被折进成功态**：覆盖前快照失败 ⇒ `snapshotId` 缺席，与「新建文件」同形（§3）；`appendImpact` 吞错；hook 引擎失败只 `console.warn`（`loop.ts:450`）；插件装载降级 `:1672`；沉淀轮失败 `:1936`；solpi 落账失败 `:1945`；SessionEnd/Stop 失败 `:1962-1965`、`:1836`；沙箱不可用只进 `getState` 快照。⇒ 这一族在 `runAgent`（HEAD）里有 **22 处 `console.warn`**（`:1666` 插件装载降级、`:1830` Stop 钩子、`:1930` 沉淀轮、`:1939` solpi 落账、`:1953-1959` SessionEnd、`:1981/:1985` 目标漂移……），没有一处进事件流。
8. **一次停止 = 一个失败退出码**（CLI `runFailed` 把取消折成的 `tool_result{ok:false}` 计入 `plainToolFailures`，`cli.ts:1037,1153`）。
9. 定时任务无取消入口（E9），`inflight` 只在 `runOccurrence` 末尾 `delete`（`scheduler.ts:857`），闸二硬退出后 `outcome===null` 折成 `failed(timeout)`——这条**是**写了失败态，但「人主动取消」这一格根本没有。

---

## 5. 结论：前 3 个「用户真会撞上」的缺口 + 最小改法

> 撞面现读（`git status --porcelain <path>`）：
> **DIRTY** = `src/main/agent-runner.ts`（在飞 #84，hunk 只落在 HEAD `:48` 与 `:1612`+6 行）、`src/permissions/plan-state.ts`（在飞 #84）、`src/agent/orchestrator.ts`（merge-gate 重构 + env 改名，hunk 在 `:57-60/:593-612/:2293-2310`）、`src/cli.ts`（86 行）、`apps/desktop/src/renderer/App.tsx`、`apps/desktop/src/main/index.ts`、`scripts/mutate-verify.mjs`、`docs/CODE-WIKI.md`、`src/agent/system-prompt.ts`；新增未跟踪判卷 `tests/plan-persist-cross-run.test.ts`、`tests/compaction-goal-keepfirst.test.ts`。
> **CLEAN** = `src/agent/loop.ts`、`src/events/index.ts`、`src/agent/goal.ts`、`src/agent/goal-trace.ts`、`src/agent/gates.ts`、`src/main/ask-gate.ts`、`src/agent/orchestrator-types.ts`、`src/agent/plugins/index.ts`、`src/main/scheduler.ts`、`apps/desktop/src/renderer/projections.ts`、`tests/loop.test.ts`、`tests/goal-continue.test.ts`、`tests/cli-surface.test.ts`、`tests/session-wiring.test.ts`、`tests/event-type-coverage.test.ts`、`PROGRESS.md`。

### 缺口 1（最高优先）：CLI 里「按了停止，goal 接着跑下一轮」

- **根因**：取消真值有两个持有者——内部 `runAbort`（`agent-runner.ts:1590`）与外来 `over.signal`；续跑闸只读后者（HEAD `:2153`）。
- **最小改法**（两处，共 ~4 行）：
  1. `src/main/agent-runner.ts` `runAgent`：置位处（HEAD `:1592` 之后）把 `runAbort` 交回调用方——最小形状是 `RunOptions` 增 `onRunAbort?: (c: AbortController) => void`，或让 `runAgent` 接受一个 `registerAbort` 出参；`handleAgentRun` 的 for 循环里存住它，并把 `aborted:` 改成 `() => over.signal?.aborted === true || currentRunAbort?.signal.aborted === true`（HEAD `:2153`）。
  2. 同处取消后**必须落一条事实**（缺口 3 一起解）：`{type:"goal_stopped", reason:"用户请求停止…", turn, evidence}`，复用现成的 `emitGoalEvent`（HEAD `:2176-2184`）；不要新造事件型。
- **代价**：实现 ~6-10 行；判卷 1-2 条（建议 `tests/goal-continue.test.ts`（CLEAN）加「轮界取消 + 已写盘 ⇒ 不续跑、且落 `goal_stopped`」；`runAgent` 那条出参的接线另钉一条「摘掉 ⇒ 红」的针脚）。
- **撞面**：`src/main/agent-runner.ts` **DIRTY，且在飞改动的就是这一带**（`:1590-1612` 区间）。文本上他们的 hunk 止于 HEAD `:1612`+6，`:1592`/`:2153` 不动 ⇒ 可同文件不同 hunk，但**必须等 #84 落库后再动**，否则同一文件两笔并飞；`mutate-verify.mjs` 也 DIRTY（新锚点条目撞它）。

### 缺口 2：run 取消不穿到 worker 树（停了主线，没停分身）

- **根因**：`Orchestrator.root` 与 run 的 `signal` 之间没有桥；`cancelAll()`（`orchestrator.ts:950-966`）**产品代码零调用**。
- **最小改法**（两文件，约 6 行）：
  1. `src/agent/orchestrator-types.ts`（CLEAN）`OrchestratorOptions` 加 `rootSignal?: AbortSignal`；
  2. `src/agent/orchestrator.ts` 构造器内（HEAD `:134` 之后）`if (opts.rootSignal) { if (opts.rootSignal.aborted) this.root.abort(); else opts.rootSignal.addEventListener("abort", () => this.cancelAll(), { once: true }); }`（照 `:744-747` 已立的「注册后立刻复查」纪律，`addEventListener` 对已 abort 的 signal 不触发）；
  3. `src/main/agent-runner.ts` `buildSessionOrchestrator`（HEAD `:390-421`）透传一个形参 + 调用点（HEAD `:1648-1660`）传 `rootSignal: signal`。
- **代价**：实现 6-8 行；判卷 1 条（`tests/agents.test.ts` 一族 / `scripts/agents-check.ts` 的 E3-E6 附近加「root 桥：run abort ⇒ 全树 cancelled，且 `agent_status{cancelled}` 落流」）；**注意** `cancelAll` 一旦有了调用方，`hold:"cancelled"` 的既有断言面会开始被真触发。
- **撞面**：`src/agent/orchestrator.ts` **DIRTY**（未入库改动在 `:57-60/:593-612/:2293-2310`，与本改法不重叠但同文件）；`orchestrator-types.ts` CLEAN；调用点在 DIRTY 的 `agent-runner.ts`（HEAD `:1648`，离在飞 hunk 30+ 行）。若不想撞 `agent-runner.ts`，可先只做 1+2 并加 `Orchestrator` 的构造期单测，接线留给 #84 落库后一笔。

### 缺口 3：取消/异常收场不留任何可重放的痕迹（「看起来还在跑」）

- **根因**：`loop.ts:369` 静默 return；取消真值只在 promise 返回值与 renderer 内存里。
- **最小改法**（不新增事件型的版本，约 8 行）：
  1. `src/agent/loop.ts`（CLEAN）`:369` 那句 `return` 之前落一条事实。为避开「新增事件型 ⇒ 三面同步」（`KNOWN_TYPES` 是 `Record<AgentEvent["type"], true>`，`tests/event-type-coverage.test.ts:25-38` 要求联合与注册表逐项相等，`tests/event-registry.ts:17-27` 还会因写法改动 fail-loud），复用既有型：`tool_result{ok:false, output:"[cancelled] 本轮于轮界收束（用户请求停止）", blockedBy:"permission"}` 语义不对，**建议**用 `events.append({type:"error", …})` 也违反 `loop.ts:349` 已钉的「取消不是失败」。⇒ 干净做法是**新增一型**（`RunCancelledEvent{turn, wrote, reason}`），一次付齐三面。
  2. `apps/desktop/src/renderer/projections.ts`（CLEAN）给它一条行 + 让 `deriveRunPhase` 在流尾见它时返回 `idle`（同 `:120` 的 `error` 支）⇒ 「重开后显示执行工具」自动收口。
  3. CLI `src/cli.ts` `renderEvent` 加一条 `⏹ 本轮已按停止收束`，并把这条回执从 `runFailed` 的 `plainToolFailures` 里摘出去（`:1037`），停止不再冒充失败退出码。
- **代价**：新事件型 1 个（+1 接口、`KNOWN_TYPES` +1、`tests/event-registry.ts` 取料无需改、`tests/event-type-coverage.test.ts` 自动覆盖、panels/cards/sidechat 注册表计数需同步（`PROGRESS.md:616` 先例：一次改名同步 3 张计数闸））；渲染 1 case；CLI 1 case + 1 处 tally；判卷 2-3 条（轮界取消落痕、重放后不留悬空 `tool_call` 相位、`surface-account`/redaction 面表态）。
- **撞面**：`src/agent/loop.ts`、`src/events/index.ts`、`apps/desktop/src/renderer/projections.ts`、`tests/event-type-coverage.test.ts`、`tests/event-registry.ts` 全 **CLEAN**；唯一 DIRTY 是 `src/cli.ts`（86 行未入库）。**这是三个里最不撞飞的一支**，也是「装一把新尺」收益最大的一支（取消这一格今天零证人）。
- 若嫌新事件型贵：**降级版本**只在桌面/CLI 收场处补 `agent_status`？不行——那是 worker 族。次优降级 = 缺口 1 里的 `goal_stopped`（复用既有型）只解 goal 那一半，普通会话的取消仍然无痕。

### 顺带（不进前 3，但记档）

- `disallowed-tools` 跨 turn 失效（§3）：与 #84 同族同修法（从 `user_message.skill` 事件投影回 `skillScopes`），`src/agent/plugins/index.ts` CLEAN，建议与 #84 并成一页。
- MCP `callTool` 不接 signal（§1.2）：`gatedMcpTool` 一行透传 + `plugins/mcp.ts` 侧接口，CLEAN 面。
- `GateMeta.verdict` 分不出「人拒」与「人停」：在 `deny` 出口按 `ctx.signal?.aborted` 落一个 `scope`-无关的新判据需扩 `GATE_VERDICTS`（会牵 `tests/gate-audit.test.ts` 与 `scripts/replay/gate-outcomes.ts` 的矩阵穷尽性）——建议**先不改枚举**，在取消那一条 tool_result 的 `blockedBy`/散文里点名，避免污染 §7 免批率分母。
- 目标漂移/22 处 `console.warn` 的失败态不入流：单独立项，别夹在取消这一笔里。

---

## 6. 探针读数（`node --import tsx outputs/handoff-face-2026-10-05/probe-interrupt.ts`，只读、内存事件汇、`mode:"auto"` 与生产同档）

```
A 轮界前已取消：threw=null（正常收束，不上抛）
  事件流=[user_message]
  其中带「取消/中止/cancel」字样的事件数=0
B 轮界取消：threw=null（正常收束）
  事件流=[user_message → assistant_message → assistant_message]
  「这一轮被取消」的结构化痕迹=无；散文痕迹=0
C 工具执行中取消：threw=null（loop 没被工具中断打断）
  事件流=[user_message → tool_call → tool_result]
  工具回执 ok=true｜blockedBy=undefined｜gate=缺席
  取消后有没有「这条改动是被取消的那一轮写的」的任何标注=type,callId,ok,output
D 非取消异常：threw=上抛（调用方拿 ok:false 返回值）
  事件流=[user_message → error]｜含 error=true
```

A/B/C 三条合起来就是 §1.4/§1.5/§4 的实证；D 是对照（同一支 loop 在非取消异常时**会**落 `error`），说明取消这一格是**刻意留空**，而不是漏了一处写入点。

## 7. 证据索引（HEAD 行号）

`src/main/agent-runner.ts` 248 / 530 / 555 / 604 / 646 / 1225-1278 / 1570 / 1590-1592 / 1648-1660 / 1795 / 1808-1820 / 1912-1921 / 1930-1987 / 2153 / 2164-2170 / 2176-2184 / 2192 / 2205-2238 / 2277 / 2449-2454
`src/agent/loop.ts` 80 / 104 / 216 / 337 / 349 / 369 / 440-476 / 490
`src/agent/orchestrator.ts` 134 / 516 / 742-747 / 910 / 950-966 / 1653-1696 / 1827 / 1865 / 2471-2498
`src/agent/orchestrator-types.ts` 188+（无 signal 字段）
`src/events/index.ts` 46-66 / 70-84 / 287 / 338 / 503 / 515-545 / 628-672
`src/permissions/autonomy.ts` 30-66 / 69-77 ；`src/permissions/index.ts` 141-143
`src/permissions/plan-state.ts` HEAD 34-77（工作树 80-101 **未入库**）
`src/agent/goal.ts` 105-145 / 239-253 / 263-294 ；`src/agent/goal-trace.ts` 35-62
`src/agent/gates.ts` 20-48 / 62-64 / 98-100 ；`src/main/ask-gate.ts` 53-96
`src/agent/memory/distill.ts` 185-237 ；`src/tools/run_shell.ts` 40-77 ；`src/tools/wait_for_agents.ts` 40 ；`src/tools/snapshot.ts` 26-47
`src/agent/plugins/index.ts` 92 / 158 / 231 / 245-264 / 456-462 ；`src/agent/plugins/mcp.ts`（无 signal）
`src/main/scheduler.ts` 366-368 / 794-857 ；`src/main/session-handlers.ts` 76-98 ；`src/agent/recovery.ts` 69-70
`src/cli.ts` 427-500 / 1037 / 1091-1153 / 1156-1170（工作树另有 86 行未入库）
`apps/desktop/src/main/kernel-host.ts` 14-15 / 54-57 / 117-122 / 226-245 ；`apps/desktop/src/main/index.ts` 152-159 / 194（未入库）；`apps/desktop/src/main/channels.ts` 19-20
`apps/desktop/src/renderer/projections.ts` 9-17 / 40-83 / 96-121 / 137-142 ；`apps/desktop/src/renderer/App.tsx` 69-72 / 202-241 / 306-320（工作树未入库）
判卷面：`tests/loop.test.ts` 103-108 ；`tests/loop-error-event.test.ts` 62-67 ；`tests/ask-gate.test.ts` 92-109 ；`tests/session-wiring.test.ts` 21-55 / 202-221 ；`tests/cli-surface.test.ts` 431-452 ；`tests/event-type-coverage.test.ts` 20-60 ；`tests/event-registry.ts` 17-27 ；`tests/goal-continue.test.ts` 284-334
