# 打开会话也有帽了 · 2026-11-01

检查起点与交付面都是共享工作树，HEAD `be9c0be5`；本批改动未提交。

## 这一批改了什么

`performance-smoke.cjs` 一直把「打开会话」的耗时量出来写进报告，但 **`budgets` 里没有这一档、退出码也不看它**：
打开慢三倍照样 exit 0。本轮补上：

- `budgets.openMs`（默认 1500 ms，可用 `CAIRN_PERF_OPEN_BUDGET_MS` 覆盖）；
- 超帽进 `overBudget` ⇒ 非零退出；
- `perf-summarize.ts` 的逐跑预算判定也把它算进去；**旧报告没有 `openMs` 字段时按默认 1500 判**（字段缺席不许变成不判）。

## 读数（工作树，未提交）

| 面 | 读数 |
|---|---|
| 造红（`CAIRN_PERF_OPEN_BUDGET_MS=1`，真跑） | `[performance-smoke] 超预算：打开会话 637.8ms > 帽 1ms`，**exit 1** |
| 复原（默认帽） | **exit 0**；`budgets = {p95Ms:200, maxMs:500, startupMs:1500, openMs:1500}`；`openMs = 612.2` |
| `perf-summarize.test.ts` | **6/6 绿**（含新增：开帽超限点名、旧报告缺字段仍按默认判） |

## 文件

- `red-green.log` / `smoke-red.log` / `smoke-green.log`：真跑三份原文。
- `run-ok.json`：默认帽那趟的完整报告（含新 `budgets.openMs`）。
- `docs-check.log`：台账门在补页之后的读数。

## 边界

- 帽是 1500 ms（约为实测上限 657 ms 的 2.3 倍）：它拦的是「数量级回归」，不是「慢 10%」——本机单跑离散度 1.66×（第 956 页），再紧就天天红。
- 只加判定，不改 `openMs` 的取数口径。
- CI 慢机用 `CAIRN_PERF_OPEN_BUDGET_MS` 抬帽，不许删闸。
