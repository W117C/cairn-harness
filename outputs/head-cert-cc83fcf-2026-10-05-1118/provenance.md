# 认证读数 · rev cc83fcf
- 生成时刻=2026-10-05-1118（UTC。台账页按本地日期，跨零点时页号与这里差一天，不是写错了）
- 温度＝两端独占 ⇒ **时间量可以引用**（墙钟／门耗时／杀锚用时）
- 收尾复核=同一笔
- 判据：两端独占＝「起前 0 且跑完 0 且这一趟真跑了全量判卷」；本页引用时间量前先回看这一行

## 认证打出来的读数（原样，未改写）

```text
目标提交：cc83fcf（--at=HEAD）
worktree add exit=0
已核：TREE=cc83fcf185f3bb533d245c47c6246db6443c4594｜判卷四面在飞 0 项
cp -al node_modules exit=0
依赖核对：该提交声明 10 项，缺 0 项
  硬链接子仓库依赖 apps/desktop/node_modules ← 主树 exit=0
  零依赖子仓库 16 个（不需要 node_modules，不计入补齐面）
import 面：3804 条边｜悬空 0（其中存量已豁免 0）
门表：33 道，其中该笔 package.json 没有同名 script 的 0 道
typecheck exit=0（0 报错）

== 认证门面（23 道，名单取自 cc83fcf）==
  ✅ no-progress-check exit=0 339ms（预算 1100ms）
  ✅ prune-check exit=0 391ms（预算 1100ms）
  ✅ fork-check exit=0 333ms（预算 1100ms）
  ✅ compaction-check exit=0 472ms（预算 1200ms）
  ❌ docs-check exit=1 948ms（预算 1300ms）
  ✅ memory-check exit=0 552ms（预算 1300ms）
  ✅ head-import-check exit=0 1831ms（预算 2400ms）
  ✅ autonomy-check exit=0 790ms（预算 1500ms）
  ✅ sandbox:check exit=0 1625ms（预算 1700ms）
  ✅ security-check exit=0 657ms（预算 1500ms）
  ✅ provider:check exit=0 340ms（预算 1300ms）
  ✅ routing-check exit=0 568ms（预算 1400ms）
  ✅ model-surface-check exit=0 578ms（预算 1300ms）
  ✅ prefix-churn-check exit=0 685ms（预算 1500ms）
  ✅ prompt-surface-check exit=0 376ms（预算 1400ms）
  ✅ replay-determinism-check exit=0 389ms（预算 1100ms）
  ✅ cost-per-progress-check exit=0 338ms（预算 1000ms）
  ✅ web-fetch-check exit=0 366ms（预算 1200ms）
  ✅ gym-check exit=0 1265ms（预算 2400ms）
  ✅ gate-check exit=0 2983ms（预算 5400ms）
  ✅ evidence-typecheck-check exit=0 3960ms（预算 5300ms）
  ✅ mutate-needles-check exit=0 18466ms（预算 20000ms）
  ✅ repo-hygiene-check exit=0 372ms（预算 1200ms）
  认证门面=23 道（跑到 23）｜❌ 红 1 道｜⚠️ 超预算 0
  ❌ docs-check exit=1（948ms）

== 认证汇总 ==
  TREE=cc83fcf DIRTY_JUDGED=0 依赖完整=是 收尾复核=同一笔 认证树锁=本进程持有（.git/dsh-tool-locks/head-cert-head-cert-cc83fcf.lock）
  Test Files 1 failed | 336 passed (337)｜Tests 1 failed | 4713 passed (4714)｜exit=1（退出码直接取，不接管道）
  并发判卷=起前 0 套／跑完 0 套（两端独占）
  本趟墙钟 268.25s（同一进程 hrtime 实测·口径＝起跑→汇总那一行，不含提前退出的那些趟）
  贴帽读数（缺省＝config 里的 testTimeout=30000ms）：4714 条里 0 条用时 ≥ 有效预算 80%｜无显式预算按缺省算 4379 条｜标题非字面量（it.each／插值／拼接，按缺省算）181 条｜预算没落到 0 条｜无｜离帽余量最近：tests/m3c.test.ts·M3c pipeline 哑 sequencer（零 LLM） 未获 15183ms/25000ms=61%；tests/evidence-typecheck.test.ts·门那一半：runner 的两个拒绝分支各自要出声 拼错的开关 ⇒ 退 4231ms/15000ms=28%；tests/evidence-typecheck.test.ts·门那一半：runner 的两个拒绝分支各自要出声 归属面取料那一行必 3676ms/15000ms=25%
  逐条日志：/tmp/dsh-head-cert-cc83fcf
  已回收认证树 .worktrees/head-cert-cc83fcf（exit=0）
  常驻残留树=0（规则 120：detached ∧ 0 项在飞 ∧ 那一笔已入库 才算残留；带分支的树与隔壁会话正在验的笔都不算）
  汇总已同步落盘（不靠 stdout 的尾）：/tmp/dsh-head-cert-cc83fcf/summary.txt
```
