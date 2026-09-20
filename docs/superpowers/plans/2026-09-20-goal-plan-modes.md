# goal 模式 + plan 模式 · 实施计划

**Goal:** 把「先批后写」的武装权从模型手里交给用户（plan 模式），并把"继续干"从人手推变成带轮次/美元双闸与证据审计的自动续跑（goal 模式）。

**Architecture:** 四层，每层一个可独立测的落点。① `src/permissions/index.ts`：`PlanState` 加 `required`，判据收成一个导出谓词 `planGateBlocks`（P2 的五处副本全部改读它）；② `src/agent/goal.ts`：会话目标与停止判据的**纯**函数（入参收窄 / 提醒块成形 / 五路停止决策），零 I/O 零状态；③ `src/main/agent-runner.ts`：run 入口武装 + run 尾续跑驱动（复用 `handleAgentRun`，不开第二条执行路径）；④ 渲染层：设置行「方案门」+ 输入区「目标」折叠块 + goal 芯片（live/replay 两条路）。

**Tech Stack:** Node 22 / TypeScript 5（`strict`）/ vitest 5（`tests/*.test.ts` 文件级串行）/ Electron 44 壳 / vanilla 渲染层（无框架、CSP `script-src 'self'`）。

**Spec:** `docs/superpowers/specs/2026-09-20-goal-plan-modes-design.md`（诊断 P1–P7、三条收口约束、判据 J1–J7 都在那里；施工前先读）。

## Global Constraints

1. **只改 harness**；不引入任何新依赖，`agent-plan.md` 只读。
2. **相交检查优先**（本轮实测）：`src/main/agent-runner.ts`、`src/permissions/autonomy.ts`、`src/agent/orchestrator.ts`、`src/frozen.ts`、`src/agent/gym/runner.ts` 正被另一会话的"判卷面硬闸"原子簇占着（`git status -uno` 命中 5 文件）。本计划的 Task 1/2/5 **都要动前两处** ⇒ 全程在 worktree 施工：
   `git worktree add .worktrees/goal-plan HEAD --detach && ln -sfn "<主树>/node_modules" .worktrees/goal-plan/node_modules`。
   合并窗口按文件交集判；不 stash 硬合。
3. **零回归线**：`required` 缺省 false、goal 缺省关 ⇒ 关位时事件流字节与今天逐字相同。每条任务都带一条"关位零行为"断言。
4. **不产生第二事实源**：goal 状态只落 `goal_set` 事件；轮次号、已花、停止原因一律从流投影。plan 判据只有一份谓词（J1 静态锁）。
5. **外界文本两头设界**：`goalReminder` 走 `clampToTokenBudget`，帽以 token 登记并锁 token 数（CJK 权重已由 `d98fa19` 修好，不再用"字符换算"那套失效写法）。
6. **价格不可知不得当免费**：`spentUsdFor` 返回 null ⇒ 明写"美元闸无效"，只按轮次闸停。反向断言（把不可知记成免费）必须有。
7. **默认值分层 + 双指标**：自动续跑花真钱 ⇒ 缺省关，且同批交付必须给出 A/B 实测读数（完成率 **与** `$/成功任务`）。无 key 的真模型读数如实标"未证"。
8. **判卷文件禁改**；改判据走 `BLOCKED.md`。
9. **提交纪律**：显式文件 `git add`，禁止目录级 add；变异锚点独立一笔（`mutate-verify` 拒绝在飞文件是正确红）。
10. **不新增注入工具**（`propose_plan` 已在静态 `TOOLS` 键域）⇒ `src/agent/tool-surface.ts` 与 G-B 判据本轮不动。若实现中想加 `set_goal` 让模型自设目标：**停**，那与 P1 的立项理由直接冲突。

**测试命令**（沙箱内 `pnpm test` 起不来，直连 vitest；`--config` 不是装饰——它注入 `PI_SCRATCH_DIR` 并 `exclude .worktrees/**`）：

```bash
TERM=dumb node node_modules/vitest/vitest.mjs run --config tests/vitest.config.ts tests/<文件名>
pnpm typecheck   # tsc 全量扫含未跟踪文件 ⇒ 写完再跑
```

## File Structure

| 文件 | 动作 | 责任（一句话） |
|---|---|---|
| `src/permissions/index.ts` | 修改 | `PlanState.required` + 唯一谓词 `planGateBlocks` + `markPlanRequired` |
| `tests/plan-required.test.ts` | 新建 | J1 静态锁 + J2/J3 行为面（含关位零回归） |
| `src/main/ipc-protocol.ts` / `src/preload/index.ts` | 修改 | `RunRequest.planRequired` + `agent:goal-set` |
| `src/main/settings.ts` | 修改 | `planRequiredByDefault` / `goalMode` / `goalMaxTurns` / `goalMaxUsd` 四字段（含 parse/白名单） |
| `src/main/agent-runner.ts` | 修改 | run 入口武装 + run 尾续跑驱动（唯一执行路径不变） |
| `src/agent/goal.ts` | 新建 | `GoalSpec` 入参收窄、`goalReminder`、`goalStopDecision` 五路 |
| `tests/goal-stop-decision.test.ts` | 新建 | J4 全部（含价未校准惰闸反向对照） |
| `src/events/index.ts` | 修改 | `GoalSetEvent` + `KNOWN_TYPES` + `PromoteOrigin.kind` 扩 `"goal"` |
| `src/renderer/app.js` / `index.html` / `history-window.js` | 修改 | 设置行「方案门」+ 目标块 + goal 芯片（live 与 replay 两路） |
| `tests/goal-continue.test.ts` | 新建 | J5 端到端（mock 剧本，不起真模型） |
| `scripts/mutate-verify.mjs` | 修改 | J7 锚点 ≥6（独立一笔） |
| `docs/facts/goal-plan-readings-2026-09-2x.md` | 新建 | §5 读数表：完成率 + 轮数 + token + `$/成功任务`，未证项点名 |

---

## Task 1 · plan 判据收成一份谓词（纯重构，行为逐字不变）

**Files:** Modify `src/permissions/index.ts`、`src/main/agent-runner.ts`（四处）；Test `tests/plan-required.test.ts`

**Interfaces:** Produces `planGateBlocks(state: {required?; proposed; approved}): boolean`、`markPlanRequired(v: boolean)`；`PlanState` 加 `required: boolean`（`enterPlanRunScope`/`runWithPlanScope` 初始化为 false）。

- [ ] Step 0 复认：`grep -rn "proposed && " src/main/agent-runner.ts src/permissions/index.ts | wc -l` → 5；`git diff HEAD -- src/permissions/index.ts` 必须空（非空即别人的原子单元，改道 worktree）
- [ ] 加 `required` 与谓词；五处消费点改读 `planGateBlocks(getPlanState())`
- [ ] J1 静态断言：`src/` 内除定义处外，`\.proposed\s*&&` 命中数必须为 0（写进 `tests/plan-required.test.ts`，读 `src/` 全文）
- [ ] 关位零回归：`tests/plan-gate.test.ts` 既有各条一字不改仍全绿
- [ ] `pnpm typecheck` + 单门 `pnpm gates --only=test`（`scripts/gates.ts` 只认 `--only=` 前缀形态）

## Task 2 · 用户武装：RunRequest → settings → 渲染层开关

**Files:** `src/main/{ipc-protocol,settings,agent-runner}.ts`、`src/preload/index.ts`、`src/renderer/{index.html,app.js}`、`tests/plan-required.test.ts`

- [ ] `planRequired` 透传：请求级优先、缺省取 `settings.planRequiredByDefault`；`runAgent` 在 `enterPlanRunScope()` 之后 `markPlanRequired(true)`（run 级 ALS，并发 run 不串台）
- [ ] 设置行「方案门：未批准即写禁」复用 `set-choice`/`data-setting` 形状（与「权限默认模式」同族），不新增控件种类
- [ ] J2：武装后写向被拒且理由含"方案门"、`propose_plan` 仍可、批准后放行、拒绝后保持、关位逐字同今天
- [ ] J3：`unattended` + `planRequired` ⇒ **被拒**而非被忽略（与 `unattendedAskGate` 同语义）；定时任务表单不暴露该开关
- [ ] 变异锚点预备：`required` 项被摘 / `||` 换 `&&`（Task 7 落表）

## Task 3 · `src/agent/goal.ts` 纯函数面

**Files:** Create `src/agent/goal.ts`；Test `tests/goal-stop-decision.test.ts`

**Interfaces:** Produces `parseGoalSpec(raw): {spec?, error?}`（`maxTurns` 钳 `[1,25]` 且回写钳制说明；`objective` 空即拒）、`goalReminder(spec, turn, spent): string`（帽 `clampToTokenBudget`）、`goalStopDecision({turn, spec, spentUsd, priceKnown, evidence}): "continue" | "done" | {stop: string}`。

- [ ] 先写测再写实现（J4 五路 + 每路一条反向对照）
- [ ] 证据入参类型直接复用 `WorkerEvidence`（`worker-report.ts`），不新造枚举
- [ ] 帽断言锁 token 数（`estimateTextTokens` 读数），并锁"目标原文超长时提醒块仍 ≤ 帽"

## Task 4 · `goal_set` 事件 + origin 扩成员 + 两套渲染器

**Files:** `src/events/index.ts`、`src/renderer/{app.js,history-window.js,index.html}`、`tests/renderer-run-control.test.ts`

- [ ] 事件形状 `{type:"goal_set", objective, max_turns, max_usd, ts?}`；`KNOWN_TYPES` 追加（M4a `automation_*` 先例）
- [ ] 旧日志重放逐字不变断言（拿一条既有 JSONL 重放，比对事件数组）
- [ ] `PromoteOrigin.kind: "sidechat" | "goal"`；投影出"第 N 轮 / 上限 M / 已花"芯片，live 与 replay 同一份投影函数
- [ ] `pnpm run renderer-arch-check` + `pnpm panels-check`（后者有已知 CDP 时序 flake：红时先单跑复验再判回归）

## Task 5 · 续跑驱动与审计闸（唯一的真·新执行逻辑）

**Files:** `src/main/agent-runner.ts`；Test `tests/goal-continue.test.ts`

- [ ] run 尾：`goalStopDecision(...)`；`continue` ⇒ 合成 `user_message(origin.kind="goal", content=goalReminder(...))` 再入 `handleAgentRun`（同一函数，不开第二路径）
- [ ] `done` 只允许在 `evidence === "verified"` 时成立；`stale/failed/absent` ⇒ `continue` 且文案点名是哪一态 + 最后一次红的来源
- [ ] 取消/中止：`interactiveRunAbort` 触发后不再起新轮；`stop` 与 `done` 都上屏，不静默
- [ ] 已花美元 = 会话 `usage` 事件 × `pricing.costUsd(本会话模型)`；价不可知 ⇒ `priceKnown:false`（§2 约束 3）
- [ ] 测：无绿证据 ⇒ 自动续到 `verify_result(ok:true)` 后 done，`goal_set` 恰一条；达 `maxTurns` ⇒ 停且带原因；中途取消 ⇒ 不再起轮

## Task 6 · 实测读数（缺这项即不算完成）

- [ ] `fixtures/mock` 确定性剧本 A/B：同一任务、同模型，goal 关 vs 开 ⇒ 报**完成率 / run 轮数 / input+output token / 折算美元**，`$/成功任务` 并列写进 `docs/facts/goal-plan-readings-*.md`
- [ ] 真模型（GLM）同任务一条；无 `M0_API_KEY` 时该行如实标"未证"，**不写进已证**
- [ ] plan 模式同样给一条读数：武装后 `propose_plan` 往返是否真发生、被拒写向次数（防"开了但没人用"的假功能）

## Task 7 · 变异锚点（独立一笔提交）

- [ ] ≥6 条：`required` 项被摘 / `||`→`&&` / 副本回退 / 证据闸被摘（恒 `done`）/ 轮次上限被摘（永不停）/ `priceKnown` 反向 / `goalReminder` 帽被摘
- [ ] 每条在 HEAD 隔离 worktree 实测杀死（`git worktree add <tmp> <sha> --detach` + `ln -sfn <主树>/node_modules node_modules`），跑法是**位置参数传 id**：`node --import tsx scripts/mutate-verify.mjs <锚点id>`（`classifyArgs` 把未知 flag 当 id ⇒ 拼错即报「未知 id」，全表针脚体检另跑 `--check-needles`）；needle 单命中、`desc` 不含 ASCII 双引号、变异后语法合法

## Self-Check

- 关位行为：Task 1/2/3/5 各一条"关位零行为"断言 ⇒ 全绿才允许开位实验。
- 完成定义：J1–J7 全绿 + `pnpm gates` 逐道退出码 0（未证项如实汇总，不宣称"全部通过"）+ Task 6 读数落表。

## 执行日志 2026-09-20（分支 `feat/goal-plan-mode`，worktree `.worktrees/goal-plan`，基线 `402daf9`）

**已落**：Task 1 全部 + Task 2 的后端与用户入口（settings 四写：interface / DEFAULTS / parse / `set()` 白名单 + 设置行「先批后写（方案门）」+ `runAgent` 武装）。
`enterPlanRunScope(required)` / `runWithPlanScope(fn, required)` 直接接形参，未新增 `markPlanRequired`（无生产者的导出＝新病，见 spec §3 落地口径）；`RunRequest` 保持不动。
顺带把方案门的拒因文案改成两种武装态都成立的一句「方案门：先批后写（当前没有已批准的方案）」（原文"存在未批准 plan"在用户武装、模型尚未交过方案时是假话）——四处文案同改。

**判卷现状**：`tests/plan-required.test.ts` 9 条（J1 副本扫描 + 谓词三态；J2 武装写禁/批准后放行/未武装零回归/`markPlanProposed` 不吞掉 required/`evaluate` 与 MCP 注解同一口径；J3 run 级隔离；J4 **泛化**的 settings 布尔键白名单测——见下）。
`node node_modules/typescript/bin/tsc --noEmit` exit=0；既有 422 条锚点 `--check-needles` 阻断 0 / 待复认 0（本改动没碰坏任何针脚）；相邻 5 文件 60 条全绿。
既有 `tests/plan-gate.test.ts` + `tests/permissions.test.ts` 的 **10 条 `toEqual` 形状断言**加了 `required: false`（状态形状变了，不是行为变了）——Task 1 Step 4 那句"一字不改"未按原样成立，如实记。

**欠（不谎报）**：spec J3 的 unattended 那条（要 `runAgent` 级驱动）、J5/J6（goal 模式全部）、J7 的 goal 那半锚点、Task 6 读数、主树 `pnpm gates` 收口——全部待该原子簇与并发会话落地后合回主树再跑。plan 那半见下段。

**变异锚点（plan 模式那 6 条已落，实测全杀）**：`plan-gate-required-clause-dropped` / `plan-gate-required-anded-not-ored` /
`plan-run-scope-swallows-required` / `plan-propose-clears-user-arm` / `plan-required-default-flipped-on` /
`settings-whitelist-drops-plan-required-key` —— 表从 422 → 428，`--check-needles` 阻断 0 / 待复认 0。
**还欠一条**：`handleAgentRun` 里 `planRequired: over.planRequired ?? settings...` 这半跳今天没有任何测覆盖
（要 runAgent 级驱动 ⇒ 没有可对撞的叶子断言，硬写锚点就是自造假绿），随 J3 的 unattended 那条一起补。

**环境实测（给后续执行者，省一轮误判）**：worktree 里 **`pnpm` 全不可用**——`pnpm test` / `pnpm typecheck` 都死在 pnpm 的 deps-status check（`Command failed with exit code 1: pnpm install`）。
且 `fixtures/todo-app/node_modules` 不随 worktree 生成（补 symlink 也不解决），⇒ 凡断言 `run_shell` / `verify_result` 的用例在**任何** worktree 必红，包括干净 HEAD 的 worktree：
本轮 `tests/gated-tools.test.ts`「default 档 + 批准 → write_file 与 run_shell 真实执行」与 `tests/runner-gates.test.ts`「plan 批准后写放行」即此形状——
已用 `/tmp/base-402daf9`（HEAD 同环境）对照定名：**与本改动无关**。直连写法：`node node_modules/typescript/bin/tsc --noEmit`、`node node_modules/vitest/vitest.mjs run --config tests/vitest.config.ts <文件>`。

**顺手多立的一道闸（J4 泛化）**：`SettingsStore.set()` 有一张**手写键白名单**，不在名单里的键整块 patch 被丢 ⇒ 设置项"看着能动、重启就没"。
本轮起 `tests/plan-required.test.ts` 对 `DEFAULT_SETTINGS` 里**每一个布尔键**机械验"`set()` 翻面 + 落盘读回"，
以后新增设置项忘了登记白名单会当场红（点名是哪个键），不必再靠人记得写单测。

### goal 模式（同一分支第二笔：Task 3 + 驱动 + 机器侧入口）

**已落**：`src/agent/goal.ts`（`parseGoalSpec` / `goalStopDecision` 五路 / `goalReminder` 带帽 / `projectGoal` 投影 / `sumSessionUsage`）、
两条新事件 `goal_set` + `goal_stopped`（`KNOWN_TYPES` 增量，旧日志重放逐字不变）、`UserMessageEvent.origin` 收成判别联合
（`PromoteOrigin | GoalTurnOrigin`，四个消费面全按 kind 分支）、`worker-report.hasSessionWrites`（与四态同一份 `WRITE_TOOLS`，不另立写向清单）、
`handleAgentRun` 里的续跑环 + 硬上限 + `handleGoalSet`/`agent:goal-set`/preload `setGoal`。
判卷：`tests/goal-stop-decision.test.ts` 15 条 + `tests/goal-continue.test.ts` 9 条（走真入口 `handleGoalSet` → `handleAgentRun`，不手工造 goal_set）；
直连 tsc exit=0；`goal-continue`/`goal-stop-decision`/`sidechat`/`schedule`/`sessions`/`loop`/`plan-required` 等 7 个文件 115 条全绿；428 条既有锚点针脚零破坏。
**锚点落表 9 条，第 9 条首跑存活**（`goal-stopped-flag-ignored`）：按规则 6② 先怀疑测——查出的结论是**该分支在既有测里根本不可观察**
（`view.stopped` 那道闸只在「已停之后用户又发一条」时才起作用，而我没写这条），补一条真行为测（停止是终态，
再发一条不许把自动续跑唤回来）后翻成 ✅。同族先例见记忆规则 26「新锚点存活＝免费的盲区探测器」，这里再加一次兑现（计数不写死）。

**合回主树前的唯一硬阻断**：渲染层「设目标」那颗按钮（composer 里）没落 ⇒ `setGoal` 目前是"有桥无生产者"，
`ipc-reachability-check` 正是为这种形状立的（#13 同族）。缺它就不许合并，已写进 #51。
**门实测（同一命令两边各跑一次）**：分支 worktree = 2 红，其中 `A2a 无新增孤儿桥 — agent:goal-set` 是本分支新增的红（棘轮自己点的名）；
主树 HEAD = 1 红，只剩 `A2b 基线不陈旧（provider/schedule 那 10 条）`——**A2b 在 HEAD 就红，不属本轮**，别把它算进本改动的账。
另两处欠：spec J4 的 `priceKnown` 那半在实现里等价物是 `spentUsd === null`（单一编码，不再并列一个布尔）；
`goalReminder` 内层目标帽那条锚点**故意不落**——摘掉内层帽后外层 `clampToTokenBudget` 仍会截断，
"已截断"标记照样在场 ⇒ 观测不到，按规则 17 撤锚而不是硬造断言。

**实测读数（Task 6）状态**：`goal-continue` 里那条"读答型目标一轮即停"就是"不烧钱"的确定性证据；
但"完成率 + `$/成功任务` 的 A/B"仍欠 —— 它要真模型跑（无 `M0_API_KEY` ⇒ 如实未证，不算完成），列入 #51 之后。

### 执行日志续（同日，渲染层入口 = 上面那条硬阻断的解除）

上面「唯一硬阻断」已解除（那段文字按当日快照保留，不回改）：

- **入口落法**：composer 底栏 `#ctxGoal` 芯片 + `#goalPanel` 面板，沿用权限芯片那一支的
  `registerPop`/`togglePop`/`.c-btn`/`.ctx-pop` 现成结构（不新增视觉语言，CSS 只加面板内表单）。
  三个动作（设定 / 改设 / 清除）全走既有那**一条** `setGoal`：清除 = `handleGoalSet` 追加一条
  `goal_stopped`，于是「停止是终态、用户下一条不复活」那条已有锚点直接管住清除，不必新造事件、
  新造通道（新造就是第五份停止语义）。
- **芯片读数不留第二份状态**：渲染层只保存 `goalRelevant` 筛过的事件（长度天然有界：goal 代发轮被
  轮次帽卡死），读数一律 `traceGoal` 全量重算——而 `traceGoal` 就是主进程 `projectGoal` 现在用的那份
  reduce。为此把 reduce 与轮次帽单抽出 `src/agent/goal-trace.ts`（只 import 类型，能安全进 renderer 包；
  `goal.ts` 顶层那条 worker-report→memory/security 链不能），`goal.ts` 尾部再导出保持 importer 零改动。
  两条 `projectGoal` 系锚点的针脚随迁（`goal-window-covers-pre-goal-history` 换串、
  `goal-turn-not-counted` 换文件）——这是记忆规则 8①「拆文件 = 判据搬家」又一次兑现（计数不写死）。
- **等价性有锁**：`tests/goal-trace.test.ts` 5 条，核心是对每条流的**每个前缀**断言
  「筛过重算 == 整段重算」的芯片三字段（并断言前缀循环真跑了 流长+1 格，防循环被改成只看整段）。
  筛子漏收/多收某一类事件 ⇒ 芯片当场与判据分家，这条测就红。
- **门读数（改后复跑）**：`build` ✓（renderer 11 modules，证明 `projections → ../agent/goal-trace` 这条
  跨目录运行时 import 解析得开）、`renderer-arch-check` 84/84 ✓、`a11y-check` 3/3 ✓、
  `ipc-reachability-check` 的 **A2a 转绿**（`agent:goal-set` 不再是孤儿桥），剩 A2b 那 10 条 HEAD 既有陈旧；
  直连 `tsc --noEmit` 0 错；`goal-continue`(10) + `goal-trace`(5) + `goal-stop-decision`(15) +
  `plan-required`(9) + `sidechat`(15) = 54 条全绿；`mutate-needles-check` 437 条零阻断。
- 顺带清掉两处：`handleGoalSet` 里 `sessionId !== undefined` 的恒真三元（守卫后必为字符串）；
  清除路径新建会话时的 ENOENT 不再端给用户（按"没有目标"报，其余 IO 错误照常可见）。

### 执行日志续二（J3 落地时抓到一条恒真判据 + 那条欠锚补上）

**J3 原写法恒真，已改成比拒因。** 按 spec 字面写"未武装真写成功 / 武装被拒"，实测第一步就红：
`write_file` 在 `unattended + auto 档`下**本来就**被拒（autonomy ask → 无人值守 fail-closed，
`agent-runner.ts:357` 那句原文）。⇒ "被拒"这条断言两支都绿，判它等于没判。
改法：两支只差 `planRequired` 一个维度，断言**答话的是哪道闸**——未武装报"无人值守"且不含"方案门"，
武装报"方案门"且盘上无文件。方案门在 ask 之前判，所以无人值守那条自动拒根本没机会说话。
这条恒真是**先按判据字面写完再跑**才发现的；读代码想不出来（写出来看着像分辨力）。spec §5 J3 行已同步改口径。

**那条欠锚补上（+2，全首跑即杀）**：
- `plan-required-run-override-ignored`：`planRequired: over.planRequired ?? settings` 丢掉 override 半边
  ⇒ J3 武装那支换拒因，红。
- `plan-gate-armed-for-every-run`：`enterPlanRunScope(opts.planRequired === true)` 改成无条件 `true`
  ⇒ 缺省零行为破了，未武装那支换拒因，红。
两条都指 J3 那条测（它是这条线里唯一真跑 `handleAgentRun` 的判卷面）。另 3 条清除锚点见上一笔。
针脚体检 442 条零阻断。

**J6 状态（如实）**：芯片的**数据面**有锁（`tests/goal-trace.test.ts` 逐前缀等价），
两道渲染层门不红（`renderer-arch-check` 84/84、`a11y-check` 3/3、build ✓）；
但"live 与 replay 两条路都上屏"这半句**未证**——静态构建里 `window.agent` 不存在，
桥接段在 `app.js:1973` 就 return，芯片代码根本不执行；要验只能给 app.js 尾段搭一套
DOM + api 桩（十余个），那会把"验行为"降级成"验调用"，本轮不做，留 #13 同族。

### Task 6 读数（成本侧实测；准确率侧仍缺 key ⇒ 分两半报，不合并成一句"划算"）

**为什么这半边能现在出数**：goal 模式的**边际**成本是确定的——每续跑一轮，在用户消息位重送一块
提醒（其余上下文本来就要付，记进 goal 的账就是虚报）。所以成本侧不需要真模型；
**完成率侧需要**，缺 `M0_API_KEY` ⇒ 那一半如实挂未证（规则：不接受"留位待办"，但也不许编读数）。

探针：`node --import tsx scripts/goal-cost-probe.ts`（用 `goalReminder` +
`estimateTextTokens` + 仓库自己那张 `DEFAULT_PRICE_TABLE` 折算，不引外部估算法）。实测：

| 情形 | token/轮 | 整目标付进输入的 token（含重送） | glm-standard（占位价） | anthropic-strong（已标定） |
|---|---|---|---|---|
| 典型目标 · 缺省 8 轮 · 证据 stale | 168 | 4,704 | $0.009408 | $0.023520 |
| 同上 · 证据 failed | 153 | 4,284 | $0.008568 | $0.021420 |
| 同上 · 证据 absent | 154 | 4,312 | $0.008624 | $0.021560 |
| **价格不可知那一支**（文案最长） | 175 | 4,900 | $0.009800 | $0.024500 |
| 病态长目标（6,000 字）· 帽 25 轮（付 24 次） | 545 | 163,500 | $0.327000 | $0.817500 |

⚠️ **本表第一版记错了口径**（同日自查，见下）：原记「整目标附加 = 块数 × 每块」，
漏了**第 k 轮的块会在 k..N 每轮输入里再出现一次** ⇒ 真实计费次数是三角级数
`N(N+1)/2`，典型情形低估 4 倍、25 轮情形低估 12.5 倍。上表是按修正后口径重跑的读数。

三条读法：
1. **帽是真生效的**：6,000 字目标被内层 `GOAL_OBJECTIVE_TOKEN_CAP=400` 掐住，整块 545 token <
   外层 `GOAL_REMINDER_TOKEN_CAP=700` ⇒ 双层帽都实测到，不是纸面承诺。
   提醒块的**结构上界（含重送）** = `700 × 24×25/2 = 210,000` token；
   所以美元闸即使算不出来（不可知那支）也有一个上界兜着——但它是**十万级 token**，
   不可知时"只按轮次闸停"的真实代价必须按这一档看，不能按 16,800 那版看。
2. 对照物：人手敲一句"继续" ≈ 2 token/轮 ⇒ 提醒块贵 ~77–88 倍，换来的是每轮都带上
   **证据四态 + 双闸读数 + 收束条件**——按本仓"能证明代码真的能跑"的优先级，这笔换得起；
   但它是代价，不是免费，所以记进这张表。`promptCache` 缺省已开 ⇒ 重送段多半按 cache-read 价计，
   **钱**通常低于表里的上界，**token 数与窗口占用**不降。
3. GLM 三行仍是**占位价**（表里没打 `calibrated`）⇒ 表里那两列 GLM 数字只能当量级看，
   不许当"省了多少"的证据（同一件事 `pricing.ts` 文件头自己写着）。

**仍欠（列入 #51 之后，不算完成）**：同一任务 关 vs 开 goal 的**完成率**与 `$/成功任务` A/B。
它要真模型（`M0_API_KEY`），或至少一个能真跑到 `verify_result(ok:true)` 的确定性剧本；
`goal-continue` 现有的读答型目标"一轮即停"只证明了**不烧钱**那一半，没证明**办成事**那一半。

## 评审 C6 落地（#52）：派生即提权 —— 方案门的镜像换成活委托

**病灶（复跑口径）**：`AutonomySession.planBlocked` 是 `boolean`，由调用方每次 `evaluate` 前刷新，
而刷新只接在主会话三处（`agent-runner.ts` 「gatedTool」/「gatedMcpTool」/solpi recall）。
worker 那一路的权限会话由 `orchestrator.ts` 「spawn」内 `newAutonomySession(tier, {...})` 构造，
**从不刷** ⇒ 恒 `false`；`worker-tool-table.ts` 「gatedWorkerTool」 又是直接
`evaluate(name, args, opts.autonomy ?? w.autonomy)`。净效果：用户在 plan 模式里说"先看方案"，
模型只要 `spawn_agent` 一个 write worker 就能照常写盘（`spawn_agent` 本身在被拦之列，
但**先派生、后 `propose_plan`** 这条时序完全走得通）。这是本仓点名的「两头断」的另一型：
判据在场、消费端在场，中间那根线只在一条路上接了。

**修法（架构最简）**：状态与判据从 `permissions/index.ts` 抽到 `permissions/plan-state.ts`
（`autonomy.ts` 不能 import index——index 正 re-export 它的符号 = 循环，这正是当初抄镜像的理由），
`planBlocked` 从布尔改成 `() => boolean`，**缺省挂 `planGateLive()`**。
镜像、刷新点、"谁记得刷"三样一起消失：主会话与 worker 读同一份 run 级 ALS 状态，
`enterPlanRunScope` 那唯一一处武装点成了唯一事实源。判据仍归 `evaluate` 只读（纯度测试照测）。

**判卷**：`tests/plan-required.test.ts` 11 条（新增两条：worker 形状会话在武装作用域内被 `evaluate`
当场拒写 + 全 `src` 扫描禁止任何调用点再传/再刷这份判据——传快照就是退回旧语义，
连注释里出现该名字都红，宁严到要求改名也不留判读空间）；
`tests/autonomy.test.ts` 纯度那条改为"两侧归一 + 委托按身份钉住"（函数不可 `structuredClone`，
不能因为换了类型就少测一半）。直连 tsc exit=0；工作树全量
`157 passed / 2 failed`——两条红是 `gated-tools`/`runner-gates` 的 **worktree `run_shell` 假红**
（记忆「验证判据边界」），且同一批断言里 `write_file` 与 plan 批准后放行那两半**是绿的**，
正是本改动触及的面。

**锚点**：新落 `plan-live-delegate-default-lost`（缺省从活委托退回 `() => false`）；
另 4 条 plan 锚点随抽文件重钉到 `plan-state.ts`。

**合并阻断更新（#51）**：主树这一轮在飞文件已含 `src/permissions/autonomy.ts` + `index.ts`
（另一会话在加 `GATE_LAYERS`/`GateMeta` 判定留痕），与本笔**同文件** ⇒ 本笔只落分支，
不得合回；#51 的让路面从"agent-runner 一面"变成"权限层两面 + agent-runner"。
