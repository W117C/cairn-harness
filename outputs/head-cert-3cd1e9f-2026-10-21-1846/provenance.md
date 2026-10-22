# 认证读数 · rev 3cd1e9f
- 生成时刻=2026-10-21-1846（UTC。台账页按本地日期，跨零点时页号与这里差一天，不是写错了）
- 温度＝有别人在跑 ⇒ **时间量不可引用**，只能引用「这一趟慢」；条数与红名仍可用
- 收尾复核=同一笔
- 判据：两端独占＝「起前 0 且跑完 0 且这一趟真跑了全量判卷」；本页引用时间量前先回看这一行

## 认证打出来的读数（原样，未改写）

```text
目标提交：3cd1e9f（--at=3cd1e9f4）
worktree add exit=0
已核：TREE=3cd1e9f4c4377f430fefa577d170684c08b17f9e｜判卷四面在飞 0 项
cp -al node_modules exit=0
依赖核对：该提交声明 10 项，缺 0 项
  硬链接子仓库依赖 apps/desktop/node_modules ← 主树 exit=0
  硬链接子仓库依赖 apps/desktop/preview/node_modules ← 主树 exit=0
  零依赖子仓库 17 个（不需要 node_modules，不计入补齐面）
import 面：5163 条边｜悬空 0（其中存量已豁免 0）
门表：35 道，其中该笔 package.json 没有同名 script 的 1 道：bench-judge-spec-check ⇒ **「整表绿」在这一笔上不可能成立**（这些门 spawn 就失败）
typecheck exit=0（0 报错）

== 认证门面（25 道，名单取自 3cd1e9f）==
  ✅ no-progress-check exit=0 309ms（预算 1100ms）
  ✅ prune-check exit=0 340ms（预算 1100ms）
  ✅ fork-check exit=0 378ms（预算 1100ms）
  ✅ compaction-check exit=0 534ms（预算 1200ms）
  ❌ docs-check exit=1 1093ms（预算 1300ms）
  ✅ memory-check exit=0 822ms（预算 1300ms）
  ✅ head-import-check exit=0 1587ms（预算 2400ms）
  ✅ autonomy-check exit=0 835ms（预算 1500ms）
  ✅ sandbox:check exit=0 760ms（预算 1700ms）
  ✅ security-check exit=0 615ms（预算 1500ms）
  ✅ provider:check exit=0 318ms（预算 1300ms）
  ✅ routing-check exit=0 497ms（预算 1400ms）
  ✅ model-surface-check exit=0 518ms（预算 1300ms）
  ✅ prefix-churn-check exit=0 614ms（预算 1500ms）
  ✅ prompt-surface-check exit=0 377ms（预算 1400ms）
  ✅ replay-determinism-check exit=0 349ms（预算 1100ms）
  ✅ cost-per-progress-check exit=0 305ms（预算 1000ms）
  ✅ web-fetch-check exit=0 326ms（预算 1200ms）
  ✅ gym-check exit=0 1446ms（预算 2400ms）
  ✅ gate-check exit=0 1994ms（预算 5400ms）
  ✅ evidence-typecheck-check exit=0 3848ms（预算 5300ms）
  ✅ mutate-needles-check exit=0 12085ms（预算 20000ms）
  ✅ repo-hygiene-check exit=0 452ms（预算 1200ms）
  ✅ e2e exit=0 3477ms（预算 4000ms）
  ✅ desktop-test exit=0 9900ms（预算 10000ms）
  认证门面=25 道（跑到 25）｜❌ 红 1 道｜⚠️ 超预算 0
  ❌ docs-check exit=1（1093ms）

== 认证汇总 ==
  TREE=3cd1e9f DIRTY_JUDGED=0 依赖完整=是 收尾复核=同一笔 认证树锁=本进程持有（.git/dsh-tool-locks/head-cert-head-cert-3cd1e9f.lock）
  Test Files 3 failed | 453 passed (456)｜Tests 3 failed | 6315 passed (6318)｜exit=1（退出码直接取，不接管道）
  并发判卷=起前 1 套／跑完 1 套（撞窗：本仓判卷有读写共享 /tmp 的用例）
  本趟墙钟 132.58s（同一进程 hrtime 实测·口径＝起跑→汇总那一行，不含提前退出的那些趟）
  贴帽读数（缺省＝config 里的 testTimeout=30000ms）：6318 条里 0 条用时 ≥ 有效预算 80%｜无显式预算按缺省算 5761 条｜标题非字面量（it.each／插值／拼接，按缺省算）378 条｜预算没落到 0 条｜无｜离帽余量最近：tests/m3c.test.ts·M3c pipeline 哑 sequencer（零 LLM） 未获 15370ms/25000ms=61%；tests/mutate-shards.test.ts·treeProblem 与编排器的前置闸：脏树不许当片用 同一宿主被 5734ms/15000ms=38%；tests/mutate-verify-gates.test.ts·树闸接线：真跑本脚本——主检出拒跑且一个字节都没改过盘，linked 3958ms/15000ms=26%
⚠️ 判卷有红，且两端采到 1 套判卷并行 ⇒ 先排撞窗再查代码（判卷面有写共享 /tmp 的用例，两套并行会互踩出假红；本次读数不是独占跑的）
  逐条日志：/tmp/dsh-head-cert-3cd1e9f
  已回收认证树 .worktrees/head-cert-3cd1e9f（exit=0）
  常驻残留树=1（/Users/ze/Downloads/Cairn/deepseek harness/.worktrees/evo-fix@3cd1e9f）（规则 120：detached ∧ 0 项在飞 ∧ 那一笔已入库 才算残留；带分支的树与隔壁会话正在验的笔都不算）
  本次退出码=1（这是 head-cert 这道门自己的码，不是它跑进去的 test runner 的码）｜红的维：判卷 exit=1、认证门面红 1 道
  汇总已同步落盘（不靠 stdout 的尾）：/tmp/dsh-head-cert-3cd1e9f/summary.txt
```
