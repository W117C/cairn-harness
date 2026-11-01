# apply_patch 的批准卡先给抬头 · 2026-11-01

检查起点与交付面都是共享工作树，HEAD `be9c0be5`；本批改动未提交。

## 这一批改了什么

补丁正文在批准卡上是一个 `max-height: 132px` 的滚动框——300 行的补丁只看得到开头六行，批准等于盲批。
`describeAsk` 给 `apply_patch` 加一条副行：用 core 的 `parsePatch`（纯函数，零 IO）解出文件数、增删行数
与前三路径；解析不了就**不摆抬头**（宁缺不猜），补丁原文仍整段在卡上。

## 读数（工作树，未提交）

| 面 | 改前 | 改后 |
|---|---|---|
| 两文件补丁的卡 | 标题 + 132px 滚动框里的补丁原文 | 标题 + **`2 个文件 · +3 −2 · src/a.ts、src/b.ts`** + 补丁原文 |
| 解析不了的文本 | 标题 + 原文（同左） | 标题 + 原文，**不摆抬头**（不猜） |

| 判卷面 | 读数 |
|---|---|
| `approval-card.test.tsx` | 去掉抬头接线 ⇒ **1 红**；抬头函数恒 undefined ⇒ **2 红**；改后 **18/18 绿** |
| 桌面套件 | **2057 条全绿**，exit 0（含 boundary 绿） |
| 根 typecheck / 桌面 tsc / renderer-layer | 0 / 0 / 绿（176 个渲染层源文件） |
| `pnpm run build`（Vite） | **exit 0**——渲染层引用 core 的 `patch-parse` 打得进包（跨边界 import 不是空话） |

## 文件

- `red-green.log`：两处改前的红与复原后的绿，sha256 相同。
- `desktop.log` / `typecheck.log` / `build.log`：桌面套件、两端 tsc、Vite 构建。
- `scoped.patch`：本批三个文件的差量。
- `docs-check.log`：台账门在补页之后的读数。

## 边界

- 抬头只做「几个文件、增删多少、动了谁」；更细的逐 hunk 视图仍在「改动」窗格里（那里有 DiffView）。
- `parsePatch` 只吃 `git diff` 那一族形状；`*** Update File:` 那族的补丁会解析失败 ⇒ 不摆抬头，原文照旧。
- 前三路径之后用「等 N 个」收口，不把 200 个文件名塞进一行。

## 复现

```sh
cd apps/desktop
npx vitest run tests/approval-card.test.tsx --config vitest.config.ts
pnpm run build
```
