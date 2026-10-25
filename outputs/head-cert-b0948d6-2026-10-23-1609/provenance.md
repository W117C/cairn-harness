# 认证读数 · rev b0948d6
- 生成时刻=2026-10-23-1609（UTC。台账页按本地日期，跨零点时页号与这里差一天，不是写错了）
- 温度＝两端独占 ⇒ **时间量可以引用**（墙钟／门耗时／杀锚用时）
- 收尾复核=同一笔
- 判据：两端独占＝「起前 0 且跑完 0 且这一趟真跑了全量判卷」；本页引用时间量前先回看这一行

## 认证打出来的读数（原样，未改写）

```text
目标提交：b0948d6（--at=HEAD）
worktree add exit=0
已核：TREE=b0948d6ae6087734507b3df4ea8755210189c874｜判卷四面在飞 0 项
cp -al node_modules exit=0
依赖核对：该提交声明 10 项，缺 0 项
  硬链接子仓库依赖 apps/desktop/node_modules ← 主树 exit=0
  硬链接子仓库依赖 apps/desktop/preview/node_modules ← 主树 exit=0
  零依赖子仓库 17 个（不需要 node_modules，不计入补齐面）
import 面：5479 条边｜悬空 0（其中存量已豁免 0）
门表：40 道，其中该笔 package.json 没有同名 script 的 0 道
typecheck exit=0（0 报错）

== 认证门面（25 道，名单取自 b0948d6）==
  ✅ no-progress-check exit=0 284ms（预算 1100ms）
  ✅ prune-check exit=0 323ms（预算 1100ms）
  ✅ fork-check exit=0 280ms（预算 1100ms）
  ✅ compaction-check exit=0 431ms（预算 1200ms）
  ❌ docs-check exit=1 947ms（预算 1300ms）
  ✅ memory-check exit=0 484ms（预算 1300ms）
  ✅ head-import-check exit=0 1670ms（预算 2400ms）
  ✅ autonomy-check exit=0 632ms（预算 1500ms）
  ✅ sandbox:check exit=0 671ms（预算 1700ms）
  ✅ security-check exit=0 586ms（预算 1500ms）
  ✅ provider:check exit=0 283ms（预算 1300ms）
  ✅ routing-check exit=0 491ms（预算 1400ms）
  ✅ model-surface-check exit=0 540ms（预算 1300ms）
  ✅ prefix-churn-check exit=0 563ms（预算 1500ms）
  ✅ prompt-surface-check exit=0 373ms（预算 1400ms）
  ✅ replay-determinism-check exit=0 326ms（预算 1100ms）
  ✅ cost-per-progress-check exit=0 280ms（预算 1000ms）
  ✅ web-fetch-check exit=0 367ms（预算 1200ms）
  ✅ gym-check exit=0 1173ms（预算 2400ms）
  ✅ gate-check exit=0 1941ms（预算 5400ms）
  ✅ evidence-typecheck-check exit=0 4676ms（预算 5300ms）
  ✅ mutate-needles-check exit=0 12725ms（预算 20000ms）
  ✅ repo-hygiene-check exit=0 430ms（预算 1200ms）
  ✅ e2e exit=0 3306ms（预算 4000ms）
  ✅ desktop-test exit=0 9573ms（预算 10000ms）
  认证门面=25 道（跑到 25）｜❌ 红 1 道｜⚠️ 超预算 0
  ❌ docs-check exit=1（947ms）

== 认证汇总 ==
  TREE=b0948d6 DIRTY_JUDGED=0 依赖完整=是 收尾复核=同一笔 认证树锁=本进程持有（.git/dsh-tool-locks/head-cert-gate-head-cert.lock）
  Test Files 2 failed | 485 passed (487)｜Tests 2 failed | 6601 passed (6603)｜exit=1（退出码直接取，不接管道）
  并发判卷=起前 0 套／跑完 0 套（两端独占）
  本趟墙钟 139.64s（同一进程 hrtime 实测·口径＝起跑→汇总那一行，不含提前退出的那些趟）
  贴帽读数（缺省＝config 里的 testTimeout=30000ms）：6603 条里 0 条用时 ≥ 有效预算 80%｜无显式预算按缺省算 6029 条｜标题非字面量（it.each／插值／拼接，按缺省算）392 条｜预算没落到 0 条｜无｜离帽余量最近：tests/m3c.test.ts·M3c pipeline 哑 sequencer（零 LLM） 未获 15377ms/25000ms=62%；tests/plugin-trust-revocation.test.ts·撤回插件信任后旧执行面立即失效 撤回时关闭在途 MCP 请求，服务端 106ms/200ms=53%；tests/mutate-shards.test.ts·treeProblem 与编排器的前置闸：脏树不许当片用 同一宿主被 7041ms/15000ms=47%
  逐条日志：/tmp/dsh-head-cert-b0948d6
  已回收认证树 .worktrees/gate-head-cert（exit=0）
  常驻残留树=1（/Users/ze/Downloads/Cairn/deepseek harness/.worktrees/gate-mutate-verify@b0948d6）（规则 120：detached ∧ 0 项在飞 ∧ 那一笔已入库 才算残留；带分支的树与隔壁会话正在验的笔都不算）
  本次退出码=1（这是 head-cert 这道门自己的码，不是它跑进去的 test runner 的码）｜红的维：判卷 exit=1、认证门面红 1 道
  汇总已同步落盘（不靠 stdout 的尾）：/tmp/dsh-head-cert-b0948d6/summary.txt
```
