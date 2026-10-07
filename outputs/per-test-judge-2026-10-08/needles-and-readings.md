# 逐测试名判卷（第 414 页）这一簇的反证与读数取料面

日期 2026-10-08。这一份存在的原因：§1 那张 16 针表**由子代理实跑**、它自己那侧的 `/tmp` 日志几小时内会消失，
而第 414 页 §4 引了它 ⇒ 不当场拷进仓里，下一页就没人能复算。§2 起是编排者第一手。

## 1. 反向验证 16 针（子代理实跑；编排者未复跑，本页把这一点写在脸上）

每针杀在**不同**用例上（这才是"有分辨力"的形状；一针只让同一条用例红两次＝半根针）。

| 针 | 摘掉的东西 | 变红的用例数 |
|---|---|---|
| M1 | SWE-bench 那条构造不再产出 `judge` | 3（跨两份判卷文件） |
| M2 | `TASK_FIELDS` 不登记 `judge` | 3 |
| M3 | `parseOne` 不透传 `judge` | 2 |
| M4 | 不复用 `namedSetProblems` 而另抄一份清单 | 2 |
| M5a／M5b | vitest「计划线对逐名数」两支各摘一次 | 1／2 |
| M6 | 顶层 `success=false` 不再参与派生完整 | 1 |
| M7 | `numTotalTests` 不参与核对（含真料切片那条） | 2 |
| M8 | 把 `unmatched`（名字对不上）蒙成绿 | 4 |
| M9 | pytest 零逐名也报「完整」 | 1 |
| M10 | 不认识的状态默认当 `passed` | 2 |
| M11 | 省略标记（`…`／截断）不再落成 `incomplete` | 1 |
| M12 | 「PASS_TO_PASS 一条不许坏」那一半摘掉 | 2 |
| M13 | 结尾汇总行缺失仍报完整 | 1 |
| M14／M15／M16 | 其余三格（TAP 计数、`unknown` 出口、`counts` 与逐名一致性） | 2／2／1 |

复原凭证：每针 `cp` 备份 ⇒ 改回后 `cmp` 逐字节一致，末次 `shasum` 前缀
`src/agent/eval/test-results.ts` ＝ `40eb48c2…`、`src/agent/eval/task-set.ts` ＝ `881d6781…`。
造红前 `pgrep -fl "vitest.mjs run --config tests"` 为空（不撞窗）。

## 2. 编排者第一手读数

四份判卷一趟（新两份＋两份邻卷）：

```text
 Test Files  4 passed (4)
      Tests  120 passed (120)
W1_VITEST_EXIT=0
```

120 ＝ 40（`tests/eval-test-results.test.ts`）＋ 50（`tests/eval-task-set.test.ts`）＋ 23（`tests/bench-corpus-parity.test.ts`）＋ 7（`tests/src-execution-path.test.ts`）。

类型面：

```text
typecheck: tsc --noEmit 通过（0 条报错）✅
TC_EXIT=0
```

## 3. 全量面（取在**主树脏面**，不是 HEAD）

```text
 Test Files  6 failed | 358 passed (364)
      Tests  6 failed | 5094 passed (5100)
FULL_EXIT=1
```

六条红的宿主文件与被红格子（逐条现读，全部在本簇 import 闭包之外）：

```text
 ❯ tests/prose-needle-scan.test.ts:891      （顶包候选 11 ＞ 帽 10）
 ❯ tests/mutate-verify-gates.test.ts:1373   （mutate-verify 面在别人手里在飞）
 ❯ tests/cli-surface.test.ts:180            （provider／hint 面在飞）
 ❯ tests/prompt-surface-check.test.ts:185   （同；干净 HEAD 树里这一份实测 32/32 绿）
 ❯ tests/repo-hygiene-check.test.ts:176     （`src/main/agent-runner.ts` 3108 ＞ 帽 3100，在飞）
 ❯ tests/provider-config.test.ts:73         （provider 面在飞）
```

`prose-needle-scan` 那条要单独交代，因为它量的是「抄生产文案的断言」，而本簇**新写了 40 条判卷**：
现读 `node --import tsx scripts/prose-needle-scan.ts` 的顶包候选名单（11 条：已提交态 7 ＋ 在飞 4），
**0 条**的宿主是本簇的 `tests/eval-test-results.test.ts`；本簇新文件 `src/agent/eval/test-results.ts`
只出现在「未跟踪且盘上有：49 支……＝它们此刻没有尺（一入库就进名单）」那一行里。
⇒ 这六条不是本笔的账；按第 413 页口径不代修、不动别人的判卷。

## 4. 真料证人（判卷实际读的，全是 HEAD 已跟踪件）

```text
tests/eval-test-results.test.ts:133  ../outputs/eval-long30-2026-10-02/L30-long-horizon-rep1-base.events.jsonl   → not ok 23 - …
tests/eval-test-results.test.ts:134  ../outputs/eval-chain32-2026-10-02/L32-long-chain-rep1-base.events.jsonl    → # fail 0（绿段）
tests/eval-test-results.test.ts:493  ../outputs/eval-benchmark-adapter-2026-09-24/swebench-sample.jsonl          → judge 两列逐字等于源
tests/eval-test-results.test.ts:512  ../outputs/judge-timeout-2026-10-01/suite-quiet.json                        → vitest JSON 切片，与 suiteRows 的名字集合互检
```

子代理探针里跑过但**没进判卷**的那两份（`bench-head-d0ffe15e-a`、`bench-baseline-2026-10-04` 的 `readings.json`）
此刻未被 git 跟踪 ⇒ 进了判卷就会在干净检出上因缺文件而红；「红段带省略标记要读成 `incomplete`」这一格因此仍是未证。
