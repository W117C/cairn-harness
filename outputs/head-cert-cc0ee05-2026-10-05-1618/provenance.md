# 认证读数 · rev cc0ee05
- 生成时刻=2026-10-05-1618（UTC。台账页按本地日期，跨零点时页号与这里差一天，不是写错了）
- 温度＝两端独占 ⇒ **时间量可以引用**（墙钟／门耗时／杀锚用时）
- 收尾复核=同一笔
- 判据：两端独占＝「起前 0 且跑完 0 且这一趟真跑了全量判卷」；本页引用时间量前先回看这一行

## 认证打出来的读数（原样，未改写）

```text
目标提交：cc0ee05（--at=HEAD）
worktree add exit=0
已核：TREE=cc0ee05c49259a7744f004def9c1f405efa32daf｜判卷四面在飞 0 项
cp -al node_modules exit=0
依赖核对：该提交声明 10 项，缺 0 项
  硬链接子仓库依赖 apps/desktop/node_modules ← 主树 exit=0
  零依赖子仓库 16 个（不需要 node_modules，不计入补齐面）
import 面：3825 条边｜悬空 0（其中存量已豁免 0）
门表：33 道，其中该笔 package.json 没有同名 script 的 0 道
typecheck exit=0（0 报错）

== 认证门面（23 道，名单取自 cc0ee05）==
  ✅ no-progress-check exit=0 494ms（预算 1100ms）
  ✅ prune-check exit=0 547ms（预算 1100ms）
  ✅ fork-check exit=0 483ms（预算 1100ms）
  ✅ compaction-check exit=0 670ms（预算 1200ms）
  ✅ docs-check exit=0 1420ms（预算 1300ms）
  ✅ memory-check exit=0 889ms（预算 1300ms）
  ✅ head-import-check exit=0 2638ms（预算 2400ms）
  ✅ autonomy-check exit=0 1254ms（预算 1500ms）
  ✅ sandbox:check exit=0 2428ms（预算 1700ms）
  ✅ security-check exit=0 1010ms（预算 1500ms）
  ✅ provider:check exit=0 504ms（预算 1300ms）
  ✅ routing-check exit=0 740ms（预算 1400ms）
  ✅ model-surface-check exit=0 892ms（预算 1300ms）
  ✅ prefix-churn-check exit=0 985ms（预算 1500ms）
  ✅ prompt-surface-check exit=0 539ms（预算 1400ms）
  ✅ replay-determinism-check exit=0 576ms（预算 1100ms）
  ✅ cost-per-progress-check exit=0 492ms（预算 1000ms）
  ✅ web-fetch-check exit=0 500ms（预算 1200ms）
  ✅ gym-check exit=0 1809ms（预算 2400ms）
  ✅ gate-check exit=0 4522ms（预算 5400ms）
  ✅ evidence-typecheck-check exit=0 7291ms（预算 5300ms）
  ✅ mutate-needles-check exit=0 26400ms（预算 20000ms）
  ✅ repo-hygiene-check exit=0 504ms（预算 1200ms）
  ⚠️ 超预算（只出声，不判红）：docs-check 1420ms > 名单里的 1300ms
  ⚠️ 超预算（只出声，不判红）：head-import-check 2638ms > 名单里的 2400ms
  ⚠️ 超预算（只出声，不判红）：sandbox:check 2428ms > 名单里的 1700ms
  ⚠️ 超预算（只出声，不判红）：evidence-typecheck-check 7291ms > 名单里的 5300ms
  ⚠️ 超预算（只出声，不判红）：mutate-needles-check 26400ms > 名单里的 20000ms
  认证门面=23 道（跑到 23）｜绿 23 道｜⚠️ 超预算 5

== 认证汇总 ==
  TREE=cc0ee05 DIRTY_JUDGED=0 依赖完整=是 收尾复核=同一笔 认证树锁=本进程持有（.git/dsh-tool-locks/head-cert-head-cert-cc0ee05.lock）
  Test Files 2 failed | 337 passed (339)｜Tests 2 failed | 4740 passed (4742)｜exit=1（退出码直接取，不接管道）
  并发判卷=起前 0 套／跑完 0 套（两端独占）
  本趟墙钟 395.45s（同一进程 hrtime 实测·口径＝起跑→汇总那一行，不含提前退出的那些趟）
  贴帽读数（缺省＝config 里的 testTimeout=30000ms）：4742 条里 0 条用时 ≥ 有效预算 80%｜无显式预算按缺省算 4407 条｜标题非字面量（it.each／插值／拼接，按缺省算）181 条｜预算没落到 0 条｜无｜离帽余量最近：tests/m3c.test.ts·M3c pipeline 哑 sequencer（零 LLM） 未获 15214ms/25000ms=61%；tests/evidence-typecheck.test.ts·门那一半：runner 的两个拒绝分支各自要出声 拼错的开关 ⇒ 退 6557ms/15000ms=44%；tests/evidence-typecheck.test.ts·门那一半：runner 的两个拒绝分支各自要出声 归属面取料那一行必 6056ms/15000ms=40%
  逐条日志：/tmp/dsh-head-cert-cc0ee05
  已回收认证树 .worktrees/head-cert-cc0ee05（exit=0）
  常驻残留树=2（/Users/ze/Downloads/Cairn/deepseek harness/.worktrees/verify-852452e@852452e、/Users/ze/Downloads/Cairn/deepseek harness/.worktrees/verify-cc0ee05@cc0ee05）（规则 120：detached ∧ 0 项在飞 ∧ 那一笔已入库 才算残留；带分支的树与隔壁会话正在验的笔都不算）
  汇总已同步落盘（不靠 stdout 的尾）：/tmp/dsh-head-cert-cc0ee05/summary.txt
```
