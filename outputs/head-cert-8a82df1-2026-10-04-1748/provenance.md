# 认证读数 · rev 8a82df1
- 生成时刻=2026-10-04-1748（UTC。台账页按本地日期，跨零点时页号与这里差一天，不是写错了）
- 温度＝两端独占 ⇒ **时间量可以引用**（墙钟／门耗时／杀锚用时）
- 收尾复核=同一笔
- 判据：两端独占＝「起前 0 且跑完 0 且这一趟真跑了全量判卷」；本页引用时间量前先回看这一行

## 认证打出来的读数（原样，未改写）

```text
目标提交：8a82df1（--at=HEAD）
worktree add exit=0
已核：TREE=8a82df15d741149ef7116468f1d78477b4120136｜判卷四面在飞 0 项
cp -al node_modules exit=0
依赖核对：该提交声明 10 项，缺 0 项
  硬链接子仓库依赖 apps/desktop/node_modules ← 主树 exit=0
  零依赖子仓库 16 个（不需要 node_modules，不计入补齐面）
import 面：3637 条边｜悬空 0（其中存量已豁免 0）
门表：33 道，其中该笔 package.json 没有同名 script 的 0 道
typecheck exit=0（0 报错）

== 认证门面（23 道，名单取自 8a82df1）==
  ✅ no-progress-check exit=0 298ms（预算 1100ms）
  ✅ prune-check exit=0 339ms（预算 1100ms）
  ✅ fork-check exit=0 335ms（预算 1100ms）
  ✅ compaction-check exit=0 422ms（预算 1200ms）
  ✅ docs-check exit=0 851ms（预算 1300ms）
  ✅ memory-check exit=0 479ms（预算 1300ms）
  ✅ head-import-check exit=0 1580ms（预算 2400ms）
  ✅ autonomy-check exit=0 699ms（预算 1500ms）
  ✅ sandbox:check exit=0 1459ms（预算 1700ms）
  ✅ security-check exit=0 561ms（预算 1500ms）
  ✅ provider:check exit=0 340ms（预算 1300ms）
  ✅ routing-check exit=0 475ms（预算 1400ms）
  ✅ model-surface-check exit=0 498ms（预算 1300ms）
  ✅ prefix-churn-check exit=0 607ms（预算 1500ms）
  ✅ prompt-surface-check exit=0 330ms（预算 1400ms）
  ✅ replay-determinism-check exit=0 334ms（预算 1100ms）
  ✅ cost-per-progress-check exit=0 294ms（预算 1000ms）
  ✅ web-fetch-check exit=0 318ms（预算 1200ms）
  ✅ gym-check exit=0 1111ms（预算 2400ms）
  ✅ gate-check exit=0 2798ms（预算 5400ms）
  ✅ evidence-typecheck-check exit=0 2722ms（预算 5300ms）
  ✅ mutate-needles-check exit=0 13713ms（预算 20000ms）
  ✅ repo-hygiene-check exit=0 313ms（预算 1200ms）
  认证门面=23 道（跑到 23）｜绿 23 道｜⚠️ 超预算 0

== 认证汇总 ==
  TREE=8a82df1 DIRTY_JUDGED=0 依赖完整=是 收尾复核=同一笔 认证树锁=本进程持有（.git/dsh-tool-locks/head-cert-head-cert-8a82df1.lock）
  Test Files 1 failed | 314 passed (315)｜Tests 2 failed | 4495 passed (4497)｜exit=1（退出码直接取，不接管道）
  并发判卷=起前 0 套／跑完 0 套（两端独占）
  本趟墙钟 217.91s（同一进程 hrtime 实测·口径＝起跑→汇总那一行，不含提前退出的那些趟）
  贴帽读数（缺省＝config 里的 testTimeout=30000ms）：4497 条里 0 条用时 ≥ 有效预算 80%｜无显式预算按缺省算 4179 条｜标题非字面量（it.each／插值／拼接，按缺省算）169 条｜预算没落到 0 条｜无｜离帽余量最近：tests/m3c.test.ts·M3c pipeline 哑 sequencer（零 LLM） 未获 15166ms/25000ms=61%；tests/evidence-typecheck.test.ts·门那一半：runner 的两个拒绝分支各自要出声 拼错的开关 ⇒ 退 2931ms/15000ms=20%；tests/mutate-shards.test.ts·treeProblem 与编排器的前置闸：脏树不许当片用 同一宿主被 2583ms/15000ms=17%
  逐条日志：/tmp/dsh-head-cert-8a82df1
  已回收认证树 .worktrees/head-cert-8a82df1（exit=0）
  常驻残留树=0（规则 120：detached ∧ 0 项在飞 ∧ 那一笔已入库 才算残留；带分支的树与隔壁会话正在验的笔都不算）
  汇总已同步落盘（不靠 stdout 的尾）：/tmp/dsh-head-cert-8a82df1/summary.txt
```
