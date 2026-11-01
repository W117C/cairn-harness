# 用量页的 token 数字回到同一把尺 · 2026-11-01

检查起点与交付面都是共享工作树，HEAD `be9c0be5`；本批改动未提交。

## 这一批改了什么

用量页的 `usageTokenLabel` 走 `Intl.NumberFormat` 的中文紧凑记法，用量环 / 检查器 / 时间线走 `formatTokens`
（k/m 档）⇒ 同一个 token 数两种写法。`usageTokenLabel` 改读 `formatTokens`；缺测（`measured === 0`）仍是「—」。

## 读数（工作树，未提交）

| token 数 | 用量环 / 检查器 / 时间线 | 用量页（改前） | 用量页（改后） |
|---|---|---|---|
| 14 000 | `14.0k` | `1.4万` | `14.0k` |
| 1 250 000 | `1.3m` | `125万` | `1.3m` |
| 1 830 | `1.8k` | `1830` | `1.8k` |

| 判卷面 | 读数 |
|---|---|
| `usage-dashboard.test.tsx` | 改回中文紧凑记法 ⇒ **1 红 / 4 绿**；改后 **5/5 绿**（含 14.0k / 1.3m 两条新断言与「不再出现 compact 记法」的哨兵） |
| 桌面套件 | **2062 条全绿**，exit 0（含 boundary 绿） |
| 根 typecheck / 桌面 tsc / renderer-layer | 0 / 0 / 绿（176 个渲染层源文件） |

## 文件

- `red-green.log`：改回中文记法的红、复原后的绿，以及三组数字的两把尺现读。
- `desktop.log` / `typecheck.log`：桌面套件与两端 tsc、renderer-layer。
- `scoped.patch`：本批三个文件的差量。
- `docs-check.log`：台账门在补页之后的读数。

## 边界

- 只统一「token 数字怎么显示」；缺测仍显「—」，CSV 导出仍是原始整数（导出面不适用展示口径）。
- 会话数 / 轮次 / 工具步数这些**计数**不走 `formatTokens`（它们是整数，不是 token 量）。

## 复现

```sh
cd apps/desktop
npx vitest run tests/usage-dashboard.test.tsx --config vitest.config.ts
pnpm test
```
