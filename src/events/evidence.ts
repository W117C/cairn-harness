// 证据四态——跨栈词汇的**唯一**定义处（ADR 0017：双编排栈划界与词汇单源）。
//
// 背景：同一个四态联合（verified/failed/stale/absent）在主栈（events/types.ts 的 WorkerEvidence）
// 与第二编排栈（src/orchestration/types.ts 的 EvidenceState）各定义过一份，两栈词汇已经开始漂。
// ADR 0017 裁决：跨栈词汇以**零依赖叶子**为单源，两栈各自再导出，谁都不许再抄第二份定义。
// 放 src/events/ 是因为 WorkerEvidence 的原始契约（W4b「跑过了有没有凭据」）诞生在事件面；
// 它是叶子 ⇒ orchestration → events/evidence 无环（events/types 里那三处 OrchestrationStamp
// 类型边是另一回事，编译期擦除、不在本裁决范围）。
/** W4b 四态：worker 回程那句「跑过了」到底有没有凭据（判据见 AgentResultEvent.artifacts.verified）。 */
export type WorkerEvidence = "verified" | "failed" | "stale" | "absent";
