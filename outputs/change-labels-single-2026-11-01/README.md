# 文件改动与方案动作的词各只有一张表 · 2026-11-01

检查起点与交付面都是共享工作树，HEAD `be9c0be5`；本批改动未提交。

## 这一批改了什么

两套词各被抄了多份：

| 词表 | 值 | 原分布 |
|---|---|---|
| 文件改动 | 新建 / 修改 / 变更 | `ChangeSummaryCard.CHANGE_LABEL`、`Inspector.CHANGE_WORD`、`PaneDock` 两处内联三元 |
| 方案动作 | 新建 / 修改 / 删除 | `PlanCard.ACTION_LABEL`、`PaneDock` 内联三元 |

两套词都收进 `derived/change-labels.ts`（`changeLabel` / `planActionLabel`），五个消费面改读同一份。

## 读数（工作树，未提交）

| 面 | 改前 | 改后 |
|---|---|---|
| 文件改动词表 | 3 份（2 张表 + 2 处三元） | **1 份**（`changeLabel`） |
| 方案动作词表 | 2 份（1 张表 + 1 处三元） | **1 份**（`planActionLabel`） |
| 认不出的 kind | 三元默认「变更」（两处） | `changeLabel` 一律「变更」，不猜成新建/修改 |
| 认不出的 action | `ACTION_LABEL[f.action] ?? f.action` | `planActionLabel` 原样返回 |

| 判卷面 | 读数 |
|---|---|
| `change-labels.test.ts` | 认不出的 kind 猜成「新建」⇒ **1 红**；PaneDock 又内联三元 ⇒ **1 红**；改后 **3/3 绿** |
| `review-split.test.ts` | 原来钉着 PaneDock 的内联三元，改指 `changeLabel(f.change)`（意图「徽标仍是文字」不变） |
| 桌面套件 | **2068 条全绿**，exit 0（含 boundary 绿） |
| 两端 typecheck | 0 / 0 |

## 文件

- `red-green.log`：两处造红的原文与复原后的绿，sha256 相同。
- `desktop.log` / `typecheck.log`：桌面套件与两端 tsc。
- `scoped.patch`：本批八个文件的差量（两个新文件相对 /dev/null）。
- `docs-check.log`：台账门在补页之后的读数。

## 边界

- 「变更」仍是 `change` 字段缺席时的缺省——不许猜成新建或修改（这一条判据钉住）。
- 方案动作是模型给的字符串，认不出的**原样显示**，不替它编一个中文词。
- 两套词放同一个模块是因为它们只差一档（「变更」vs「删除」），放一起才看得出区别；不是同一个枚举。

## 复现

```sh
cd apps/desktop
npx vitest run tests/change-labels.test.ts tests/review-split.test.ts --config vitest.config.ts
pnpm test
```
