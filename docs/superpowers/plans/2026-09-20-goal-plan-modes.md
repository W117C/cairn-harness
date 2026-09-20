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
