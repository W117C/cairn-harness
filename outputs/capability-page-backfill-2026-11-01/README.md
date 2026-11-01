# LSP 能力协商的补记页 · 2026-11-01

检查起点与交付面都是共享工作树，HEAD `be9c0be5`；本批改动未提交。

## 这一批改了什么

那批（LSP 能力协商）的代码与判卷早在工作树里，但台账一直没落页，四处引用写着「第 914 页」——
一个不存在的页号。本页做两件事：

1. 补记一页（台帐第 920 页）把那批的行为、判卷面与今天的复跑读数记下来。
2. 四处引用改成第 920 页：`src/tools/lsp.ts:317`、`tests/lsp.test.ts:198`、`tests/lsp.test.ts:204`、
   `docs/CODE-WIKI.md:153`、`scripts/lib/mutations/tools.mjs:75`（变异表的那条注释）。

实现、判卷、口径一行未改——只动注释/标题里的页号。

## 读数（工作树，未提交）

| 面 | 读数 |
|---|---|
| 全仓「第 914 页」引用 | **0** |
| `tests/lsp.test.ts` | **25/25 绿** |
| LSP 相关（`tests/lsp*` + 插件激活/发现） | **8 文件 / 92 条全绿** |
| `tests/mutate-anchor-titles.test.ts` | **23/23 绿**（改 describe 标题没让锚点漂） |

## 文件

- `refs.log`：改后全仓 0 命中 + 五处指向第 920 页的行号原文。
- `tests.log`：三组复跑读数。
- `scoped.patch`：本批五个文件的差量。
- `docs-check.log`：台账门在补页之后的读数。

## 边界

- 补记不能替代当时的读数：那批自己跑过什么已无从回查，本页给的是今天的复跑读数。
- 只动注释与页号，没有改实现或判据；`tests/lsp.test.ts` 的 describe 标题变了，`mutate-anchor-titles` 23 条仍绿。
