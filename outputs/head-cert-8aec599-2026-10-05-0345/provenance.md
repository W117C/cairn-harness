# 认证读数 · rev 8aec599
- 生成时刻=2026-10-05-0345（UTC。台账页按本地日期，跨零点时页号与这里差一天，不是写错了）
- 温度＝两端独占 ⇒ **时间量可以引用**（墙钟／门耗时／杀锚用时）
- 收尾复核=同一笔
- 判据：两端独占＝「起前 0 且跑完 0 且这一趟真跑了全量判卷」；本页引用时间量前先回看这一行

## 认证打出来的读数（原样，未改写）

```text
目标提交：8aec599（--at=HEAD）
worktree add exit=0
已核：TREE=8aec599b467b1335130cb48bd506800ffc6a19a2｜判卷四面在飞 0 项
cp -al node_modules exit=0
依赖核对：该提交声明 10 项，缺 0 项
  硬链接子仓库依赖 apps/desktop/node_modules ← 主树 exit=0
  零依赖子仓库 16 个（不需要 node_modules，不计入补齐面）
import 面：3754 条边｜悬空 0（其中存量已豁免 0）
门表：33 道，其中该笔 package.json 没有同名 script 的 0 道
typecheck exit=0（0 报错）

== 认证门面（23 道，名单取自 8aec599）==
  ✅ no-progress-check exit=0 369ms（预算 1100ms）
  ✅ prune-check exit=0 412ms（预算 1100ms）
  ✅ fork-check exit=0 468ms（预算 1100ms）
  ✅ compaction-check exit=0 538ms（预算 1200ms）
  ✅ docs-check exit=0 994ms（预算 1300ms）
  ✅ memory-check exit=0 608ms（预算 1300ms）
  ✅ head-import-check exit=0 1744ms（预算 2400ms）
  ✅ autonomy-check exit=0 925ms（预算 1500ms）
  ✅ sandbox:check exit=0 1815ms（预算 1700ms）
  ✅ security-check exit=0 743ms（预算 1500ms）
  ✅ provider:check exit=0 416ms（预算 1300ms）
  ✅ routing-check exit=0 558ms（预算 1400ms）
  ✅ model-surface-check exit=0 633ms（预算 1300ms）
  ✅ prefix-churn-check exit=0 753ms（预算 1500ms）
  ✅ prompt-surface-check exit=0 412ms（预算 1400ms）
  ✅ replay-determinism-check exit=0 404ms（预算 1100ms）
  ✅ cost-per-progress-check exit=0 366ms（预算 1000ms）
  ✅ web-fetch-check exit=0 393ms（预算 1200ms）
  ✅ gym-check exit=0 1409ms（预算 2400ms）
  ✅ gate-check exit=0 4005ms（预算 5400ms）
  ✅ evidence-typecheck-check exit=0 5126ms（预算 5300ms）
  ✅ mutate-needles-check exit=0 19844ms（预算 20000ms）
  ✅ repo-hygiene-check exit=0 407ms（预算 1200ms）
  ⚠️ 超预算（只出声，不判红）：sandbox:check 1815ms > 名单里的 1700ms
  认证门面=23 道（跑到 23）｜绿 23 道｜⚠️ 超预算 1

== 认证汇总 ==
  TREE=8aec599 DIRTY_JUDGED=0 依赖完整=是 收尾复核=同一笔 认证树锁=本进程持有（.git/dsh-tool-locks/head-cert-head-cert-8aec599.lock）
  Test Files 332 passed (332)｜Tests 4626 passed (4626)｜exit=0（退出码直接取，不接管道）
  并发判卷=起前 0 套／跑完 0 套（两端独占）
  本趟墙钟 276.94s（同一进程 hrtime 实测·口径＝起跑→汇总那一行，不含提前退出的那些趟）
  贴帽读数（缺省＝config 里的 testTimeout=30000ms）：4626 条里 0 条用时 ≥ 有效预算 80%｜无显式预算按缺省算 4299 条｜标题非字面量（it.each／插值／拼接，按缺省算）178 条｜预算没落到 0 条｜无｜离帽余量最近：tests/m3c.test.ts·M3c pipeline 哑 sequencer（零 LLM） 未获 15192ms/25000ms=61%；tests/evidence-typecheck.test.ts·门那一半：runner 的两个拒绝分支各自要出声 拼错的开关 ⇒ 退 3793ms/15000ms=25%；tests/evidence-typecheck.test.ts·门那一半：runner 的两个拒绝分支各自要出声 归属面取料那一行必 3496ms/15000ms=23%
  逐条日志：/tmp/dsh-head-cert-8aec599
  已回收认证树 .worktrees/head-cert-8aec599（exit=0）
  常驻残留树=0（规则 120：detached ∧ 0 项在飞 ∧ 那一笔已入库 才算残留；带分支的树与隔壁会话正在验的笔都不算）
  汇总已同步落盘（不靠 stdout 的尾）：/tmp/dsh-head-cert-8aec599/summary.txt
```
