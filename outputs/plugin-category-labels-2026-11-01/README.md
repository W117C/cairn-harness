# 插件类目只有一张词表 · 2026-11-01

检查起点与交付面都是共享工作树，HEAD `be9c0be5`；本批改动未提交。

## 这一批改了什么

发现页的能力计数用中文（智能体 / 钩子），而插件详情抽屉的「组成」行直接摆英文键名：
`技能 3 · 命令 2 · agents 1 · hooks 4 · MCP 0（激活 —）· LSP 2/3`——同一套词两处两种写法，英文那两格还夹在中文中间。
类目词表收到 `components/plugins/labels.ts`（`PLUGIN_CATEGORY_LABEL` / `categoryLabel`），发现页与抽屉都读它。

## 读数（工作树，未提交）

| 面 | 改前 | 改后 |
|---|---|---|
| 抽屉「组成」行 | `技能 3 · 命令 2 · agents 1 · hooks 4 · MCP 0 · LSP 2/3` | `技能 3 · 命令 2 · 智能体 1 · 钩子 4 · MCP 0 · LSP 2/3` |
| 发现页能力计数 | `CATEGORY_LABEL`（本文件私有） | 同一份 `PLUGIN_CATEGORY_LABEL` |

| 判卷面 | 读数 |
|---|---|
| `plugin-labels.test.ts` | 抽屉写回英文键名 ⇒ **1 红**；词表把 agents 读回英文 ⇒ **1 红**；改后 **5/5 绿** |
| 桌面套件 | **2062 条全绿**，exit 0（含 boundary 绿） |
| 根 typecheck / 桌面 tsc / renderer-layer | 0 / 0 / 绿（176 个渲染层源文件） |

## 文件

- `red-green.log`：两处改前的红与复原后的绿，sha256 相同。
- `desktop.log` / `typecheck.log`：桌面套件与两端 tsc、renderer-layer。
- `scoped.patch`：本批五个文件的差量。
- `docs-check.log`：台账门在补页之后的读数。

## 边界

- 只统一类目词；`MCP` / `LSP` 是专名，原样保留。
- 抽屉里的计数口径没动（`counts.*` 原样读），换的只是叫法。

## 复现

```sh
cd apps/desktop
npx vitest run tests/plugin-labels.test.ts --config vitest.config.ts
pnpm test
```
