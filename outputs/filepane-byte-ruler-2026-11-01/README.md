# 文件窗格的大小也走字节尺 · 2026-11-01

检查起点与交付面都是共享工作树，HEAD `be9c0be5`；本批改动未提交。

## 这一批改了什么

文件树里 `{e.size}` 直接摆裸字节数（截图里是 `2140`、`880`），而附件行在同一版里已经写 `2.1 KB`
（第 924 页统一的那把尺）——同一个文件两种写法。改成 `formatBytes(e.size) ?? "—"`，并给第 925 页
那把覆盖尺加一条 `raw-bytes` 形状（直接渲染 `{x.size}`），再有人摆裸数就当场红。

## 读数（工作树，未提交）

| 面 | 改前（真机截图 `14-popout-pane.png`） | 改后 |
|---|---|---|
| `README.md` 行尾 | `2140` | `2.1 KB` |
| `package.json` 行尾 | `880` | `880 B` |

| 判卷面 | 读数 |
|---|---|
| `file-pane-improvements.test.ts` | 摆回 `{e.size}` ⇒ **1 红**；改后 **9/9 绿** |
| `format-rulers.test.ts` | 同一次回退被 `raw-bytes` 抓住，点名 `components/FilePane.tsx:208`；改后 **2/2 绿** |
| 桌面套件 | **2069 条全绿**，exit 0（含 boundary 绿） |
| 核心套件 | **605 文件 / 7540 条全绿**，exit 0 |
| 两端 typecheck | 0 / 0 |

## 文件

- `red-green.log`：一次回退同时打红两条判据的原文，复原后两条都绿。
- `core.log` / `desktop.log` / `typecheck.log`：两个套件与两端 tsc。
- `scoped.patch`：本批四个文件的差量。
- `docs-check.log`：台账门在补页之后的读数。

## 边界

- 只改「大小怎么显示」；目录大小仍是 `null`（不摆），未知不折成 0。
- `raw-bytes` 只认「直接渲染小写标识符的 `.size`」这一形状；`{STR.logViewer.size}`（文案标签）不匹配。
- 字节的格式化口径没动（仍是第 924 页那个 `formatBytes`）。

## 复现

```sh
cd apps/desktop
npx vitest run tests/file-pane-improvements.test.ts --config vitest.config.ts
npx vitest run tests/format-rulers.test.ts --config tests/vitest.config.ts
```
