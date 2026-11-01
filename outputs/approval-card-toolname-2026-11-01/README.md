# 名单外工具的批准卡要看见工具名 · 2026-11-01

检查起点与交付面都是共享工作树，HEAD `be9c0be5`；本批改动未提交。

## 这一批改了什么

`describeAsk` 只给几张熟面孔写人话，其余工具走兜底：标题「需要你批准」+ `JSON.stringify(args)`。
工具名只出现在卡片的 `aria-label` 里 ⇒ 屏幕上只有参数 JSON，批的是哪把工具无从判断。
CLI 那一面早就把工具名印在提示里（`src/cli.ts:832`），桌面这套兜底卡丢了它。

改：兜底补 `subject: 工具名`（卡片有现成的 `.ask-subject` 位，带 title 悬停看全），参数 JSON 保留。

## 读数（工作树，未提交）

| 面 | 改前 | 改后 |
|---|---|---|
| `describeAsk({tool:"mystery_tool",args:{a:1}})` | `{ title: "需要你批准", body: "{\"a\":1}" }` | `{ title: "需要你批准", subject: "mystery_tool", body: "{\"a\":1}" }` |
| `mcp__db__drop_table` 卡片（SSR） | 可见文本只有标题 + 参数 JSON | 标题 + **工具名** + 参数 JSON |

| 判卷面 | 读数 |
|---|---|
| `approval-card.test.tsx` | 改回兜底 ⇒ **2 红 / 11 绿**；改后 **13/13 绿** |
| 桌面套件 | **2051 条全绿**，exit 0（含 boundary 绿） |
| 根 typecheck / 桌面 tsc | 0 / 0 |

## 文件

- `red-green.log`：改回兜底的两条红与复原后的绿。
- `desktop.log`：桌面套件的同树实跑。
- `typecheck.log`：根与桌面 tsc。
- `scoped.patch`：本批三个文件的差量。
- `docs-check.log`：台账门在补页之后的读数。

## 边界

- 只补「哪把工具」这一格；参数仍是原样 JSON——把危险参数渲染成人话是另一件事。
- `aria-label` 不变（屏幕阅读器本来就能听到工具名）。

## 复现

```sh
cd apps/desktop
npx vitest run tests/approval-card.test.tsx --config vitest.config.ts
pnpm test
```
