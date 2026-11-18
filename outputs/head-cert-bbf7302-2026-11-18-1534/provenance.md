# 认证读数 · rev bbf7302
- 生成时刻=2026-11-18-1534（UTC。台账页按本地日期，跨零点时页号与这里差一天，不是写错了）
- 温度＝两端独占 ⇒ **时间量可以引用**（墙钟／门耗时／杀锚用时）
- 收尾复核=同一笔
- 判据：两端独占＝「起前 0 且跑完 0 且这一趟真跑了全量判卷」；本页引用时间量前先回看这一行

## 认证打出来的读数（原样，未改写）

```text
目标提交：bbf7302（--at=HEAD）
♻️ 回收一把不能用的锁：持有者 pid 95940 已不在 ⇒ 崩溃残留，按证据回收
checkout exit=0
已核：TREE=bbf730214500e0588432d185c74860ec37ac9ef6｜判卷四面在飞 0 项
依赖核对：该提交声明 12 项，缺 0 项
  零依赖子仓库 17 个（不需要 node_modules，不计入补齐面）
import 面：7982 条边｜悬空 0（其中存量已豁免 0）
门表：40 道，其中该笔 package.json 没有同名 script 的 0 道
typecheck exit=0（0 报错）

== 认证门面（26 道，名单取自 bbf7302）==
  ✅ no-progress-check exit=0 561ms（预算 1100ms）
  ✅ prune-check exit=0 688ms（预算 1100ms）
  ✅ fork-check exit=0 575ms（预算 1100ms）
  ✅ compaction-check exit=0 869ms（预算 1200ms）
  ✅ docs-check exit=0 2661ms（预算 1300ms）
  ✅ memory-check exit=0 1298ms（预算 1300ms）
  ✅ head-import-check exit=0 4460ms（预算 2400ms）
  ✅ autonomy-check exit=0 1323ms（预算 1500ms）
  ✅ sandbox:check exit=0 1212ms（预算 1700ms）
  ✅ security-check exit=0 1250ms（预算 1500ms）
  ✅ provider:check exit=0 531ms（预算 1300ms）
  ✅ routing-check exit=0 718ms（预算 1400ms）
  ✅ model-surface-check exit=0 873ms（预算 1300ms）
  ✅ prefix-churn-check exit=0 2382ms（预算 1500ms）
  ✅ prompt-surface-check exit=0 1190ms（预算 1400ms）
  ✅ replay-determinism-check exit=0 560ms（预算 1100ms）
  ✅ cost-per-progress-check exit=0 614ms（预算 1000ms）
  ✅ web-fetch-check exit=0 569ms（预算 1200ms）
  ✅ gym-check exit=0 2735ms（预算 2400ms）
  ✅ gate-check exit=0 3939ms（预算 5400ms）
  ✅ evidence-typecheck-check exit=0 27766ms（预算 5300ms）
  ✅ mutate-needles-check exit=0 40003ms（预算 20000ms）
  ✅ repo-hygiene-check exit=0 827ms（预算 1200ms）
  ✅ e2e exit=0 4844ms（预算 4000ms）
  ✅ desktop-test exit=0 50139ms（预算 10000ms）
  ✅ renderer-layer-check exit=0 829ms（预算 800ms）
  ⚠️ 超预算（只出声，不判红）：docs-check 2661ms > 名单里的 1300ms
  ⚠️ 超预算（只出声，不判红）：head-import-check 4460ms > 名单里的 2400ms
  ⚠️ 超预算（只出声，不判红）：prefix-churn-check 2382ms > 名单里的 1500ms
  ⚠️ 超预算（只出声，不判红）：gym-check 2735ms > 名单里的 2400ms
  ⚠️ 超预算（只出声，不判红）：evidence-typecheck-check 27766ms > 名单里的 5300ms
  ⚠️ 超预算（只出声，不判红）：mutate-needles-check 40003ms > 名单里的 20000ms
  ⚠️ 超预算（只出声，不判红）：e2e 4844ms > 名单里的 4000ms
  ⚠️ 超预算（只出声，不判红）：desktop-test 50139ms > 名单里的 10000ms
  ⚠️ 超预算（只出声，不判红）：renderer-layer-check 829ms > 名单里的 800ms
  认证门面=26 道（跑到 26）｜绿 26 道｜⚠️ 超预算 9

== 认证汇总 ==
  TREE=bbf7302 DIRTY_JUDGED=0 依赖完整=是 收尾复核=同一笔 认证树锁=本进程持有（.git/dsh-tool-locks/head-cert-gate-head-cert.lock）
  Test Files 714 passed (714)｜Tests 8392 passed (8392)｜并发=maxWorkers 2｜exit=0（退出码直接取，不接管道）
  并发判卷=起前 0 套／跑完 0 套（两端独占）
  本趟墙钟 470.36s（同一进程 hrtime 实测·口径＝起跑→汇总那一行，不含提前退出的那些趟）
  贴帽读数（缺省＝config 里的 testTimeout=30000ms）：8392 条里 0 条用时 ≥ 有效预算 80%｜无显式预算按缺省算 7555 条｜标题非字面量（it.each／插值／拼接，按缺省算）582 条｜预算没落到 24 条（这一格没量到，不等于 0）｜成因点名：tests/metacognition-policy.test.ts（标题不在那份判卷里）；tests/metacognition-policy.test.ts（标题不在那份判卷里）；tests/metacognition-policy.test.ts（标题不在那份判卷里）｜无｜离帽余量最近：tests/cli-surface.test.ts·cairn CLI：--serve 常驻调度（不需任务描述） --s 8024ms/20000ms=40%；tests/cli-surface.test.ts·cairn CLI：--serve 常驻调度（不需任务描述） --s 8007ms/20000ms=40%；tests/evidence-typecheck.test.ts·真环境：这一格得在真仓里跑得出东西（规则 237/320） 仓内 t 19389ms/60000ms=32%
  逐条日志：/tmp/dsh-head-cert-bbf7302
  未回收认证树 .worktrees/gate-head-cert：不是本次新建的树（复用来的共享树）⇒ 不收
  常驻残留树=1（/Users/ze/Downloads/Cairn/cairn/.worktrees/gate-mutate-verify@ac08d8c）／另有 1 棵不住本仓 scratch 面的残留形树（/Users/ze/.config/alma/scratch/mutate-shards-wt-8gGptU/wt）＝不是本仓建的，别照上面那条回收命令删它们（规则 120：detached ∧ 0 项在飞 ∧ 那一笔已入库 才算残留；带分支的树与隔壁会话正在验的笔都不算）
  本次退出码=0（这是 head-cert 这道门自己的码，不是它跑进去的 test runner 的码）｜判决输入六维全过
  汇总已同步落盘（不靠 stdout 的尾）：/tmp/dsh-head-cert-bbf7302/summary.txt
```
