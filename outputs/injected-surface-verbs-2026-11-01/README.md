# 注入面也全覆盖 · 2026-11-01

检查起点与交付面都是共享工作树，HEAD `be9c0be5`；本批改动未提交。

## 这一批改了什么

静态工具面的动词判据只盯 `TOOL_NAMES`，运行期注入的五把漏在判据外：行首仍是实现名，其中三把的摘要还会甩 JSON。
本批补五个动词与三条主语，并把覆盖判据扩到 `INJECTED_TOOLS`（少一把就红、报错里点名）。

## 读数（工作树，未提交）

| 工具 | 改前（行面） | 改后（行面） |
|---|---|---|
| `obs_recall {id,by}` | `obs_recall {"id":"obs-7","by":"lines"}` | `回看 obs-7` |
| `impact_query {symbol}` | `impact_query {"symbol":"buildConfig"}` | `查波及面 buildConfig` |
| `impact_query {file}` | `impact_query src/a.ts` | `查波及面 src/a.ts` |
| `search_history {query}` | `search_history 登录重试` | `搜历史 登录重试` |
| `tool_search {query}` | `tool_search sqlite 查询` | `找工具 sqlite 查询` |
| `diagnose {}` | `diagnose {}` | `诊断 全部检查` |
| `diagnose {face:"lint"}` | `diagnose {"face":"lint"}` | `诊断 只跑 lint` |

| 判卷面 | 读数 |
|---|---|
| `tool-row-summary.test.ts` | 抽掉五个动词 ⇒ 覆盖判据红并点名 `impact_query \| obs_recall \| search_history \| diagnose \| tool_search`；抽掉三条主语 ⇒ **3 红**；改后 **25/25 绿** |
| 桌面套件 | **300 文件 / 2047 条全绿**，exit 0（含 boundary 绿） |
| 根 typecheck / 桌面 tsc / renderer-layer | 0 / 0 / 绿（175 个渲染层源文件） |

## 文件

- `before.log` / `after.log`：七格行面的前后对照。
- `red-green.log`：两处改前的红与复原后的绿。
- `desktop.log`：桌面套件 + boundary 的同树实跑。
- `typecheck.log`：根与桌面 tsc、renderer-layer。
- `scoped.patch`：本批四个文件的差量。
- `docs-check.log`：台账门在补页之后的读数。

## 边界

- 覆盖判据管的是「有没有动词」，不管「摘得对不对」；主语取值由各工具的行为判据盯着。
- `web_fetch` 不在 `INJECTED_TOOLS`（规格在 session-provider，按配置注册），词表里的 `抓取` 仍由陈旧键那条的豁免名单认。

## 复现

```sh
cd apps/desktop
npx vitest run tests/tool-row-summary.test.ts --config vitest.config.ts
pnpm test
```
