# 字节刻度单一把尺 · 2026-11-01

检查起点与交付面都是共享工作树，HEAD `be9c0be5`；本批改动未提交。

## 这一批改了什么

字节刻度原本两份实现：附件行 `Composer.formatSize`（B 档不带单位、`Math.round(n/102.4)/10`）
与日志窗的局部 `formatBytes`（B 档带单位、`toFixed(1)`）。现收到 `derived/format-bytes.ts`：
B/KB/MB 一位小数、`1024.0 KB` 进位成 `1.0 MB`、非法与负数返回 `null`；两个组件都读它。

## 读数（工作树，未提交）

| 字节 | 改前（附件行） | 改前（日志窗） | 改后 |
|---|---|---|---|
| 512 | `512`（没单位） | `512 B` | `512 B` |
| 2048 | `2 KB` | `2.0 KB` | `2.0 KB` |
| 1048575（1 MB 差 1） | `1024 KB` | `1024.0 KB` | `1.0 MB` |
| 1047552 | `1023 KB` | `1023.0 KB` | `1023.0 KB` |
| 1048576 | `1 MB` | `1.0 MB` | `1.0 MB` |

| 判卷面 | 读数 |
|---|---|
| `format-bytes.test.ts` | 改前 A（不带进位）1 红 / 3 绿；改前 B（附件行回到自份）1 红 / 3 绿；改后 **4/4 绿** |
| 桌面套件 | **300 文件 / 2036 条全绿**，exit 0（含 boundary 绿） |
| 根 typecheck / 桌面 tsc / renderer-layer | 0 / 0 / 绿（175 个渲染层源文件，+1 新模块） |

## 文件

- `values.log`：七个真值（新值 + 两处旧公式的对照）。
- `red-green.log`：两处改前的红与复原后的绿。
- `desktop.log`：桌面套件 + boundary 的同树实跑。
- `typecheck.log`：根与桌面 tsc、renderer-layer。
- `scoped.patch`：本批五个文件的差量（两个新文件相对 /dev/null）。
- `docs-check.log`：台账门在补页之后的读数。

## 边界

- 只统一刻度与进位；「拿不到大小」的展示（附件行破折号 / 日志窗 `—`）留在各自调用点，没有把 unknown 折成 0。
- `OrchestrationPane` 的「计划文件不能超过 1 MB」是阈值文案，不是刻度，本批不动。

## 复现

```sh
cd apps/desktop
npx vitest run tests/format-bytes.test.ts tests/session-log-viewer.test.tsx --config vitest.config.ts
pnpm test
```
