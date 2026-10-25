// 原始日志的只读分桶。没有 session replay / parent 指针展开，没有价格猜测。
import type { AgentEvent } from "../events";
import type { UsageLedgerActivityPayload, UsageLedgerBucketPayload } from "./ipc-protocol";
import { isMeasuredTokenCount } from "./usage-ledger";

export interface UsageFileAnalytics {
  buckets: UsageLedgerBucketPayload[];
  activity: UsageLedgerActivityPayload[];
}

export interface UsageAnalyticsAccumulator {
  buckets: Map<string, UsageLedgerBucketPayload>;
  activity: Map<string | null, UsageLedgerActivityPayload>;
}

export function emptyUsageAnalytics(): UsageAnalyticsAccumulator {
  return { buckets: new Map(), activity: new Map() };
}

export function usageDayKey(timestamp: unknown): string | null {
  if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) return null;
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return null;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** 一文件一天只计一个活跃会话；worker token 计入，worker 对话/工具不冒充用户轮次。 */
export function foldUsageAnalytics(acc: UsageAnalyticsAccumulator, event: AgentEvent): void {
  const worker = typeof (event as { agent_id?: unknown }).agent_id === "string";
  const isUsage = event.type === "usage";
  const isRound = event.type === "user_message" && !worker;
  const isTool = event.type === "tool_call" && !worker;
  if (!isUsage && !isRound && !isTool) return;
  const day = usageDayKey(event.ts);
  let activity = acc.activity.get(day);
  if (!activity) {
    activity = { day, sessions: 1, rounds: 0, toolSteps: 0 };
    acc.activity.set(day, activity);
  }
  if (isRound) activity.rounds += 1;
  if (isTool) activity.toolSteps += 1;
  if (!isUsage) return;
  const model = typeof event.model === "string" && event.model.trim() !== "" ? event.model.trim() : null;
  const key = JSON.stringify([day, model]);
  let bucket = acc.buckets.get(key);
  if (!bucket) {
    bucket = { day, model, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, usageCount: 0, workerUsageCount: 0, inputMeasured: 0, outputMeasured: 0, cacheReadMeasured: 0 };
    acc.buckets.set(key, bucket);
  }
  bucket.usageCount += 1;
  if (worker) bucket.workerUsageCount += 1;
  if (isMeasuredTokenCount(event.inputTokens)) { bucket.inputTokens += event.inputTokens; bucket.inputMeasured += 1; }
  if (isMeasuredTokenCount(event.outputTokens)) { bucket.outputTokens += event.outputTokens; bucket.outputMeasured += 1; }
  if (isMeasuredTokenCount(event.cacheReadInputTokens)) { bucket.cacheReadTokens += event.cacheReadInputTokens; bucket.cacheReadMeasured += 1; }
}

export function usageAnalyticsSnapshot(acc: UsageAnalyticsAccumulator): UsageFileAnalytics {
  return { buckets: [...acc.buckets.values()].map((row) => ({ ...row })), activity: [...acc.activity.values()].map((row) => ({ ...row })) };
}

export function cloneUsageAnalytics(value: UsageFileAnalytics): UsageFileAnalytics {
  return { buckets: value.buckets.map((row) => ({ ...row })), activity: value.activity.map((row) => ({ ...row })) };
}

/** 跨文件归并：只有日志自己的桶入账，不去展开 session_meta 的 parent。 */
export function mergeUsageAnalytics(acc: UsageAnalyticsAccumulator, value: UsageFileAnalytics): void {
  for (const row of value.buckets) {
    const key = JSON.stringify([row.day, row.model]);
    const previous = acc.buckets.get(key);
    if (!previous) { acc.buckets.set(key, { ...row }); continue; }
    previous.inputTokens += row.inputTokens;
    previous.outputTokens += row.outputTokens;
    previous.cacheReadTokens += row.cacheReadTokens;
    previous.usageCount += row.usageCount;
    previous.workerUsageCount += row.workerUsageCount;
    previous.inputMeasured += row.inputMeasured;
    previous.outputMeasured += row.outputMeasured;
    previous.cacheReadMeasured += row.cacheReadMeasured;
  }
  for (const row of value.activity) {
    const previous = acc.activity.get(row.day);
    if (!previous) { acc.activity.set(row.day, { ...row }); continue; }
    previous.sessions += row.sessions;
    previous.rounds += row.rounds;
    previous.toolSteps += row.toolSteps;
  }
}
