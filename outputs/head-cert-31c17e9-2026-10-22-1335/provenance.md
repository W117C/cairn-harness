# 认证读数 · rev 31c17e9
- 生成时刻=2026-10-22-1335（UTC。台账页按本地日期，跨零点时页号与这里差一天，不是写错了）
- 温度＝两端独占 ⇒ **时间量可以引用**（墙钟／门耗时／杀锚用时）
- 收尾复核=同一笔
- 判据：两端独占＝「起前 0 且跑完 0 且这一趟真跑了全量判卷」；本页引用时间量前先回看这一行

## 认证打出来的读数（原样，未改写）

```text
目标提交：31c17e9（--at=HEAD）
worktree add exit=0
已核：TREE=b75c11d｜判卷四面在飞 0 项
cp -al node_modules exit=0
依赖核对：该提交声明 10 项，缺 0 项
  硬链接子仓库依赖 apps/desktop/node_modules ← 主树 exit=0
  硬链接子仓库依赖 apps/desktop/preview/node_modules ← 主树 exit=0
  零依赖子仓库 17 个（不需要 node_modules，不计入补齐面）
import 面：5422 条边｜悬空 0（其中存量已豁免 0）
门表：40 道，其中该笔 package.json 没有同名 script 的 0 道
typecheck exit=0（0 报错）

== 认证门面（25 道，名单取自 31c17e9）==
  ✅ no-progress-check exit=0 451ms（预算 1100ms）
  ✅ prune-check exit=0 450ms（预算 1100ms）
  ✅ fork-check exit=0 773ms（预算 1100ms）
  ✅ compaction-check exit=0 625ms（预算 1200ms）
  ❌ docs-check exit=1 1357ms（预算 1300ms）
  ✅ memory-check exit=0 651ms（预算 1300ms）
  ✅ head-import-check exit=0 2350ms（预算 2400ms）
  ✅ autonomy-check exit=0 914ms（预算 1500ms）
  ✅ sandbox:check exit=0 916ms（预算 1700ms）
  ✅ security-check exit=0 778ms（预算 1500ms）
  ✅ provider:check exit=0 387ms（预算 1300ms）
  ✅ routing-check exit=0 633ms（预算 1400ms）
  ✅ model-surface-check exit=0 655ms（预算 1300ms）
  ✅ prefix-churn-check exit=0 709ms（预算 1500ms）
  ✅ prompt-surface-check exit=0 532ms（预算 1400ms）
  ✅ replay-determinism-check exit=0 423ms（预算 1100ms）
  ✅ cost-per-progress-check exit=0 367ms（预算 1000ms）
  ✅ web-fetch-check exit=0 446ms（预算 1200ms）
  ✅ gym-check exit=0 1409ms（预算 2400ms）
  ✅ gate-check exit=0 2474ms（预算 5400ms）
  ✅ evidence-typecheck-check exit=0 6122ms（预算 5300ms）
  ✅ mutate-needles-check exit=0 14817ms（预算 20000ms）
  ✅ repo-hygiene-check exit=0 573ms（预算 1200ms）
  ✅ e2e exit=0 4361ms（预算 4000ms）
  ✅ desktop-test exit=0 13811ms（预算 10000ms）
  ⚠️ 超预算（只出声，不判红）：docs-check 1357ms > 名单里的 1300ms
  ⚠️ 超预算（只出声，不判红）：evidence-typecheck-check 6122ms > 名单里的 5300ms
  ⚠️ 超预算（只出声，不判红）：e2e 4361ms > 名单里的 4000ms
  ⚠️ 超预算（只出声，不判红）：desktop-test 13811ms > 名单里的 10000ms
  认证门面=25 道（跑到 25）｜❌ 红 1 道｜⚠️ 超预算 4
  ❌ docs-check exit=1（1357ms）

== 认证汇总 ==
  TREE=31c17e9 DIRTY_JUDGED=0 依赖完整=是 收尾复核=同一笔 认证树锁=本进程持有（.git/dsh-tool-locks/head-cert-gate-head-cert.lock）
  Test Files 6 failed | 472 passed (478)｜Tests 7 failed | 6515 passed (6522)｜exit=1（退出码直接取，不接管道）
  并发判卷=起前 0 套／跑完 0 套（两端独占）
  本趟墙钟 337.26s（同一进程 hrtime 实测·口径＝起跑→汇总那一行，不含提前退出的那些趟）
  贴帽读数（缺省＝config 里的 testTimeout=30000ms）：6522 条里 6 条用时 ≥ 有效预算 80%｜无显式预算按缺省算 5948 条｜标题非字面量（it.each／插值／拼接，按缺省算）392 条｜预算没落到 0 条：tests/plugin-trust-revocation.test.ts·撤回插件信任后旧执行面立即失效 撤回时关闭在途 MCP 请求，服务端 608ms/200ms=304%；tests/mutate-shards.test.ts·treeProblem 与编排器的前置闸：脏树不许当片用 同一宿主被 34269ms/15000ms=228%；tests/main-run-routing.test.ts·glm main-session routing uses the  33546ms/30000ms=112%；tests/evidence-typecheck.test.ts·门那一半：runner 的两个拒绝分支各自要出声 拼错的开关 ⇒ 退 61929ms/60000ms=103%；tests/evidence-typecheck.test.ts·门那一半：runner 的两个拒绝分支各自要出声 归属面取料那一行必 61555ms/60000ms=103%；tests/bench-judge-spec.test.ts·judge-spec 的 --check 门形状 门脚本在场，且在配 24175ms/30000ms=81%
  逐条日志：/tmp/dsh-head-cert-31c17e9
  已回收认证树 .worktrees/gate-head-cert（exit=0）
  常驻残留树=0（规则 120：detached ∧ 0 项在飞 ∧ 那一笔已入库 才算残留；带分支的树与隔壁会话正在验的笔都不算）
  本次退出码=1（这是 head-cert 这道门自己的码，不是它跑进去的 test runner 的码）｜红的维：判卷 exit=1、认证门面红 1 道
  汇总已同步落盘（不靠 stdout 的尾）：/tmp/dsh-head-cert-31c17e9/summary.txt
```
