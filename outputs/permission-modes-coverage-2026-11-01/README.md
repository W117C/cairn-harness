# 设置页档位与词表逐个对上 · 2026-11-01

检查起点与交付面都是共享工作树，HEAD `be9c0be5`；本批改动未提交。

## 这一批改了什么

权限档的两份词表互相不锁：

| 词表 | 位置 | 消费面 |
|---|---|---|
| `MODE_LABEL` | `renderer/permission-labels.ts` | 芯片、菜单、确认框、命令面板 |
| `MODE_OPTIONS` | `renderer/components/settings-sections.tsx` | 设置页的五张单选卡 |

**这里出过一次真事故**（写在 `MODE_OPTIONS` 的注释里）：2026-10-24 加第五档 `full-access` 时只补了词表，设置页仍列四档 ⇒ 用户从设置页永远选不到最松档，而且用芯片切过去之后四个单选项**全不选中**（看起来像"没生效"）。本轮把这条事故变成判据。

## 读数（工作树，未提交）

| 面 | 现读 |
|---|---|
| `MODE_LABEL` 档位 | 5（read-only / default / guided / auto / full-access） |
| `MODE_OPTIONS` 档位 | 5，id 集合与词表**恰好相等**、无重复 |

| 判卷面 | 读数 |
|---|---|
| `permission-modes-coverage.test.ts` | 删掉 `full-access`（重演那次事故）⇒ **2 红**（集合不等 + 条数 <5）；同一档位列两遍 ⇒ **2 红**；改后 **3/3 绿** |
| 桌面套件 | **309 文件 / 2082 条全绿**，exit 0（含 boundary 绿） |
| 两端 typecheck | 0 / 0 |

## 文件

- `red-green.log`：两种造红（少一档 / 重一档）的原文与复原后的绿。
- `desktop.log` / `typecheck.log`：桌面整套与两端 tsc。
- `scoped.patch`：本批两个文件的差量（判据文件相对 /dev/null）。
- `docs-check.log`：台账门在补页之后的读数。

## 边界

- 两份词表的**措辞有意不同**：芯片要短（「默认」），单选卡要交代后果（「默认 · 逐次审批」）。判据只锁「有哪些档、有没有重复、有没有空串」，不锁措辞。
- 判据从 `MODE_LABEL` 的键取全集——加档时必须先动词表，设置页不跟就当场红。

## 复现

```sh
cd apps/desktop
npx vitest run tests/permission-modes-coverage.test.ts --config vitest.config.ts
```
