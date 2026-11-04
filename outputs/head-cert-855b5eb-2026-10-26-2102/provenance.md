# 认证读数 · rev 855b5eb
- 生成时刻=2026-10-26-2102（UTC。台账页按本地日期，跨零点时页号与这里差一天，不是写错了）
- 温度＝两端独占 ⇒ **时间量可以引用**（墙钟／门耗时／杀锚用时）
- 收尾复核=同一笔
- 判据：两端独占＝「起前 0 且跑完 0 且这一趟真跑了全量判卷」；本页引用时间量前先回看这一行

## 认证打出来的读数（原样，未改写）

```text
目标提交：855b5eb（--at=HEAD）
worktree add exit=0
已核：TREE=855b5ebe5e3391c0d29a3e6af9375b041c8a6122｜判卷四面在飞 0 项
cp -al node_modules exit=0
依赖核对：该提交声明 10 项，缺 0 项
  硬链接子仓库依赖 apps/desktop/node_modules ← 主树 exit=0
  硬链接子仓库依赖 apps/desktop/preview/node_modules ← 主树 exit=0
  零依赖子仓库 17 个（不需要 node_modules，不计入补齐面）
import 面：5060 条边｜悬空 0（其中存量已豁免 0）
门表：34 道，其中该笔 package.json 没有同名 script 的 0 道
typecheck exit=0（0 报错）

== 认证门面（25 道，名单取自 855b5eb）==
  ✅ no-progress-check exit=0 865ms（预算 1100ms）
  ✅ prune-check exit=0 896ms（预算 1100ms）
  ✅ fork-check exit=0 789ms（预算 1100ms）
  ✅ compaction-check exit=0 1301ms（预算 1200ms）
  ✅ docs-check exit=0 2240ms（预算 1300ms）
  ✅ memory-check exit=0 1648ms（预算 1300ms）
  ✅ head-import-check exit=0 6587ms（预算 2400ms）
  ✅ autonomy-check exit=0 2086ms（预算 1500ms）
  ✅ sandbox:check exit=0 1607ms（预算 1700ms）
  ✅ security-check exit=0 1769ms（预算 1500ms）
  ✅ provider:check exit=0 792ms（预算 1300ms）
  ✅ routing-check exit=0 1249ms（预算 1400ms）
  ✅ model-surface-check exit=0 1687ms（预算 1300ms）
  ✅ prefix-churn-check exit=0 1699ms（预算 1500ms）
  ✅ prompt-surface-check exit=0 1006ms（预算 1400ms）
  ✅ replay-determinism-check exit=0 1068ms（预算 1100ms）
  ✅ cost-per-progress-check exit=0 876ms（预算 1000ms）
  ✅ web-fetch-check exit=0 893ms（预算 1200ms）
  ✅ gym-check exit=0 4284ms（预算 2400ms）
  ✅ gate-check exit=0 4920ms（预算 5400ms）
  ✅ evidence-typecheck-check exit=0 10067ms（预算 5300ms）
  ✅ mutate-needles-check exit=0 33611ms（预算 20000ms）
  ✅ repo-hygiene-check exit=0 1134ms（预算 1200ms）
  ✅ e2e exit=0 7749ms（预算 4000ms）
  ❌ desktop-test exit=1 26235ms（预算 10000ms）
  ⚠️ 超预算（只出声，不判红）：compaction-check 1301ms > 名单里的 1200ms
  ⚠️ 超预算（只出声，不判红）：docs-check 2240ms > 名单里的 1300ms
  ⚠️ 超预算（只出声，不判红）：memory-check 1648ms > 名单里的 1300ms
  ⚠️ 超预算（只出声，不判红）：head-import-check 6587ms > 名单里的 2400ms
  ⚠️ 超预算（只出声，不判红）：autonomy-check 2086ms > 名单里的 1500ms
  ⚠️ 超预算（只出声，不判红）：security-check 1769ms > 名单里的 1500ms
  ⚠️ 超预算（只出声，不判红）：model-surface-check 1687ms > 名单里的 1300ms
  ⚠️ 超预算（只出声，不判红）：prefix-churn-check 1699ms > 名单里的 1500ms
  ⚠️ 超预算（只出声，不判红）：gym-check 4284ms > 名单里的 2400ms
  ⚠️ 超预算（只出声，不判红）：evidence-typecheck-check 10067ms > 名单里的 5300ms
  ⚠️ 超预算（只出声，不判红）：mutate-needles-check 33611ms > 名单里的 20000ms
  ⚠️ 超预算（只出声，不判红）：e2e 7749ms > 名单里的 4000ms
  ⚠️ 超预算（只出声，不判红）：desktop-test 26235ms > 名单里的 10000ms
  认证门面=25 道（跑到 25）｜❌ 红 1 道｜⚠️ 超预算 13
  ❌ desktop-test exit=1（26235ms）

== 认证汇总 ==
  TREE=855b5eb DIRTY_JUDGED=0 依赖完整=是 收尾复核=同一笔 认证树锁=本进程持有（/Users/ze/Downloads/Cairn/cairn/.git/dsh-tool-locks/head-cert-gate-head-cert.lock）
  Test Files 6 failed | 440 passed (446)｜Tests 7 failed | 6180 passed | 13 skipped (6200)｜exit=1（退出码直接取，不接管道）
  并发判卷=起前 0 套／跑完 0 套（两端独占）
  本趟墙钟 530.87s（同一进程 hrtime 实测·口径＝起跑→汇总那一行，不含提前退出的那些趟）
  贴帽读数（缺省＝config 里的 testTimeout=30000ms）：6200 条里 8 条用时 ≥ 有效预算 80%｜无显式预算按缺省算 5665 条｜标题非字面量（it.each／插值／拼接，按缺省算）357 条｜预算没落到 0 条：tests/mutate-shards.test.ts·treeProblem 与编排器的前置闸：脏树不许当片用 同一宿主被 33281ms/15000ms=222%；tests/plugin-trust-revocation.test.ts·撤回插件信任后旧执行面立即失效 撤回时关闭在途 MCP 请求，服务端 414ms/200ms=207%；tests/evidence-typecheck.test.ts·门那一半：runner 的两个拒绝分支各自要出声 拼错的开关 ⇒ 退 87039ms/60000ms=145%；tests/mutate-verify-gates.test.ts·树闸接线：真跑本脚本——主检出拒跑且一个字节都没改过盘，linked 19754ms/15000ms=132%；tests/main-run-routing.test.ts·glm main-session routing uses the  37705ms/30000ms=126%；tests/evidence-typecheck.test.ts·门那一半：runner 的两个拒绝分支各自要出声 归属面取料那一行必 62095ms/60000ms=103%；tests/web-fetch-stream-lifecycle.test.ts·压缩网页流的取消与背压 消费方暂不读取时，上游保留背压；恢复读取后仍 29712ms/30000ms=99%；tests/evidence-typecheck.test.ts·真环境：这一格得在真仓里跑得出东西（规则 237/320） 真仓那一 58781ms/60000ms=98%
  逐条日志：/tmp/dsh-head-cert-855b5eb
  已回收认证树 .worktrees/gate-head-cert（exit=0）
  常驻残留树=0（规则 120：detached ∧ 0 项在飞 ∧ 那一笔已入库 才算残留；带分支的树与隔壁会话正在验的笔都不算）
  本次退出码=1（这是 head-cert 这道门自己的码，不是它跑进去的 test runner 的码）｜红的维：判卷 exit=1、认证门面红 1 道
  汇总已同步落盘（不靠 stdout 的尾）：/tmp/dsh-head-cert-855b5eb/summary.txt
```
