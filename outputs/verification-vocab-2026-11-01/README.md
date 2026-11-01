# 验证状态只有一套词 · 2026-11-01

检查起点与交付面都是共享工作树，HEAD `be9c0be5`；本批改动未提交。

## 这一批改了什么

同样四个状态（verified / failed / stale / absent），两处两套说法：

| 状态 | 编排面 `EVIDENCE_LABEL` | 交付卡 `STATUS_LABEL` | 收口后 |
|---|---|---|---|
| verified | 已验证 | 已验证 | 已验证 |
| failed | 验证失败 | 验证未过 | **验证失败** |
| stale | 验证过期 | 证据已过期 | **证据已过期** |
| absent | 未验证 | 未验证 | 未验证 |

收进 `derived/verification-labels.ts`（取两处各自最准的词）；交付卡多出的一档「无需验证」单独常量。

## 读数（工作树，未提交）

| 判卷面 | 读数 |
|---|---|
| `verification-labels.test.ts` | 交付卡写回自表（验证未过）⇒ **1 红**；`stale` 写回「验证过期」⇒ **1 红**；改后 **2/2 绿** |
| `delivery-summary.test.tsx` | 同一处回退 ⇒ **1 红**（它原本钉着「验证未过」） |
| `orchestration-controls.test.ts` | 四值钉改指「证据已过期」 |
| 桌面套件 | **2071 条全绿**，exit 0（含 boundary 绿） |
| 两端 typecheck | 0 / 0 |

## 文件

- `red-green.log`：两处造红的原文与复原后的绿（三个判卷文件合跑 25/25）。
- `desktop.log` / `typecheck.log`：桌面套件与两端 tsc。
- `scoped.patch`：本批八个文件的差量（两个新文件相对 /dev/null）。
- `docs-check.log`：台账门在补页之后的读数。

## 边界

- 只统一「同一状态怎么说」；状态本身的判定（`turnDelivery` 的 stale/absent 规则）没动。
- 「无需验证」是交付卡专有的第五档，不塞进四值表——它不是「验证的结果」，而是「不需要验证」。
- 认不出的状态原样返回，不替事件流编词。

## 复现

```sh
cd apps/desktop
npx vitest run tests/verification-labels.test.ts tests/delivery-summary.test.tsx tests/orchestration-controls.test.ts --config vitest.config.ts
pnpm test
```
