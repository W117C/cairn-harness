# 认证读数 · rev d9eef10
- 生成时刻=2026-10-25-1802（UTC。台账页按本地日期，跨零点时页号与这里差一天，不是写错了）
- 温度＝两端独占 ⇒ **时间量可以引用**（墙钟／门耗时／杀锚用时）
- 收尾复核=同一笔
- 判据：两端独占＝「起前 0 且跑完 0 且这一趟真跑了全量判卷」；本页引用时间量前先回看这一行

## 认证打出来的读数（原样，未改写）

```text
目标提交：d9eef10（--at=HEAD）
worktree add exit=0
已核：TREE=d9eef102522472e6c140c9020da42a6a77278273｜判卷四面在飞 0 项
cp -al node_modules exit=0
依赖核对：该提交声明 10 项，缺 0 项
  硬链接子仓库依赖 apps/desktop/node_modules ← 主树 exit=0
  硬链接子仓库依赖 apps/desktop/preview/node_modules ← 主树 exit=0
  零依赖子仓库 17 个（不需要 node_modules，不计入补齐面）
import 面：5914 条边｜悬空 0（其中存量已豁免 0）
门表：40 道，其中该笔 package.json 没有同名 script 的 0 道
typecheck exit=0（0 报错）

== 认证门面（25 道，名单取自 d9eef10）==
  ✅ no-progress-check exit=0 283ms（预算 1100ms）
  ✅ prune-check exit=0 310ms（预算 1100ms）
  ✅ fork-check exit=0 290ms（预算 1100ms）
  ✅ compaction-check exit=0 426ms（预算 1200ms）
  ✅ docs-check exit=0 752ms（预算 1300ms）
  ✅ memory-check exit=0 490ms（预算 1300ms）
  ✅ head-import-check exit=0 1607ms（预算 2400ms）
  ✅ autonomy-check exit=0 719ms（预算 1500ms）
  ✅ sandbox:check exit=0 630ms（预算 1700ms）
  ✅ security-check exit=0 590ms（预算 1500ms）
  ✅ provider:check exit=0 293ms（预算 1300ms）
  ✅ routing-check exit=0 454ms（预算 1400ms）
  ✅ model-surface-check exit=0 484ms（预算 1300ms）
  ✅ prefix-churn-check exit=0 552ms（预算 1500ms）
  ✅ prompt-surface-check exit=0 336ms（预算 1400ms）
  ✅ replay-determinism-check exit=0 314ms（预算 1100ms）
  ✅ cost-per-progress-check exit=0 278ms（预算 1000ms）
  ❌ web-fetch-check exit=1 320ms（预算 1200ms）
  ✅ gym-check exit=0 1062ms（预算 2400ms）
  ✅ gate-check exit=0 1763ms（预算 5400ms）
  ✅ evidence-typecheck-check exit=0 3653ms（预算 5300ms）
  ❌ mutate-needles-check exit=1 10490ms（预算 20000ms）
  ✅ repo-hygiene-check exit=0 371ms（预算 1200ms）
  ✅ e2e exit=0 3228ms（预算 4000ms）
  ✅ desktop-test exit=0 9691ms（预算 10000ms）
  认证门面=25 道（跑到 25）｜❌ 红 2 道｜⚠️ 超预算 0
  ❌ web-fetch-check exit=1（320ms）
  ❌ mutate-needles-check exit=1（10490ms）

== 认证汇总 ==
  TREE=d9eef10 DIRTY_JUDGED=0 依赖完整=是 收尾复核=同一笔 认证树锁=本进程持有（.git/dsh-tool-locks/head-cert-gate-head-cert.lock）
  Test Files 1 failed | 517 passed (518)｜Tests 2 failed | 6969 passed (6971)｜exit=1（退出码直接取，不接管道）
  并发判卷=起前 0 套／跑完 0 套（两端独占）
  本趟墙钟 119.00s（同一进程 hrtime 实测·口径＝起跑→汇总那一行，不含提前退出的那些趟）
  贴帽读数（缺省＝config 里的 testTimeout=30000ms）：6971 条里 0 条用时 ≥ 有效预算 80%｜无显式预算按缺省算 6289 条｜标题非字面量（it.each／插值／拼接，按缺省算）475 条｜预算没落到 24 条（这一格没量到，不等于 0）｜成因点名：tests/metacognition-policy.test.ts（标题不在那份判卷里）；tests/metacognition-policy.test.ts（标题不在那份判卷里）；tests/metacognition-policy.test.ts（标题不在那份判卷里）｜无｜离帽余量最近：tests/m3c.test.ts·M3c pipeline 哑 sequencer（零 LLM） 未获 15260ms/25000ms=61%；tests/mutate-shards.test.ts·treeProblem 与编排器的前置闸：脏树不许当片用 同一宿主被 5358ms/15000ms=36%；tests/plugin-trust-revocation.test.ts·撤回插件信任后旧执行面立即失效 撤回时关闭在途 MCP 请求，服务端 46ms/200ms=23%
  逐条日志：/tmp/dsh-head-cert-d9eef10
  已回收认证树 .worktrees/gate-head-cert（exit=0）
  常驻残留树=0／另有 1 棵不住本仓 scratch 面的残留形树（/private/tmp/cairn-head-audit-20261026）＝不是本仓建的，别照上面那条回收命令删它们（规则 120：detached ∧ 0 项在飞 ∧ 那一笔已入库 才算残留；带分支的树与隔壁会话正在验的笔都不算）
  本次退出码=1（这是 head-cert 这道门自己的码，不是它跑进去的 test runner 的码）｜红的维：判卷 exit=1、认证门面红 2 道
  汇总已同步落盘（不靠 stdout 的尾）：/tmp/dsh-head-cert-d9eef10/summary.txt
```
