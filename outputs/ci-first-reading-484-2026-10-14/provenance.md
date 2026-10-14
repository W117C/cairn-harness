++
# 第 484 页取料：CI 第一次给出「本机之外」的读数

出证 2026-10-14；推送 commit `40f09ccd`（本页台账 HEAD），run **38516829143**。

## 1. 为什么记这一笔

`docs/development-plan-2026-10-12.md` 第 4 波写着：这一波的成功判据**不是 CI 绿**，
是「终于有了一份非本地自评的读数」。此前仓里 `git remote` = 0 条、CI 从未真跑过；
2026-10-13 起配了远端（`W117C/cairn-harness`，private），这一页是本机全绿之后
第一次由 runner 复述同一棵树的结论。

## 2. 读数（逐 step，取 `gh run view --json`）

`headSha=40f09ccd2a4ceeb30c1e0a9b59827475c98c02c1`，`conclusion=success`：

| # | step | 结论 |
|---|---|---|
| 1 | Set up job | success |
| 2 | actions/checkout@v4 | success |
| 3 | pnpm/action-setup@v4 | success |
| 4 | actions/setup-node@v4 | success |
| 5 | `pnpm install --frozen-lockfile` | success |
| 6 | typecheck | success |
| 7 | full test suite | success |
| 8 | desktop tests | success |
| 9 | fast gates (cert face, 25) | success |

墙钟：起跑 05:28:39Z，`full test suite` 一段 05:28:58Z → 05:32:44Z（≈3m46s），整 run ≈6 分钟。

## 3. 怎么读它（不许读大的部分）

- 这一趟**不覆盖** `mutate-verify` 全表（1558 条 ≈ 20+ 分钟）与 `head-cert-check`——
  CI 跑的是 cert 面里那 25 道快的。所以「CI 绿」≠ 「全表在 HEAD 上全杀」；
  后者是同日在本机由 `pnpm gates` 出的（34/34，`mutate-verify` 1558 条全杀）。
- 同 sha 两趟结果不同不是改动信号：第 481 页已登记过一次第一趟 canceled（steps=0、15m 断），
  `gh run rerun --failed` 后同 sha success ⇒ 因果在 runner 侧（macOS 队列），不在改动侧。
- 本页没有跑任何真模型请求；CI 也没有凭据（`CAIRN_API_KEY` 缺席），暗卷照旧跳过。


## 4. 累计读数（2026-10-14 晚更新）

推送历史（`gh run list --branch zcode`）：

| run | headSha | 结论 |
|---|---|---|
| 38516829143 | `40f09ccd` | success（9 步全绿） |
| 38518011858 | `b3aa6e3e` | success |
| 38523971766 | `e1b64ae3` | success |
| 38552490396 | `065fa440` | success |

⇒ **本机全绿之后，CI 连续四次独立复述同一结论**，其中三次是本页之后的新工作。
第 481 页那次 `failure` 是早于本页的历史（第一趟 canceled、steps=0，同 sha 重跑 success），
成因在 runner 侧（macOS 队列），不是改动信号。

## 5. 反向验证：CI 真的会拦（路线图第 4 波自己要求的那一格）

原文：「故意推一处类型错误 ⇒ CI 必须红，且由 workflow 抓到（**本地跑不算**）」。

做法：在一次性分支 `codex/ci-negative-probe`（HEAD `40f09ccd`）上注入一处类型错误
（`const deliberateTypeError: number = "this is not a number";`），推上去，看完就删分支删远端
（主树 `zcode` 从未带过这笔）。

读数（run **38517608076**，`negative-probe.log`）：

| # | step | 结论 |
|---|---|---|
| 1-5 | setup / checkout / pnpm / node / install | success |
| 6 | **typecheck** | **failure** |
| 7 | full test suite | **skipped** |
| 8 | desktop tests | **skipped** |
| 9 | fast gates (cert face, 25) | **skipped** |

CI 日志逐字：`##[error]src/agent/acceptance-sampler.ts(89,9): error TS2322: Type 'string' is not assignable to type 'number'.`

⇒ 「CI 会放过一棵坏树」这一半不成立；两道证据现在都全了：好树放过（38516829143 success）、
坏树拦住（38517608076 failure 且后置三步全 skip）。分支与远端 ref 均已删除，
本机 `git log --oneline -1` 仍停在 `40f09ccd`，`rg deliberateTypeError src/` 零命中。

## 6. 仍未证（不许读成绿）

① CI 只覆盖 25 道 cert 面门，另 9 道（含 `mutate-verify` / `head-cert-check`）没有 runner 侧读数；
② 反向验证只验了**类型错误**这一种坏法，没验「判卷红但 typecheck 绿」那种（后者 CI 也会拦，
   但本页没有它的读数）；③ 真模型/生产行为未跑（CI 无凭据，暗卷照旧跳过）；
④ ubuntu runner 未验（workflow 注释里自己记着：换 runner 前要先在真实 CI 上验一轮）。
