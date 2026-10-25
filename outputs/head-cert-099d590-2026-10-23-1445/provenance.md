# 认证读数 · rev 099d590
- 生成时刻=2026-10-23-1445（UTC。台账页按本地日期，跨零点时页号与这里差一天，不是写错了）
- 温度＝两端独占 ⇒ **时间量可以引用**（墙钟／门耗时／杀锚用时）
- 收尾复核=同一笔
- 判据：两端独占＝「起前 0 且跑完 0 且这一趟真跑了全量判卷」；本页引用时间量前先回看这一行

## 认证打出来的读数（原样，未改写）

```text
目标提交：099d590（--at=HEAD）
worktree add exit=0
已核：TREE=099d5905b902b9333afd0fcac0d904e251785db1｜判卷四面在飞 0 项
cp -al node_modules exit=0
依赖核对：该提交声明 10 项，缺 0 项
  硬链接子仓库依赖 apps/desktop/node_modules ← 主树 exit=0
  硬链接子仓库依赖 apps/desktop/preview/node_modules ← 主树 exit=0
  零依赖子仓库 17 个（不需要 node_modules，不计入补齐面）
import 面：5479 条边｜悬空 0（其中存量已豁免 0）
门表：40 道，其中该笔 package.json 没有同名 script 的 0 道
typecheck exit=0（0 报错）

== 认证门面（25 道，名单取自 099d590）==
  ✅ no-progress-check exit=0 278ms（预算 1100ms）
  ✅ prune-check exit=0 317ms（预算 1100ms）
  ✅ fork-check exit=0 279ms（预算 1100ms）
  ✅ compaction-check exit=0 430ms（预算 1200ms）
  ❌ docs-check exit=1 915ms（预算 1300ms）
  ✅ memory-check exit=0 480ms（预算 1300ms）
  ✅ head-import-check exit=0 1648ms（预算 2400ms）
  ✅ autonomy-check exit=0 594ms（预算 1500ms）
  ✅ sandbox:check exit=0 650ms（预算 1700ms）
  ✅ security-check exit=0 581ms（预算 1500ms）
  ✅ provider:check exit=0 276ms（预算 1300ms）
  ✅ routing-check exit=0 472ms（预算 1400ms）
  ✅ model-surface-check exit=0 514ms（预算 1300ms）
  ✅ prefix-churn-check exit=0 556ms（预算 1500ms）
  ✅ prompt-surface-check exit=0 371ms（预算 1400ms）
  ✅ replay-determinism-check exit=0 316ms（预算 1100ms）
  ✅ cost-per-progress-check exit=0 277ms（预算 1000ms）
  ✅ web-fetch-check exit=0 342ms（预算 1200ms）
  ✅ gym-check exit=0 1129ms（预算 2400ms）
  ✅ gate-check exit=0 1893ms（预算 5400ms）
  ✅ evidence-typecheck-check exit=0 4607ms（预算 5300ms）
  ✅ mutate-needles-check exit=0 11753ms（预算 20000ms）
  ✅ repo-hygiene-check exit=0 416ms（预算 1200ms）
  ✅ e2e exit=0 3261ms（预算 4000ms）
  ✅ desktop-test exit=0 9192ms（预算 10000ms）
  认证门面=25 道（跑到 25）｜❌ 红 1 道｜⚠️ 超预算 0
  ❌ docs-check exit=1（915ms）

== 认证汇总 ==
  TREE=099d590 DIRTY_JUDGED=0 依赖完整=是 收尾复核=同一笔 认证树锁=本进程持有（.git/dsh-tool-locks/head-cert-gate-head-cert.lock）
  Test Files 2 failed | 485 passed (487)｜Tests 2 failed | 6598 passed (6600)｜exit=1（退出码直接取，不接管道）
  并发判卷=起前 0 套／跑完 0 套（两端独占）
  本趟墙钟 126.10s（同一进程 hrtime 实测·口径＝起跑→汇总那一行，不含提前退出的那些趟）
  贴帽读数（缺省＝config 里的 testTimeout=30000ms）：6600 条里 0 条用时 ≥ 有效预算 80%｜无显式预算按缺省算 6026 条｜标题非字面量（it.each／插值／拼接，按缺省算）392 条｜预算没落到 0 条｜无｜离帽余量最近：tests/m3c.test.ts·M3c pipeline 哑 sequencer（零 LLM） 未获 15349ms/25000ms=61%；tests/mutate-shards.test.ts·treeProblem 与编排器的前置闸：脏树不许当片用 同一宿主被 5000ms/15000ms=33%；tests/mutate-verify-gates.test.ts·树闸接线：真跑本脚本——主检出拒跑且一个字节都没改过盘，linked 3124ms/15000ms=21%
  逐条日志：/tmp/dsh-head-cert-099d590
  已回收认证树 .worktrees/gate-head-cert（exit=0）
  常驻残留树=1（/Users/ze/Downloads/Cairn/deepseek harness/.worktrees/gate-mutate-verify@099d590）（规则 120：detached ∧ 0 项在飞 ∧ 那一笔已入库 才算残留；带分支的树与隔壁会话正在验的笔都不算）
  本次退出码=1（这是 head-cert 这道门自己的码，不是它跑进去的 test runner 的码）｜红的维：判卷 exit=1、认证门面红 1 道
  汇总已同步落盘（不靠 stdout 的尾）：/tmp/dsh-head-cert-099d590/summary.txt
```
