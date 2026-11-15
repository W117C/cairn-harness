# 认证读数 · rev a5a6954
- 生成时刻=2026-11-15-0556（UTC。台账页按本地日期，跨零点时页号与这里差一天，不是写错了）
- 温度＝两端独占 ⇒ **时间量可以引用**（墙钟／门耗时／杀锚用时）
- 收尾复核=同一笔
- 判据：两端独占＝「起前 0 且跑完 0 且这一趟真跑了全量判卷」；本页引用时间量前先回看这一行

## 认证打出来的读数（原样，未改写）

```text
目标提交：a5a6954（--at=HEAD）
checkout exit=0
已核：TREE=a5a6954b5e01f2174983383961cf3a1fb70db08a｜判卷四面在飞 0 项
依赖核对：该提交声明 12 项，缺 0 项
  零依赖子仓库 17 个（不需要 node_modules，不计入补齐面）
import 面：7772 条边｜悬空 0（其中存量已豁免 0）
门表：40 道，其中该笔 package.json 没有同名 script 的 0 道
typecheck exit=0（0 报错）

== 认证门面（25 道，名单取自 a5a6954）==
  ✅ no-progress-check exit=0 261ms（预算 1100ms）
  ✅ prune-check exit=0 294ms（预算 1100ms）
  ✅ fork-check exit=0 258ms（预算 1100ms）
  ✅ compaction-check exit=0 402ms（预算 1200ms）
  ✅ docs-check exit=0 945ms（预算 1300ms）
  ✅ memory-check exit=0 508ms（预算 1300ms）
  ✅ head-import-check exit=0 1745ms（预算 2400ms）
  ✅ autonomy-check exit=0 565ms（预算 1500ms）
  ✅ sandbox:check exit=0 606ms（预算 1700ms）
  ✅ security-check exit=0 513ms（预算 1500ms）
  ✅ provider:check exit=0 258ms（预算 1300ms）
  ✅ routing-check exit=0 356ms（预算 1400ms）
  ✅ model-surface-check exit=0 402ms（预算 1300ms）
  ✅ prefix-churn-check exit=0 527ms（预算 1500ms）
  ✅ prompt-surface-check exit=0 360ms（预算 1400ms）
  ✅ replay-determinism-check exit=0 298ms（预算 1100ms）
  ✅ cost-per-progress-check exit=0 260ms（预算 1000ms）
  ✅ web-fetch-check exit=0 310ms（预算 1200ms）
  ✅ gym-check exit=0 1050ms（预算 2400ms）
  ✅ gate-check exit=0 1624ms（预算 5400ms）
  ✅ evidence-typecheck-check exit=0 4182ms（预算 5300ms）
  ✅ mutate-needles-check exit=0 11468ms（预算 20000ms）
  ✅ repo-hygiene-check exit=0 375ms（预算 1200ms）
  ✅ e2e exit=0 1678ms（预算 4000ms）
  ✅ desktop-test exit=0 11585ms（预算 10000ms）
  ⚠️ 超预算（只出声，不判红）：desktop-test 11585ms > 名单里的 10000ms
  认证门面=25 道（跑到 25）｜绿 25 道｜⚠️ 超预算 1

== 认证汇总 ==
  TREE=a5a6954 DIRTY_JUDGED=0 依赖完整=是 收尾复核=同一笔 认证树锁=本进程持有（.git/dsh-tool-locks/head-cert-gate-head-cert.lock）
  Test Files 678 passed (678)｜Tests 8152 passed (8152)｜并发=maxWorkers 2｜exit=0（退出码直接取，不接管道）
  并发判卷=起前 0 套／跑完 0 套（两端独占）
  本趟墙钟 219.76s（同一进程 hrtime 实测·口径＝起跑→汇总那一行，不含提前退出的那些趟）
  贴帽读数（缺省＝config 里的 testTimeout=30000ms）：8152 条里 0 条用时 ≥ 有效预算 80%｜无显式预算按缺省算 7320 条｜标题非字面量（it.each／插值／拼接，按缺省算）582 条｜预算没落到 24 条（这一格没量到，不等于 0）｜成因点名：tests/metacognition-policy.test.ts（标题不在那份判卷里）；tests/metacognition-policy.test.ts（标题不在那份判卷里）；tests/metacognition-policy.test.ts（标题不在那份判卷里）｜无｜离帽余量最近：tests/cli-surface.test.ts·cairn CLI：--serve 常驻调度（不需任务描述） --s 8020ms/20000ms=40%；tests/cli-surface.test.ts·cairn CLI：--serve 常驻调度（不需任务描述） --s 8005ms/20000ms=40%；tests/process-liveness.test.ts·进程探活只有一份、且分得清「死了」与「不知道」（第 966 页） E 2005ms/10000ms=20%
  逐条日志：/tmp/dsh-head-cert-a5a6954
  未回收认证树 .worktrees/gate-head-cert：不是本次新建的树（复用来的共享树）⇒ 不收
  常驻残留树=1（/Users/ze/Downloads/Cairn/cairn/.worktrees/gate-mutate-verify@907deda）（规则 120：detached ∧ 0 项在飞 ∧ 那一笔已入库 才算残留；带分支的树与隔壁会话正在验的笔都不算）
  本次退出码=0（这是 head-cert 这道门自己的码，不是它跑进去的 test runner 的码）｜判决输入六维全过
  汇总已同步落盘（不靠 stdout 的尾）：/tmp/dsh-head-cert-a5a6954/summary.txt
```
