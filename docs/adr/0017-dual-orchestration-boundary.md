# ADR 0017：双编排栈划界与跨栈词汇单源

- **状态**：**Accepted**（2026-11-19，业主令「所有的方案都按照最优解来实现，自己设定目标，你所有的方案我都是统一的」统一授权；裁决与落地同日完成）
- **日期**：2026-11-19
- **依据**：2026-11-19 第三遍审计（台账第 1330 页）：主栈 `src/agent/orchestrator*` 与第二编排栈
  `src/orchestration/` 词汇重叠，证据四态联合已逐字双份（`WorkerEvidence` ≡ `EvidenceState`），
  双栈词汇已经开始漂移。

## 背景

本仓有两套编排机器：

- **主栈**（`src/agent/orchestrator.ts` 族）：会话内 worker 派工——spawn/审批/合并/卡死闸，
  消费者 = 工具面 `spawn_agent`、card_action、desktop 团队面。
- **第二栈**（`src/orchestration/`：Plan/FlowTask/TaskPhase/仲裁/local+remote backend）：
  被设计为跨会话的计划流，消费者 = `src/main/orchestration-service.ts` + IPC + renderer
  `derived/orchestration.ts`。两栈互不 import（唯一例外是 events→orchestration 的
  `OrchestrationStamp` 类型边，编译期擦除）。

## 裁决

1. **边界**：主栈管**会话内**派工（一次会话里的 worker 生命周期、审批、合并）；第二栈管
   **跨会话**的计划流（Plan→FlowTask→TaskPhase 的生命周期长于任何一场会话）。
2. **词汇单源规则**：凡跨栈词汇（两栈都要说、且语义必须相同的词），定义收进**零依赖叶子**，
   两栈各自再导出；本地再抄一份联合定义 = 第二事实源，判卷当场红
   （首例落地：证据四态 → `src/events/evidence.ts`；判卷 `tests/orchestration-vocab.test.ts`）。
3. **不合并**：合并两栈是高成本低收益（消费面不同、生命周期不同）。划界 + 词汇单源是最优解：
   词汇不再漂，两栈各自演进互不踩。

## 后果

- `src/events/evidence.ts`（零依赖叶子）成为证据四态的唯一定义处；`events/types.ts` 与
  `orchestration/types.ts` 各自再导出（「两条都写」纪律：export…from 不进本地作用域，
  本文件要用就得再写一行 import）。
- 判卷 `tests/orchestration-vocab.test.ts`：联合字面量全仓恰好一处 + 边界面钉住；反向锚点 =
  任何一侧再抄本地定义当场红。
- 后续新增跨栈词汇先问「哪栈拥有定义权」：答案只有两个——叶子（跨栈）或拥有栈（栈内），
  不存在第三种"两边各写一份"的合法形状。
