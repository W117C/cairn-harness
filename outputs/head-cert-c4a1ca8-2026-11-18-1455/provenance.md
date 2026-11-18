# 认证读数 · rev c4a1ca8
- 生成时刻=2026-11-18-1455（UTC。台账页按本地日期，跨零点时页号与这里差一天，不是写错了）
- 温度＝两端独占 ⇒ **时间量可以引用**（墙钟／门耗时／杀锚用时）
- 收尾复核=同一笔
- 判据：两端独占＝「起前 0 且跑完 0 且这一趟真跑了全量判卷」；本页引用时间量前先回看这一行

## 认证打出来的读数（原样，未改写）

```text
目标提交：c4a1ca8（--at=HEAD）
checkout exit=0
已核：TREE=c4a1ca806594b76b008128db7139e07afae7352c｜判卷四面在飞 0 项
依赖核对：该提交声明 12 项，缺 0 项
  零依赖子仓库 17 个（不需要 node_modules，不计入补齐面）
import 面：7982 条边｜悬空 0（其中存量已豁免 0）
门表：40 道，其中该笔 package.json 没有同名 script 的 0 道
typecheck exit=0（0 报错）

== 认证门面（26 道，名单取自 c4a1ca8）==
  ✅ no-progress-check exit=0 282ms（预算 1100ms）
  ✅ prune-check exit=0 320ms（预算 1100ms）
  ✅ fork-check exit=0 273ms（预算 1100ms）
  ✅ compaction-check exit=0 441ms（预算 1200ms）
  ✅ docs-check exit=0 1059ms（预算 1300ms）
  ✅ memory-check exit=0 624ms（预算 1300ms）
  ✅ head-import-check exit=0 2020ms（预算 2400ms）
  ✅ autonomy-check exit=0 681ms（预算 1500ms）
  ✅ sandbox:check exit=0 659ms（预算 1700ms）
  ✅ security-check exit=0 616ms（预算 1500ms）
  ✅ provider:check exit=0 281ms（预算 1300ms）
  ✅ routing-check exit=0 406ms（预算 1400ms）
  ✅ model-surface-check exit=0 458ms（预算 1300ms）
  ✅ prefix-churn-check exit=0 583ms（预算 1500ms）
  ✅ prompt-surface-check exit=0 387ms（预算 1400ms）
  ✅ replay-determinism-check exit=0 328ms（预算 1100ms）
  ✅ cost-per-progress-check exit=0 282ms（预算 1000ms）
  ✅ web-fetch-check exit=0 343ms（预算 1200ms）
  ✅ gym-check exit=0 1197ms（预算 2400ms）
  ✅ gate-check exit=0 1820ms（预算 5400ms）
  ✅ evidence-typecheck-check exit=0 4682ms（预算 5300ms）
  ✅ mutate-needles-check exit=0 13681ms（预算 20000ms）
  ✅ repo-hygiene-check exit=0 429ms（预算 1200ms）
  ✅ e2e exit=0 1893ms（预算 4000ms）
  ✅ desktop-test exit=0 18233ms（预算 10000ms）
  ✅ renderer-layer-check exit=0 351ms（预算 800ms）
  ⚠️ 超预算（只出声，不判红）：desktop-test 18233ms > 名单里的 10000ms
  认证门面=26 道（跑到 26）｜绿 26 道｜⚠️ 超预算 1

== 认证汇总 ==
  TREE=c4a1ca8 DIRTY_JUDGED=0 依赖完整=是 收尾复核=同一笔 认证树锁=本进程持有（.git/dsh-tool-locks/head-cert-gate-head-cert.lock）
  Test Files 714 passed (714)｜Tests 8391 passed (8391)｜并发=maxWorkers 2｜exit=0（退出码直接取，不接管道）
  并发判卷=起前 0 套／跑完 0 套（两端独占）
  本趟墙钟 269.99s（同一进程 hrtime 实测·口径＝起跑→汇总那一行，不含提前退出的那些趟）
  贴帽读数（缺省＝config 里的 testTimeout=30000ms）：8391 条里 0 条用时 ≥ 有效预算 80%｜无显式预算按缺省算 7554 条｜标题非字面量（it.each／插值／拼接，按缺省算）582 条｜预算没落到 24 条（这一格没量到，不等于 0）｜成因点名：tests/metacognition-policy.test.ts（标题不在那份判卷里）；tests/metacognition-policy.test.ts（标题不在那份判卷里）；tests/metacognition-policy.test.ts（标题不在那份判卷里）｜无｜离帽余量最近：tests/cli-surface.test.ts·cairn CLI：--serve 常驻调度（不需任务描述） --s 8019ms/20000ms=40%；tests/cli-surface.test.ts·cairn CLI：--serve 常驻调度（不需任务描述） --s 8006ms/20000ms=40%；tests/process-liveness.test.ts·进程探活只有一份、且分得清「死了」与「不知道」（第 966 页） E 2007ms/10000ms=20%
  逐条日志：/tmp/dsh-head-cert-c4a1ca8
  未回收认证树 .worktrees/gate-head-cert：不是本次新建的树（复用来的共享树）⇒ 不收
  常驻残留树=1（/Users/ze/Downloads/Cairn/cairn/.worktrees/gate-mutate-verify@ac08d8c）／另有 1 棵不住本仓 scratch 面的残留形树（/Users/ze/.config/alma/scratch/mutate-shards-wt-8gGptU/wt）＝不是本仓建的，别照上面那条回收命令删它们（规则 120：detached ∧ 0 项在飞 ∧ 那一笔已入库 才算残留；带分支的树与隔壁会话正在验的笔都不算）
  本次退出码=0（这是 head-cert 这道门自己的码，不是它跑进去的 test runner 的码）｜判决输入六维全过
  汇总已同步落盘（不靠 stdout 的尾）：/tmp/dsh-head-cert-c4a1ca8/summary.txt
```
