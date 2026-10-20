# 认证读数 · rev fc3ce80
- 生成时刻=2026-10-12-0237（UTC。台账页按本地日期，跨零点时页号与这里差一天，不是写错了）
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
  ✅ no-progress-check exit=0 246ms（预算 1100ms）
  ✅ prune-check exit=0 287ms（预算 1100ms）
  ✅ fork-check exit=0 241ms（预算 1100ms）
  ✅ compaction-check exit=0 345ms（预算 1200ms）
  ✅ docs-check exit=0 735ms（预算 1300ms）
  ✅ memory-check exit=0 431ms（预算 1300ms）
  ❌ head-import-check exit=1 1072391ms（预算 2400ms）
  ✅ autonomy-check exit=0 519ms（预算 1500ms）
  ✅ sandbox:check exit=0 1195ms（预算 1700ms）
  ✅ security-check exit=0 934896ms（预算 1500ms）
  ✅ provider:check exit=0 237ms（预算 1300ms）
  ✅ routing-check exit=0 468ms（预算 1400ms）
  ✅ model-surface-check exit=0 438ms（预算 1300ms）
  ✅ prefix-churn-check exit=0 502ms（预算 1500ms）
  ✅ prompt-surface-check exit=0 303ms（预算 1400ms）
  ✅ replay-determinism-check exit=0 285ms（预算 1100ms）
  ✅ cost-per-progress-check exit=0 242ms（预算 1000ms）
  ✅ web-fetch-check exit=0 294ms（预算 1200ms）
  ✅ gym-check exit=0 983ms（预算 2400ms）
  ✅ gate-check exit=0 2104ms（预算 5400ms）
  ✅ evidence-typecheck-check exit=0 1020048ms（预算 5300ms）
  ❌ mutate-needles-check exit=124 1895349ms（预算 20000ms）
  ✅ repo-hygiene-check exit=0 345ms（预算 1200ms）
  ⚠️ 超预算（只出声，不判红）：head-import-check 1072391ms > 名单里的 2400ms
  ⚠️ 超预算（只出声，不判红）：security-check 934896ms > 名单里的 1500ms
  ⚠️ 超预算（只出声，不判红）：evidence-typecheck-check 1020048ms > 名单里的 5300ms
  ⚠️ 超预算（只出声，不判红）：mutate-needles-check 1895349ms > 名单里的 20000ms
  认证门面=23 道（跑到 23）｜❌ 红 2 道｜⚠️ 超预算 4
  ❌ head-import-check exit=1（1072391ms）
  ❌ mutate-needles-check exit=124（1895349ms）

== 认证汇总 ==
  TREE=fc3ce80 DIRTY_JUDGED=0 依赖完整=是 收尾复核=同一笔 认证树锁=本进程持有（.git/dsh-tool-locks/head-cert-gate-head-cert.lock）
  Test Files 19 failed | 329 passed (348)｜Tests 30 failed | 4930 passed | 19 skipped (4979)｜exit=1（退出码直接取，不接管道）
  并发判卷=起前 0 套／跑完 0 套（两端独占）
  本趟墙钟 25140.65s（同一进程 hrtime 实测·口径＝起跑→汇总那一行，不含提前退出的那些趟）
  贴帽读数（缺省＝config 里的 testTimeout=30000ms）：4979 条里 8 条用时 ≥ 有效预算 80%｜无显式预算按缺省算 4625 条｜标题非字面量（it.each／插值／拼接，按缺省算）195 条｜预算没落到 0 条：tests/mutate-shards.test.ts·treeProblem 与编排器的前置闸：脏树不许当片用 同一宿主被 973179ms/15000ms=6488%；tests/evidence-typecheck.test.ts·真环境：这一格得在真仓里跑得出东西（规则 237/320） 真仓那一 808386ms/15000ms=5389%；tests/chain-lease-held.test.ts·链的环 worker 真持有申报的写租约 约束的另一侧：环活着时，另 1014021ms/20000ms=5070%；tests/m3c.test.ts·M3c pipeline 哑 sequencer（零 LLM） 未获 900294ms/25000ms=3601%；tests/cli-surface.test.ts·cairn CLI：默认档位是 fail-closed 的那一档 支 1068204ms/30000ms=3561%；tests/prose-needle-scan.test.ts·影子池：登记表的引用与用例表的输入都不算生产者 唯一副本就在登记表里 1021876ms/30000ms=3406%；tests/gate-kill.test.ts·门禁跑命令的超时支路 超时后子进程以退出码 0 收场：仍是 124， 993329ms/30000ms=3311%；tests/head-import-face.test.ts·真表自证：这把尺不许是空载的，也不许对事故那笔失明 HEAD 现读： 940536ms/30000ms=3135%
  逐条日志：/tmp/dsh-head-cert-fc3ce80
  已回收认证树 .worktrees/gate-head-cert（exit=0）
  常驻残留树=1（/Users/ze/Downloads/Cairn/deepseek harness/.worktrees/verify-5691a5c@5691a5c）（规则 120：detached ∧ 0 项在飞 ∧ 那一笔已入库 才算残留；带分支的树与隔壁会话正在验的笔都不算）
  本次退出码=1（这是 head-cert 这道门自己的码，不是它跑进去的 test runner 的码）｜红的维：typecheck 非 0、判卷 exit=1、认证门面红 2 道
  汇总已同步落盘（不靠 stdout 的尾）：/tmp/dsh-head-cert-fc3ce80/summary.txt
```
