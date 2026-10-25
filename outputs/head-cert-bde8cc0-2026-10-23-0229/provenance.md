# 认证读数 · rev bde8cc0
- 生成时刻=2026-10-23-0229（UTC。台账页按本地日期，跨零点时页号与这里差一天，不是写错了）
- 温度＝有别人在跑 ⇒ **时间量不可引用**，只能引用「这一趟慢」；条数与红名仍可用
- 收尾复核=同一笔
- 判据：两端独占＝「起前 0 且跑完 0 且这一趟真跑了全量判卷」；本页引用时间量前先回看这一行

## 认证打出来的读数（原样，未改写）

```text
目标提交：bde8cc0（--at=HEAD）
worktree add exit=0
已核：TREE=c368858｜判卷四面在飞 0 项
cp -al node_modules exit=0
依赖核对：该提交声明 10 项，缺 0 项
  硬链接子仓库依赖 apps/desktop/node_modules ← 主树 exit=0
  硬链接子仓库依赖 apps/desktop/preview/node_modules ← 主树 exit=0
  零依赖子仓库 17 个（不需要 node_modules，不计入补齐面）
import 面：5460 条边｜悬空 0（其中存量已豁免 0）
门表：40 道，其中该笔 package.json 没有同名 script 的 0 道
typecheck exit=0（0 报错）

== 认证门面（25 道，名单取自 bde8cc0）==
  ✅ no-progress-check exit=0 308ms（预算 1100ms）
  ✅ prune-check exit=0 354ms（预算 1100ms）
  ✅ fork-check exit=0 294ms（预算 1100ms）
  ✅ compaction-check exit=0 467ms（预算 1200ms）
  ❌ docs-check exit=1 1219ms（预算 1300ms）
  ✅ memory-check exit=0 548ms（预算 1300ms）
  ✅ head-import-check exit=0 1885ms（预算 2400ms）
  ✅ autonomy-check exit=0 743ms（预算 1500ms）
  ✅ sandbox:check exit=0 691ms（预算 1700ms）
  ✅ security-check exit=0 665ms（预算 1500ms）
  ✅ provider:check exit=0 311ms（预算 1300ms）
  ✅ routing-check exit=0 522ms（预算 1400ms）
  ✅ model-surface-check exit=0 568ms（预算 1300ms）
  ✅ prefix-churn-check exit=0 640ms（预算 1500ms）
  ✅ prompt-surface-check exit=0 491ms（预算 1400ms）
  ✅ replay-determinism-check exit=0 342ms（预算 1100ms）
  ✅ cost-per-progress-check exit=0 312ms（预算 1000ms）
  ✅ web-fetch-check exit=0 378ms（预算 1200ms）
  ✅ gym-check exit=0 1238ms（预算 2400ms）
  ✅ gate-check exit=0 2137ms（预算 5400ms）
  ✅ evidence-typecheck-check exit=0 5112ms（预算 5300ms）
  ✅ mutate-needles-check exit=0 13544ms（预算 20000ms）
  ✅ repo-hygiene-check exit=0 533ms（预算 1200ms）
  ✅ e2e exit=0 3686ms（预算 4000ms）
  ✅ desktop-test exit=0 17596ms（预算 10000ms）
  ⚠️ 超预算（只出声，不判红）：desktop-test 17596ms > 名单里的 10000ms
  认证门面=25 道（跑到 25）｜❌ 红 1 道｜⚠️ 超预算 1
  ❌ docs-check exit=1（1219ms）

== 认证汇总 ==
  TREE=bde8cc0 DIRTY_JUDGED=0 依赖完整=是 收尾复核=同一笔 认证树锁=本进程持有（.git/dsh-tool-locks/head-cert-gate-head-cert.lock）
  Test Files 2 failed | 482 passed (484)｜Tests 2 failed | 6584 passed (6586)｜exit=1（退出码直接取，不接管道）
  并发判卷=起前 1 套／跑完 0 套（撞窗：本仓判卷有读写共享 /tmp 的用例）
  本趟墙钟 199.84s（同一进程 hrtime 实测·口径＝起跑→汇总那一行，不含提前退出的那些趟）
  贴帽读数（缺省＝config 里的 testTimeout=30000ms）：6586 条里 1 条用时 ≥ 有效预算 80%｜无显式预算按缺省算 6012 条｜标题非字面量（it.each／插值／拼接，按缺省算）392 条｜预算没落到 0 条：tests/plugin-trust-revocation.test.ts·撤回插件信任后旧执行面立即失效 撤回时关闭在途 MCP 请求，服务端 381ms/200ms=190%｜离帽余量最近：tests/plugin-trust-revocation.test.ts·撤回插件信任后旧执行面立即失效 撤回时关闭在途 MCP 请求，服务端 381ms/200ms=190%；tests/mutate-shards.test.ts·treeProblem 与编排器的前置闸：脏树不许当片用 同一宿主被 9704ms/15000ms=65%；tests/m3c.test.ts·M3c pipeline 哑 sequencer（零 LLM） 未获 15375ms/25000ms=61%
⚠️ 判卷有红，且两端采到 1 套判卷并行 ⇒ 先排撞窗再查代码（判卷面有写共享 /tmp 的用例，两套并行会互踩出假红；本次读数不是独占跑的）
  逐条日志：/tmp/dsh-head-cert-bde8cc0
  已回收认证树 .worktrees/gate-head-cert（exit=0）
  常驻残留树=0（规则 120：detached ∧ 0 项在飞 ∧ 那一笔已入库 才算残留；带分支的树与隔壁会话正在验的笔都不算）
  本次退出码=1（这是 head-cert 这道门自己的码，不是它跑进去的 test runner 的码）｜红的维：判卷 exit=1、认证门面红 1 道
  汇总已同步落盘（不靠 stdout 的尾）：/tmp/dsh-head-cert-bde8cc0/summary.txt
```
