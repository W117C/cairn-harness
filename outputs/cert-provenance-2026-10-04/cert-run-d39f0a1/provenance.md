# 认证读数 · rev d39f0a1
- 生成时刻=2026-10-03-1639（UTC。台账页按本地日期，跨零点时页号与这里差一天，不是写错了）
- 温度＝两端独占 ⇒ **时间量可以引用**（墙钟／门耗时／杀锚用时）
- 收尾复核=同一笔
- 判据：两端独占＝「起前 0 且跑完 0 且这一趟真跑了全量判卷」；本页引用时间量前先回看这一行

## 认证打出来的读数（原样，未改写）

```text
目标提交：d39f0a1（--at=d39f0a1）
worktree add exit=0
已核：TREE=d39f0a171d89621d1f96c998dff810e33dfd1d06｜判卷四面在飞 0 项
cp -al node_modules exit=0
依赖核对：该提交声明 10 项，缺 0 项
  硬链接子仓库依赖 apps/desktop/node_modules ← 主树 exit=0
  子仓库 fixtures/bench/bench-bugfix-async/node_modules 缺，而主树也没有 ⇒ 这棵树跑不了它里面的命令
  子仓库 fixtures/bench/bench-bugfix-crossfile/node_modules 缺，而主树也没有 ⇒ 这棵树跑不了它里面的命令
  子仓库 fixtures/bench/bench-bugfix-pagination/node_modules 缺，而主树也没有 ⇒ 这棵树跑不了它里面的命令
  子仓库 fixtures/bench/bench-feature-csv/node_modules 缺，而主树也没有 ⇒ 这棵树跑不了它里面的命令
  子仓库 fixtures/bench/bench-feature-export/node_modules 缺，而主树也没有 ⇒ 这棵树跑不了它里面的命令
  子仓库 fixtures/bench/bench-feature-flag/node_modules 缺，而主树也没有 ⇒ 这棵树跑不了它里面的命令
  子仓库 fixtures/bench/bench-feature-memo/node_modules 缺，而主树也没有 ⇒ 这棵树跑不了它里面的命令
  子仓库 fixtures/bench/bench-long-chain-32/node_modules 缺，而主树也没有 ⇒ 这棵树跑不了它里面的命令
  子仓库 fixtures/bench/bench-long-chain-48/node_modules 缺，而主树也没有 ⇒ 这棵树跑不了它里面的命令
  子仓库 fixtures/bench/bench-long-horizon/node_modules 缺，而主树也没有 ⇒ 这棵树跑不了它里面的命令
  子仓库 fixtures/bench/bench-long-horizon-30/node_modules 缺，而主树也没有 ⇒ 这棵树跑不了它里面的命令
  子仓库 fixtures/bench/bench-refactor-callsite/node_modules 缺，而主树也没有 ⇒ 这棵树跑不了它里面的命令
  子仓库 fixtures/bench/bench-refactor-dedupe/node_modules 缺，而主树也没有 ⇒ 这棵树跑不了它里面的命令
  子仓库 fixtures/bench/bench-refactor-rename/node_modules 缺，而主树也没有 ⇒ 这棵树跑不了它里面的命令
  子仓库 fixtures/bench/bench-refactor-signature/node_modules 缺，而主树也没有 ⇒ 这棵树跑不了它里面的命令
  硬链接子仓库依赖 fixtures/todo-app/node_modules ← 主树 exit=0
⚠️ 这些靶子仓库的依赖补不齐：fixtures/bench/bench-bugfix-async、fixtures/bench/bench-bugfix-crossfile、fixtures/bench/bench-bugfix-pagination、fixtures/bench/bench-feature-csv、fixtures/bench/bench-feature-export、fixtures/bench/bench-feature-flag、fixtures/bench/bench-feature-memo、fixtures/bench/bench-long-chain-32、fixtures/bench/bench-long-chain-48、fixtures/bench/bench-long-horizon、fixtures/bench/bench-long-horizon-30、fixtures/bench/bench-refactor-callsite、fixtures/bench/bench-refactor-dedupe、fixtures/bench/bench-refactor-rename、fixtures/bench/bench-refactor-signature ⇒ 在其中真跑命令的判卷红**不可归因于代码**
import 面：3458 条边｜悬空 0（其中存量已豁免 0）
门表：32 道，其中该笔 package.json 没有同名 script 的 0 道
typecheck exit=0（0 报错）

== 认证门面（22 道，名单取自 d39f0a1）==
  ✅ no-progress-check exit=0 320ms（预算 1100ms）
  ✅ prune-check exit=0 377ms（预算 1100ms）
  ✅ fork-check exit=0 364ms（预算 1100ms）
  ✅ compaction-check exit=0 464ms（预算 1200ms）
  ✅ docs-check exit=0 1000ms（预算 1300ms）
  ✅ memory-check exit=0 545ms（预算 1300ms）
  ✅ head-import-check exit=0 1736ms（预算 2400ms）
  ✅ autonomy-check exit=0 849ms（预算 1500ms）
  ✅ sandbox:check exit=0 1674ms（预算 1700ms）
  ✅ security-check exit=0 656ms（预算 1500ms）
  ✅ provider:check exit=0 358ms（预算 1300ms）
  ✅ routing-check exit=0 538ms（预算 1400ms）
  ✅ model-surface-check exit=0 547ms（预算 1300ms）
  ✅ prefix-churn-check exit=0 659ms（预算 1500ms）
  ✅ prompt-surface-check exit=0 363ms（预算 1400ms）
  ✅ replay-determinism-check exit=0 372ms（预算 1100ms）
  ✅ cost-per-progress-check exit=0 341ms（预算 1000ms）
  ✅ web-fetch-check exit=0 388ms（预算 1200ms）
  ✅ gym-check exit=0 1350ms（预算 2400ms）
  ✅ gate-check exit=0 2433ms（预算 5400ms）
  ✅ evidence-typecheck-check exit=0 3055ms（预算 5300ms）
  ✅ mutate-needles-check exit=0 16599ms（预算 20000ms）
  认证门面=22 道（跑到 22）｜绿 22 道｜⚠️ 超预算 0

== 认证汇总 ==
  TREE=d39f0a1 DIRTY_JUDGED=0 依赖完整=是 收尾复核=同一笔 认证树锁=本进程持有（.git/dsh-tool-locks/head-cert-head-cert-d39f0a1.lock）
  Test Files 1 failed | 290 passed (291)｜Tests 1 failed | 4069 passed (4070)｜exit=1（退出码直接取，不接管道）
  并发判卷=起前 0 套／跑完 0 套（两端独占）
  本趟墙钟 243.59s（同一进程 hrtime 实测·口径＝起跑→汇总那一行，不含提前退出的那些趟）
  贴帽读数（缺省＝config 里的 testTimeout=30000ms）：4070 条里 0 条用时 ≥ 有效预算 80%｜无显式预算按缺省算 3805 条｜标题非字面量（it.each／插值／拼接，按缺省算）116 条｜预算没落到 0 条｜无｜离帽余量最近：tests/m3c.test.ts·M3c pipeline 哑 sequencer（零 LLM） 未获 15223ms/25000ms=61%；tests/evidence-typecheck.test.ts·门那一半：runner 的两个拒绝分支各自要出声 拼错的开关 ⇒ 退 3213ms/15000ms=21%；tests/evidence-typecheck.test.ts·门那一半：runner 的两个拒绝分支各自要出声 归属面取料那一行必 2839ms/15000ms=19%
  逐条日志：/tmp/dsh-head-cert-d39f0a1
  已回收认证树 .worktrees/head-cert-d39f0a1（exit=0）
  常驻残留树=16（/Users/ze/Downloads/deepseek harness/.worktrees/gate-head-cert@ebee005、/Users/ze/Downloads/deepseek harness/.worktrees/gate-mutate-322@e06b04f、/Users/ze/Downloads/deepseek harness/.worktrees/gate-mutate-323@cd4df98、/Users/ze/Downloads/deepseek harness/.worktrees/gate-mutate-324@a2b2bb3、/Users/ze/Downloads/deepseek harness/.worktrees/gate-mutate-325@98578b3、/Users/ze/Downloads/deepseek harness/.worktrees/gate-mutate-326@ebee005、/Users/ze/Downloads/deepseek harness/.worktrees/gate-mutate-327@5bdaf78、/Users/ze/Downloads/deepseek harness/.worktrees/gate-mutate-328@4254a84、/Users/ze/Downloads/deepseek harness/.worktrees/gate-mutate-329@2501848、/Users/ze/Downloads/deepseek harness/.worktrees/gate-mutate-330@324e28d、/Users/ze/Downloads/deepseek harness/.worktrees/gate-mutate-331@c6a61eb、/Users/ze/Downloads/deepseek harness/.worktrees/gate-mutate-332@517ed95、/Users/ze/Downloads/deepseek harness/.worktrees/gate-mutate-333@fb2931d、/Users/ze/Downloads/deepseek harness/.worktrees/gate-mutate-334@d39f0a1、/Users/ze/Downloads/deepseek harness/.worktrees/gate-mutate-verify@fa1c30b、/Users/ze/Downloads/deepseek harness/.worktrees/suite-base-330@2abe0f7）（规则 120：detached ∧ 0 项在飞 ∧ 那一笔已入库 才算残留；带分支的树与隔壁会话正在验的笔都不算）
  汇总已同步落盘（不靠 stdout 的尾）：/tmp/dsh-head-cert-d39f0a1/summary.txt
```
