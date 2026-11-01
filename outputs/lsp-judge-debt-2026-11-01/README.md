# LSP 判据债 · 2026-11-01

检查起点与交付面都是共享工作树，HEAD `be9c0be5`；本批改动未提交，未跑 `head-cert-check` / `mutate-verify`
（两者量的是 HEAD，工作树没提交前判不了）。

## 这一批改了什么

1. `src/tools/lsp.ts#requireProvider` 的能力边界话术由多段 `+` 拼接收成**一支**模板字面量（运行时字符串
   逐字不变），让「能力断言证人」这把尺能读出 ≥6 字的可判中文段；`tests/lsp.test.ts` 补原句证人。
2. `scripts/lib/mutations/tools.mjs` 三条 LSP 变异锚点改指现值（第 912/914 页把实现搬走了）：
   `lsp-diag-severity`、`lsp-diag-cap`、`plugin-lsp-diagnostics-switch-ignored`。

## 读数（工作树，未提交）

| 面 | 改前 | 改后 |
|---|---|---|
| `tests/promise-recall-inventory.test.ts` | 1 红 / 34 绿（「尺读不出」6 条 > 帽 5） | **35/35 绿** |
| 同一句的探针面（`probe-promise-recall.ts`） | 有证人 64／绑定 12／欠证人 0／尺读不出 **6（超帽）** | 65／12／0／**5（正贴线）**，四态相加 82 不变 |
| `pnpm mutate-needles-check` | 阻断 **21**，其中「针脚已不在源文件」**3** 条 | 阻断 **20**，「针脚已不在源文件」**0** 条；余 20 全为「钉在飞文本」 |
| `tests/lsp.test.ts` | 25/25 | **25/25**（同一用例内 +2 条断言，用例数不变） |

## 文件

- `before-probe.log` / `after-probe.log`：`node --import tsx scripts/probe-promise-recall.ts` 的同一行读数。
- `before-inventory.log` / `after-inventory.log`：`tests/promise-recall-inventory.test.ts` 改前红、改后绿。
- `after-lsp.log`：`tests/lsp.test.ts` 25/25。
- `mutation-kills.log`：用表里的 `apply` 逐条改 `src/tools/lsp.ts`，三条 killer 各红一次；每次复原后
  `sha256 c43e6b4787348bf316e57410da0cb819013d86c597d303f5ded495f4951eeb9f` 一致。
- `before-needles.log` / `after-needles.log`：`pnpm mutate-needles-check` 的前后原文。
- `scoped.patch`：本批三个文件的差量（相对本批开始时的内容），不含其他会话在飞改动。

## 复现

```sh
node --import tsx scripts/probe-promise-recall.ts | grep 能力断言证人面
npx vitest run tests/promise-recall-inventory.test.ts --config tests/vitest.config.ts --maxWorkers=2
npx vitest run tests/lsp.test.ts --config tests/vitest.config.ts --maxWorkers=2
pnpm mutate-needles-check
```
