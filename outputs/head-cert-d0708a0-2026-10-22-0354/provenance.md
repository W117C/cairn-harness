# 认证读数 · rev d0708a0
- 生成时刻=2026-10-22-0354（UTC。台账页按本地日期，跨零点时页号与这里差一天，不是写错了）
- 温度＝两端独占 ⇒ **时间量可以引用**（墙钟／门耗时／杀锚用时）
- 收尾复核=同一笔
- 判据：两端独占＝「起前 0 且跑完 0 且这一趟真跑了全量判卷」；本页引用时间量前先回看这一行

## 认证打出来的读数（原样，未改写）

```text
目标提交：d0708a0（--at=HEAD）
worktree add exit=0
已核：TREE=d0708a0｜判卷四面在飞 0 项
cp -al node_modules exit=0
依赖核对：该提交声明 10 项，缺 0 项
  硬链接子仓库依赖 apps/desktop/node_modules ← 主树 exit=0
  硬链接子仓库依赖 apps/desktop/preview/node_modules ← 主树 exit=0
  零依赖子仓库 17 个（不需要 node_modules，不计入补齐面）
import 面：5195 条边｜悬空 1（其中存量已豁免 0）
  ❌ apps/desktop/src/main/channels.ts — 这一版里 tests/readme-invoke-channel-count.test.ts import 了它，而它不在这一版 ⇒ **漏 `git add`**（盘上有但未入库）
门表：35 道，其中该笔 package.json 没有同名 script 的 0 道
typecheck exit=0（0 报错）

== 认证门面（25 道，名单取自 d0708a0）==
  ✅ no-progress-check exit=0 350ms（预算 1100ms）
  ✅ prune-check exit=0 355ms（预算 1100ms）
  ✅ fork-check exit=0 304ms（预算 1100ms）
  ✅ compaction-check exit=0 471ms（预算 1200ms）
  ✅ docs-check exit=0 1054ms（预算 1300ms）
  ✅ memory-check exit=0 599ms（预算 1300ms）
  ❌ head-import-check exit=1 1776ms（预算 2400ms）
  ✅ autonomy-check exit=0 811ms（预算 1500ms）
  ✅ sandbox:check exit=0 745ms（预算 1700ms）
  ✅ security-check exit=0 764ms（预算 1500ms）
  ✅ provider:check exit=0 319ms（预算 1300ms）
  ✅ routing-check exit=0 497ms（预算 1400ms）
  ✅ model-surface-check exit=0 561ms（预算 1300ms）
  ✅ prefix-churn-check exit=0 630ms（预算 1500ms）
  ✅ prompt-surface-check exit=0 381ms（预算 1400ms）
  ✅ replay-determinism-check exit=0 409ms（预算 1100ms）
  ✅ cost-per-progress-check exit=0 337ms（预算 1000ms）
  ✅ web-fetch-check exit=0 336ms（预算 1200ms）
  ✅ gym-check exit=0 1196ms（预算 2400ms）
  ✅ gate-check exit=0 1987ms（预算 5400ms）
  ✅ evidence-typecheck-check exit=0 4627ms（预算 5300ms）
  ❌ mutate-needles-check exit=1 11536ms（预算 20000ms）
  ✅ repo-hygiene-check exit=0 472ms（预算 1200ms）
  ✅ e2e exit=0 3684ms（预算 4000ms）
  ✅ desktop-test exit=0 10249ms（预算 10000ms）
  ⚠️ 超预算（只出声，不判红）：desktop-test 10249ms > 名单里的 10000ms
  认证门面=25 道（跑到 25）｜❌ 红 2 道｜⚠️ 超预算 1
  ❌ head-import-check exit=1（1776ms）
  ❌ mutate-needles-check exit=1（11536ms）

== 认证汇总 ==
  TREE=d0708a0 DIRTY_JUDGED=0 依赖完整=是 收尾复核=同一笔 认证树锁=本进程持有（.git/dsh-tool-locks/head-cert-gate-head-cert.lock）
  Test Files 1 failed | 459 passed (460)｜Tests 1 failed | 6335 passed (6336)｜exit=1（退出码直接取，不接管道）
  并发判卷=起前 0 套／跑完 0 套（两端独占）
  本趟墙钟 157.58s（同一进程 hrtime 实测·口径＝起跑→汇总那一行，不含提前退出的那些趟）
  贴帽读数（缺省＝config 里的 testTimeout=30000ms）：6336 条里 0 条用时 ≥ 有效预算 80%｜无显式预算按缺省算 5772 条｜标题非字面量（it.each／插值／拼接，按缺省算）382 条｜预算没落到 0 条｜无｜离帽余量最近：tests/m3c.test.ts·M3c pipeline 哑 sequencer（零 LLM） 未获 15295ms/25000ms=61%；tests/main-run-routing.test.ts·glm main-session routing uses the  14042ms/30000ms=47%；tests/plugin-trust-revocation.test.ts·撤回插件信任后旧执行面立即失效 撤回时关闭在途 MCP 请求，服务端 93ms/200ms=47%
  逐条日志：/tmp/dsh-head-cert-d0708a0
  已回收认证树 .worktrees/gate-head-cert（exit=0）
  常驻残留树=0（规则 120：detached ∧ 0 项在飞 ∧ 那一笔已入库 才算残留；带分支的树与隔壁会话正在验的笔都不算）
  本次退出码=1（这是 head-cert 这道门自己的码，不是它跑进去的 test runner 的码）｜红的维：判卷 exit=1、认证门面红 2 道
  汇总已同步落盘（不靠 stdout 的尾）：/tmp/dsh-head-cert-d0708a0/summary.txt
```
