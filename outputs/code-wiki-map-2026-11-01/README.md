# CODE-WIKI 是一张能走通的地图 · 2026-11-01

检查起点与交付面都是共享工作树，HEAD `be9c0be5`；本批改动未提交。

## 这一批改了什么

`docs/CODE-WIKI.md` 是「先读它再动手」那张地图，但它有三处对不上：

1. `tests/markdown.test.tsx`、`scripts/ui-gallery.cjs` 两处少了 `apps/desktop/` 前缀——按仓库根照抄找不到文件；
2. 引用的判卷字符串 `标准 · 窗口 128k` 在第 937 页改成 `128.0k` 之后成了旧话。

改指真路径与真引文，并加一把尺（`tests/code-wiki-paths.test.ts`）：地图里每条路径必须按仓库根解析得到；
引用的「标准 · 窗口 …」必须逐字出现在 `render-structure.test.tsx` 里。

## 读数（工作树，未提交）

| 面 | 改前 | 改后 |
|---|---|---|
| 路径引用 | 31 条里 **2 条**按仓库根走不通 | 31 条**全部**解析得到 |
| 引文 | `标准 · 窗口 128k`（判卷里已是 `128.0k`） | `标准 · 窗口 128.0k`，与判卷逐字一致 |

| 判卷面 | 读数 |
|---|---|
| `code-wiki-paths.test.ts` | 回退两条路径 ⇒ **1 红**（点名两条）；回退引文 ⇒ **1 红**；改后 **2/2 绿** |
| 核心套件 | **603 文件 / 7536 条全绿**，exit 0 |
| 桌面套件 | **2062 条全绿**，exit 0（含 boundary 绿） |
| 根 typecheck | 0 报错 |

## 文件

- `red-green.log`：两处回退的红与复原后的绿，sha256 相同。
- `core.log` / `desktop.log` / `typecheck.log`：两个套件与根 tsc。
- `scoped.patch`：本批三个文件的差量。
- `docs-check.log`：台账门在补页之后的读数。

## 边界

- 只对 `docs/CODE-WIKI.md` 上尺；`docs/superpowers/plans/*` 这类历史计划稿描述的是当时的文件形状（`App.ts` 那种早已并成 `App.tsx`），不做追溯改。
- 引文那条只钉「标准 · 窗口 …」这一处（地图里唯一被引用、且判卷也在钉的字符串）；其他描述性文字不做机械比对。

## 复现

```sh
npx vitest run tests/code-wiki-paths.test.ts --config tests/vitest.config.ts
pnpm test:capped
```
