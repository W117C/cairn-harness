# 认证读数 · rev 303c5ee
- 生成时刻=2026-10-23-0121（UTC。台账页按本地日期，跨零点时页号与这里差一天，不是写错了）
- 温度＝两端独占 ⇒ **时间量可以引用**（墙钟／门耗时／杀锚用时）
- 收尾复核=同一笔
- 判据：两端独占＝「起前 0 且跑完 0 且这一趟真跑了全量判卷」；本页引用时间量前先回看这一行

## 认证打出来的读数（原样，未改写）

```text
目标提交：303c5ee（--at=HEAD）
worktree add exit=0
已核：TREE=7bbd2b4｜判卷四面在飞 0 项
cp -al node_modules exit=0
依赖核对：该提交声明 10 项，缺 0 项
  硬链接子仓库依赖 apps/desktop/node_modules ← 主树 exit=0
  硬链接子仓库依赖 apps/desktop/preview/node_modules ← 主树 exit=0
  零依赖子仓库 17 个（不需要 node_modules，不计入补齐面）
import 面：5454 条边｜悬空 0（其中存量已豁免 0）
门表：40 道，其中该笔 package.json 没有同名 script 的 0 道
typecheck exit=0（0 报错）

== 认证门面（25 道，名单取自 303c5ee）==
  ✅ no-progress-check exit=0 470ms（预算 1100ms）
  ✅ prune-check exit=0 539ms（预算 1100ms）
  ✅ fork-check exit=0 431ms（预算 1100ms）
  ✅ compaction-check exit=0 742ms（预算 1200ms）
  ❌ docs-check exit=1 1297ms（预算 1300ms）
  ✅ memory-check exit=0 831ms（预算 1300ms）
  ✅ head-import-check exit=0 3262ms（预算 2400ms）
  ✅ autonomy-check exit=0 934ms（预算 1500ms）
  ✅ sandbox:check exit=0 993ms（预算 1700ms）
  ✅ security-check exit=0 1022ms（预算 1500ms）
  ✅ provider:check exit=0 477ms（预算 1300ms）
  ✅ routing-check exit=0 683ms（预算 1400ms）
  ✅ model-surface-check exit=0 833ms（预算 1300ms）
  ✅ prefix-churn-check exit=0 975ms（预算 1500ms）
  ✅ prompt-surface-check exit=0 611ms（预算 1400ms）
  ✅ replay-determinism-check exit=0 526ms（预算 1100ms）
  ✅ cost-per-progress-check exit=0 456ms（预算 1000ms）
  ✅ web-fetch-check exit=0 518ms（预算 1200ms）
  ✅ gym-check exit=0 1783ms（预算 2400ms）
  ✅ gate-check exit=0 3042ms（预算 5400ms）
  ✅ evidence-typecheck-check exit=0 9172ms（预算 5300ms）
  ✅ mutate-needles-check exit=0 21835ms（预算 20000ms）
  ✅ repo-hygiene-check exit=0 651ms（预算 1200ms）
  ✅ e2e exit=0 4580ms（预算 4000ms）
  ✅ desktop-test exit=0 25757ms（预算 10000ms）
  ⚠️ 超预算（只出声，不判红）：head-import-check 3262ms > 名单里的 2400ms
  ⚠️ 超预算（只出声，不判红）：evidence-typecheck-check 9172ms > 名单里的 5300ms
  ⚠️ 超预算（只出声，不判红）：mutate-needles-check 21835ms > 名单里的 20000ms
  ⚠️ 超预算（只出声，不判红）：e2e 4580ms > 名单里的 4000ms
  ⚠️ 超预算（只出声，不判红）：desktop-test 25757ms > 名单里的 10000ms
  认证门面=25 道（跑到 25）｜❌ 红 1 道｜⚠️ 超预算 5
  ❌ docs-check exit=1（1297ms）

== 认证汇总 ==
  TREE=303c5ee DIRTY_JUDGED=0 依赖完整=是 收尾复核=同一笔 认证树锁=本进程持有（.git/dsh-tool-locks/head-cert-gate-head-cert.lock）
  Test Files 3 failed | 480 passed (483)｜Tests 3 failed | 6574 passed (6577)｜exit=1（退出码直接取，不接管道）
  并发判卷=起前 0 套／跑完 0 套（两端独占）
  本趟墙钟 361.64s（同一进程 hrtime 实测·口径＝起跑→汇总那一行，不含提前退出的那些趟）
  贴帽读数（缺省＝config 里的 testTimeout=30000ms）：6577 条里 4 条用时 ≥ 有效预算 80%｜无显式预算按缺省算 6003 条｜标题非字面量（it.each／插值／拼接，按缺省算）392 条｜预算没落到 0 条：tests/plugin-trust-revocation.test.ts·撤回插件信任后旧执行面立即失效 撤回时关闭在途 MCP 请求，服务端 353ms/200ms=177%；tests/mutate-shards.test.ts·treeProblem 与编排器的前置闸：脏树不许当片用 同一宿主被 24144ms/15000ms=161%；tests/main-run-routing.test.ts·glm main-session routing uses the  28230ms/30000ms=94%；tests/mutate-verify-gates.test.ts·树闸接线：真跑本脚本——主检出拒跑且一个字节都没改过盘，linked 13478ms/15000ms=90%
  逐条日志：/tmp/dsh-head-cert-303c5ee
  已回收认证树 .worktrees/gate-head-cert（exit=0）
  常驻残留树=0（规则 120：detached ∧ 0 项在飞 ∧ 那一笔已入库 才算残留；带分支的树与隔壁会话正在验的笔都不算）
  本次退出码=1（这是 head-cert 这道门自己的码，不是它跑进去的 test runner 的码）｜红的维：判卷 exit=1、认证门面红 1 道
  汇总已同步落盘（不靠 stdout 的尾）：/tmp/dsh-head-cert-303c5ee/summary.txt
```
