# 认证读数 · rev 48cc04a
- 生成时刻=2026-10-22-0454（UTC。台账页按本地日期，跨零点时页号与这里差一天，不是写错了）
- 温度＝两端独占 ⇒ **时间量可以引用**（墙钟／门耗时／杀锚用时）
- 收尾复核=同一笔
- 判据：两端独占＝「起前 0 且跑完 0 且这一趟真跑了全量判卷」；本页引用时间量前先回看这一行

## 认证打出来的读数（原样，未改写）

```text
目标提交：48cc04a（--at=HEAD）
worktree add exit=0
已核：TREE=48cc04ab4626f9d85e7d12b6675be7bce82e4dea｜判卷四面在飞 0 项
cp -al node_modules exit=0
依赖核对：该提交声明 10 项，缺 0 项
  硬链接子仓库依赖 apps/desktop/node_modules ← 主树 exit=0
  硬链接子仓库依赖 apps/desktop/preview/node_modules ← 主树 exit=0
  零依赖子仓库 17 个（不需要 node_modules，不计入补齐面）
import 面：5288 条边｜悬空 0（其中存量已豁免 0）
门表：40 道，其中该笔 package.json 没有同名 script 的 0 道
typecheck exit=0（0 报错）

== 认证门面（25 道，名单取自 48cc04a）==
  ✅ no-progress-check exit=0 293ms（预算 1100ms）
  ✅ prune-check exit=0 332ms（预算 1100ms）
  ✅ fork-check exit=0 275ms（预算 1100ms）
  ✅ compaction-check exit=0 463ms（预算 1200ms）
  ✅ docs-check exit=0 915ms（预算 1300ms）
  ✅ memory-check exit=0 538ms（预算 1300ms）
  ✅ head-import-check exit=0 1745ms（预算 2400ms）
  ✅ autonomy-check exit=0 611ms（预算 1500ms）
  ✅ sandbox:check exit=0 707ms（预算 1700ms）
  ✅ security-check exit=0 637ms（预算 1500ms）
  ✅ provider:check exit=0 290ms（预算 1300ms）
  ✅ routing-check exit=0 484ms（预算 1400ms）
  ✅ model-surface-check exit=0 546ms（预算 1300ms）
  ✅ prefix-churn-check exit=0 593ms（预算 1500ms）
  ✅ prompt-surface-check exit=0 398ms（预算 1400ms）
  ✅ replay-determinism-check exit=0 334ms（预算 1100ms）
  ✅ cost-per-progress-check exit=0 294ms（预算 1000ms）
  ✅ web-fetch-check exit=0 346ms（预算 1200ms）
  ✅ gym-check exit=0 1197ms（预算 2400ms）
  ✅ gate-check exit=0 2009ms（预算 5400ms）
  ✅ evidence-typecheck-check exit=0 4637ms（预算 5300ms）
  ✅ mutate-needles-check exit=0 13011ms（预算 20000ms）
  ❌ repo-hygiene-check exit=1 526ms（预算 1200ms）
  ✅ e2e exit=0 3542ms（预算 4000ms）
  ✅ desktop-test exit=0 9354ms（预算 10000ms）
  认证门面=25 道（跑到 25）｜❌ 红 1 道｜⚠️ 超预算 0
  ❌ repo-hygiene-check exit=1（526ms）

== 认证汇总 ==
  TREE=48cc04a DIRTY_JUDGED=0 依赖完整=是 收尾复核=同一笔 认证树锁=本进程持有（.git/dsh-tool-locks/head-cert-gate-head-cert.lock）
  Test Files 467 passed (467)｜Tests 6459 passed (6459)｜exit=0（退出码直接取，不接管道）
  并发判卷=起前 0 套／跑完 0 套（两端独占）
  本趟墙钟 133.07s（同一进程 hrtime 实测·口径＝起跑→汇总那一行，不含提前退出的那些趟）
  贴帽读数（缺省＝config 里的 testTimeout=30000ms）：6459 条里 0 条用时 ≥ 有效预算 80%｜无显式预算按缺省算 5893 条｜标题非字面量（it.each／插值／拼接，按缺省算）384 条｜预算没落到 0 条｜无｜离帽余量最近：tests/m3c.test.ts·M3c pipeline 哑 sequencer（零 LLM） 未获 15352ms/25000ms=61%；tests/mutate-shards.test.ts·treeProblem 与编排器的前置闸：脏树不许当片用 同一宿主被 5738ms/15000ms=38%；tests/plugin-trust-revocation.test.ts·撤回插件信任后旧执行面立即失效 撤回时关闭在途 MCP 请求，服务端 64ms/200ms=32%
  逐条日志：/tmp/dsh-head-cert-48cc04a
  已回收认证树 .worktrees/gate-head-cert（exit=0）
  常驻残留树=1（/Users/ze/Downloads/Cairn/deepseek harness/.worktrees/gate-mutate-verify@6455bb2）（规则 120：detached ∧ 0 项在飞 ∧ 那一笔已入库 才算残留；带分支的树与隔壁会话正在验的笔都不算）
  本次退出码=1（这是 head-cert 这道门自己的码，不是它跑进去的 test runner 的码）｜红的维：认证门面红 1 道
  汇总已同步落盘（不靠 stdout 的尾）：/tmp/dsh-head-cert-48cc04a/summary.txt
```
