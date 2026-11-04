# 认证读数 · rev aeb577c
- 生成时刻=2026-11-04-1523（UTC。台账页按本地日期，跨零点时页号与这里差一天，不是写错了）
- 温度＝两端独占 ⇒ **时间量可以引用**（墙钟／门耗时／杀锚用时）
- 收尾复核=同一笔
- 判据：两端独占＝「起前 0 且跑完 0 且这一趟真跑了全量判卷」；本页引用时间量前先回看这一行

## 认证打出来的读数（原样，未改写）

```text
目标提交：aeb577c（--at=HEAD）
worktree add exit=0
已核：TREE=aeb577c79db6348972782eaa3712ff0bbb618e4b｜判卷四面在飞 0 项
cp -al node_modules exit=0
依赖核对：该提交声明 11 项，缺 0 项
  硬链接子仓库依赖 apps/desktop/node_modules ← 主树 exit=0
  硬链接子仓库依赖 apps/desktop/preview/node_modules ← 主树 exit=0
  零依赖子仓库 18 个（不需要 node_modules，不计入补齐面）
import 面：7254 条边｜悬空 0（其中存量已豁免 0）
门表：40 道，其中该笔 package.json 没有同名 script 的 0 道
typecheck exit=0（0 报错）

== 认证门面（25 道，名单取自 aeb577c）==
  ✅ no-progress-check exit=0 361ms（预算 1100ms）
  ✅ prune-check exit=0 387ms（预算 1100ms）
  ✅ fork-check exit=0 360ms（预算 1100ms）
  ✅ compaction-check exit=0 534ms（预算 1200ms）
  ✅ docs-check exit=0 1320ms（预算 1300ms）
  ✅ memory-check exit=0 656ms（预算 1300ms）
  ✅ head-import-check exit=0 2655ms（预算 2400ms）
  ✅ autonomy-check exit=0 779ms（预算 1500ms）
  ✅ sandbox:check exit=0 1033ms（预算 1700ms）
  ✅ security-check exit=0 711ms（预算 1500ms）
  ✅ provider:check exit=0 354ms（预算 1300ms）
  ✅ routing-check exit=0 595ms（预算 1400ms）
  ✅ model-surface-check exit=0 670ms（预算 1300ms）
  ✅ prefix-churn-check exit=0 734ms（预算 1500ms）
  ✅ prompt-surface-check exit=0 472ms（预算 1400ms）
  ✅ replay-determinism-check exit=0 391ms（预算 1100ms）
  ✅ cost-per-progress-check exit=0 470ms（预算 1000ms）
  ✅ web-fetch-check exit=0 408ms（预算 1200ms）
  ✅ gym-check exit=0 1266ms（预算 2400ms）
  ✅ gate-check exit=0 2444ms（预算 5400ms）
  ✅ evidence-typecheck-check exit=0 6290ms（预算 5300ms）
  ✅ mutate-needles-check exit=0 17054ms（预算 20000ms）
  ✅ repo-hygiene-check exit=0 525ms（预算 1200ms）
  ✅ e2e exit=0 4118ms（预算 4000ms）
  ✅ desktop-test exit=0 21121ms（预算 10000ms）
  ⚠️ 超预算（只出声，不判红）：docs-check 1320ms > 名单里的 1300ms
  ⚠️ 超预算（只出声，不判红）：head-import-check 2655ms > 名单里的 2400ms
  ⚠️ 超预算（只出声，不判红）：evidence-typecheck-check 6290ms > 名单里的 5300ms
  ⚠️ 超预算（只出声，不判红）：e2e 4118ms > 名单里的 4000ms
  ⚠️ 超预算（只出声，不判红）：desktop-test 21121ms > 名单里的 10000ms
  认证门面=25 道（跑到 25）｜绿 25 道｜⚠️ 超预算 5

== 认证汇总 ==
  TREE=aeb577c DIRTY_JUDGED=0 依赖完整=是 收尾复核=同一笔 认证树锁=本进程持有（.git/dsh-tool-locks/head-cert-gate-head-cert.lock）
  Test Files 635 passed (635)｜Tests 7770 passed (7770)｜并发=maxWorkers 2｜exit=0（退出码直接取，不接管道）
  并发判卷=起前 0 套／跑完 0 套（两端独占）
  本趟墙钟 342.67s（同一进程 hrtime 实测·口径＝起跑→汇总那一行，不含提前退出的那些趟）
  贴帽读数（缺省＝config 里的 testTimeout=30000ms）：7770 条里 0 条用时 ≥ 有效预算 80%｜无显式预算按缺省算 6994 条｜标题非字面量（it.each／插值／拼接，按缺省算）535 条｜预算没落到 24 条（这一格没量到，不等于 0）｜成因点名：tests/metacognition-policy.test.ts（标题不在那份判卷里）；tests/metacognition-policy.test.ts（标题不在那份判卷里）；tests/metacognition-policy.test.ts（标题不在那份判卷里）｜无｜离帽余量最近：tests/m3c.test.ts·M3c pipeline 哑 sequencer（零 LLM） 未获 15241ms/25000ms=61%；tests/cli-surface.test.ts·cairn CLI：--serve 常驻调度（不需任务描述） --s 8026ms/20000ms=40%；tests/cli-surface.test.ts·cairn CLI：--serve 常驻调度（不需任务描述） --s 8011ms/20000ms=40%
  逐条日志：/tmp/dsh-head-cert-aeb577c
  已回收认证树 .worktrees/gate-head-cert（exit=0）
  常驻残留树=0（规则 120：detached ∧ 0 项在飞 ∧ 那一笔已入库 才算残留；带分支的树与隔壁会话正在验的笔都不算）
  本次退出码=0（这是 head-cert 这道门自己的码，不是它跑进去的 test runner 的码）｜判决输入六维全过
  汇总已同步落盘（不靠 stdout 的尾）：/tmp/dsh-head-cert-aeb577c/summary.txt
```
