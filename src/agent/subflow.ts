import type { AgentEvent } from "../events";

/** worker 归属判据（第 946 页）：事件带**非空** `agent_id` 才算 worker 子流。
 *  空串算「没有 id」＝主会话——`agent_id: ""` 不是标识符，把空串当 worker 会让这条事件
 *  三个面三种算法（见下）。
 *
 *  这条判据此前在六处各写一遍，其中两处漏了 `!== ""`：
 *   · `agent/context.ts#hasWorkerAttribution`（=== ""）
 *   · `agent/acceptance-sampler.ts#isWorkerSubflow`（=== ""，注释里明确警告过不一致的后果）
 *   · `main/usage-ledger.ts#isWorkerSubflow`（**漏**——空串被当 worker，用量少算一条）
 *   · `renderer/derived/session.ts#isWorkerSubflowEvent`（**漏**——空串事件从主流里消失）
 *   · `scripts/replay/run-scorecard.ts#splitStreams`（=== ""）
 *  同一个「agent_id 为空」的事件被一把尺当 worker、另一把当主会话，两个读数就再也对不上。
 */
export function hasWorkerId(e: AgentEvent): e is AgentEvent & { agent_id: string } {
  const id = (e as { agent_id?: unknown }).agent_id;
  return typeof id === "string" && id !== "";
}

/** 子流判据（带 `agent_spawned` 例外）：`agent_spawned` 是**父流事实**（「派出了哪个 worker」），
 *  即使它带 agent_id 也属于主会话的流水账。 */
export function isWorkerSubflowEvent(e: AgentEvent): boolean {
  return e.type !== "agent_spawned" && hasWorkerId(e);
}
