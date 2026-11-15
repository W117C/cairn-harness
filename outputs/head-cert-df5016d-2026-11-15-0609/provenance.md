# 认证读数 · rev df5016d
- 生成时刻=2026-11-15-0609（UTC。台账页按本地日期，跨零点时页号与这里差一天，不是写错了）
- 温度＝有别人在跑 ⇒ **时间量不可引用**，只能引用「这一趟慢」；条数与红名仍可用
- 收尾复核=同一笔
- 判据：两端独占＝「起前 0 且跑完 0 且这一趟真跑了全量判卷」；本页引用时间量前先回看这一行

## 认证打出来的读数（原样，未改写）

```text
目标提交：df5016d（--at=HEAD）
checkout exit=0
已核：TREE=df5016d8781f7c70221188b3f57e3a36cea327d3｜判卷四面在飞 0 项
依赖核对：该提交声明 12 项，缺 0 项
  零依赖子仓库 17 个（不需要 node_modules，不计入补齐面）
import 面：7772 条边｜悬空 0（其中存量已豁免 0）
门表：40 道，其中该笔 package.json 没有同名 script 的 0 道
typecheck exit=0（0 报错）

== 认证门面（25 道，名单取自 df5016d）==
  ✅ no-progress-check exit=0 759ms（预算 1100ms）
  ✅ prune-check exit=0 574ms（预算 1100ms）
  ✅ fork-check exit=0 585ms（预算 1100ms）
  ✅ compaction-check exit=0 979ms（预算 1200ms）
  ✅ docs-check exit=0 2669ms（预算 1300ms）
  ✅ memory-check exit=0 1429ms（预算 1300ms）
  ✅ head-import-check exit=0 4998ms（预算 2400ms）
  ✅ autonomy-check exit=0 1594ms（预算 1500ms）
  ✅ sandbox:check exit=0 1358ms（预算 1700ms）
  ✅ security-check exit=0 1467ms（预算 1500ms）
  ✅ provider:check exit=0 429ms（预算 1300ms）
  ✅ routing-check exit=0 947ms（预算 1400ms）
  ✅ model-surface-check exit=0 890ms（预算 1300ms）
  ✅ prefix-churn-check exit=0 1459ms（预算 1500ms）
  ✅ prompt-surface-check exit=0 854ms（预算 1400ms）
  ✅ replay-determinism-check exit=0 661ms（预算 1100ms）
  ✅ cost-per-progress-check exit=0 617ms（预算 1000ms）
  ✅ web-fetch-check exit=0 739ms（预算 1200ms）
  ✅ gym-check exit=0 3953ms（预算 2400ms）
  ✅ gate-check exit=0 3762ms（预算 5400ms）
  ✅ evidence-typecheck-check exit=0 14937ms（预算 5300ms）
  ✅ mutate-needles-check exit=0 29608ms（预算 20000ms）
  ✅ repo-hygiene-check exit=0 1043ms（预算 1200ms）
  ✅ e2e exit=0 3997ms（预算 4000ms）
  ❌ desktop-test exit=1 26108ms（预算 10000ms）
  ⚠️ 超预算（只出声，不判红）：docs-check 2669ms > 名单里的 1300ms
  ⚠️ 超预算（只出声，不判红）：memory-check 1429ms > 名单里的 1300ms
  ⚠️ 超预算（只出声，不判红）：head-import-check 4998ms > 名单里的 2400ms
  ⚠️ 超预算（只出声，不判红）：autonomy-check 1594ms > 名单里的 1500ms
  ⚠️ 超预算（只出声，不判红）：gym-check 3953ms > 名单里的 2400ms
  ⚠️ 超预算（只出声，不判红）：evidence-typecheck-check 14937ms > 名单里的 5300ms
  ⚠️ 超预算（只出声，不判红）：mutate-needles-check 29608ms > 名单里的 20000ms
  ⚠️ 超预算（只出声，不判红）：desktop-test 26108ms > 名单里的 10000ms
  认证门面=25 道（跑到 25）｜❌ 红 1 道｜⚠️ 超预算 8
  ❌ desktop-test exit=1（26108ms）

== 认证汇总 ==
  TREE=df5016d DIRTY_JUDGED=0 依赖完整=是 收尾复核=同一笔 认证树锁=本进程持有（.git/dsh-tool-locks/head-cert-gate-head-cert.lock）
  Test Files 1 failed | 677 passed (678)｜Tests 1 failed | 8154 passed (8155)｜并发=maxWorkers 2｜exit=1（退出码直接取，不接管道）
  并发判卷=起前 1 套／跑完 1 套（撞窗：本仓判卷有读写共享 /tmp 的用例）
  本趟墙钟 520.46s（同一进程 hrtime 实测·口径＝起跑→汇总那一行，不含提前退出的那些趟）
  贴帽读数（缺省＝config 里的 testTimeout=30000ms）：8155 条里 0 条用时 ≥ 有效预算 80%｜无显式预算按缺省算 7323 条｜标题非字面量（it.each／插值／拼接，按缺省算）582 条｜预算没落到 24 条（这一格没量到，不等于 0）｜成因点名：tests/metacognition-policy.test.ts（标题不在那份判卷里）；tests/metacognition-policy.test.ts（标题不在那份判卷里）；tests/metacognition-policy.test.ts（标题不在那份判卷里）｜无｜离帽余量最近：tests/plugin-trust-revocation.test.ts·撤回插件信任后旧执行面立即失效 撤回时关闭在途 MCP 请求，服务端 92ms/200ms=46%；tests/cli-surface.test.ts·cairn CLI：--serve 常驻调度（不需任务描述） --s 8043ms/20000ms=40%；tests/cli-surface.test.ts·cairn CLI：--serve 常驻调度（不需任务描述） --s 8011ms/20000ms=40%
⚠️ 判卷有红，且两端采到 1 套判卷并行 ⇒ 先排撞窗再查代码（判卷面有写共享 /tmp 的用例，两套并行会互踩出假红；本次读数不是独占跑的）
  逐条日志：/tmp/dsh-head-cert-df5016d
  未回收认证树 .worktrees/gate-head-cert：不是本次新建的树（复用来的共享树）⇒ 不收
  常驻残留树=1（/Users/ze/Downloads/Cairn/cairn/.worktrees/gate-mutate-verify@907deda）（规则 120：detached ∧ 0 项在飞 ∧ 那一笔已入库 才算残留；带分支的树与隔壁会话正在验的笔都不算）
  本次退出码=1（这是 head-cert 这道门自己的码，不是它跑进去的 test runner 的码）｜红的维：判卷 exit=1、认证门面红 1 道
  汇总已同步落盘（不靠 stdout 的尾）：/tmp/dsh-head-cert-df5016d/summary.txt
```
