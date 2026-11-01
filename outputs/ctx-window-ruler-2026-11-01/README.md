# 上下文窗口也归同一把尺 · 2026-11-01

检查起点与交付面都是共享工作树，HEAD `be9c0be5`；本批改动未提交。

## 这一批改了什么

`formatCtxWindow`（模型菜单里的上下文窗口）自己写了一套：`12 000 → 12k`、`1 000 000 → 1M`；
而用量环 / 检查器 / 时间线 / 用量页都走 `formatTokens`（`128.0k` / `1.0m`）。同一个窗口两处两种写法。
`formatCtxWindow` 改成 `formatTokens` 的薄包装（未知/非正仍给「—」），并加一条「必须等于 `formatTokens`」的钉子。

## 读数（工作树，未提交）

| 窗口 | 模型菜单（改前） | 环 / 用量浮层 | 模型菜单（改后） |
|---|---|---|---|
| 128 000 | `128k` | `128.0k` | `128.0k` |
| 1 000 000 | `1M` | `1.0m` | `1.0m` |
| 1 500 000 | `1.5M` | `1.5m` | `1.5m` |

| 判卷面 | 读数 |
|---|---|
| `model-picker.test.ts` | 改回自带那套 ⇒ **2 红 / 12 绿**（`expected '1M' to be '1.0m'`）；改后 **14/14 绿**，含七个值逐个对 `formatTokens` 的钉子 |
| `model-menu-interaction` / `render-structure` | 三处 `窗口 128k` / `窗口 1M` 的钉改指新口径，**81/81 绿**（三文件合跑） |
| 桌面套件 | **2062 条全绿**，exit 0（含 boundary 绿） |
| 根 typecheck / 桌面 tsc / renderer-layer | 0 / 0 / 绿（176 个渲染层源文件） |

## 文件

- `red-green.log`：改回自带那套的红与复原后的绿，三组数字的两处现读。
- `desktop.log` / `typecheck.log`：桌面套件与两端 tsc、renderer-layer。
- `scoped.patch`：本批五个文件的差量。
- `docs-check.log`：台账门在补页之后的读数。

## 边界

- 只统一「token 量怎么显示」；「—」的缺省语义（未知窗口不冒充 0）没动。
- 至此用量环 / 检查器 / 时间线 / 用量页 / 模型菜单五个面读同一把尺；这条链上的钉子见 `model-picker.test.ts` 的逐值比对。

## 复现

```sh
cd apps/desktop
npx vitest run tests/model-picker.test.ts --config vitest.config.ts
pnpm test
```
