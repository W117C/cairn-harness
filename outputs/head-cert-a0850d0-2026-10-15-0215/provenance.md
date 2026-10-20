# 认证读数 · rev a0850d0
- 生成时刻=2026-10-15-0215（UTC。台账页按本地日期，跨零点时页号与这里差一天，不是写错了）
- 温度＝两端独占 ⇒ **时间量可以引用**（墙钟／门耗时／杀锚用时）
- 收尾复核=同一笔
- 判据：两端独占＝「起前 0 且跑完 0 且这一趟真跑了全量判卷」；本页引用时间量前先回看这一行

## 认证打出来的读数（原样，未改写）

```text
目标提交：a0850d0（--at=HEAD）
worktree add exit=0
已核：TREE=a0850d09d485d02a3af48160634d55e549b1d359｜判卷四面在飞 0 项
cp -al node_modules exit=0
依赖核对：该提交声明 10 项，缺 0 项
  硬链接子仓库依赖 apps/desktop/node_modules ← 主树 exit=0
  零依赖子仓库 17 个（不需要 node_modules，不计入补齐面）
import 面：4258 条边｜悬空 0（其中存量已豁免 0）
门表：34 道，其中该笔 package.json 没有同名 script 的 0 道
typecheck exit=0（0 报错）

== 认证门面（25 道，名单取自 a0850d0）==
  ✅ no-progress-check exit=0 283ms（预算 1100ms）
  ✅ prune-check exit=0 315ms（预算 1100ms）
  ✅ fork-check exit=0 280ms（预算 1100ms）
  ✅ compaction-check exit=0 392ms（预算 1200ms）
  ✅ docs-check exit=0 1025ms（预算 1300ms）
  ✅ memory-check exit=0 466ms（预算 1300ms）
  ✅ head-import-check exit=0 1483ms（预算 2400ms）
  ✅ autonomy-check exit=0 569ms（预算 1500ms）
  ✅ sandbox:check exit=0 653ms（预算 1700ms）
  ✅ security-check exit=0 558ms（预算 1500ms）
  ✅ provider:check exit=0 282ms（预算 1300ms）
  ✅ routing-check exit=0 460ms（预算 1400ms）
  ✅ model-surface-check exit=0 504ms（预算 1300ms）
  ✅ prefix-churn-check exit=0 534ms（预算 1500ms）
  ✅ prompt-surface-check exit=0 347ms（预算 1400ms）
  ✅ replay-determinism-check exit=0 320ms（预算 1100ms）
  ✅ cost-per-progress-check exit=0 282ms（预算 1000ms）
  ✅ web-fetch-check exit=0 338ms（预算 1200ms）
  ✅ gym-check exit=0 1143ms（预算 2400ms）
  ✅ gate-check exit=0 1951ms（预算 5400ms）
  ✅ evidence-typecheck-check exit=0 3162ms（预算 5300ms）
  ✅ mutate-needles-check exit=0 15311ms（预算 20000ms）
  ✅ repo-hygiene-check exit=0 399ms（预算 1200ms）
  ✅ e2e exit=0 3862ms（预算 4000ms）
  ✅ desktop-test exit=0 3570ms（预算 10000ms）
  认证门面=25 道（跑到 25）｜绿 25 道｜⚠️ 超预算 0

== 认证汇总 ==
  TREE=a0850d0 DIRTY_JUDGED=0 依赖完整=是 收尾复核=同一笔 认证树锁=本进程持有（.git/dsh-tool-locks/head-cert-gate-head-cert.lock）
  Test Files 1 failed | 373 passed (374)｜Tests 1 failed | 5334 passed (5335)｜exit=1（退出码直接取，不接管道）
  并发判卷=起前 0 套／跑完 0 套（两端独占）
  本趟墙钟 259.23s（同一进程 hrtime 实测·口径＝起跑→汇总那一行，不含提前退出的那些趟）
  贴帽读数（缺省＝config 里的 testTimeout=30000ms）：5335 条里 0 条用时 ≥ 有效预算 80%｜无显式预算按缺省算 4971 条｜标题非字面量（it.each／插值／拼接，按缺省算）197 条｜预算没落到 0 条｜无｜离帽余量最近：tests/m3c.test.ts·M3c pipeline 哑 sequencer（零 LLM） 未获 15183ms/25000ms=61%；tests/evidence-typecheck.test.ts·门那一半：runner 的两个拒绝分支各自要出声 拼错的开关 ⇒ 退 3252ms/15000ms=22%；tests/mutate-shards.test.ts·treeProblem 与编排器的前置闸：脏树不许当片用 同一宿主被 2977ms/15000ms=20%
  逐条日志：/tmp/dsh-head-cert-a0850d0
  已回收认证树 .worktrees/gate-head-cert（exit=0）
  常驻残留树=5（/Users/ze/Downloads/Cairn/deepseek harness/.worktrees/gate-mutate-verify@a0850d0、/Users/ze/Downloads/Cairn/deepseek harness/.worktrees/gate-mutate-verify-n1@b174bc0、/Users/ze/Downloads/Cairn/deepseek harness/.worktrees/gate-mutate-verify-n2@2715876、/Users/ze/Downloads/Cairn/deepseek harness/.worktrees/gate-mutate-verify-n3@a0850d0、/Users/ze/Downloads/Cairn/deepseek harness/.worktrees/verify-5691a5c@5691a5c）／另有 5 棵不住本仓 scratch 面的残留形树（/private/var/folders/pc/fqvmbm2s2ydc22z1z2frt08m0000gn/T/tmp.fwfU3kppNT/wt、/private/var/folders/pc/fqvmbm2s2ydc22z1z2frt08m0000gn/T/tmp.ogRgmPo3YZ/wt、/private/var/folders/pc/fqvmbm2s2ydc22z1z2frt08m0000gn/T/tmp.Qouqc6GkfW/wt2、/private/var/folders/pc/fqvmbm2s2ydc22z1z2frt08m0000gn/T/tmp.UZzspCHbwo/wt、/private/var/folders/pc/fqvmbm2s2ydc22z1z2frt08m0000gn/T/tmp.VDntPlqjnU/wt3）＝不是本仓建的，别照上面那条回收命令删它们（规则 120：detached ∧ 0 项在飞 ∧ 那一笔已入库 才算残留；带分支的树与隔壁会话正在验的笔都不算）
  本次退出码=1（这是 head-cert 这道门自己的码，不是它跑进去的 test runner 的码）｜红的维：判卷 exit=1
  汇总已同步落盘（不靠 stdout 的尾）：/tmp/dsh-head-cert-a0850d0/summary.txt
```
