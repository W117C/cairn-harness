# 认证读数 · rev a601a54
- 生成时刻=2026-11-14-1448（UTC。台账页按本地日期，跨零点时页号与这里差一天，不是写错了）
- 温度＝两端独占 ⇒ **时间量可以引用**（墙钟／门耗时／杀锚用时）
- 收尾复核=同一笔
- 判据：两端独占＝「起前 0 且跑完 0 且这一趟真跑了全量判卷」；本页引用时间量前先回看这一行

## 认证打出来的读数（原样，未改写）

```text
目标提交：a601a54（--at=HEAD）
worktree add exit=0
已核：TREE=a601a5407b3604c0ccb7b6ef007b31f270718100｜判卷四面在飞 0 项
cp -al node_modules exit=0
依赖核对：该提交声明 12 项，缺 0 项
  硬链接子仓库依赖 apps/desktop/node_modules ← 主树 exit=0
  硬链接子仓库依赖 apps/desktop/preview/node_modules ← 主树 exit=0
  零依赖子仓库 18 个（不需要 node_modules，不计入补齐面）
import 面：7730 条边｜悬空 0（其中存量已豁免 0）
门表：40 道，其中该笔 package.json 没有同名 script 的 0 道
typecheck exit=2：
  tests/plugin-install-operations.test.ts(448,90): error TS2554: Expected 1 arguments, but got 2.
  tests/plugin-install-operations.test.ts(479,90): error TS2554: Expected 1 arguments, but got 2.
  tests/plugin-install-operations.test.ts(513,90): error TS2554: Expected 1 arguments, but got 2.
  [typecheck] 报错文件归因：HEAD 内 1／在飞改动中的 tracked 0／未跟踪草稿 0／工作树状态取不到 0（四档相加＝1，与分母 1 不等就是归因坏了）

== 认证门面（25 道，名单取自 a601a54）==
  ✅ no-progress-check exit=0 313ms（预算 1100ms）
  ✅ prune-check exit=0 369ms（预算 1100ms）
  ✅ fork-check exit=0 382ms（预算 1100ms）
  ✅ compaction-check exit=0 551ms（预算 1200ms）
  ✅ docs-check exit=0 1305ms（预算 1300ms）
  ✅ memory-check exit=0 774ms（预算 1300ms）
  ✅ head-import-check exit=0 2670ms（预算 2400ms）
  ✅ autonomy-check exit=0 718ms（预算 1500ms）
  ✅ sandbox:check exit=0 1019ms（预算 1700ms）
  ✅ security-check exit=0 676ms（预算 1500ms）
  ✅ provider:check exit=0 328ms（预算 1300ms）
  ✅ routing-check exit=0 509ms（预算 1400ms）
  ✅ model-surface-check exit=0 486ms（预算 1300ms）
  ✅ prefix-churn-check exit=0 662ms（预算 1500ms）
  ✅ prompt-surface-check exit=0 428ms（预算 1400ms）
  ✅ replay-determinism-check exit=0 360ms（预算 1100ms）
  ✅ cost-per-progress-check exit=0 322ms（预算 1000ms）
  ✅ web-fetch-check exit=0 754ms（预算 1200ms）
  ✅ gym-check exit=0 1447ms（预算 2400ms）
  ✅ gate-check exit=0 2423ms（预算 5400ms）
  ✅ evidence-typecheck-check exit=0 9210ms（预算 5300ms）
  ✅ mutate-needles-check exit=0 16172ms（预算 20000ms）
  ✅ repo-hygiene-check exit=0 695ms（预算 1200ms）
  ✅ e2e exit=0 4357ms（预算 4000ms）
  ✅ desktop-test exit=0 19972ms（预算 10000ms）
  ⚠️ 超预算（只出声，不判红）：docs-check 1305ms > 名单里的 1300ms
  ⚠️ 超预算（只出声，不判红）：head-import-check 2670ms > 名单里的 2400ms
  ⚠️ 超预算（只出声，不判红）：evidence-typecheck-check 9210ms > 名单里的 5300ms
  ⚠️ 超预算（只出声，不判红）：e2e 4357ms > 名单里的 4000ms
  ⚠️ 超预算（只出声，不判红）：desktop-test 19972ms > 名单里的 10000ms
  认证门面=25 道（跑到 25）｜绿 25 道｜⚠️ 超预算 5

== 认证汇总 ==
  TREE=a601a54 DIRTY_JUDGED=0 依赖完整=是 收尾复核=同一笔 认证树锁=本进程持有（.git/dsh-tool-locks/head-cert-gate-head-cert.lock）
  Test Files 673 passed (673)｜Tests 8114 passed (8114)｜并发=maxWorkers 2｜exit=0（退出码直接取，不接管道）
  并发判卷=起前 0 套／跑完 0 套（两端独占）
  本趟墙钟 362.81s（同一进程 hrtime 实测·口径＝起跑→汇总那一行，不含提前退出的那些趟）
  贴帽读数（缺省＝config 里的 testTimeout=30000ms）：8114 条里 0 条用时 ≥ 有效预算 80%｜无显式预算按缺省算 7283 条｜标题非字面量（it.each／插值／拼接，按缺省算）582 条｜预算没落到 24 条（这一格没量到，不等于 0）｜成因点名：tests/metacognition-policy.test.ts（标题不在那份判卷里）；tests/metacognition-policy.test.ts（标题不在那份判卷里）；tests/metacognition-policy.test.ts（标题不在那份判卷里）｜无｜离帽余量最近：tests/cli-surface.test.ts·cairn CLI：--serve 常驻调度（不需任务描述） --s 8093ms/20000ms=40%；tests/cli-surface.test.ts·cairn CLI：--serve 常驻调度（不需任务描述） --s 8033ms/20000ms=40%；tests/main-run-routing.test.ts·glm main-session routing uses the  9740ms/30000ms=32%
  逐条日志：/tmp/dsh-head-cert-a601a54
  已回收认证树 .worktrees/gate-head-cert（exit=0）
  常驻残留树=1（/Users/ze/Downloads/Cairn/cairn/.worktrees/gate-mutate-verify@b9f2ce0）（规则 120：detached ∧ 0 项在飞 ∧ 那一笔已入库 才算残留；带分支的树与隔壁会话正在验的笔都不算）
  本次退出码=1（这是 head-cert 这道门自己的码，不是它跑进去的 test runner 的码）｜红的维：typecheck 非 0
  汇总已同步落盘（不靠 stdout 的尾）：/tmp/dsh-head-cert-a601a54/summary.txt
```
