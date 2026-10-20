# 认证读数 · rev 18692fb
- 生成时刻=2026-10-03-2239（UTC。台账页按本地日期，跨零点时页号与这里差一天，不是写错了）
- 温度＝有别人在跑 ⇒ **时间量不可引用**，只能引用「这一趟慢」；条数与红名仍可用
- 收尾复核=同一笔
- 判据：两端独占＝「起前 0 且跑完 0 且这一趟真跑了全量判卷」；本页引用时间量前先回看这一行

## 认证打出来的读数（原样，未改写）

```text
目标提交：18692fb（--at=HEAD）
checkout exit=0
已核：TREE=18692fbadcb60a0d35d8d40689188877a29bf702｜判卷四面在飞 0 项
依赖核对：该提交声明 10 项，缺 0 项
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
⚠️ 这些靶子仓库的依赖补不齐：fixtures/bench/bench-bugfix-async、fixtures/bench/bench-bugfix-crossfile、fixtures/bench/bench-bugfix-pagination、fixtures/bench/bench-feature-csv、fixtures/bench/bench-feature-export、fixtures/bench/bench-feature-flag、fixtures/bench/bench-feature-memo、fixtures/bench/bench-long-chain-32、fixtures/bench/bench-long-chain-48、fixtures/bench/bench-long-horizon、fixtures/bench/bench-long-horizon-30、fixtures/bench/bench-refactor-callsite、fixtures/bench/bench-refactor-dedupe、fixtures/bench/bench-refactor-rename、fixtures/bench/bench-refactor-signature ⇒ 在其中真跑命令的判卷红**不可归因于代码**
import 面：3482 条边｜悬空 0（其中存量已豁免 0）
门表：32 道，其中该笔 package.json 没有同名 script 的 0 道
typecheck exit=0（0 报错）

== 认证门面（22 道，名单取自 18692fb）==
  ✅ no-progress-check exit=0 296ms（预算 1100ms）
  ✅ prune-check exit=0 340ms（预算 1100ms）
  ✅ fork-check exit=0 348ms（预算 1100ms）
  ✅ compaction-check exit=0 424ms（预算 1200ms）
  ✅ docs-check exit=0 897ms（预算 1300ms）
  ✅ memory-check exit=0 496ms（预算 1300ms）
  ✅ head-import-check exit=0 1533ms（预算 2400ms）
  ✅ autonomy-check exit=0 690ms（预算 1500ms）
  ✅ sandbox:check exit=0 669ms（预算 1700ms）
  ✅ security-check exit=0 564ms（预算 1500ms）
  ✅ provider:check exit=0 338ms（预算 1300ms）
  ✅ routing-check exit=0 481ms（预算 1400ms）
  ✅ model-surface-check exit=0 494ms（预算 1300ms）
  ✅ prefix-churn-check exit=0 617ms（预算 1500ms）
  ✅ prompt-surface-check exit=0 330ms（预算 1400ms）
  ✅ replay-determinism-check exit=0 340ms（预算 1100ms）
  ✅ cost-per-progress-check exit=0 294ms（预算 1000ms）
  ✅ web-fetch-check exit=0 315ms（预算 1200ms）
  ✅ gym-check exit=0 1130ms（预算 2400ms）
  ✅ gate-check exit=0 2812ms（预算 5400ms）
  ✅ evidence-typecheck-check exit=0 2666ms（预算 5300ms）
  ✅ mutate-needles-check exit=0 14852ms（预算 20000ms）
  认证门面=22 道（跑到 22）｜绿 22 道｜⚠️ 超预算 0

== 认证汇总 ==
  TREE=18692fb DIRTY_JUDGED=0 依赖完整=是 收尾复核=同一笔 认证树锁=本进程持有（.git/dsh-tool-locks/head-cert-gate-head-cert.lock）
  Test Files 2 failed | 291 passed (293)｜Tests 2 failed | 4117 passed (4119)｜exit=1（退出码直接取，不接管道）
  并发判卷=起前 1 套／跑完 0 套（撞窗：本仓判卷有读写共享 /tmp 的用例）
  本趟墙钟 204.44s（同一进程 hrtime 实测·口径＝起跑→汇总那一行，不含提前退出的那些趟）
  贴帽读数（缺省＝config 里的 testTimeout=30000ms）：4119 条里 0 条用时 ≥ 有效预算 80%｜无显式预算按缺省算 3854 条｜标题非字面量（it.each／插值／拼接，按缺省算）116 条｜预算没落到 0 条｜无｜离帽余量最近：tests/m3c.test.ts·M3c pipeline 哑 sequencer（零 LLM） 未获 15189ms/25000ms=61%；tests/evidence-typecheck.test.ts·门那一半：runner 的两个拒绝分支各自要出声 拼错的开关 ⇒ 退 2726ms/15000ms=18%；tests/mutate-shards.test.ts·treeProblem 与编排器的前置闸：脏树不许当片用 同一宿主被 2340ms/15000ms=16%
⚠️ 判卷有红，且两端采到 1 套判卷并行 ⇒ 先排撞窗再查代码（判卷面有写共享 /tmp 的用例，两套并行会互踩出假红；本次读数不是独占跑的）
  逐条日志：/tmp/dsh-head-cert-18692fb
  未回收认证树 .worktrees/gate-head-cert：不是本次新建的树（复用来的共享树）⇒ 不收
  常驻残留树=15（/Users/ze/Downloads/Cairn/deepseek harness/.worktrees/gate-mutate-322@e06b04f、/Users/ze/Downloads/Cairn/deepseek harness/.worktrees/gate-mutate-323@cd4df98、/Users/ze/Downloads/Cairn/deepseek harness/.worktrees/gate-mutate-324@a2b2bb3、/Users/ze/Downloads/Cairn/deepseek harness/.worktrees/gate-mutate-325@98578b3、/Users/ze/Downloads/Cairn/deepseek harness/.worktrees/gate-mutate-326@ebee005、/Users/ze/Downloads/Cairn/deepseek harness/.worktrees/gate-mutate-327@5bdaf78、/Users/ze/Downloads/Cairn/deepseek harness/.worktrees/gate-mutate-328@4254a84、/Users/ze/Downloads/Cairn/deepseek harness/.worktrees/gate-mutate-329@2501848、/Users/ze/Downloads/Cairn/deepseek harness/.worktrees/gate-mutate-330@324e28d、/Users/ze/Downloads/Cairn/deepseek harness/.worktrees/gate-mutate-331@c6a61eb、/Users/ze/Downloads/Cairn/deepseek harness/.worktrees/gate-mutate-332@517ed95、/Users/ze/Downloads/Cairn/deepseek harness/.worktrees/gate-mutate-333@fb2931d、/Users/ze/Downloads/Cairn/deepseek harness/.worktrees/gate-mutate-334@d39f0a1、/Users/ze/Downloads/Cairn/deepseek harness/.worktrees/gate-mutate-verify@fa1c30b、/Users/ze/Downloads/Cairn/deepseek harness/.worktrees/suite-base-330@2abe0f7）（规则 120：detached ∧ 0 项在飞 ∧ 那一笔已入库 才算残留；带分支的树与隔壁会话正在验的笔都不算）
  汇总已同步落盘（不靠 stdout 的尾）：/tmp/dsh-head-cert-18692fb/summary.txt
```
