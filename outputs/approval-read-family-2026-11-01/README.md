# 读族 / 渲染 / 诊断的批准卡也说人话 · 2026-11-01

检查起点与交付面都是共享工作树，HEAD `be9c0be5`；本批改动未提交。

## 这一批改了什么

`describeAsk` 此前只覆盖写族、命令、网络、记忆与定时任务。`read_file` / `grep` / `glob` / `lsp` /
`render_image` / `diagnose` 在沙箱降级或严格档下同样会弹批准卡，却一律落到「需要你批准 + 参数 JSON」——
批的是「读哪个文件 / 查什么 / 渲染哪张图」看不出来。补六条人话。

## 读数（工作树，未提交）

| 工具 | 改前 | 改后 |
|---|---|---|
| `read_file {path}` | 需要你批准 + `{"path":"src/a.ts"}` | **读取文件** / `src/a.ts` |
| `read_file {paths}` | 需要你批准 + 数组 JSON | **读取文件** / `a.ts、b.ts` |
| `grep {pattern}` | 需要你批准 + JSON | **查找内容** / `TODO` |
| `glob {pattern}` | 需要你批准 + JSON | **找文件** / `**/*.ts` |
| `lsp {symbol}` | 需要你批准 + JSON | **查符号** / 副行 `resolveFlag` |
| `render_image {path}` | 需要你批准 + JSON | **渲染图** / `out/chart.html` |
| `diagnose {}` | 需要你批准 + `{}` | **跑诊断** / `全部检查` |

| 判卷面 | 读数 |
|---|---|
| `approval-card.test.tsx` | 去掉这六条 ⇒ **2 红 / 13 绿**；改后 **15/15 绿** |
| 桌面套件 | **2054 条全绿**，exit 0（含 boundary 绿） |
| 根 typecheck / 桌面 tsc | 0 / 0 |

## 文件

- `red-green.log`：去掉六条的红与复原后的绿，sha256 相同。
- `desktop.log` / `typecheck.log`：桌面套件与两端 tsc。
- `scoped.patch`：本批三个文件的差量。
- `docs-check.log`：台账门在补页之后的读数。

## 边界

- 只动「批准卡怎么念」这一层：参数 JSON 在无字段可念时仍保留（可诊断性）。
- `lsp` 的 path 只在同时给了 symbol 时作副行；只给 path 时主体就是 path。
- 名单外工具（MCP scoped 等）仍走兜底「需要你批准 + 工具名 + JSON」。

## 复现

```sh
cd apps/desktop
npx vitest run tests/approval-card.test.tsx --config vitest.config.ts
pnpm test
```
