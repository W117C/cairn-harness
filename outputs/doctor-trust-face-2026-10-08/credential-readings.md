# 第 434 页凭证的取料面（原文照抄，未改写、未摘要）

页里引用的每个时间量都要能在本文件或同那两个 head-cert provenance 目录里逐字找到（D-9 那一格）。

## 1. 干净树派生杀锚（`.worktrees/verify-edf6101`，`node scripts/mutate-verify.mjs --changed-since=040a02b7… --lock-tag=judge-432`）

```text
改动面派生：rev=040a02b7af042bb024fd30410bcbd9c8f8448cf9 → 变更文件 7 个 ⇒ 选中锚点 40/1502 条
[mutate-verify] 本次耗时 50.4s · 跑了 40/40 条 · 未设预算（外层超时会在中途杀我，见 --budget-ms）
成本分母：判卷 spawn 80 次／40 条（每条次数分布 2×40）· 单次中位 第1次 0.4s／第2次 0.4s· 最贵一条 changed-since-list-mode-always-filters 3.0s
全部变异被正确杀死（断言非恒真）
```

复算：在 `3eda888d` 的干净 detached 树里跑
`node scripts/mutate-verify.mjs --changed-since=edf6101b --lock-tag=judge-433`（那一笔只动了文案与判卷形状，派生名单会变小）。

## 2. 认证 `3eda888d`（本笔凭证所认证的那一棵）

```text
  认证门面=23 道（跑到 23）｜绿 23 道｜⚠️ 超预算 0
  Test Files 1 failed | 346 passed (347)｜Tests 1 failed | 4908 passed (4909)｜exit=1（退出码直接取，不接管道）
  并发判卷=起前 0 套／跑完 0 套（两端独占）
  本趟墙钟 266.53s（同一进程 hrtime 实测·口径＝起跑→汇总那一行，不含提前退出的那些趟）
  本次退出码=1（这是 head-cert 这道门自己的码，不是它跑进去的 test runner 的码）｜红的维：判卷 exit=1
  ▶ gate-check …  ✅ gate-check         exit=0  3022ms
  ▶ repo-hygiene-check …  ✅ repo-hygiene-check exit=0  352ms
  ▶ mutate-needles-check …  ✅ mutate-needles-check exit=0  17531ms
  ▶ evidence-typecheck-check …  ✅ evidence-typecheck-check exit=0  3818ms
  已核：TREE=3eda888d7417022f21297589e04370b3fd8e6e61｜判卷四面在飞 0 项
  门表：33 道，其中该笔 package.json 没有同名 script 的 0 道
  typecheck exit=0（0 报错）
```

同趟的机器面（针脚体检在认证里报的那一行）：`[mutate-needles-check] 全部锚点针脚可判定 ✅`。

## 3. 认证 `edf6101b`（第 432 页那一趟，三条红还在的那一趟）

```text
  认证门面=23 道（跑到 23）｜绿 23 道｜⚠️ 超预算 1
  Test Files 3 failed | 344 passed (347)｜Tests 3 failed | 4906 passed (4909)｜exit=1（退出码直接取，不接管道）
  本趟墙钟 281.14s（同一进程 hrtime 实测·口径＝起跑→汇总那一行，不含提前退出的那些趟）
  并发判卷=起前 0 套／跑完 0 套（两端独占）
```

## 4. 条数核对式的取料（两笔认证之间逐文件条数只有一支变了）

```text
逐文件条数之和 旧＝4875 新＝4896
差异文件 1 支：
  tests/doctor.test.ts tests): 14 → 35
```

「旧」＝`/tmp/dsh-head-cert-cd0cbc9/test.log`（第 429 页那一趟），「新」＝`/tmp/dsh-head-cert-3eda888/test.log`。
取料法：对每支 `✓ tests/<名> (N tests)` 汇总行抽 N，按文件名配对后逐支比；红的那支文件不带 `✓` 行，所以两侧之和都不含它
（旧 4875＋那支＝4888 报告口径，新 4896＋那支＝4909）。
