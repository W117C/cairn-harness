# 认证读数 · rev 19dfa23
- 生成时刻=2026-10-04-1639（UTC。台账页按本地日期，跨零点时页号与这里差一天，不是写错了）
- 温度＝有别人在跑 ⇒ **时间量不可引用**，只能引用「这一趟慢」；条数与红名仍可用
- 收尾复核=同一笔
- 判据：两端独占＝「起前 0 且跑完 0 且这一趟真跑了全量判卷」；本页引用时间量前先回看这一行

## 认证打出来的读数（原样，未改写）

```text
目标提交：19dfa23（--at=HEAD）
worktree add exit=0
已核：TREE=19dfa23c9dddfba81f734002ee81f061e544a7da｜判卷四面在飞 0 项
cp -al node_modules exit=0
依赖核对：该提交声明 10 项，缺 0 项
  硬链接子仓库依赖 apps/desktop/node_modules ← 主树 exit=0
  零依赖子仓库 16 个（不需要 node_modules，不计入补齐面）
import 面：3599 条边｜悬空 0（其中存量已豁免 0）
门表：33 道，其中该笔 package.json 没有同名 script 的 0 道
typecheck exit=0（0 报错）

== 认证门面（23 道，名单取自 19dfa23）==
  ✅ no-progress-check exit=0 535ms（预算 1100ms）
  ✅ prune-check exit=0 939ms（预算 1100ms）
  ✅ fork-check exit=0 412ms（预算 1100ms）
  ✅ compaction-check exit=0 1005ms（预算 1200ms）
  ❌ docs-check exit=1 1725ms（预算 1300ms）
  ✅ memory-check exit=0 976ms（预算 1300ms）
  ✅ head-import-check exit=0 2946ms（预算 2400ms）
  ✅ autonomy-check exit=0 1944ms（预算 1500ms）
  ✅ sandbox:check exit=0 1667ms（预算 1700ms）
  ❌ security-check exit=1 975ms（预算 1500ms）
  ✅ provider:check exit=0 1117ms（预算 1300ms）
  ✅ routing-check exit=0 714ms（预算 1400ms）
  ✅ model-surface-check exit=0 993ms（预算 1300ms）
  ✅ prefix-churn-check exit=0 1139ms（预算 1500ms）
  ✅ prompt-surface-check exit=0 639ms（预算 1400ms）
  ✅ replay-determinism-check exit=0 601ms（预算 1100ms）
  ✅ cost-per-progress-check exit=0 507ms（预算 1000ms）
  ✅ web-fetch-check exit=0 543ms（预算 1200ms）
  ✅ gym-check exit=0 1724ms（预算 2400ms）
  ✅ gate-check exit=0 4802ms（预算 5400ms）
  ✅ evidence-typecheck-check exit=0 3899ms（预算 5300ms）
  ❌ mutate-needles-check exit=1 22344ms（预算 20000ms）
  ✅ repo-hygiene-check exit=0 514ms（预算 1200ms）
  ⚠️ 超预算（只出声，不判红）：docs-check 1725ms > 名单里的 1300ms
  ⚠️ 超预算（只出声，不判红）：head-import-check 2946ms > 名单里的 2400ms
  ⚠️ 超预算（只出声，不判红）：autonomy-check 1944ms > 名单里的 1500ms
  ⚠️ 超预算（只出声，不判红）：mutate-needles-check 22344ms > 名单里的 20000ms
  认证门面=23 道（跑到 23）｜❌ 红 3 道｜⚠️ 超预算 4
  ❌ docs-check exit=1（1725ms）
  ❌ security-check exit=1（975ms）
  ❌ mutate-needles-check exit=1（22344ms）

== 认证汇总 ==
  TREE=19dfa23 DIRTY_JUDGED=0 依赖完整=是 收尾复核=同一笔 认证树锁=本进程持有（.git/dsh-tool-locks/head-cert-head-cert-19dfa23.lock）
  Test Files 17 failed | 291 passed (308)｜Tests 77 failed | 4285 passed (4362)｜exit=1（退出码直接取，不接管道）
  并发判卷=起前 1 套／跑完 1 套（撞窗：本仓判卷有读写共享 /tmp 的用例）
  本趟墙钟 323.81s（同一进程 hrtime 实测·口径＝起跑→汇总那一行，不含提前退出的那些趟）
  贴帽读数（缺省＝config 里的 testTimeout=30000ms）：4362 条里 0 条用时 ≥ 有效预算 80%｜无显式预算按缺省算 4064 条｜标题非字面量（it.each／插值／拼接，按缺省算）149 条｜预算没落到 0 条｜无｜离帽余量最近：tests/m3c.test.ts·M3c pipeline 哑 sequencer（零 LLM） 未获 15245ms/25000ms=61%；tests/evidence-typecheck.test.ts·门那一半：runner 的两个拒绝分支各自要出声 拼错的开关 ⇒ 退 8985ms/15000ms=60%；tests/evidence-typecheck.test.ts·门那一半：runner 的两个拒绝分支各自要出声 归属面取料那一行必 7661ms/15000ms=51%
⚠️ 判卷有红，且两端采到 1 套判卷并行 ⇒ 先排撞窗再查代码（判卷面有写共享 /tmp 的用例，两套并行会互踩出假红；本次读数不是独占跑的）
  逐条日志：/tmp/dsh-head-cert-19dfa23
  已回收认证树 .worktrees/head-cert-19dfa23（exit=0）
  常驻残留树=1（/Users/ze/Downloads/Cairn/deepseek harness/.worktrees/verify-971f3b5f@971f3b5）（规则 120：detached ∧ 0 项在飞 ∧ 那一笔已入库 才算残留；带分支的树与隔壁会话正在验的笔都不算）
  汇总已同步落盘（不靠 stdout 的尾）：/tmp/dsh-head-cert-19dfa23/summary.txt
```
