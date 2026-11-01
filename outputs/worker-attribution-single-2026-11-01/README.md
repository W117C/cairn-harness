# worker 归属判据只有一份 · 2026-11-01

检查起点与交付面都是共享工作树，HEAD `be9c0be5`；本批改动未提交。

## 这一批改了什么

「带非空 `agent_id` 的事件属于 worker 子流」这条判据在六处各写一遍，其中**两处漏了空串判断**：

| 处 | 原判据 | 后果 |
|---|---|---|
| `main/usage-ledger.ts` | `typeof id === "string"` | `agent_id: ""` 被当 worker ⇒ 用量少算一条 |
| `renderer/derived/session.ts` | `typeof id === "string"` | `agent_id: ""` 的事件从主流里消失 |
| `agent/context.ts`（`hasWorkerAttribution` / `isWorkerCompaction`） | 非空才算 | — |
| `agent/acceptance-sampler.ts` | 非空才算 | — |
| `scripts/replay/run-scorecard.ts#splitStreams` | 非空才算 | — |

`acceptance-sampler` 的注释里早就写着：两处不一致时「同一个『agent_id 为空』的事件会被一把尺当 worker、另一把当主会话，两个读数就再也对不上」。本轮把它收到 `src/agent/subflow.ts`（`hasWorkerId` / `isWorkerSubflowEvent`，`agent_spawned` 仍是父流事实），六处改读。

## 读数（工作树，未提交）

| 面 | 改前 | 改后 |
|---|---|---|
| 判据实现处 | 6 处（2 处口径不同） | **1 处**（`src/agent/subflow.ts`） |
| 用量账本：`toolSteps`（两条主会话 + 一条 worker） | `agent_id: ""` 那条被跳过 | **2**（两条主会话都算） |
| 主流行：`agent_id: ""` 的 tool 行 | 不出现 | **出现** |

| 判卷面 | 读数 |
|---|---|
| `subflow-attribution.test.ts` | 账本写回漏空串版 ⇒ **1 红**（`expected 1 to be 2`）；渲染面写回自份 ⇒ **2 红**（主流行为 + 消费面哨兵）；改后 **4/4 绿** |
| 核心套件 | **606 文件 / 7544 条全绿**，exit 0 |
| 桌面套件 | **2073 条全绿**，exit 0（含 boundary 绿） |
| 两端 typecheck | 0 / 0 |

## 文件

- `red-green.log`：两处造红的原文（行为断言，不只是哨兵）与复原后的绿。
- `core.log` / `desktop.log` / `typecheck.log`：两个套件与两端 tsc。
- `scoped.patch`：本批八个文件的差量（两个新文件相对 /dev/null）。
- `docs-check.log`：台账门在补页之后的读数。

## 边界

- 这是**行为修正**，不是纯搬家：`agent_id: ""` 的事件从此按主会话计（与另外三处及仓库既定口径一致）。
- `agent_spawned` 仍是父流事实：即使带 `agent_id` 也归主会话。
- 判据只看「有没有非空 id」，不看 worker 的其它字段（mode/task 等）。

## 复现

```sh
npx vitest run tests/subflow-attribution.test.ts --config tests/vitest.config.ts
pnpm test:capped
```
