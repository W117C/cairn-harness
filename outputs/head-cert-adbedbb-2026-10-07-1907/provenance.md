# 认证读数 · rev adbedbb
- 生成时刻=2026-10-07-1907（UTC。台账页按本地日期，跨零点时页号与这里差一天，不是写错了）
- 温度＝两端独占 ⇒ **时间量可以引用**（墙钟／门耗时／杀锚用时）
- 收尾复核=同一笔
- 判据：两端独占＝「起前 0 且跑完 0 且这一趟真跑了全量判卷」；本页引用时间量前先回看这一行

## 认证打出来的读数（原样，未改写）

```text
目标提交：adbedbb（--at=HEAD）
worktree add exit=0
已核：TREE=adbedbbc00651f986549292b219f802a8721f46a｜判卷四面在飞 0 项
cp -al node_modules exit=0
依赖核对：该提交声明 10 项，缺 0 项
  硬链接子仓库依赖 apps/desktop/node_modules ← 主树 exit=0
  零依赖子仓库 16 个（不需要 node_modules，不计入补齐面）
import 面：3882 条边｜悬空 0（其中存量已豁免 0）
门表：33 道，其中该笔 package.json 没有同名 script 的 0 道
typecheck exit=2：
  tests/main-run-routing-bandit.test.ts(212,26): error TS7006: Parameter 's' implicitly has an 'any' type.
  tests/main-run-routing-bandit.test.ts(234,34): error TS7006: Parameter 's' implicitly has an 'any' type.
  tests/main-run-routing-bandit.test.ts(252,48): error TS7006: Parameter 's' implicitly has an 'any' type.
  [typecheck] 报错文件归因：HEAD 内 1／在飞改动中的 tracked 0／未跟踪草稿 0／工作树状态取不到 0（四档相加＝1，与分母 1 不等就是归因坏了）

== 认证门面（23 道，名单取自 adbedbb）==
  ✅ no-progress-check exit=0 275ms（预算 1100ms）
  ✅ prune-check exit=0 315ms（预算 1100ms）
  ✅ fork-check exit=0 274ms（预算 1100ms）
  ✅ compaction-check exit=0 377ms（预算 1200ms）
  ✅ docs-check exit=0 620ms（预算 1300ms）
  ✅ memory-check exit=0 446ms（预算 1300ms）
  ❌ head-import-check exit=1 1499ms（预算 2400ms）
  ✅ autonomy-check exit=0 627ms（预算 1500ms）
  ✅ sandbox:check exit=0 1340ms（预算 1700ms）
  ✅ security-check exit=0 518ms（预算 1500ms）
  ✅ provider:check exit=0 280ms（预算 1300ms）
  ✅ routing-check exit=0 458ms（预算 1400ms）
  ✅ model-surface-check exit=0 454ms（预算 1300ms）
  ✅ prefix-churn-check exit=0 550ms（预算 1500ms）
  ✅ prompt-surface-check exit=0 299ms（预算 1400ms）
  ✅ replay-determinism-check exit=0 314ms（预算 1100ms）
  ✅ cost-per-progress-check exit=0 272ms（预算 1000ms）
  ✅ web-fetch-check exit=0 292ms（预算 1200ms）
  ✅ gym-check exit=0 1014ms（预算 2400ms）
  ✅ gate-check exit=0 2573ms（预算 5400ms）
  ✅ evidence-typecheck-check exit=0 2976ms（预算 5300ms）
  ✅ mutate-needles-check exit=0 14466ms（预算 20000ms）
  ✅ repo-hygiene-check exit=0 294ms（预算 1200ms）
  认证门面=23 道（跑到 23）｜❌ 红 1 道｜⚠️ 超预算 0
  ❌ head-import-check exit=1（1499ms）

== 认证汇总 ==
  TREE=adbedbb DIRTY_JUDGED=0 依赖完整=是 收尾复核=同一笔 认证树锁=本进程持有（.git/dsh-tool-locks/head-cert-head-cert-adbedbb.lock）
  Test Files 3 failed | 342 passed (345)｜Tests 8 failed | 4854 passed (4862)｜exit=1（退出码直接取，不接管道）
  并发判卷=起前 0 套／跑完 0 套（两端独占）
  本趟墙钟 227.78s（同一进程 hrtime 实测·口径＝起跑→汇总那一行，不含提前退出的那些趟）
  贴帽读数（缺省＝config 里的 testTimeout=30000ms）：4862 条里 0 条用时 ≥ 有效预算 80%｜无显式预算按缺省算 4521 条｜标题非字面量（it.each／插值／拼接，按缺省算）181 条｜预算没落到 0 条｜无｜离帽余量最近：tests/m3c.test.ts·M3c pipeline 哑 sequencer（零 LLM） 未获 15174ms/25000ms=61%；tests/evidence-typecheck.test.ts·门那一半：runner 的两个拒绝分支各自要出声 拼错的开关 ⇒ 退 3184ms/15000ms=21%；tests/evidence-typecheck.test.ts·门那一半：runner 的两个拒绝分支各自要出声 归属面取料那一行必 2704ms/15000ms=18%
  逐条日志：/tmp/dsh-head-cert-adbedbb
  已回收认证树 .worktrees/head-cert-adbedbb（exit=0）
  常驻残留树=2（/Users/ze/Downloads/Cairn/deepseek harness/.worktrees/gate-mutate-verify@46cde6b、/Users/ze/Downloads/Cairn/deepseek harness/.worktrees/verify-54df77f8@adbedbb）（规则 120：detached ∧ 0 项在飞 ∧ 那一笔已入库 才算残留；带分支的树与隔壁会话正在验的笔都不算）
  汇总已同步落盘（不靠 stdout 的尾）：/tmp/dsh-head-cert-adbedbb/summary.txt
```
