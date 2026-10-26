import type { AgentEvent } from "../events";
import type {
  AgentMessage,
  AgentRecord,
  AgentRuntimeStatus,
} from "./runtime-types";

export interface AgentThreadSnapshot {
  threads: AgentRecord[];
  messages: AgentMessage[];
  anomalies: string[];
}

function statusOf(value: string): AgentRuntimeStatus {
  switch (value) {
    case "running": return "running";
    case "waiting_approval":
    case "waiting_input": return "waiting";
    case "done": return "done";
    case "failed": return "failed";
    case "cancelled": return "cancelled";
    default: return "starting";
  }
}

function eventThreadId(event: Extract<AgentEvent, { type: "agent_spawned" | "agent_status" | "agent_message" | "agent_result" }>): string {
  return event.thread_id ?? event.agent_id;
}

function timestamp(event: AgentEvent): number {
  return typeof event.ts === "number" && Number.isFinite(event.ts) ? event.ts : Number.POSITIVE_INFINITY;
}

/**
 * Reconstruct logical agent threads from the event journal. The projector never
 * creates state outside the supplied events and is safe to replay repeatedly.
 */
export function projectAgentThreads(
  events: readonly AgentEvent[],
  workspace: string,
  sessionId: string,
): AgentThreadSnapshot {
  const ordered = events
    .map((event, index) => ({ event, index }))
    .sort((left, right) => timestamp(left.event) - timestamp(right.event) || left.index - right.index);
  const threads = new Map<string, AgentRecord>();
  const runToThread = new Map<string, string>();
  const runStatus = new Map<string, AgentRuntimeStatus>();
  const runFence = new Map<string, string | undefined>();
  const messages = new Map<string, AgentMessage>();
  const anomalies: string[] = [];

  const ensure = (threadId: string, runId: string, ts: number): AgentRecord => {
    let record = threads.get(threadId);
    if (record === undefined) {
      record = {
        id: threadId,
        workspace,
        sessionId,
        task: "",
        mode: "read",
        status: "starting",
        runIds: [],
        createdAt: Number.isFinite(ts) ? ts : 0,
        updatedAt: Number.isFinite(ts) ? ts : 0,
        usage: { inputTokens: 0, outputTokens: 0 },
      };
      threads.set(threadId, record);
    }
    runToThread.set(runId, threadId);
    return record;
  };

  for (const { event, index } of ordered) {
    if (event.type === "agent_spawned") {
      const threadId = eventThreadId(event);
      const record = ensure(threadId, event.agent_id, timestamp(event));
      if (!record.runIds.includes(event.agent_id)) record.runIds.push(event.agent_id);
      record.task = event.task;
      record.mode = event.mode;
      if (event.role !== undefined) record.role = event.role;
      record.currentRunId = event.agent_id;
      record.status = "running";
      if (event.fence !== undefined) record.fence = event.fence;
      runStatus.set(event.agent_id, "running");
      runFence.set(event.agent_id, event.fence);
      record.updatedAt = Math.max(record.updatedAt, Number.isFinite(timestamp(event)) ? timestamp(event) : record.updatedAt);
      continue;
    }

    if (event.type === "agent_status") {
      const threadId = eventThreadId(event);
      const record = ensure(threadId, event.agent_id, timestamp(event));
      const next = statusOf(event.status);
      runStatus.set(event.agent_id, next);
      if (event.fence !== undefined) runFence.set(event.agent_id, event.fence);
      if (record.currentRunId === event.agent_id &&
          (record.fence === undefined || event.fence === undefined || record.fence === event.fence)) {
        record.status = next;
        if (event.fence !== undefined) record.fence = event.fence;
      }
      record.updatedAt = Math.max(record.updatedAt, Number.isFinite(timestamp(event)) ? timestamp(event) : record.updatedAt);
      continue;
    }

    if (event.type === "agent_result") {
      const threadId = eventThreadId(event);
      const record = ensure(threadId, event.agent_id, timestamp(event));
      const next = event.status === "done" ? "done" : "failed";
      runStatus.set(event.agent_id, next);
      if (event.fence !== undefined) runFence.set(event.agent_id, event.fence);
      const current = record.currentRunId === event.agent_id;
      const fenceMatches = record.fence === undefined || event.fence === undefined || record.fence === event.fence;
      if (current && fenceMatches) {
        record.status = next;
        record.summary = event.summary;
      } else if (record.runIds.includes(event.agent_id)) {
        const anomaly = "late-result:" + event.agent_id;
        if (!anomalies.includes(anomaly)) anomalies.push(anomaly);
      }
      record.updatedAt = Math.max(record.updatedAt, Number.isFinite(timestamp(event)) ? timestamp(event) : record.updatedAt);
      continue;
    }

    if (event.type === "agent_message") {
      const threadId = eventThreadId(event);
      ensure(threadId, event.agent_id, timestamp(event));
      const id = event.message_id ?? "legacy:" + String(index);
      const key = threadId + ":" + id;
      if (!messages.has(key)) {
        messages.set(key, {
          id,
          threadId,
          runId: event.agent_id,
          kind: event.kind,
          text: event.text,
          ts: Number.isFinite(timestamp(event)) ? timestamp(event) : 0,
        });
      }
      continue;
    }

    if (event.type === "usage" && event.agent_id !== undefined) {
      const threadId = runToThread.get(event.agent_id);
      const record = threadId === undefined ? undefined : threads.get(threadId);
      if (record !== undefined) {
        record.usage.inputTokens += Math.max(0, event.inputTokens);
        record.usage.outputTokens += Math.max(0, event.outputTokens);
      }
    }
  }

  for (const record of threads.values()) {
    if (record.currentRunId !== undefined) {
      const currentStatus = runStatus.get(record.currentRunId);
      if (currentStatus !== undefined) record.status = currentStatus;
      const currentFence = runFence.get(record.currentRunId);
      if (currentFence !== undefined) record.fence = currentFence;
    }
  }

  return {
    threads: [...threads.values()].sort((left, right) => left.id.localeCompare(right.id)),
    messages: [...messages.values()].sort((left, right) => left.ts - right.ts || left.id.localeCompare(right.id)),
    anomalies,
  };
}

