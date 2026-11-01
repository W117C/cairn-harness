# evolve 的内容指纹只有一份 · 2026-11-01

检查起点与交付面都是共享工作树，HEAD `be9c0be5`；本批改动未提交。

## 这一批改了什么

`digestOf`（`sha256` 前 16 位十六进制）在四个文件里各抄了一份：`agent/evolve/candidates.ts`、
`agent/evolve/episode.ts`、`agent/evolve/playbook.ts`、`main/evolve/playbook-store.ts`。
这四处的 id 都由它派生——`cand_…`、`ep_…`、playbook 条目 `digest`、`legacyId` 里的 `exp_…`。
四份现在一模一样，但长度或算法只要有一处改了，跨模块 id 就**静默失配**（按 id 查不到，也不报错）。
实现收到 `src/agent/evolve/digest.ts`，四处改成 import。

## 读数（工作树，未提交）

| 面 | 改前 | 改后 |
|---|---|---|
| `function digestOf` 定义处 | 4 处（各文件私有） | **1 处**（`src/agent/evolve/digest.ts`） |
| 四个消费面 | 各读自己那份 | 都 `import { digestOf }` |
| 行为 | — | 逐字一致（同一实现搬出去），`e3b0c44298fc1c14` 真值钉住 |

| 判卷面 | 读数 |
|---|---|
| `evolve-digest.test.ts` | playbook 抄回自份 ⇒ **1 红**；指纹长度改 12 位 ⇒ **2 红**（真值 + `slice(0, 16)`）；改后 **2/2 绿** |
| 核心套件 | **604 文件 / 7538 条全绿**，exit 0 |
| 桌面套件 | **2062 条全绿**，exit 0（含 boundary 绿） |
| 两端 typecheck | 0 / 0 |

## 文件

- `red-green.log`：两处造红的原文与复原后的绿，sha256 相同。
- `core.log` / `desktop.log` / `typecheck.log`：两个套件与两端 tsc。
- `scoped.patch`：本批七个文件的差量（含一个新模块与一个判据文件）。
- `docs-check.log`：台账门在补页之后的读数。

## 边界

- 只搬实现、不改算法与长度（`slice(0, 16)` 原样），所以既有 id 一个都不变——这是「静默失配」风险的结构性收敛，不是行为变更。
- `uniqueSorted` 之类同名小工具没并入：它们在各模块语义一致但不是 id 身份面，不属本批范围。

## 复现

```sh
npx vitest run tests/evolve-digest.test.ts --config tests/vitest.config.ts
pnpm test:capped
```
