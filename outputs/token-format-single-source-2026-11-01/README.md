# 用量数字的单一把尺 · 2026-11-01

检查起点与交付面都是共享工作树，HEAD `be9c0be5`；本批改动未提交。

## 这一批改了什么

用量数字原本有两份实现：`components/format-tokens.ts`（只有 k 档，用量环 / 检查器在用）与
`derived/timeline.ts` 里的局部 `fmtTokens`（k + m 两档，时间线 usage 步在用）⇒ 同一个 token 数两个写法。
现把实现搬到派生层 `derived/format-tokens.ts`（三个消费面都读得到），组件层那个文件改成转发出口；
`derived/timeline.ts` 删掉局部分份，改用共享实现。顺带把 `999_950…999_999` 从四位数 `1000.0k` 进位成 `1.0m`。

## 读数（工作树，未提交）

| 输入 | 改前（k-only） | 改后 |
|---|---|---|
| 1_000_000 | `1000.0k` | `1.0m` |
| 1_250_000 | `1250.0k` | `1.3m` |
| 999_960 | `1000.0k` | `1.0m` |
| 999_949 | `999.9k` | `999.9k` |
| 400_000 | `400.0k` | `400.0k` |
| 1234 / 0 | `1.2k` / `0` | `1.2k` / `0` |

| 判卷面 | 读数 |
|---|---|
| `model-picker.test.ts` + `timeline-pane.test.tsx` | 改前（k-only 那版）**2 红 / 20 绿** → **22/22 绿** |
| 桌面套件 | **299 文件 / 2026 条全绿**，exit 0（含 boundary 绿） |
| 根 typecheck / 桌面 tsc / renderer-layer | 0 / 0 / 绿（174 个渲染层源文件，+1 新模块） |

## 文件

- `before.log` / `after.log`：八个真值的前后输出（改前是 k-only 那版）。
- `red-green.log`：改前 2 红、复原后 22 绿，sha256 一致。
- `desktop.log`：桌面套件 + boundary 的同树实跑。
- `typecheck.log`：根与桌面 tsc、renderer-layer。
- `scoped.patch`：本批六个文件的差量（新模块相对 /dev/null）。
- `docs-check.log`：台账门在补页之后的读数。

## 边界

- 只统一「token 数怎么念」，没动采集与口径（unknown 仍不折 0）。
- 字节格式化（`SessionLogDialog` 的 KB/MB）是另一把尺，本批不动。

## 复现

```sh
cd apps/desktop
npx vitest run tests/model-picker.test.ts tests/timeline-pane.test.tsx --config vitest.config.ts
pnpm test
cd ../..
node --import tsx scripts/typecheck.ts
pnpm renderer-layer-check
```
