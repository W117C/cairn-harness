# 行级评注的行键 · 2026-11-01

检查起点与交付面都是共享工作树，HEAD `be9c0be5`；本批改动未提交。

## 这一批改了什么

「改动」窗格的行级评注键此前是 `<path>|<newNo ?? oldNo>`——只有行号、没有哪一侧。一次「改这一行」的 diff
里删除行（oldNo=2）与新增行（newNo=2）共用一把键：一条评注同时挂两行，再写一条覆盖前一条；提交消息里的
「第 N 行」也说不清是改前还是改后（删除行按新文件找会找错）。

现在：行键 `<path>|<side>:<line>`（del 用旧文件行号、其余用新文件行号），`composeReviewMessage` 对删除侧
写「第 N 行（删除前）」；旧键 `<path>|<line>` 仍认（当轮内存里的评注不丢）。

## 读数（工作树，未提交）

| 面 | 读数 |
|---|---|
| 撞键实测 | 改前一条评注（`src/a.ts\|2`）在 DiffView 真 HTML 里渲染 **2 个标记**；改后 old/new 各挂各的 |
| 红→绿 | 行键改回只到行号 ⇒ diff-split **2 红**；解析改回老形状 ⇒ panes **1 红**；复原后 **42/42 绿** |
| 桌面套件 | **299 文件 / 2029 条全绿**，exit 0（含 boundary 绿） |
| 根 typecheck / 桌面 tsc / renderer-layer | 0 / 0 / 绿（174 个渲染层源文件） |

## 文件

- `before-collision.log`：改前那条探针（一条评注 ⇒ `markers = 2`）。
- `red-green.log`：两处改前的红与复原后的绿，sha256 成对相同。
- `desktop.log`：桌面套件 + boundary 的同树实跑。
- `typecheck.log`：根与桌面 tsc、renderer-layer。
- `scoped.patch`：本批六个文件的差量。
- `docs-check.log`：台账门在补页之后的读数。

## 边界

- 评注只活在本次渲染的 `useState`，不落盘、不跨会话 ⇒ 不需要迁移历史键；旧键仍被 `composeReviewMessage` 认。
- 并排视图只允许评右栏（现在还在的那一行），本批不改这个口径。

## 复现

```sh
cd apps/desktop
npx vitest run tests/panes.test.ts tests/diff-split.test.tsx tests/panes-structure.test.tsx --config vitest.config.ts
pnpm test
```
