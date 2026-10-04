# 用户自定义子代理面取证 — 2026-10-05

作者：只读子代理（无写权，主线程落盘）。**一律以 HEAD 为准**；在飞（主树未提交、结论不据此施工）：`src/agent/{orchestrator,orchestrator-types,metering,system-prompt,automation-surface}.ts`、`src/permissions/{index,plan-state,risk,command-shape}.ts`、`src/main/agent-runner.ts`、`src/providers/openai.ts`，判卷侧 `tests/{plugins-hooks,worker-spent-usd,worker-budget,session-tools}.test.ts`。

## 一句话结论
**能，但是半条路**：用户往 `~/.dsh/agents/x.md` 或 `~/.claude/agents/x.md` 放一个文件，模型能在 `spawn_agent(role="user:x")` / `pipeline stages[].role` 点名并真跑起来（角色正文进 system 首块、工具面能裁）；但角色的 `model`/`isolation` 在**单发路径被丢**、字段名与 Claude Code 不兼容、worker 拿不到 MCP/skill，钱账还会记错档。

## 1 声明面
解析器 `src/agent/plugins/discover.ts`（只显式吃 `name`/`description`，其余原样进裸 `Record`，形状在 `types.ts`，**无字段表**）；第二来源（非插件）`src/agent/roles/user-agents.ts`，装载在 `plugins/index.ts`，**不需要 env 门**（用户级插件仍要 `M2E_USER_PLUGINS`）。执行端真读清单在 `sequencer.ts`：`name/description/isolation/tools/disallowedTools/maxTurns/model`；**忽略＋警告**的有 `hooks/mcpServers/permissionMode`、`effort/skills/memory/background`；未知键也警告——**CC 的 `allowed-tools` 恰在未知键里**，于是那个角色按默认面跑。

## 2 装配面
`orchestrator.ts` → `resolveStageRole`；注入口 `agent-runner.ts`；模型可见参数在 `glm-session.ts`（该文件此刻在飞）；发现面 `plugins/index.ts`。内置角色只有 implement/review/test。工具裁剪贯通 `worker-projection.ts` ⇄ `worker-tool-table.ts`（白名单**只缩不涨**）。

## 3 权限面
`orchestrator.ts` 两条会话；档位单调继承在 `worker-report.ts`；只读父禁 write 子。plan 门不传 `planBlocked` ⇒ 挂 `planGateLive`（ALS 活委托，`permissions/autonomy.ts`）。**扩面风险**：write 子的 `write_file/edit_file/shell_rw` 走 `toolAutonomy="auto"`；而 `isolation→write` 只被**链路径**读，单发 spawn 的 mode 只看 `args.mode`。

## 4 成本面
价在 `orchestrator.ts`；入账 `orchestrator-join.ts`；闸 `goal.ts`（只累加已终态 `spent_usd`，无价 worker 不进 booked）。角色 `model` **仅 pipeline** 转成 pin（`routing/policy.ts` 对未知 pin 抛），routing 缺省关 ⇒ **单发路径完全丢**；routing 关时 `agent_spawned.model=args.model` 而实跑按缺省档 ⇒ **事件说 A、价按 B**。

## 5 判卷面
`tests/plugins-discover.test.ts`、`tests/m3c.test.ts`、`tests/plugin-role-discoverability.test.ts`、`tests/user-agent-roles.test.ts`（**止于 findAgentRole，不 spawn**）、`tests/worker-role.test.ts`（`agentRoleFor` 是手写 lambda，非磁盘插件）。
空格子：没有「磁盘 `agents/*.md` → PluginRuntime → spawn → worker 起来」的端到端；`user:x` 从未被 spawn 测；`model`/`isolation` 无测。

## 6 前三缺口（按用户真会撞上排序）
1. **CC 字段名不兼容**（`allowed-tools`/`permission-mode` 被当未知键丢弃）：`sequencer.ts` 加别名读 ＋ `resolvePluginRole` 约 3 行；判卷 3 条（在 `plugin-role-discoverability.test.ts` 同族）。**不撞在飞文件** ⇒ 可立刻施工。
2. **角色 model 单发丢失 ⇒ 事件与价错档**：`spawnReserved` 的 pin 改吃 `stageRole?.model ?? args.model`，routing 关时不写 `agent_spawned.model`；判卷 2–3 条。**撞在飞的 `orchestrator.ts`** ⇒ 只登记。
3. **write 子的 `shell_rw` 恒 auto**：改为 `min(auto, parentMode)` 或在装配处校验 `stageRole.mode` vs `args.mode`；判卷 2 条（session-tools/autonomy，两支都在飞）。

主线程处置：1 号缺口接工（编号 `#97`）；2、3 号登记为 `#98`，前置＝`orchestrator.ts` 与 session-tools/autonomy 两支腾出手。
