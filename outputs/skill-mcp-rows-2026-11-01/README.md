# 技能 / 目标 / MCP 元工具的行摘要 · 2026-11-01

检查起点与交付面都是共享工作树，HEAD `be9c0be5`；本批改动未提交。

## 这一批改了什么

`skill` / `refine_goal` / `mcp_list` / `mcp_activate` / `mcp_release` 的参数同样没有 command/path，
摘要此前落到 JSON 兜底（`{"name":"/plugin:review","args":…}`、`{}`）。本批在 `ownSubject` 补这五族，
并在共享词表补五个动词（用技能 / 改目标 / 列 · 启用 · 停用 MCP）。

## 读数（工作树，未提交）

| 工具 | 改前 | 改后 |
|---|---|---|
| `skill {name,args}` | `{"name":"/plugin:review","args":"src/a.ts"}` | `/plugin:review` |
| `refine_goal {objective}` | `{"objective":"把登录页的重试做成指数退避，并在 3 次失败后给出可操作提示"}` | `把登录页的重试做成指数退避，并在 3 次失败后给出可操作提示` |
| `mcp_list {}` | `{}` | `全部 MCP 服务器` |
| `mcp_list {server}` | `{"server":"plugin/sqlite"}` | `plugin/sqlite` |
| `mcp_activate {server,tools}` | `{"server":"plugin/sqlite","tools":["query","schema"]}` | `plugin/sqlite（2 把）` |
| `mcp_activate {server}` | `{"server":"plugin/sqlite"}` | `plugin/sqlite（整台）` |
| `mcp_release {server,tool}` | `{"server":"plugin/sqlite","tool":"query"}` | `plugin/sqlite / query` |

| 判卷面 | 读数 |
|---|---|
| `tool-row-summary.test.ts` | 关掉 ownSubject 复现 **13 红 / 8 绿**（含本批四条）；抽掉 mcp_activate 动词复现 **1 红**；复原 **21/21 绿** |
| 桌面套件 | **300 文件 / 2040 条全绿**，exit 0（含 boundary 绿） |
| 根 typecheck / 桌面 tsc / renderer-layer | 0 / 0 / 绿（175 个渲染层源文件） |

## 文件

- `before.log` / `after.log`：七个真值的前后摘要。
- `red-green.log`：两处改前的红与复原后的绿。
- `desktop.log`：桌面套件 + boundary 的同树实跑。
- `typecheck.log`：根与桌面 tsc、renderer-layer。
- `scoped.patch`：本批四个文件的差量。
- `docs-check.log`：台账门在补页之后的读数。

## 边界

- 运行期注入里还剩 `obs_recall` / `search_history` / `diagnose` / `impact_query` 没有主语规则（它们的参数面在各自模块里，下一批）。
- `mcp_activate` 的「N 把」是工具数量口径，工具名清单在展开区的原始参数里。

## 复现

```sh
cd apps/desktop
npx vitest run tests/tool-row-summary.test.ts --config vitest.config.ts
pnpm test
```
