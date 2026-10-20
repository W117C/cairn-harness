# 第 229 页仍开两半的现读事实（2026-09-30）

这两半都写着「属用户裁决」。本页只把**裁决要押在它上面的事实**取到，不替裁决。
取料：`src/agent/context.ts:165-223`、`src/agent/orchestrator.ts:485`、第 229 页 §8。

## ③ 那 9 处自造／派生 callId：拦路的那句「会不会折消息」已有确定答案

现读 `mergeToolResultsById`（`src/agent/context.ts:173-192`）：

- 同一 `tool_call_id` 的多条 `role:"tool"` 并成一条，正文按事件先后 `${prev}\n\n${next}` 拼接（:189），
  **一条不丢**；只有一条 result 时结构逐字不变。
- ⇒ 第 229 页登记的那个前置疑问「同一 callId 的两条拒绝会不会折成一条模型可见消息」答案是**会折，但不丢字**。
  它不构成数据损失风险，只剩一个语义问题：**两次拒绝该不该在同一格出现成一条**。
- 折的动机在注释里（:165-172）：Anthropic 要求每个 `tool_use` **恰好一条** `tool_result`，
  OpenAI 兼容端要求一一对应。所以「同 id 多条」本来就是必须收的形，不是可选优化。

现读 `demoteOrphanToolResults`（:210-223）——**自造 id 今天走的其实是这一支，不是折消息那一支**：

- 合并键只看 `declared`（所有 assistant `tool_calls` 里声明过的 id，:214）。
  `budget-<ts>`／`diff-<agent>`／`wt-cleanup-<agent>`／`merge-<agent>`×4／`pipeline-<…callId>` 这类自造或派生 id
  **从来没有配对的 `tool_call` 声明** ⇒ 判 `!declared.has(id)` 成立 ⇒ 整条降级成 `role:"user"`（:217）。
- 降级还要付一句固定前言 `orphanResultNote`（:197-200）：
  「[harness] 以下回执没有配对的调用声明（callId …）：它是系统补发或派生的，不是你对某一次调用的返回
  ⇒ 别按 tool_result 的语义复述它；要接着做就把它当一条新到的信息读。」
- ⇒ 换成真 callId 的**收益**不是「避免折叠」，而是这两条：回执保持 `tool_result` 语义并挂回模型自己那次调用；
  省掉每次命中那句前言。**代价**才是折叠：若该 callId 另有回执，两正文会并排出现在同一条里。

裁决点因此收窄为一句话：**同一 callId 上「模型看到的拒绝」与「harness 补的合成回执」并列成一条，是否可接受。**

## ② `hold` 不进模型可见投影：五挡散文**各自已经点名自己的挡**，回注买不到信息

现读五处落点的 `output` 原文（`src/agent/orchestrator.ts`）：

| 挡 | 模型可见正文原文（逐字） | 位点 |
| --- | --- | --- |
| `budget` | `spawn_agent: [budget] 会话成本超限（估价 $X ≥ maxBudgetUsd $Y），新 spawn 被拒` | :496（另有 :493-494 落流那份） |
| `concurrency-limit` | `spawn_agent: 并发已达上限（N），不排队——请等现有 worker 收敛或取消后再试` | :515-516 |
| `concurrency-limit`（race 同族出口） | `spawn_agent(race): 并发预算不足（k 候选 + 1 余量 > N），不排队` | :390-391 |
| `cancelled` | `spawn_agent: 主会话已取消（fail-closed，不再派发 worker）`；后环撤销那份 `[harness] 后环 spawn 撤销（主会话已取消）` | :510 / :954-955 |
| `dependency-failed` | `前环 <dep> <st> → 后环标记 failed（reason=dependency_failed，不静默跳过 §2.1）` | :472 |
| `chain-failed` | `[harness] pipeline 整链 failed（各环报告可见）：\n<chainTable>\n原因：<reason>` | :1468-1469 |

⇒ 结论：**读者（模型）从正文就能分辨是哪一挡，五挡没有两挡在散文里长成同一个人。**
`HARNESS_HOLD_PROSE_TOKEN`（`src/events/index.ts:61-67`）是 `triggerDeferredSpawn` 那一侧**由结构列派生散文**的映射，
不是「散文缺信息」的补丁——第 229 页 §3 说的就是这一层：散文与结构只剩一个决策点。
⇒ 因此把 `hold` 再回注成模型可见文本，**新增信息量为零、新增 token 为非零**；
这一列的真读者是下游（额度、按档升级、沉淀、失败轨迹评估），见 `src/events/index.ts:50-56` 那段。
**建议裁否**（不回注），除非要裁的另一格「③ 换真 callId」把回执降级成 user 的那一步改掉后，
仍需要在正文里留一个机器可切的记号——那是 ③ 的下游结论，不该反过来替 ② 定方向。

## 顺带一条与本裁决相邻的现读纠偏（别按旧台账开工）

第 229 页说 worker 侧散文落点「未接本列」是**当时**的状态。现读 `src/agent/loop.ts:80-88`＋`:453-460`：
主会话的换路提示 `stuckNudge` 早已存在且**缺省 false**，真理由不是保守而是
「给 `tool_result` 追加文本会打掉 worker 的卡死看门」（`tests/m3c.test.ts` 当场红过）。
⇒ 与「回注结构列」是同一类风险的两种写法：**往模型可见正文里加字，会改掉另一把尺的观察串。**
若将来真要回注，判据必须含「worker 看门仍触发」那一格，不能只测「文本到了」。


## 事实未取到的格（别读成已做）

- **③ 的分母在本检出取不到，而且不能拿 0 代替**（现读于 2026-09-30 05:37）：
  - 真会话事件流这一路：`.agent/sessions/` 实测**空目录**（`find -type f` 计数 0，`du` 0B）⇒
    `scripts/replay/corpus-inventory.ts` 那条「要本地有会话流 `.jsonl`」的前提在这里不成立，尺会退 1 并说明。
  - 剧本这一路我试了，读数与结论都要打括号：`fixtures/**.jsonl` 37 个文件里，
    含 `"tool_result"` 的 **7 个**（哨兵，证明查询本身打得通），
    而 `budget-<数字>`／`diff-*`／`merge-*`／`wt-cleanup-*`／`pipeline-*`／`*-sup<n>`／`*-s<n>` 这些 id 形状命中 **0**
    （`grep -oE … | grep -c ''` ⇒ 打印 `0`、退出码 1）。
    **⇒ 这个 0 不构成「这 9 处不常发」的证据**：fixture 是**给模型的剧本**，
    而那些 id 是 **harness 自己在运行时造并落进事件流的**，剧本里本来就不该有它们——
    这是本仓第 12 次复发那条老坑的形状（**被测量没上场时读数也是 0**）。
  - 「这 9 处会不会发」目前唯一的见证是判卷：`tests/orchestrator-hold.test.ts` 那 15 条里，
    自造／派生 id 的出口在**合成轨迹**中确实被走到（第 229 页 §5 记的落流接线两条走真 `runLoop`）。
    ⇒ 能证的只有「装配存在且打得通」，**不能证**「生产流量里每会话几次」。
- 因此 ③ 的裁决只能押在：**形状成本**（每次命中白付 `orphanResultNote` 那句前言、且丢掉 `tool_result` 语义）
  ＋ **折叠语义**（同一 callId 两条正文并排）。频次一栏写「缺真会话流」，不写 0。
- `context.ts:204-206` 那句旧实测（45 个语料文件投影出 3 条孤儿）**不能拿来当 ③ 的分母**：
  它数的是 `*-sup*`／`*-s*` 派生 id，语料早于 `hold` 列，且当时的会话流今天也不在盘上。
- `hold` 落流后 worker 侧与主会话侧各看到什么，未分别量（同一判据在两处代价不同，本仓已吃过三次）。

