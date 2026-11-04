# 认证读数 · rev 855b5eb
- 生成时刻=2026-10-26-2034（UTC。台账页按本地日期，跨零点时页号与这里差一天，不是写错了）
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
  ✅ no-progress-check exit=0 980ms（预算 1100ms）
  ✅ prune-check exit=0 823ms（预算 1100ms）
  ✅ fork-check exit=0 672ms（预算 1100ms）
  ✅ compaction-check exit=0 1196ms（预算 1200ms）
  ✅ docs-check exit=0 2303ms（预算 1300ms）
  ✅ memory-check exit=0 1382ms（预算 1300ms）
  ✅ head-import-check exit=0 4787ms（预算 2400ms）
  ✅ autonomy-check exit=0 1507ms（预算 1500ms）
  ✅ sandbox:check exit=0 1474ms（预算 1700ms）
  ✅ security-check exit=0 1586ms（预算 1500ms）
  ✅ provider:check exit=0 729ms（预算 1300ms）
  ✅ routing-check exit=0 1056ms（预算 1400ms）
  ✅ model-surface-check exit=0 1418ms（预算 1300ms）
  ✅ prefix-churn-check exit=0 1684ms（预算 1500ms）
  ✅ prompt-surface-check exit=0 1095ms（预算 1400ms）
  ✅ replay-determinism-check exit=0 1052ms（预算 1100ms）
  ✅ cost-per-progress-check exit=0 1029ms（预算 1000ms）
  ✅ web-fetch-check exit=0 894ms（预算 1200ms）
  ✅ gym-check exit=0 3135ms（预算 2400ms）
  ✅ gate-check exit=0 6915ms（预算 5400ms）
  ✅ evidence-typecheck-check exit=0 9475ms（预算 5300ms）
  ✅ mutate-needles-check exit=0 32680ms（预算 20000ms）
  ✅ repo-hygiene-check exit=0 1091ms（预算 1200ms）
  ✅ e2e exit=0 7296ms（预算 4000ms）
  ✅ desktop-test exit=0 23468ms（预算 10000ms）
  ⚠️ 超预算（只出声，不判红）：docs-check 2303ms > 名单里的 1300ms
  ⚠️ 超预算（只出声，不判红）：memory-check 1382ms > 名单里的 1300ms
  ⚠️ 超预算（只出声，不判红）：head-import-check 4787ms > 名单里的 2400ms
  ⚠️ 超预算（只出声，不判红）：autonomy-check 1507ms > 名单里的 1500ms
  ⚠️ 超预算（只出声，不判红）：security-check 1586ms > 名单里的 1500ms
  ⚠️ 超预算（只出声，不判红）：model-surface-check 1418ms > 名单里的 1300ms
  ⚠️ 超预算（只出声，不判红）：prefix-churn-check 1684ms > 名单里的 1500ms
  ⚠️ 超预算（只出声，不判红）：cost-per-progress-check 1029ms > 名单里的 1000ms
  ⚠️ 超预算（只出声，不判红）：gym-check 3135ms > 名单里的 2400ms
  ⚠️ 超预算（只出声，不判红）：gate-check 6915ms > 名单里的 5400ms
  ⚠️ 超预算（只出声，不判红）：evidence-typecheck-check 9475ms > 名单里的 5300ms
  ⚠️ 超预算（只出声，不判红）：mutate-needles-check 32680ms > 名单里的 20000ms
  ⚠️ 超预算（只出声，不判红）：e2e 7296ms > 名单里的 4000ms
  ⚠️ 超预算（只出声，不判红）：desktop-test 23468ms > 名单里的 10000ms
  认证门面=25 道（跑到 25）｜绿 25 道｜⚠️ 超预算 14

== 认证汇总 ==
  TREE=855b5eb DIRTY_JUDGED=0 依赖完整=是 收尾复核=同一笔 认证树锁=本进程持有（/Users/ze/Downloads/Cairn/cairn/.git/dsh-tool-locks/head-cert-gate-head-cert.lock）
  Test Files 9 failed | 437 passed (446)｜Tests 12 failed | 6188 passed (6200)｜exit=1（退出码直接取，不接管道）
  并发判卷=起前 0 套／跑完 0 套（两端独占）
  本趟墙钟 586.15s（同一进程 hrtime 实测·口径＝起跑→汇总那一行，不含提前退出的那些趟）
  贴帽读数（缺省＝config 里的 testTimeout=30000ms）：6200 条里 8 条用时 ≥ 有效预算 80%｜无显式预算按缺省算 5665 条｜标题非字面量（it.each／插值／拼接，按缺省算）357 条｜预算没落到 0 条：tests/mutate-shards.test.ts·treeProblem 与编排器的前置闸：脏树不许当片用 同一宿主被 44976ms/15000ms=300%；tests/mutate-verify-gates.test.ts·树闸接线：真跑本脚本——主检出拒跑且一个字节都没改过盘，linked 26260ms/15000ms=175%；tests/evidence-typecheck.test.ts·门那一半：runner 的两个拒绝分支各自要出声 拼错的开关 ⇒ 退 104301ms/60000ms=174%；tests/main-run-routing.test.ts·glm main-session routing uses the  48082ms/30000ms=160%；tests/evidence-typecheck.test.ts·真环境：这一格得在真仓里跑得出东西（规则 237/320） 真仓那一 89620ms/60000ms=149%；tests/cli-fork-replay.test.ts·真跑 bin：--replay 只读 / --fork 不污染原历史 42607ms/30000ms=142%；tests/evidence-typecheck.test.ts·门那一半：runner 的两个拒绝分支各自要出声 归属面取料那一行必 75210ms/60000ms=125%；tests/head-import-face.test.ts·真表自证：这把尺不许是空载的，也不许对事故那笔失明 换 rev 也能 34319ms/30000ms=114%
  逐条日志：/tmp/dsh-head-cert-855b5eb
  已回收认证树 .worktrees/gate-head-cert（exit=0）
  常驻残留树=0（规则 120：detached ∧ 0 项在飞 ∧ 那一笔已入库 才算残留；带分支的树与隔壁会话正在验的笔都不算）
  本次退出码=1（这是 head-cert 这道门自己的码，不是它跑进去的 test runner 的码）｜红的维：判卷 exit=1
  汇总已同步落盘（不靠 stdout 的尾）：/tmp/dsh-head-cert-855b5eb/summary.txt
```
