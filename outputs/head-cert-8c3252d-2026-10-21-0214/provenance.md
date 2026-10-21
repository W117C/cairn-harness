# 认证读数 · rev 8c3252d
- 生成时刻=2026-10-21-0214（UTC。台账页按本地日期，跨零点时页号与这里差一天，不是写错了）
- 温度＝两端独占 ⇒ **时间量可以引用**（墙钟／门耗时／杀锚用时）
- 收尾复核=同一笔
- 判据：两端独占＝「起前 0 且跑完 0 且这一趟真跑了全量判卷」；本页引用时间量前先回看这一行

## 认证打出来的读数（原样，未改写）

```text
目标提交：8c3252d（--at=HEAD）
worktree add exit=0
已核：TREE=8c3252d6640c795c8b6357632ec0e075d7d7c14a｜判卷四面在飞 0 项
cp -al node_modules exit=0
依赖核对：该提交声明 10 项，缺 0 项
  硬链接子仓库依赖 apps/desktop/node_modules ← 主树 exit=0
  硬链接子仓库依赖 apps/desktop/preview/node_modules ← 主树 exit=0
  零依赖子仓库 17 个（不需要 node_modules，不计入补齐面）
import 面：5043 条边｜悬空 0（其中存量已豁免 0）
门表：34 道，其中该笔 package.json 没有同名 script 的 0 道
typecheck exit=0（0 报错）

== 认证门面（25 道，名单取自 8c3252d）==
  ✅ no-progress-check exit=0 259ms（预算 1100ms）
  ✅ prune-check exit=0 295ms（预算 1100ms）
  ✅ fork-check exit=0 252ms（预算 1100ms）
  ✅ compaction-check exit=0 400ms（预算 1200ms）
  ✅ docs-check exit=0 948ms（预算 1300ms）
  ✅ memory-check exit=0 452ms（预算 1300ms）
  ✅ head-import-check exit=0 1612ms（预算 2400ms）
  ✅ autonomy-check exit=0 563ms（预算 1500ms）
  ✅ sandbox:check exit=0 570ms（预算 1700ms）
  ✅ security-check exit=0 526ms（预算 1500ms）
  ✅ provider:check exit=0 255ms（预算 1300ms）
  ✅ routing-check exit=0 452ms（预算 1400ms）
  ✅ model-surface-check exit=0 487ms（预算 1300ms）
  ✅ prefix-churn-check exit=0 518ms（预算 1500ms）
  ✅ prompt-surface-check exit=0 342ms（预算 1400ms）
  ✅ replay-determinism-check exit=0 291ms（预算 1100ms）
  ✅ cost-per-progress-check exit=0 257ms（预算 1000ms）
  ✅ web-fetch-check exit=0 312ms（预算 1200ms）
  ✅ gym-check exit=0 1023ms（预算 2400ms）
  ✅ gate-check exit=0 1766ms（预算 5400ms）
  ✅ evidence-typecheck-check exit=0 3567ms（预算 5300ms）
  ✅ mutate-needles-check exit=0 10385ms（预算 20000ms）
  ✅ repo-hygiene-check exit=0 383ms（预算 1200ms）
  ✅ e2e exit=0 3414ms（预算 4000ms）
  ✅ desktop-test exit=0 9503ms（预算 10000ms）
  认证门面=25 道（跑到 25）｜绿 25 道｜⚠️ 超预算 0

== 认证汇总 ==
  TREE=8c3252d DIRTY_JUDGED=0 依赖完整=是 收尾复核=同一笔 认证树锁=本进程持有（.git/dsh-tool-locks/head-cert-gate-head-cert.lock）
  Test Files 445 passed (445)｜Tests 6182 passed (6182)｜exit=0（退出码直接取，不接管道）
  并发判卷=起前 0 套／跑完 0 套（两端独占）
  本趟墙钟 137.78s（同一进程 hrtime 实测·口径＝起跑→汇总那一行，不含提前退出的那些趟）
  贴帽读数（缺省＝config 里的 testTimeout=30000ms）：6182 条里 0 条用时 ≥ 有效预算 80%｜无显式预算按缺省算 5647 条｜标题非字面量（it.each／插值／拼接，按缺省算）357 条｜预算没落到 0 条｜无｜离帽余量最近：tests/m3c.test.ts·M3c pipeline 哑 sequencer（零 LLM） 未获 15282ms/25000ms=61%；tests/mutate-shards.test.ts·treeProblem 与编排器的前置闸：脏树不许当片用 同一宿主被 8244ms/15000ms=55%；tests/main-run-routing.test.ts·glm main-session routing uses the  12604ms/30000ms=42%
  逐条日志：/tmp/dsh-head-cert-8c3252d
  已回收认证树 .worktrees/gate-head-cert（exit=0）
  常驻残留树=0（规则 120：detached ∧ 0 项在飞 ∧ 那一笔已入库 才算残留；带分支的树与隔壁会话正在验的笔都不算）
  本次退出码=0（这是 head-cert 这道门自己的码，不是它跑进去的 test runner 的码）｜判决输入六维全过
  汇总已同步落盘（不靠 stdout 的尾）：/tmp/dsh-head-cert-8c3252d/summary.txt
```
