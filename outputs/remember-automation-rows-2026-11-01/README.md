# 记忆与定时任务的行摘要 · 2026-11-01

检查起点与交付面都是共享工作树，HEAD `be9c0be5`；本批改动未提交。

## 这一批改了什么

第 917 页给编排族与 clarify 挑了主语，但 `remember` / `automation_*` 的参数仍然一个字段都不在通用取值链上，
折叠行落到 JSON 兜底（`{"scope":"project","kind":"decision",…}`、`{}`）。本批：

1. `derived/stream.ts#ownSubject` 补两族：remember→正文首行（无正文用 `topic`）、automation_create/update→`name`
   （update 缺 name 用 id）、delete/run_now→`id`、list→「全部定时任务」。
2. `derived/tool-verbs.ts`（共享词表）补六个动词：记住 / 建 · 改 · 删 · 跑 · 列定时任务。
3. `tests/tool-row-summary.test.ts` +3（remember 三态 / automation 五格 / 行面 SSR）。

## 读数（工作树，未提交）

| 工具 | 改前 | 改后 |
|---|---|---|
| `remember {content}` | `{"scope":"project","kind":"decision","op":"append","content":"发布前必须跑全量 gates；上一轮` | `发布前必须跑全量 gates；上一轮因为跳过它把红带进了 main。` |
| `remember {topic}` | `{"kind":"memory","topic":"release-gate"}` | `release-gate` |
| `automation_create {name,…}` | `{"name":"每日备份","prompt":"备份仓库","schedule":[…]}` | `每日备份` |
| `automation_update {id,name}` | `{"id":"a1","name":"每周巡检"}` | `每周巡检` |
| `automation_delete/run_now {id}` | `{"id":"a1"}` | `a1` |
| `automation_list {}` | `{}` | `全部定时任务` |

| 判卷面 | 读数 |
|---|---|
| `tool-row-summary.test.ts` | 关掉 ownSubject 复现 **9 红 / 8 绿**；抽掉 remember 动词复现 **1 红**；复原 **17/17 绿** |
| 桌面套件 | **299 文件 / 2032 条全绿**，exit 0（含 boundary 绿） |
| 根 typecheck / 桌面 tsc / renderer-layer | 0 / 0 / 绿（174 个渲染层源文件） |

## 文件

- `before.log` / `after.log`：七个真值的前后摘要。
- `red-green.log`：两处改前的红与复原后的绿。
- `desktop.log`：桌面套件 + boundary 的同树实跑。
- `typecheck.log`：根与桌面 tsc、renderer-layer。
- `scoped.patch`：本批四个文件的差量。
- `docs-check.log`：台账门在补页之后的读数。

## 边界

- 运行期注入里还剩 `skill` / `mcp_*` / `obs_recall` / `search_history` / `diagnose` / `impact_query` 没有主语规则。
- remember 只取正文首行；正文其余行仍在展开区的原始参数里。

## 复现

```sh
cd apps/desktop
npx vitest run tests/tool-row-summary.test.ts --config vitest.config.ts
pnpm test
```
