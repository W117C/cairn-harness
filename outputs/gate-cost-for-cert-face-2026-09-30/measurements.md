# 第 223 页 · #36 的决策输入：认证面要吞下哪些门，先看每一道值多少秒（2026-09-30）

## 现读的那格缺陷

`scripts/head-cert.ts` 今天只**跑** `typecheck` 与全量判卷，门表那一格它只**数**不**跑**
（`head-cert.ts:210-217`：`git show TARGET:scripts/gate-manifest.ts` 抽名单 → 印「门表：29 道，缺同名 script 0 道」）。
⇒ `cert exit=0` 与「某道门是红的」可以并存（本仓规则 292 记过一次；这两天每笔凭证页都在靠**人肉自报**别的门）。

## 复跑命令（认证树 `2becb8e`、工作树＝HEAD）

```
cd .worktrees/head-cert-2becb8e
time node --import tsx scripts/gates.ts --only=docs-check,gate-check,fork-check,autonomy-check,\
compaction-check,tools-check,map-check,prune-check,memory-check,plugins-check,no-progress-check,\
head-import-check,mutate-needles-check
```

原文 `thirteen-gates-at-2becb8e.log`：`绿 13 / 13，红 0`，`gates_exit=0`，墙钟 `46.7s`。
**这 13 道是我按"看着像秒级"挑的**，不是随机样本——剩下 16 道（含 `e2e`／`test`／`sandbox:check`／
`security-check`／`provider:check`／`routing-check`／`gym-check`／`replay-determinism-check` 等）本笔没量。

## 逐道秒（机器自报，不是推算）

| 门 | 秒 | | 门 | 秒 |
| --- | --- | --- | --- | --- |
| no-progress-check | 0.514 | | gate-check | 2.659 |
| prune-check | 0.524 | | map-check | 4.767 |
| fork-check | 0.545 | | tools-check | 8.628 |
| compaction-check | 0.574 | | mutate-needles-check | 9.756 |
| docs-check | 0.606 | | plugins-check | 15.209 |
| memory-check | 0.638 | | | |
| head-import-check | 0.667 | | | |
| autonomy-check | 0.737 | | | |

- **逐道之和 45.8s** 对 **墙钟 46.7s**（差 0.9s＝编排/换盘），`gates.ts` 是串行跑的 ⇒ 这两个数可以互相验算；
  报数时别拿"之和"当墙钟（规则 293 同一条纪律的反面）。
- **亚秒档有 8 道**（合计 **4.24s**）：no-progress／prune／fork／compaction／docs／memory／head-import／autonomy。
- 最贵两道（plugins 15.2s ＋ mutate-needles 9.76s）＝ 25.0s，占这 13 道之和的 **54.6%**，
  而 `mutate-needles-check` 恰好是**每笔交笔都要跑**的那道（针脚体检），`plugins-check` 与交笔无关。

## 这道题的分母在哪：一次认证现在花多少

**认证树自己那份逐条日志**（`/tmp/dsh-head-cert-2becb8e/test.log`，本目录留了 `cert-tree-suite-duration.txt`
与 `cert-summary-2becb8e.txt`——`/tmp` 是易失的，所以取料要抄进产物）：
`Duration 122.02s`。主检出那一趟全量是 `118.99s`（两个数不同树、不同批，**不许互相顶替**，也不许当成"认证比主树慢 3s 的机制"——没量）。
`gate-manifest.ts` 第 56 行那条旧实测把整趟 `head-cert-check` 记为 **123.7s**（其中判卷 86.66s，那是表长 3169 条时期的事）。

⇒ 以今天这一趟 **122.02s** 为分母：加**亚秒档 8 道**＝ **+4.24s ≈ +3.5%**；加这 13 道＝ **+45.8s ≈ +37.5%**。
「3.5%」与「37.5%」都只有一个 pair 的样本（同一台机、同一棵树、串行），符号稳、幅度未复测 ⇒ 别当预算数用。


## 未量/未决（留给裁决，不是结论）

1. **加哪些**：亚秒档 8 道是无争议的（合计 4s 换「认证面 ⊇ 门面」这一格不再靠人肉自报）；
   `mutate-needles-check` 要不要进（它自己就是交笔门，9.76s）；`tools/map/plugins/gate-check` 属"贵的等下一轮"。
2. **进面之后怎么报**：`cert exit=0` 的语义会变（从"判卷全绿"变成"判卷＋这 N 道门全绿"）⇒
   汇总行要并列印每道退出码与秒数，否则**读不出是哪一道把整笔判红**（规则 211：凭据等级要印出来）。
3. **未证 7 项**这一格跟着进门面后怎么办：`gates.ts` 自己印「13 道退出码全 0，但有 7 项未证——不得宣称全部通过」
   （逐道：gate-check 1／docs-check 3／autonomy-check 1／compaction-check 1／plugins-check 1）。
   认证面若把它们吞进来，`--strict-unverified` 的口径要一并决定，否则 cert 会把"未证"读成"通过"（规则 261）。
4. 本笔**不动代码**：#36 是能力面加格（认证覆盖面），不是缺陷修复；这份读数是它需要的输入。
   等真加判据时按规则 306 补锚点与分母证人（"哪道门的秒数掉出预算就红"要有一条尺，不是靠人记）。
