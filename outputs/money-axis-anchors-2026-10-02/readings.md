# 钱轴锚点落定与认证（2026-10-02）

被测：HEAD `b44976a`（其父 `c438529`＝机制本体，本笔＝接线判卷＋三条锚点）。
命令与取数口径都按本仓固定流水线；退出码一律直接取、不接管道。

## 一、三条新锚点逐条杀（`pnpm mutate-verify <id> × 3`）

`run1.log`（退出码 0，本次耗时 2.9s，跑了 3/3 条，工作树 `.worktrees/gate-mutate-verify` → b44976a）

| 锚点 | 变异方向 | 结果 | 本机实测 |
|---|---|---|---|
| `cost-split-face-collapsed` | 分流恒真 ⇒ `validSpend` 退化成 `paidAll` | 杀死 | 0.7s／2 拍 |
| `loop-eval-money-numerator` | 汇总分子改回全量 `cny` | 杀死 | 0.8s／2 拍 |
| `loop-eval-wasted-cell-constant` | 白花那格印成常数 0 | 杀死 | 1.0s／2 拍 |

汇总行原文：`全部变异被正确杀死（断言非恒真）`。
成本分母原文：`判卷 spawn 6 次／3 条（每条次数分布 2×3）·单次中位 第1次 0.4s／第2次 0.5s·最贵一条 loop-eval-wasted-cell-constant 1.0s`。

三条各打不同用例（语义 1 条在纯函数用例、接线 2 条各在自己的用例），不是同一条用例被杀三遍。

## 二、针脚体检（`pnpm mutate-needles-check`，退出码 0）

全表 `1223 → 1226` 条（＋本笔 3 条）。原文：
`针脚体检：1226 条 —— 阻断 0，待复认 1，未覆盖 0，逐行式 5，未入库面 0（被测面 + 判卷两面），钉在飞文本 0，killer 指针失效 0（其中 HEAD 侧 0）`
`改法语法体检：1226 条改法全部产出合法源文件 ✅`

那条「待复认 1」**不是本笔的**：`verify-lang-timeout-same-as-npm`（针脚命中 2 处，存量）。
本笔三条 needle 插前逐字核过命中数＝1（见下"复现取料"里的探针写法）。

## 三、认证（`pnpm head-cert-check`，退出码 0）

`head-cert.log` 原文关键行：

- `认证门面=22 道（跑到 22）｜绿 22 道｜⚠️ 超预算 0`
- `TREE=b44976a DIRTY_JUDGED=0 依赖完整=是 收尾复核=同一笔 认证树锁=本进程持有`
- `Test Files 278 passed (278)｜Tests 3712 passed (3712)｜exit=0（退出码直接取，不接管道）`
- `未回收认证树 .worktrees/gate-head-cert：不是本次新建的树（复用来的共享树）⇒ 不收`

判卷条数与上一笔留档的关系：`1acc3c0` 留档 3710 ⇒ 现在 3712，差 ＝2，正是本笔新增的两条接线用例
（不是"跑出来多了"，是我列得出的那两条）。

## 四、这笔仍未证的（不许当作已闭）

- **钱轴的归因键**：`readings.json` 的行内仍无 `model` 字段，`createUsageAttributor` 的唯一调用点仍只有
  `src/main/agent-runner.ts:1599`——基准路径绕过它 ⇒ 跨模型 A/B 的分面对账还不成立。这一格是任务 #2 的下半，
  本目录只锚定了"分子分母同面"，没有锚定"每一笔钱属于哪个模型"。
- **台账页**：`PROGRESS.md` 是热串行点，按惯例留给整合的那笔；这里如实写明本笔未进页。
- 存量语料（36 趟那份 readings.json）没有 `model` 键 ⇒ 任何"按模型分臂"的历史读数仍不可回算，
  补上键之后也只有**新跑**才有数（与 09-27 那 166 条 usage 不回填同一口径）。

## 复现取料

```sh
# 三条锚点（须先落库，mutate-verify 量的是 HEAD）
pnpm mutate-verify cost-split-face-collapsed loop-eval-money-numerator loop-eval-wasted-cell-constant
# 针脚体检（只读，主树可跑）
pnpm mutate-needles-check
# 认证（自建树、自锁）
pnpm head-cert-check
# needle 命中数自证（插锚点前跑的形状）
node -e 'const fs=require("fs");const cs=[["scripts/lib/eval-validity.ts","    if (runValidity(x.r, x.g.fails).valid) validSpend += cny;"],["scripts/loop-eval.ts","(money.validSpend / t0.pass).toFixed(4)"],["scripts/loop-eval.ts","¥${money.wastedSpend.toFixed(4)}）"]];for(const [f,n] of cs)console.log(f,"hits",fs.readFileSync(f,"utf8").split(n).length-1)'
```
