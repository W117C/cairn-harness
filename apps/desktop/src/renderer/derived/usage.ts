// 派生层·用量面（纯投影）：事件流 → 用量读数。
// I3 契约：只吃 AgentEvent[]，只吐值；不读时钟、不取随机、不做 IO、不留模块级可变态。
import type { AgentEvent } from "../../../../../src/main/ipc-protocol";
import { usageTotals } from "../../../../../src/main/usage-ledger";

/** 累加全部 usage 事件；缺字段当 0（UsageEvent 字段必在，防御旧日志），并给消费方事件计数。
 *  v3（状态条对齐原型 renderStatus）：cacheReadTokens = 各事件缓存读之和（缺席不计，不是 0——
 *  「没量到」不冒充「量到了 0」）；lastInputTokens = 最后一条 usage 的输入（上下文水位≈末轮输入，
 *  累加值会虚高，不能拿来算上下文百分比）。 */
export function usageAggregate(events: readonly AgentEvent[]): {
  inputTokens: number; outputTokens: number; usageCount: number; cacheReadTokens: number; lastInputTokens: number;
} {
  let inputTokens = 0;
  let outputTokens = 0;
  let usageCount = 0;
  let cacheReadTokens = 0;
  let lastInputTokens = 0;
  for (const e of events) {
    if (e.type !== "usage") continue;
    usageCount += 1;
    inputTokens += typeof e.inputTokens === "number" ? e.inputTokens : 0;
    outputTokens += typeof e.outputTokens === "number" ? e.outputTokens : 0;
    if (typeof (e as { cacheReadInputTokens?: unknown }).cacheReadInputTokens === "number") {
      cacheReadTokens += (e as { cacheReadInputTokens: number }).cacheReadInputTokens;
    }
    if (typeof e.inputTokens === "number") lastInputTokens = e.inputTokens;
  }
  return { inputTokens, outputTokens, usageCount, cacheReadTokens, lastInputTokens };
}

/** 用量统计（2026-10-20 批 130 · 头像菜单的「用量统计」面板读它）。
 *  口径与主进程跨会话账本**同源**（`src/main/usage-ledger.ts` 的 `usageTotals`，批 131 收口）——
 *  面板的「当前会话」与「全部会话」不会各算一套、慢慢分叉。
 *  纯函数 ⇒ 可判卷。 */
export interface UsageSummary {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  usageCount: number;
  toolSteps: number;
  rounds: number;
}

export function usageSummary(events: readonly AgentEvent[]): UsageSummary {
  return usageTotals(events);
}
