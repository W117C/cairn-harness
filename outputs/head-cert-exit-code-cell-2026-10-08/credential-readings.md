# 第 426—429 页那一簇的复认与认证读数（凭证页 430 用，2026-10-08）

## 1. 这一簇落库的五笔

| 笔 | 内容 |
| --- | --- |
| `08c081e5` | 第 426 页：判决与读数同源（`certExitCode`／`certExitCodeCell`）＋ 判卷 17 条 ＋ 锚点 4 根 ＋ 页 ＋ 工件 |
| `0f48acb2` | 第 427 页：那一搬让三处旧证人取料落空，按「两跳」重写；两根老锚点针脚搬家 |
| `9e3bf57b` | 第 428 页：搬过去的针脚差四个空格 ⇒ 门分成 `no-effect` 而不是 `survived` |
| `cd0cbc94` | 第 429 页：`expectFail` 指在拼接标题上＝自愿进「松钉指针」名单（帽 10 被顶到 11），补一条字面标题证人把针脚降回来 |

## 2. 三趟复认（都在自建干净树，`cp -al` 打依赖、每次核过 0 项在飞）

```text
① 第 426 页簇：改动面派生 rev=d15c4ebd → 变更文件 6 个 ⇒ 选中锚点 65/1496 条
   62 杀／2 判红，类别 baseline-red 2 ⇒ 「基线就不绿 ⇒ 本条判定被污染，不算存活的证据」
   REDKINDS=survived:0,misattributed:0,baseline-red:2,no-effect:0,syntax:0,restore-mismatch:0,vacuous:0
   —— 那两条把「我搬走了别人判卷钉的文字」喊了出来（见第 427 页）

② 第 427 页之后：改动面派生 rev=08c081e5 → 变更文件 5 个 ⇒ 选中锚点 118/1496 条
   117 杀／1 判红，类别 no-effect 1：head-cert-drift-not-in-exit-code
   —— 针脚四空格 vs 盘上两空格 ⇒ 跑起来什么都没改（见第 428 页）

③ 第 429 页之后：显式六根（cert-exit-code-* ×4 ＋ head-cert-drift-not-in-exit-code ＋ concurrency-wired-into-exit-code）
   6/6 ✅、末行「全部变异被正确杀死（断言非恒真）」、EXIT=0
```

三趟的分类行各不同（`baseline-red`／`no-effect`／全杀），这正是门把「哪一种坏」分开报的价值：三者的修法互相冲突（动别人判卷／改自己针脚／什么都不用做）。

## 3. 认证读数（`cd0cbc94`，原文）

```text
依赖核对：该提交声明 10 项，缺 0 项
import 面：3892 条边｜悬空 0（其中存量已豁免 0）
  Test Files 1 failed | 346 passed (347)｜Tests 1 failed | 4887 passed (4888)｜exit=1（退出码直接取，不接管道）
  并发判卷=起前 0 套／跑完 0 套（两端独占）
  本趟墙钟 229.51s
  已回收认证树 .worktrees/head-cert-cd0cbc9（exit=0）
  本次退出码=1（这是 head-cert 这道门自己的码，不是它跑进去的 test runner 的码）｜红的维：判卷 exit=1
```

**最后那一行就是第 426 页那一格的行为证人**：这一趟是 `nohup` 起的（`$?` 依然没捕获），但码自己印进了 stdout，并且随 `spoken` 进了 `summary.txt` 与 `outputs/head-cert-cd0cbc9-2026-10-07-2115/provenance.md`——第 421／423／425 页连着三页欠的那一格到此合上。

## 4. 条数核对式与红的归因

- `4888 = 4870（第 425 页认证）＋ 17（第 426 页新判卷文件）＋ 1（第 429 页补的字面标题证人 ⑭）`；`Test Files 347 = 346 ＋ 1`。
- 唯一那条红 = `tests/scratch-tree-naming.test.ts`（常驻红：`gate-mutate-verify` 树名没编码提交，豁免在别人工作树里，第 413 页登记）。第 429 页修掉的松钉红已不在认证里。
- 主树另有一条 `tests/mutate-verify-gates.test.ts > 水位：真表现读「选不中＋不唯一」只准调低（帽 3）` 红，**只在工作树面**：隔壁在飞的 `tests/docs-check.test.ts` 新增标题含「点名该删」，那正是某根锚点的短 `expectFail` ⇒ 同一文件从 1 命中变 2 命中（现读：工作树 2、HEAD 1、本簇文件 0）。同一把尺在干净认证树里不红——两个面各自是真值，出口必带面；本笔不动别人的判卷也不替他降帽。

## 5. 清场

自建树逐棵核过后回收：`verify-08c081e`（本轮复用它跑了三趟复认，最后 `git checkout --detach cd0cbc94` 时仍是 0 项在飞）与两棵 `head-cert-*`（由门自回收）。`.worktrees/` 只剩常驻门的 `gate-mutate-verify`。
