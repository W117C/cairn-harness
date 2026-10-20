# 认证读数 · rev fc3ce80
- 生成时刻=2026-10-12-0254（UTC。台账页按本地日期，跨零点时页号与这里差一天，不是写错了）
- 温度＝两端独占 ⇒ **时间量可以引用**（墙钟／门耗时／杀锚用时）
- 收尾复核=同一笔
- 判据：两端独占＝「起前 0 且跑完 0 且这一趟真跑了全量判卷」；本页引用时间量前先回看这一行

## 认证打出来的读数（原样，未改写）

```text
目标提交：fc3ce80（--at=HEAD）
worktree add exit=0
已核：TREE=fc3ce80aff0e5d93da362d2bc7afdcdf5b40be9b｜判卷四面在飞 0 项
cp -al node_modules exit=0
依赖核对：该提交声明 10 项，缺 0 项
  硬链接子仓库依赖 apps/desktop/node_modules ← 主树 exit=0
  零依赖子仓库 17 个（不需要 node_modules，不计入补齐面）
import 面：3915 条边｜悬空 0（其中存量已豁免 0）
门表：33 道，其中该笔 package.json 没有同名 script 的 0 道
typecheck exit=2：
  tests/docs-check.test.ts(914,31): error TS2345: Argument of type '"D-13"' is not assignable to parameter of type '"D-1" | "D-2" | "D-3" | "D-4" | "D-5" | "D-7" | "D-8" | "D-9" | "D-10" | "D-11" | "D-12" | "W"'.
  tests/docs-check.test.ts(916,17): error TS2339: Property 'pageNum' does not exist on type '{ findings: Finding[]; skipped: string[]; waived: number; ledgerChecked: number; cred: { findings: Finding[]; checked: number; unmatched: number; unnamed: number; unnamedPages: string[]; registeredPages: string[]; registeredReadings: number; weak: CredWeakWitness[]; weakUnjudged: number; }; witness: { ...; } | null;...'.
  tests/docs-check.test.ts(916,45): error TS2339: Property 'pageNum' does not exist on type '{ findings: Finding[]; skipped: string[]; waived: number; ledgerChecked: number; cred: { findings: Finding[]; checked: number; unmatched: number; unnamed: number; unnamedPages: string[]; registeredPages: string[]; registeredReadings: number; weak: CredWeakWitness[]; weakUnjudged: number; }; witness: { ...; } | null;...'.
  [typecheck] 报错文件归因：HEAD 内 1／在飞改动中的 tracked 0／未跟踪草稿 0／工作树状态取不到 0（四档相加＝1，与分母 1 不等就是归因坏了）

== 认证门面（23 道，名单取自 fc3ce80）==
  ✅ no-progress-check exit=0 264ms（预算 1100ms）
  ✅ prune-check exit=0 307ms（预算 1100ms）
  ✅ fork-check exit=0 352ms（预算 1100ms）
  ✅ compaction-check exit=0 375ms（预算 1200ms）
  ✅ docs-check exit=0 907ms（预算 1300ms）
  ✅ memory-check exit=0 437ms（预算 1300ms）
  ❌ head-import-check exit=1 1541ms（预算 2400ms）
  ✅ autonomy-check exit=0 544ms（预算 1500ms）
  ✅ sandbox:check exit=0 1362ms（预算 1700ms）
  ✅ security-check exit=0 529ms（预算 1500ms）
  ✅ provider:check exit=0 254ms（预算 1300ms）
  ✅ routing-check exit=0 452ms（预算 1400ms）
  ✅ model-surface-check exit=0 476ms（预算 1300ms）
  ✅ prefix-churn-check exit=0 529ms（预算 1500ms）
  ✅ prompt-surface-check exit=0 327ms（预算 1400ms）
  ✅ replay-determinism-check exit=0 318ms（预算 1100ms）
  ✅ cost-per-progress-check exit=0 258ms（预算 1000ms）
  ✅ web-fetch-check exit=0 312ms（预算 1200ms）
  ✅ gym-check exit=0 1013ms（预算 2400ms）
  ✅ gate-check exit=0 3483ms（预算 5400ms）
  ✅ evidence-typecheck-check exit=0 3199ms（预算 5300ms）
  ✅ mutate-needles-check exit=0 15551ms（预算 20000ms）
  ✅ repo-hygiene-check exit=0 359ms（预算 1200ms）
  认证门面=23 道（跑到 23）｜❌ 红 1 道｜⚠️ 超预算 0
  ❌ head-import-check exit=1（1541ms）

== 认证汇总 ==
  TREE=fc3ce80 DIRTY_JUDGED=0 依赖完整=是 收尾复核=同一笔 认证树锁=本进程持有（.git/dsh-tool-locks/head-cert-gate-head-cert.lock）
  Test Files 4 failed | 344 passed (348)｜Tests 11 failed | 4968 passed (4979)｜exit=1（退出码直接取，不接管道）
  并发判卷=起前 0 套／跑完 0 套（两端独占）
  本趟墙钟 250.00s（同一进程 hrtime 实测·口径＝起跑→汇总那一行，不含提前退出的那些趟）
  贴帽读数（缺省＝config 里的 testTimeout=30000ms）：4979 条里 0 条用时 ≥ 有效预算 80%｜无显式预算按缺省算 4625 条｜标题非字面量（it.each／插值／拼接，按缺省算）195 条｜预算没落到 0 条｜无｜离帽余量最近：tests/m3c.test.ts·M3c pipeline 哑 sequencer（零 LLM） 未获 15194ms/25000ms=61%；tests/evidence-typecheck.test.ts·门那一半：runner 的两个拒绝分支各自要出声 拼错的开关 ⇒ 退 3407ms/15000ms=23%；tests/evidence-typecheck.test.ts·门那一半：runner 的两个拒绝分支各自要出声 归属面取料那一行必 2868ms/15000ms=19%
  逐条日志：/tmp/dsh-head-cert-fc3ce80
  已回收认证树 .worktrees/gate-head-cert（exit=0）
  常驻残留树=1（/Users/ze/Downloads/Cairn/deepseek harness/.worktrees/verify-5691a5c@5691a5c）（规则 120：detached ∧ 0 项在飞 ∧ 那一笔已入库 才算残留；带分支的树与隔壁会话正在验的笔都不算）
  本次退出码=1（这是 head-cert 这道门自己的码，不是它跑进去的 test runner 的码）｜红的维：typecheck 非 0、判卷 exit=1、认证门面红 1 道
  汇总已同步落盘（不靠 stdout 的尾）：/tmp/dsh-head-cert-fc3ce80/summary.txt
```
