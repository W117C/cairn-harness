# ⌘F 在折叠轮次里的命中 · 2026-11-01

检查起点与交付面都是共享工作树，HEAD `be9c0be5`；本批改动未提交。

## 这一批改了什么

折叠轮次的分支只渲染「第 N 轮 + 摘要」（`Stream.tsx` 的 folded 分支），正文不在 DOM ⇒ 查找条原来只查
DOM（`.row.user .t, .row.assistant .t`），自己折起来的那些轮一律搜不到（计数 0，也没有任何提示）。

1. `FindBar` 新增 `rows` / `foldedRounds` / `onExpandRound`（都可选）：可见部分仍按 DOM 命中（文档序在前），
   折叠轮次里的 user/assistant 正文按模型行补在后面（`foldedHitSeqs`，只算正文、工具行不参与）。
2. 步进到折叠轮次里的命中：先 `onExpandRound(round)` 展开那一轮，下一拍再按行锚（`data-event-id = seq + 1`）
   滚到 `.t` 并闪一下。
3. `WorkbenchView` 接线：`rows={streamRows}`、`foldedRounds={foldedRounds}`、`onExpandRound` 走 `streamActions.onToggleFold`。
4. 判卷 +3：折叠命中的模型口径 / 大小写与空查询 / 接线与「先展开再闪」的源码哨兵。

## 读数（工作树，未提交）

| 面 | 读数 |
|---|---|
| `find-bar.test.tsx` | 改前 A（折叠命中和等于 0）**2 红 / 5 绿**；改前 B（不展开）**1 红 / 6 绿**；改后 **7/7 绿** |
| 桌面套件 | **300 文件 / 2043 条全绿**，exit 0（含 boundary 绿） |
| 根 typecheck / 桌面 tsc / renderer-layer | 0 / 0 / 绿（175 个渲染层源文件） |

## 文件

- `red-green.log`：两处改前的红与复原后的绿，sha256 成对相同。
- `desktop.log`：桌面套件 + boundary 的同树实跑。
- `typecheck.log`：根与桌面 tsc、renderer-layer。
- `scoped.patch`：本批四个文件的差量。
- `docs-check.log`：台账门在补页之后的读数。

## 边界

- 只补「折叠轮次里的正文」；工具行、元信息、折叠摘要仍不参与（与 DOM 选择器同口径）。
- DOM 命中的文本是渲染后的可见文本；模型命中是原文——两者对 markdown 语法字符（如 `**`）的判定可能不同，
  这类查询在可见行上仍以 DOM 为准。
- 展开动作是 `onToggleFold`（只对已折叠的轮生效），不改折叠状态的其他口径。

## 复现

```sh
cd apps/desktop
npx vitest run tests/find-bar.test.tsx --config vitest.config.ts
pnpm test
```
