# 插件标签一把尺 · 2026-11-01

检查起点与交付面都是共享工作树，HEAD `be9c0be5`；本批改动未提交。

## 这一批改了什么

来源/作用域的词表有三份手抄本：列表页与发现页把 local 写「本地」，安装确认卡写「本地目录」；runtime 只有列表认「手动」；
作用域一边按 `scope === "project"` 判、一边按 `scope === "user"` 判。词表收到
`components/plugins/labels.ts`（`sourceKindLabel` / `scopeLabelOf`），三张卡都读它。

## 读数（工作树，未提交）

| 取值 | 改前（列表 / 发现页） | 改前（安装卡） | 改后（三张卡一致） |
|---|---|---|---|
| `catalog` | 官方目录 | 官方目录 | 官方目录 |
| `git` | Git | Git | Git |
| `local` | **本地** | **本地目录** | **本地目录** |
| `runtime` | 手动 | （走不到） | 手动 |
| `user` / `project` | 全局 / 当前项目 | 全局 / 当前项目 | 全局 / 当前项目 |

| 判卷面 | 读数 |
|---|---|
| `plugin-labels.test.ts` | 改前 A（local 写「本地」）2 红 / 1 绿；改前 B（发现页抄回自份）1 红 / 2 绿；改后 **3/3 绿** |
| 桌面套件 | **301 文件 / 2050 条全绿**，exit 0（含 boundary 绿） |
| 根 typecheck / 桌面 tsc / renderer-layer | 0 / 0 / 绿（176 个渲染层源文件，+1 新模块） |

## 文件

- `red-green.log`：两处改前的红与复原后的绿，sha256 成对相同。
- `desktop.log`：桌面套件 + boundary 的同树实跑。
- `typecheck.log`：根与桌面 tsc、renderer-layer。
- `scoped.patch`：本批六个文件的差量（两个新文件相对 /dev/null）。
- `docs-check.log`：台账门在补页之后的读数。

## 边界

- runtime（手放进插件目录、没有安装记录的那类）仍显示「手动」，与 local 保留区分；本批只统说法，不改判定口径。
- 来源枚举来自 core 的 `PluginSource`（catalog / git / local），前端多一个 runtime；词表按这一份枚举写全。

## 复现

```sh
cd apps/desktop
npx vitest run tests/plugin-labels.test.ts --config vitest.config.ts
pnpm test
```
