# 认证读数 · rev f465f66
- 生成时刻=2026-11-08-1217（UTC。台账页按本地日期，跨零点时页号与这里差一天，不是写错了）
- 温度＝两端独占 ⇒ **时间量可以引用**（墙钟／门耗时／杀锚用时）
- 收尾复核=同一笔
- 判据：两端独占＝「起前 0 且跑完 0 且这一趟真跑了全量判卷」；本页引用时间量前先回看这一行

## 认证打出来的读数（原样，未改写）

```text
目标提交：f465f66（--at=HEAD）
worktree add exit=0
已核：TREE=f465f66f2ea99af19660eaa42ee27705e611a3fb｜判卷四面在飞 0 项
cp -al node_modules exit=0
依赖核对：该提交声明 12 项，缺 0 项
  硬链接子仓库依赖 apps/desktop/node_modules ← 主树 exit=0
  子仓库 apps/desktop/preview/node_modules 缺，而主树也没有 ⇒ 这棵树跑不了它里面的命令
  零依赖子仓库 18 个（不需要 node_modules，不计入补齐面）
⚠️ 这些靶子仓库的依赖补不齐：apps/desktop/preview ⇒ 在其中真跑命令的判卷红**不可归因于代码**
import 面：7636 条边｜悬空 0（其中存量已豁免 0）
门表：40 道，其中该笔 package.json 没有同名 script 的 0 道
typecheck exit=0（0 报错）

== 认证门面（25 道，名单取自 f465f66）==
  ❌ no-progress-check exit=1 491ms（预算 1100ms）
  ❌ prune-check exit=1 487ms（预算 1100ms）
  ❌ fork-check exit=1 487ms（预算 1100ms）
  ❌ compaction-check exit=1 491ms（预算 1200ms）
  ❌ docs-check exit=1 493ms（预算 1300ms）
  ❌ memory-check exit=1 492ms（预算 1300ms）
  ❌ head-import-check exit=1 491ms（预算 2400ms）
  ❌ autonomy-check exit=1 489ms（预算 1500ms）
  ❌ sandbox:check exit=1 488ms（预算 1700ms）
  ❌ security-check exit=1 493ms（预算 1500ms）
  ❌ provider:check exit=1 488ms（预算 1300ms）
  ❌ routing-check exit=1 489ms（预算 1400ms）
  ❌ model-surface-check exit=1 492ms（预算 1300ms）
  ❌ prefix-churn-check exit=1 491ms（预算 1500ms）
  ❌ prompt-surface-check exit=1 490ms（预算 1400ms）
  ❌ replay-determinism-check exit=1 496ms（预算 1100ms）
  ❌ cost-per-progress-check exit=1 491ms（预算 1000ms）
  ❌ web-fetch-check exit=1 492ms（预算 1200ms）
  ❌ gym-check exit=1 489ms（预算 2400ms）
  ❌ gate-check exit=1 486ms（预算 5400ms）
  ❌ evidence-typecheck-check exit=1 595ms（预算 5300ms）
  ❌ mutate-needles-check exit=1 489ms（预算 20000ms）
  ❌ repo-hygiene-check exit=1 492ms（预算 1200ms）
  ❌ e2e exit=1 505ms（预算 4000ms）
  ❌ desktop-test exit=1 497ms（预算 10000ms）
  认证门面=25 道（跑到 25）｜❌ 红 25 道｜⚠️ 超预算 0
  ❌ no-progress-check exit=1（491ms）
  ❌ prune-check exit=1（487ms）
  ❌ fork-check exit=1（487ms）
  ❌ compaction-check exit=1（491ms）
  ❌ docs-check exit=1（493ms）
  ❌ memory-check exit=1（492ms）
  ❌ head-import-check exit=1（491ms）
  ❌ autonomy-check exit=1（489ms）
  ❌ sandbox:check exit=1（488ms）
  ❌ security-check exit=1（493ms）
  ❌ provider:check exit=1（488ms）
  ❌ routing-check exit=1（489ms）
  ❌ model-surface-check exit=1（492ms）
  ❌ prefix-churn-check exit=1（491ms）
  ❌ prompt-surface-check exit=1（490ms）
  ❌ replay-determinism-check exit=1（496ms）
  ❌ cost-per-progress-check exit=1（491ms）
  ❌ web-fetch-check exit=1（492ms）
  ❌ gym-check exit=1（489ms）
  ❌ gate-check exit=1（486ms）
  ❌ evidence-typecheck-check exit=1（595ms）
  ❌ mutate-needles-check exit=1（489ms）
  ❌ repo-hygiene-check exit=1（492ms）
  ❌ e2e exit=1（505ms）
  ❌ desktop-test exit=1（497ms）

== 认证汇总 ==
  TREE=f465f66 DIRTY_JUDGED=0 依赖完整=是 收尾复核=同一笔 认证树锁=本进程持有（/Users/ze/Downloads/Cairn/cairn/.git/dsh-tool-locks/head-cert-gate-head-cert.lock）
  Test Files 2 failed | 660 passed (662)｜Tests 2 failed | 7975 passed (7977)｜并发=maxWorkers 2｜exit=1（退出码直接取，不接管道）
  并发判卷=起前 0 套／跑完 0 套（两端独占）
  本趟墙钟 214.30s（同一进程 hrtime 实测·口径＝起跑→汇总那一行，不含提前退出的那些趟）
  贴帽读数（缺省＝config 里的 testTimeout=30000ms）：7977 条里 0 条用时 ≥ 有效预算 80%｜无显式预算按缺省算 7170 条｜标题非字面量（it.each／插值／拼接，按缺省算）561 条｜预算没落到 24 条（这一格没量到，不等于 0）｜成因点名：tests/metacognition-policy.test.ts（标题不在那份判卷里）；tests/metacognition-policy.test.ts（标题不在那份判卷里）；tests/metacognition-policy.test.ts（标题不在那份判卷里）｜无｜离帽余量最近：tests/cli-surface.test.ts·cairn CLI：--serve 常驻调度（不需任务描述） --s 8017ms/20000ms=40%；tests/cli-surface.test.ts·cairn CLI：--serve 常驻调度（不需任务描述） --s 8007ms/20000ms=40%；tests/mutate-shards.test.ts·treeProblem 与编排器的前置闸：脏树不许当片用 同一宿主被 6049ms/30000ms=20%
  逐条日志：/tmp/dsh-head-cert-f465f66
  已回收认证树 .worktrees/gate-head-cert（exit=0）
  常驻残留树=1（/Users/ze/Downloads/Cairn/cairn/.worktrees/gate-mutate-verify@e300859）（规则 120：detached ∧ 0 项在飞 ∧ 那一笔已入库 才算残留；带分支的树与隔壁会话正在验的笔都不算）
  本次退出码=1（这是 head-cert 这道门自己的码，不是它跑进去的 test runner 的码）｜红的维：判卷 exit=1、认证门面红 25 道
  汇总已同步落盘（不靠 stdout 的尾）：/tmp/dsh-head-cert-f465f66/summary.txt
```
