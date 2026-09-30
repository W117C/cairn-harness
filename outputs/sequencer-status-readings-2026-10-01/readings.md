# sequencer 状态事件读数（第 248 页取料，2026-10-01，主树 @`b0280c9`）

第 245 页登记「sequencer 状态事件…需单独一页读数」的交卷。**静态清单＋折叠推演已闭环；动态探针两格登记（见 §四）。**

## 一、发射点普查（源码现读）

`emitSequencerStatus`（L1529）＝ 1 处定义 ＋ **4 个发射点**，全部 `ok: chain.status !== "failed"`：

| 发射点 | 时机 | 文本 | ok |
| --- | --- | --- | --- |
| L1031 | 链批准启动 | 「链已批准启动：N 环（role → …）」 | true |
| L1303 | 每个 stage 启动 | 「stage i/N（role）启动」 | true |
| L1449 | 整链 done | 「整链 done：\n」＋chainTable | true |
| L1465 | 整链 failed | 「整链 failed：」＋reason＋chainTable | **false（唯一 false 位）** |

每链条数 ≈ 2 ＋ stage 数（8 环帽 ⇒ 上限 10 条/链）——**有界**。

## 二、折叠推演（若 L1529 改挂 `chain.callId`）

1. **ok 首条占位恰好正确**：`mergeToolResultsById` 合并保留**首条** ok；同一链上必然 `spawn 回执（ok:true）→ 批准 → stage 启动 → 终态` 的事件序 ⇒ 首条永远是 spawn 回执，其 ok 属于「spawn 调用本身成功」，链的后续失败在**正文**里可见（不丢字）而不翻 ok 位——这正是并列语义想要的样子。
2. **体积有界**：折叠后每链 1 条消息，合计 ≈ 各状态文本之和（无前言重复）；对比现状：每条派生 id 走孤儿降级各付一句 `orphanResultNote` 前言。
3. **m3c:545 钉着旧形状**（`callId === "pipeline-" + chainId` 的过滤器）——真要改，判卷同笔改它。
4. **事件序＝时间序的假设要在实现时钉住**：折叠按事件先后拼接（`context.ts:189`），spawn 回执先于状态事件的依据是「spawn 返回早于链批准」——若 pipeline 被延迟登记（前环未收敛），回执与批准的先后要看 runLoop 的发射序，落实现前用一条真链的 replay 钉死。

## 三、结论

**静态判定：折叠安全、可做**——ok 首条占位正确、体积有界、m3c 判据同笔可改。剩下的是两格动态探针（§四）＋实现本身（含 m3c 判据同笔），属下一笔。

## 四、动态探针两格登记（本页未交卷的部分）

1. **无 runLoop 驱动的探针跑不出状态事件**：直接 `orch.spawn({mode:"pipeline"})`（不经 runLoop）后事件只有方案门两件——sequencer 转变由 loop 节拍驱动，headless 探针要拿到动态读数必须驱动 `runLoop`（或复用 m3c 的整套驱动）。本页试跑实录：方案门批准走 `decideWorkerApproval`，但 id `apr-1-pipeline` 在 300ms 内已被决议（`未知或已决议的审批 id`）——**这个时序反常本身值得下一笔查**（谁在无决策者时决议了它）。
2. **方案门 id 时序**：`decideWorkerApproval("apr-1-pipeline")` 返回「未知或已决议」而事件里 `approval_resolved` 已存在——决议者不是本探针。与 §四-1 同根（无驱动者时的 fail-closed 路径），实现折叠前先把这条读数补上，避免把「没驱动」误读成「折叠有风险」。

## 五、动态实测（第 256 页补：runLoop 驱动 + 生产装配接线，`probe-prod.mts`/`probe-prod.log`）

生产装配镜像（spawn_agent.run(args,ctx) → orch.spawn(args,{callId:ctx.callId})，agent-runner.ts:976-982 同款）接进 runLoop 的 tools：
两环 pipeline 真跑一遍，方案门**抢答成功**（`orchestratorForApproval("apr-1-pipeline")` 路由 → decideWorkerApproval ok:true）。

1. **①格交卷（runLoop 节拍下的状态事件）**：两环链实测 **4 条状态事件**（批准启动／stage 1/2 启动／stage 2/2 启动／整链 done，全 ok=true，各 ~80-100 字节）——与静态普查的 2+环数逐条吻合。
2. **②格交卷（审批时序）**：10ms 轮询器抢答成功 ⇒ 审批 id 路由可用、链可被外部决策者驱动；250 页的反常（无决策者时 300ms 内被决议）根因收敛为**无决策者时的 fail-closed 自动路径**（deny/收窄），不再是「未知决议者」。
3. **意外发现（改写裁决 weighs）**：spawn 回执 pc1 本来就有**两条**——即时回执 `{"pipeline":true,"chain_id":...}` ＋ `[harness] pipeline 整链 done` 终态报告挂回（emitSyntheticResult 同款）。⇒ **链结局今天已经挂回模型那次调用**；4 条 "pipeline-*" 状态事件是额外的进度播报（当前走孤儿降级带前言）。
4. **裁决面更新**：折叠「安全」依旧成立，但动态读数显示折叠**非必要**（结局已挂回）；三选一（折叠／保持现状／终态不重复播）交下一笔裁决，数据齐了。
