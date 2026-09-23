# verify 红的分母：本语料里 3/3 全是环境红（P1-3 落笔前的实测）

日期 2026-09-23 · 分支 `codex/dsh-structural-hardening` · 起点 HEAD `13ac3d5`（复跑面门落库后）
命题来源：`outputs/gap-fix-proposal-2026-09-23.md` P1-3 + `docs/judgment-layer-calibration-proposal.md` §9。
本页只做一件事：**在动 `src/` 之前把分母量出来**，并按本仓纪律当场复核那条"先不加"的裁决还站不站得住。

## 一、读数（登记项 `replay:verify-cause-mix`）

```sh
node --import tsx scripts/replay/verify-cause-mix.ts
```

```
verify_result 事件=19 红事件=3 红命令=3
带 cause 字段的红命令= 0 （>0 表示 cause 已落盘）
钩子异常拍（红且 results 为空）= 0 红事件里 harness 自动拍= 0
结构栏（产品可用的机制）: unknown:3
文案栏（人眼线索，非判据）: code-or-unknown:3
今天可机器归因占比= 0.00 (0/3)
```

语料 = 本机 `outputs/**` 的 19 个会话流（**不在 git 里**，干净 checkout 上这条命令 exit 1 并说明缺哪个根）。

两条读数的含义要分开，别混着念：

- **`0.00 (0/3)` 是仪器级读数，不是群体级读数**。今天事件里根本没有 `cause` 字段，结构栏按定义只能
  认出 `(none)` 这一类哨兵，所以"归因占比 0"里有 3 是"测不到"、不是"没有环境红"。
  P1-3 落盘后同一条命令的 `带 cause 字段的红命令` 必须 >0 —— 那才是这条尺的 after 判据。
- **群体级读数来自逐条看那 3 条红的开头**（脚本下方附的取料就是这几条）：

| 会话流 | 命令 | 输出开头 |
|---|---|---|
| `loop-eval-2026-09-20-base/I2-rep1-base` | `pnpm run test` | `[ERR_PNPM_UNSAFE_MODULES_DIR] Refusing to remove the modules directory at ".../fixtures/todo-app/…"` |
| 同上（第二拍） | `pnpm run test` | 同一条 |
| `loop-eval-2026-09-20-short/I2-rep1-short` | `pnpm run test` | 同一条 |

⇒ **3/3 = 100% 是环境红**（pnpm 拒动 modules 目录，模型写的代码根本没被跑到），
而它们当场就被记成一次验证失败：烧模型额度、进 `failureDigest` 让模型去"修"、并进沉淀。

## 二、这反过来推翻了一条已记档的裁决（必须点名）

§9.1 定案的 `cause` 集里，**包管理器错误码白名单（`^\[ERR_PNPM_…`）被以这条理由省略**：
「它要治的态已被 9.2 消除，为已消失的样本建分类器是反向的"为假想需求设计"」。实测两处都不成立：

1. **9.2 的缓解不在这一类上**：`EVAL_EXEC`（`scripts/loop-eval.ts:87-88`）加的前缀是
   `pnpm_config_verify_deps_before_run=false`，它治的是 **deps-before-run / lockfile 预检**那一类；
   `UNSAFE_MODULES_DIR` 是 pnpm 拒删 modules 目录，前缀碰不到它。上面 3 条红就发生在评测跑出来的会话里。
2. **9.2 本身还没落到生产路径**：`verifyExec`（`src/main/agent-runner.ts:1092-1093`）在
   `sandbox?.available` 为假时**整段退回 `defaultExec`**，既无前缀也无 runner 映射 ⇒ 生产侧照旧。

按本页 §一 的分母：这一类不是"已消失的样本"，是**目前唯一被观测到的环境红样本（3/3）**。
被省略的裁决要重开——但**怎么补**不在这里拍：它和 `cause` 落盘是同一原子单元（缺字段则分类器无处可写），
见下节切法。

## 三、P1-3 的施工切法（据本页读数收窄过一遍）

三处出口都是**读代码定位**到的，不是猜的：

| 出口 | 位置 | 环境红今天造成的事 |
|---|---|---|
| 涨 attempt | `src/agent/loop.ts:128` `verifyAttempts++`（无条件） | 烧掉 `maxAttempts`（缺省 3）额度，模型没机会修真错 |
| 喂升档 | `src/agent/orchestrator-types.ts:204`（verify 红 ⇒ 按档位阶梯升一级重跑同一环） | 花更多钱换同一个环境错 |
| 进沉淀 | `src/agent/memory/distill.ts:56` `verify_result && !ok` | 记成"该模型在此处会失败"，喂 bandit β |

`cause` 集沿用 §9.1 定案五值（`code` / `timeout` / `toolchain-missing` / `no-surface` / `hook-error`）
+ `exitCode?: number`，缺省 `"code"` = 零行为。两个待定项在此立项时先说清：

- **spawn `error` 事件那条路**（`verify.ts:71-76`，今天已存在、已置 `ok:false`）落哪个值？它既不是代码错也不是
  退出码 127。取 `toolchain-missing`（"这台机器上没有能跑这条命令的东西"），并把它算作对该值的**口径加宽**，
  在 §9.1 追加一句写明——不许悄悄塞进去。
- **pnpm 错误码这一类**：要么补第 6 值（如 `toolchain-config`），要么让 9.2 的缓解真落到生产路径后**不补**，
  由 `no-surface`/`toolchain-missing` 之外留 `code`。这是裁决点，落码前需用户拍一下（下一页写明两条的代价）。

判卷形状（gap-fix P1-3 原话）：一条**合取**断言——同一条环境红在**三处出口**都不涨 attempt / 不喂升档 / 不进沉淀；
三道各测各的看不见中间漏过去的那条。加一条当场造红 + 变异锚点各钉一格（三出口共 3 条）。

## 四、本轮（读数轮）改了什么

只加尺，不改产品：新增 `scripts/replay/verify-cause-mix.ts` 并登记（`scripts/replay-readings.ts` 2→3 项），
judgment-layer §9.1 后补该读数的复跑块；`scripts/replay/corpus.ts` 把第一格抽成可调用的
`zeroCorpusProblem`（本读数只关心"有没有料"，"语料里没有 verify 拍"按 G7 口径标**不可测**并 exit 1，
不许报 0）。tsc 0 错、`docs-check` 全绿。
