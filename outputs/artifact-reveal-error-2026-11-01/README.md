# 「在 Finder 中显示」失败不许静默 · 2026-11-01

检查起点与交付面都是共享工作树，HEAD `be9c0be5`；本批改动未提交。

## 这一批改了什么

同一个动作（`revealInFinder`）两处调用点，口径不一样：

| 调用点 | 失败时 |
|---|---|
| 项目列表 `state/projects.ts#handleRevealProject` | `toast.error(r.error ?? "无法在 Finder 中显示")`，抛错也 toast |
| 产物行 `state/workbench.ts#handleOpenArtifact` | `void …revealInFinder(abs)`——**结果直接丢掉** |

上一轮的产物常已被删、或者不在当前工作区：用户点「在 Finder 中显示」没有任何反应，只能猜是不是按钮坏了。改成与项目列表同口径。

## 读数（工作树，未提交）

| 判卷面 | 读数 |
|---|---|
| `artifact-reveal-error.test.ts` | 退回丢结果的写法 ⇒ **1 红**；改后 **2/2 绿**（另一条钉项目列表那处本来就这样） |
| 桌面套件 | **310 文件 / 2084 条全绿**，exit 0（含 boundary 绿） |
| 桌面 typecheck | 0 |

## 文件

- `red-green.log`：造红与复原的原文 + sha256。
- `desktop.log` / `typecheck.log`：桌面整套与 tsc。
- `scoped.patch`：本批三个文件的差量（判据文件相对 /dev/null）。
- `docs-check.log`：台账门在补页之后的读数。

## 边界

- 只补「失败要说出来」；HTML/SVG 预览那支（`openPreview`）没动——它有自己的错误面。
- 判据是接线级的（源码形状）：这条行为要真跑起来验，得在 Electron 里点一次产物行——那属于画廊/交互冒烟的范围，不在本批。
- 没有全仓批量改另外 80 多处 `void window.agent.*`：多数是 `.then(...)` 已接结果，或本来就是一发即忘的遥测（`reportViewing`）。

## 复现

```sh
cd apps/desktop
npx vitest run tests/artifact-reveal-error.test.ts --config vitest.config.ts
```
