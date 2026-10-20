# 认证读数 · rev 87a563c
- 生成时刻=2026-10-18-0647（UTC。台账页按本地日期，跨零点时页号与这里差一天，不是写错了）
- 温度＝两端独占 ⇒ **时间量可以引用**（墙钟／门耗时／杀锚用时）
- 收尾复核=同一笔
- 判据：两端独占＝「起前 0 且跑完 0 且这一趟真跑了全量判卷」；本页引用时间量前先回看这一行

## 认证打出来的读数（原样，未改写）

```text
目标提交：87a563c（--at=HEAD）
worktree add exit=0
已核：TREE=87a563c0e0032ac36ec9ef5dfa056dda39cbd767｜判卷四面在飞 0 项
cp -al node_modules exit=0
依赖核对：该提交声明 10 项，缺 0 项
  硬链接子仓库依赖 apps/desktop/node_modules ← 主树 exit=0
  零依赖子仓库 17 个（不需要 node_modules，不计入补齐面）
import 面：4396 条边｜悬空 0（其中存量已豁免 0）
门表：34 道，其中该笔 package.json 没有同名 script 的 0 道
typecheck exit=2：
  src/main/agent-runner.ts(1188,7): error TS2353: Object literal may only specify known properties, and 'pendingImages' does not exist in type 'LoopOptions'.
  [typecheck] 报错文件归因：HEAD 内 1／在飞改动中的 tracked 0／未跟踪草稿 0／工作树状态取不到 0（四档相加＝1，与分母 1 不等就是归因坏了）

== 认证门面（25 道，名单取自 87a563c）==
  ✅ no-progress-check exit=0 280ms（预算 1100ms）
  ✅ prune-check exit=0 310ms（预算 1100ms）
  ✅ fork-check exit=0 274ms（预算 1100ms）
  ✅ compaction-check exit=0 388ms（预算 1200ms）
  ❌ docs-check exit=1 904ms（预算 1300ms）
  ✅ memory-check exit=0 459ms（预算 1300ms）
  ✅ head-import-check exit=0 1537ms（预算 2400ms）
  ✅ autonomy-check exit=0 609ms（预算 1500ms）
  ✅ sandbox:check exit=0 643ms（预算 1700ms）
  ✅ security-check exit=0 560ms（预算 1500ms）
  ✅ provider:check exit=0 272ms（预算 1300ms）
  ✅ routing-check exit=0 462ms（预算 1400ms）
  ✅ model-surface-check exit=0 504ms（预算 1300ms）
  ✅ prefix-churn-check exit=0 535ms（预算 1500ms）
  ✅ prompt-surface-check exit=0 347ms（预算 1400ms）
  ✅ replay-determinism-check exit=0 307ms（预算 1100ms）
  ✅ cost-per-progress-check exit=0 277ms（预算 1000ms）
  ✅ web-fetch-check exit=0 331ms（预算 1200ms）
  ✅ gym-check exit=0 1122ms（预算 2400ms）
  ✅ gate-check exit=0 1951ms（预算 5400ms）
  ❌ evidence-typecheck-check exit=1 3202ms（预算 5300ms）
  ✅ mutate-needles-check exit=0 11583ms（预算 20000ms）
  ✅ repo-hygiene-check exit=0 402ms（预算 1200ms）
  ✅ e2e exit=0 3564ms（预算 4000ms）
  ❌ desktop-test exit=1 6926ms（预算 10000ms）
  认证门面=25 道（跑到 25）｜❌ 红 3 道｜⚠️ 超预算 0
  ❌ docs-check exit=1（904ms）
  ❌ evidence-typecheck-check exit=1（3202ms）
  ❌ desktop-test exit=1（6926ms）

== 认证汇总 ==
  TREE=87a563c DIRTY_JUDGED=0 依赖完整=是 收尾复核=同一笔 认证树锁=本进程持有（.git/dsh-tool-locks/head-cert-gate-head-cert.lock）
  Test Files 3 failed | 375 passed (378)｜Tests 4 failed | 5405 passed (5409)｜exit=1（退出码直接取，不接管道）
  并发判卷=起前 0 套／跑完 0 套（两端独占）
  本趟墙钟 277.24s（同一进程 hrtime 实测·口径＝起跑→汇总那一行，不含提前退出的那些趟）
  贴帽读数（缺省＝config 里的 testTimeout=30000ms）：5409 条里 0 条用时 ≥ 有效预算 80%｜无显式预算按缺省算 5044 条｜标题非字面量（it.each／插值／拼接，按缺省算）197 条｜预算没落到 0 条｜无｜离帽余量最近：tests/m3c.test.ts·M3c pipeline 哑 sequencer（零 LLM） 未获 15178ms/25000ms=61%；tests/evidence-typecheck.test.ts·门那一半：runner 的两个拒绝分支各自要出声 拼错的开关 ⇒ 退 3291ms/15000ms=22%；tests/mutate-shards.test.ts·treeProblem 与编排器的前置闸：脏树不许当片用 同一宿主被 2883ms/15000ms=19%
  逐条日志：/tmp/dsh-head-cert-87a563c
  已回收认证树 .worktrees/gate-head-cert（exit=0）
  常驻残留树=1（/Users/ze/Downloads/Cairn/deepseek harness/.worktrees/gate-mutate-verify@479b167）（规则 120：detached ∧ 0 项在飞 ∧ 那一笔已入库 才算残留；带分支的树与隔壁会话正在验的笔都不算）
  本次退出码=1（这是 head-cert 这道门自己的码，不是它跑进去的 test runner 的码）｜红的维：typecheck 非 0、判卷 exit=1、认证门面红 3 道
  汇总已同步落盘（不靠 stdout 的尾）：/tmp/dsh-head-cert-87a563c/summary.txt
```
