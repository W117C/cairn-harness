# 认证读数 · rev 6af2473
- 生成时刻=2026-10-21-0933（UTC。台账页按本地日期，跨零点时页号与这里差一天，不是写错了）
- 温度＝两端独占 ⇒ **时间量可以引用**（墙钟／门耗时／杀锚用时）
- 收尾复核=同一笔
- 判据：两端独占＝「起前 0 且跑完 0 且这一趟真跑了全量判卷」；本页引用时间量前先回看这一行

## 认证打出来的读数（原样，未改写）

```text
目标提交：6af2473（--at=HEAD）
worktree add exit=0
已核：TREE=6af24734ba957838e5584e01228499e5e77b61e9｜判卷四面在飞 0 项
cp -al node_modules exit=0
依赖核对：该提交声明 10 项，缺 0 项
  硬链接子仓库依赖 apps/desktop/node_modules ← 主树 exit=0
  硬链接子仓库依赖 apps/desktop/preview/node_modules ← 主树 exit=0
  零依赖子仓库 17 个（不需要 node_modules，不计入补齐面）
import 面：5043 条边｜悬空 0（其中存量已豁免 0）
门表：34 道，其中该笔 package.json 没有同名 script 的 0 道
typecheck exit=0（0 报错）

== 认证门面（25 道，名单取自 6af2473）==
  ✅ no-progress-check exit=0 336ms（预算 1100ms）
  ✅ prune-check exit=0 354ms（预算 1100ms）
  ✅ fork-check exit=0 627ms（预算 1100ms）
  ✅ compaction-check exit=0 468ms（预算 1200ms）
  ✅ docs-check exit=0 1289ms（预算 1300ms）
  ✅ memory-check exit=0 529ms（预算 1300ms）
  ✅ head-import-check exit=0 1963ms（预算 2400ms）
  ✅ autonomy-check exit=0 724ms（预算 1500ms）
  ✅ sandbox:check exit=0 912ms（预算 1700ms）
  ✅ security-check exit=0 694ms（预算 1500ms）
  ✅ provider:check exit=0 300ms（预算 1300ms）
  ✅ routing-check exit=0 561ms（预算 1400ms）
  ✅ model-surface-check exit=0 840ms（预算 1300ms）
  ✅ prefix-churn-check exit=0 1109ms（预算 1500ms）
  ✅ prompt-surface-check exit=0 636ms（预算 1400ms）
  ✅ replay-determinism-check exit=0 406ms（预算 1100ms）
  ✅ cost-per-progress-check exit=0 403ms（预算 1000ms）
  ✅ web-fetch-check exit=0 382ms（预算 1200ms）
  ✅ gym-check exit=0 1393ms（预算 2400ms）
  ✅ gate-check exit=0 2739ms（预算 5400ms）
  ✅ evidence-typecheck-check exit=0 4608ms（预算 5300ms）
  ✅ mutate-needles-check exit=0 15569ms（预算 20000ms）
  ✅ repo-hygiene-check exit=0 517ms（预算 1200ms）
  ✅ e2e exit=0 6976ms（预算 4000ms）
  ✅ desktop-test exit=0 10395ms（预算 10000ms）
  ⚠️ 超预算（只出声，不判红）：e2e 6976ms > 名单里的 4000ms
  ⚠️ 超预算（只出声，不判红）：desktop-test 10395ms > 名单里的 10000ms
  认证门面=25 道（跑到 25）｜绿 25 道｜⚠️ 超预算 2

== 认证汇总 ==
  TREE=6af2473 DIRTY_JUDGED=0 依赖完整=是 收尾复核=同一笔 认证树锁=本进程持有（.git/dsh-tool-locks/head-cert-gate-head-cert.lock）
  Test Files 1 failed | 444 passed (445)｜Tests 1 failed | 6187 passed (6188)｜exit=1（退出码直接取，不接管道）
  并发判卷=起前 0 套／跑完 0 套（两端独占）
  本趟墙钟 196.22s（同一进程 hrtime 实测·口径＝起跑→汇总那一行，不含提前退出的那些趟）
  贴帽读数（缺省＝config 里的 testTimeout=30000ms）：6188 条里 2 条用时 ≥ 有效预算 80%｜无显式预算按缺省算 5653 条｜标题非字面量（it.each／插值／拼接，按缺省算）357 条｜预算没落到 0 条：tests/main-run-routing.test.ts·glm main-session routing uses the  33103ms/30000ms=110%；tests/plugin-trust-revocation.test.ts·撤回插件信任后旧执行面立即失效 撤回时关闭在途 MCP 请求，服务端 210ms/200ms=105%｜离帽余量最近：tests/main-run-routing.test.ts·glm main-session routing uses the  33103ms/30000ms=110%；tests/plugin-trust-revocation.test.ts·撤回插件信任后旧执行面立即失效 撤回时关闭在途 MCP 请求，服务端 210ms/200ms=105%；tests/web-fetch-stream-lifecycle.test.ts·压缩网页流的取消与背压 消费方暂不读取时，上游保留背压；恢复读取后仍 18530ms/30000ms=62%
  逐条日志：/tmp/dsh-head-cert-6af2473
  已回收认证树 .worktrees/gate-head-cert（exit=0）
  常驻残留树=0（规则 120：detached ∧ 0 项在飞 ∧ 那一笔已入库 才算残留；带分支的树与隔壁会话正在验的笔都不算）
  本次退出码=1（这是 head-cert 这道门自己的码，不是它跑进去的 test runner 的码）｜红的维：判卷 exit=1
  汇总已同步落盘（不靠 stdout 的尾）：/tmp/dsh-head-cert-6af2473/summary.txt
```
