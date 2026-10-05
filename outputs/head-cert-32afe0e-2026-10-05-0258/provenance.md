# 认证读数 · rev 32afe0e
- 生成时刻=2026-10-05-0258（UTC。台账页按本地日期，跨零点时页号与这里差一天，不是写错了）
- 温度＝两端独占 ⇒ **时间量可以引用**（墙钟／门耗时／杀锚用时）
- 收尾复核=同一笔
- 判据：两端独占＝「起前 0 且跑完 0 且这一趟真跑了全量判卷」；本页引用时间量前先回看这一行

## 认证打出来的读数（原样，未改写）

```text
目标提交：32afe0e（--at=HEAD）
worktree add exit=0
已核：TREE=32afe0ec70af6b0b4f4c8ba6f0ccce0d42623e7d｜判卷四面在飞 0 项
cp -al node_modules exit=0
依赖核对：该提交声明 10 项，缺 0 项
  硬链接子仓库依赖 apps/desktop/node_modules ← 主树 exit=0
  零依赖子仓库 16 个（不需要 node_modules，不计入补齐面）
import 面：3745 条边｜悬空 0（其中存量已豁免 0）
门表：33 道，其中该笔 package.json 没有同名 script 的 0 道
typecheck exit=2：
  tests/role-field-aliases.test.ts(251,15): error TS2352: Conversion of type 'ResolvedPluginRole' to type 'Record<string, unknown>' may be a mistake because neither type sufficiently overlaps with the other. If this was intentional, convert the expression to 'unknown' first.
    Index signature for type 'string' is missing in type 'ResolvedPluginRole'.
  tests/verify-skipped-third-outcome.test.ts(106,21): error TS7006: Parameter 'messages' implicitly has an 'any' type.
  [typecheck] 报错文件归因：HEAD 内 2／在飞改动中的 tracked 0／未跟踪草稿 0／工作树状态取不到 0（四档相加＝2，与分母 2 不等就是归因坏了）

== 认证门面（23 道，名单取自 32afe0e）==
  ✅ no-progress-check exit=0 385ms（预算 1100ms）
  ✅ prune-check exit=0 447ms（预算 1100ms）
  ✅ fork-check exit=0 440ms（预算 1100ms）
  ✅ compaction-check exit=0 647ms（预算 1200ms）
  ✅ docs-check exit=0 916ms（预算 1300ms）
  ✅ memory-check exit=0 634ms（预算 1300ms）
  ✅ head-import-check exit=0 2224ms（预算 2400ms）
  ✅ autonomy-check exit=0 950ms（预算 1500ms）
  ✅ sandbox:check exit=0 2036ms（预算 1700ms）
  ✅ security-check exit=0 754ms（预算 1500ms）
  ✅ provider:check exit=0 420ms（预算 1300ms）
  ✅ routing-check exit=0 692ms（预算 1400ms）
  ✅ model-surface-check exit=0 657ms（预算 1300ms）
  ✅ prefix-churn-check exit=0 820ms（预算 1500ms）
  ✅ prompt-surface-check exit=0 453ms（预算 1400ms）
  ✅ replay-determinism-check exit=0 429ms（预算 1100ms）
  ✅ cost-per-progress-check exit=0 374ms（预算 1000ms）
  ✅ web-fetch-check exit=0 418ms（预算 1200ms）
  ✅ gym-check exit=0 1425ms（预算 2400ms）
  ✅ gate-check exit=0 3705ms（预算 5400ms）
  ✅ evidence-typecheck-check exit=0 4385ms（预算 5300ms）
  ✅ mutate-needles-check exit=0 19213ms（预算 20000ms）
  ✅ repo-hygiene-check exit=0 390ms（预算 1200ms）
  ⚠️ 超预算（只出声，不判红）：sandbox:check 2036ms > 名单里的 1700ms
  认证门面=23 道（跑到 23）｜绿 23 道｜⚠️ 超预算 1

== 认证汇总 ==
  TREE=32afe0e DIRTY_JUDGED=0 依赖完整=是 收尾复核=同一笔 认证树锁=本进程持有（.git/dsh-tool-locks/head-cert-head-cert-32afe0e.lock）
  Test Files 1 failed | 330 passed (331)｜Tests 2 failed | 4615 passed (4617)｜exit=1（退出码直接取，不接管道）
  并发判卷=起前 0 套／跑完 0 套（两端独占）
  本趟墙钟 315.69s（同一进程 hrtime 实测·口径＝起跑→汇总那一行，不含提前退出的那些趟）
  贴帽读数（缺省＝config 里的 testTimeout=30000ms）：4617 条里 0 条用时 ≥ 有效预算 80%｜无显式预算按缺省算 4290 条｜标题非字面量（it.each／插值／拼接，按缺省算）178 条｜预算没落到 0 条｜无｜离帽余量最近：tests/m3c.test.ts·M3c pipeline 哑 sequencer（零 LLM） 未获 15207ms/25000ms=61%；tests/evidence-typecheck.test.ts·门那一半：runner 的两个拒绝分支各自要出声 拼错的开关 ⇒ 退 5431ms/15000ms=36%；tests/evidence-typecheck.test.ts·真环境：这一格得在真仓里跑得出东西（规则 237/320） 仓内 t 4718ms/15000ms=31%
  逐条日志：/tmp/dsh-head-cert-32afe0e
  已回收认证树 .worktrees/head-cert-32afe0e（exit=0）
  常驻残留树=0（规则 120：detached ∧ 0 项在飞 ∧ 那一笔已入库 才算残留；带分支的树与隔壁会话正在验的笔都不算）
  汇总已同步落盘（不靠 stdout 的尾）：/tmp/dsh-head-cert-32afe0e/summary.txt
```
