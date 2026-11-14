# 认证读数 · rev 2dd11ac
- 生成时刻=2026-11-14-1616（UTC。台账页按本地日期，跨零点时页号与这里差一天，不是写错了）
- 温度＝两端独占 ⇒ **时间量可以引用**（墙钟／门耗时／杀锚用时）
- 收尾复核=同一笔
- 判据：两端独占＝「起前 0 且跑完 0 且这一趟真跑了全量判卷」；本页引用时间量前先回看这一行

## 认证打出来的读数（原样，未改写）

```text
目标提交：2dd11ac（--at=HEAD）
worktree add exit=0
已核：TREE=2dd11acd4ea16a4f64713d4d38a0d40d204c5abb｜判卷四面在飞 0 项
cp -al node_modules exit=0
依赖核对：该提交声明 12 项，缺 0 项
  硬链接子仓库依赖 apps/desktop/node_modules ← 主树 exit=0
  硬链接子仓库依赖 apps/desktop/preview/node_modules ← 主树 exit=0
  零依赖子仓库 18 个（不需要 node_modules，不计入补齐面）
import 面：7744 条边｜悬空 0（其中存量已豁免 0）
门表：40 道，其中该笔 package.json 没有同名 script 的 0 道
typecheck exit=0（0 报错）

== 认证门面（25 道，名单取自 2dd11ac）==
  ✅ no-progress-check exit=0 300ms（预算 1100ms）
  ✅ prune-check exit=0 334ms（预算 1100ms）
  ✅ fork-check exit=0 285ms（预算 1100ms）
  ✅ compaction-check exit=0 464ms（预算 1200ms）
  ✅ docs-check exit=0 1005ms（预算 1300ms）
  ✅ memory-check exit=0 633ms（预算 1300ms）
  ✅ head-import-check exit=0 1932ms（预算 2400ms）
  ✅ autonomy-check exit=0 675ms（预算 1500ms）
  ✅ sandbox:check exit=0 672ms（预算 1700ms）
  ✅ security-check exit=0 576ms（预算 1500ms）
  ✅ provider:check exit=0 290ms（预算 1300ms）
  ✅ routing-check exit=0 396ms（预算 1400ms）
  ✅ model-surface-check exit=0 448ms（预算 1300ms）
  ✅ prefix-churn-check exit=0 582ms（预算 1500ms）
  ✅ prompt-surface-check exit=0 392ms（预算 1400ms）
  ✅ replay-determinism-check exit=0 353ms（预算 1100ms）
  ✅ cost-per-progress-check exit=0 317ms（预算 1000ms）
  ✅ web-fetch-check exit=0 339ms（预算 1200ms）
  ✅ gym-check exit=0 1219ms（预算 2400ms）
  ✅ gate-check exit=0 1869ms（预算 5400ms）
  ✅ evidence-typecheck-check exit=0 5059ms（预算 5300ms）
  ✅ mutate-needles-check exit=0 14307ms（预算 20000ms）
  ✅ repo-hygiene-check exit=0 431ms（预算 1200ms）
  ✅ e2e exit=0 3269ms（预算 4000ms）
  ✅ desktop-test exit=0 16762ms（预算 10000ms）
  ⚠️ 超预算（只出声，不判红）：desktop-test 16762ms > 名单里的 10000ms
  认证门面=25 道（跑到 25）｜绿 25 道｜⚠️ 超预算 1

== 认证汇总 ==
  TREE=2dd11ac DIRTY_JUDGED=0 依赖完整=是 收尾复核=同一笔 认证树锁=本进程持有（.git/dsh-tool-locks/head-cert-gate-head-cert.lock）
  Test Files 676 passed (676)｜Tests 8126 passed (8126)｜并发=maxWorkers 2｜exit=0（退出码直接取，不接管道）
  并发判卷=起前 0 套／跑完 0 套（两端独占）
  本趟墙钟 273.45s（同一进程 hrtime 实测·口径＝起跑→汇总那一行，不含提前退出的那些趟）
  贴帽读数（缺省＝config 里的 testTimeout=30000ms）：8126 条里 0 条用时 ≥ 有效预算 80%｜无显式预算按缺省算 7295 条｜标题非字面量（it.each／插值／拼接，按缺省算）582 条｜预算没落到 24 条（这一格没量到，不等于 0）｜成因点名：tests/metacognition-policy.test.ts（标题不在那份判卷里）；tests/metacognition-policy.test.ts（标题不在那份判卷里）；tests/metacognition-policy.test.ts（标题不在那份判卷里）｜无｜离帽余量最近：tests/cli-surface.test.ts·cairn CLI：--serve 常驻调度（不需任务描述） --s 8018ms/20000ms=40%；tests/cli-surface.test.ts·cairn CLI：--serve 常驻调度（不需任务描述） --s 8006ms/20000ms=40%；tests/mutate-shards.test.ts·treeProblem 与编排器的前置闸：脏树不许当片用 同一宿主被 6143ms/30000ms=20%
  逐条日志：/tmp/dsh-head-cert-2dd11ac
  已回收认证树 .worktrees/gate-head-cert（exit=0）
  常驻残留树=1（/Users/ze/Downloads/Cairn/cairn/.worktrees/gate-mutate-verify@ba6807d）（规则 120：detached ∧ 0 项在飞 ∧ 那一笔已入库 才算残留；带分支的树与隔壁会话正在验的笔都不算）
  本次退出码=0（这是 head-cert 这道门自己的码，不是它跑进去的 test runner 的码）｜判决输入六维全过
  汇总已同步落盘（不靠 stdout 的尾）：/tmp/dsh-head-cert-2dd11ac/summary.txt
```
