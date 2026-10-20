# 认证读数 · rev cd4b921
- 生成时刻=2026-10-04-1819（UTC。台账页按本地日期，跨零点时页号与这里差一天，不是写错了）
- 温度＝两端独占 ⇒ **时间量可以引用**（墙钟／门耗时／杀锚用时）
- 收尾复核=同一笔
- 判据：两端独占＝「起前 0 且跑完 0 且这一趟真跑了全量判卷」；本页引用时间量前先回看这一行

## 认证打出来的读数（原样，未改写）

```text
目标提交：cd4b921（--at=HEAD）
worktree add exit=0
已核：TREE=cd4b9212971c8adc411656b46401a1ef31a1b36d｜判卷四面在飞 0 项
cp -al node_modules exit=0
依赖核对：该提交声明 10 项，缺 0 项
  硬链接子仓库依赖 apps/desktop/node_modules ← 主树 exit=0
  零依赖子仓库 16 个（不需要 node_modules，不计入补齐面）
import 面：3691 条边｜悬空 0（其中存量已豁免 0）
门表：33 道，其中该笔 package.json 没有同名 script 的 0 道
typecheck exit=2：
  tests/goal-evidence-attribution.test.ts(26,4): error TS2322: Type '{ agent_id?: string | undefined; type: "verify_result"; callId: string; auto: true; ok: boolean; results: never[]; }' is not assignable to type 'AgentEvent'.
    Type '{ agent_id?: string | undefined; type: "verify_result"; callId: string; auto: true; ok: boolean; results: never[]; }' is not assignable to type 'VerifyResultEvent & { ts?: number | undefined; }'.
      Type '{ agent_id?: string | undefined; type: "verify_result"; callId: string; auto: true; ok: boolean; results: never[]; }' is missing the following properties from type 'VerifyResultEvent': attempt, maxAttempts
  [typecheck] 报错文件归因：HEAD 内 1／在飞改动中的 tracked 0／未跟踪草稿 0／工作树状态取不到 0（四档相加＝1，与分母 1 不等就是归因坏了）

== 认证门面（23 道，名单取自 cd4b921）==
  ✅ no-progress-check exit=0 315ms（预算 1100ms）
  ✅ prune-check exit=0 324ms（预算 1100ms）
  ✅ fork-check exit=0 321ms（预算 1100ms）
  ✅ compaction-check exit=0 405ms（预算 1200ms）
  ✅ docs-check exit=0 678ms（预算 1300ms）
  ✅ memory-check exit=0 463ms（预算 1300ms）
  ✅ head-import-check exit=0 1522ms（预算 2400ms）
  ✅ autonomy-check exit=0 672ms（预算 1500ms）
  ✅ sandbox:check exit=0 1378ms（预算 1700ms）
  ✅ security-check exit=0 546ms（预算 1500ms）
  ✅ provider:check exit=0 321ms（预算 1300ms）
  ✅ routing-check exit=0 461ms（预算 1400ms）
  ✅ model-surface-check exit=0 472ms（预算 1300ms）
  ✅ prefix-churn-check exit=0 583ms（预算 1500ms）
  ✅ prompt-surface-check exit=0 312ms（预算 1400ms）
  ✅ replay-determinism-check exit=0 351ms（预算 1100ms）
  ✅ cost-per-progress-check exit=0 294ms（预算 1000ms）
  ✅ web-fetch-check exit=0 301ms（预算 1200ms）
  ✅ gym-check exit=0 1041ms（预算 2400ms）
  ✅ gate-check exit=0 2607ms（预算 5400ms）
  ✅ evidence-typecheck-check exit=0 3344ms（预算 5300ms）
  ✅ mutate-needles-check exit=0 14478ms（预算 20000ms）
  ✅ repo-hygiene-check exit=0 298ms（预算 1200ms）
  认证门面=23 道（跑到 23）｜绿 23 道｜⚠️ 超预算 0

== 认证汇总 ==
  TREE=cd4b921 DIRTY_JUDGED=0 依赖完整=是 收尾复核=同一笔 认证树锁=本进程持有（.git/dsh-tool-locks/head-cert-head-cert-cd4b921.lock）
  Test Files 3 failed | 321 passed (324)｜Tests 4 failed | 4552 passed (4556)｜exit=1（退出码直接取，不接管道）
  并发判卷=起前 0 套／跑完 0 套（两端独占）
  本趟墙钟 223.51s（同一进程 hrtime 实测·口径＝起跑→汇总那一行，不含提前退出的那些趟）
  贴帽读数（缺省＝config 里的 testTimeout=30000ms）：4556 条里 0 条用时 ≥ 有效预算 80%｜无显式预算按缺省算 4229 条｜标题非字面量（it.each／插值／拼接，按缺省算）178 条｜预算没落到 0 条｜无｜离帽余量最近：tests/m3c.test.ts·M3c pipeline 哑 sequencer（零 LLM） 未获 15169ms/25000ms=61%；tests/evidence-typecheck.test.ts·门那一半：runner 的两个拒绝分支各自要出声 拼错的开关 ⇒ 退 3164ms/15000ms=21%；tests/evidence-typecheck.test.ts·门那一半：runner 的两个拒绝分支各自要出声 归属面取料那一行必 2700ms/15000ms=18%
  逐条日志：/tmp/dsh-head-cert-cd4b921
  已回收认证树 .worktrees/head-cert-cd4b921（exit=0）
  常驻残留树=1（/Users/ze/Downloads/Cairn/deepseek harness/.worktrees/verify-mutate-5pins@cd4b921）（规则 120：detached ∧ 0 项在飞 ∧ 那一笔已入库 才算残留；带分支的树与隔壁会话正在验的笔都不算）
  汇总已同步落盘（不靠 stdout 的尾）：/tmp/dsh-head-cert-cd4b921/summary.txt
```
