import { randomUUID } from "node:crypto";
import type { AgentEvent } from "../events";
import type { SpawnArgs } from "./orchestrator-types";
import { parseSpawnedAgentId } from "./worker-report";
import type { ToolResult } from "../tools/base";
import type {
  AgentReceipt,
  AgentRecord,
  AgentRuntime,
  AgentRuntimeStatus,
  AgentSpawnSpec,
  AgentWaitResult,
} from "./runtime-types";

export interface LocalAgentOrchestrator {
  spawn(args: SpawnArgs, ctx: { callId?: string; threadId?: string; fence?: string }): Promise<ToolResult>;
  followUp(
    agentId: string,
    messageId: string,
    text: string,
    threadId?: string,
    fence?: string,
  ): Promise<{ ok: boolean; duplicate?: boolean; reason?: string }>;
  waitForAgents(ids: readonly string[], timeoutMs: number): Promise<{
    rows: Array<{ agent_id: string; status: string; summary: string }>;
    timedOut: string[];
  }>;
  resumeAgent(agentId: string): boolean;
  cancelAgent(agentId: string): boolean;
  appendProtocol(event: AgentEvent): Promise<void>;
}

interface ThreadState {
  record: AgentRecord;
  spawnSpec: AgentSpawnSpec;
  originalTask: string;
  lastSummary: string;
  messageIds: Set<string>;
  receipts: Map<string, AgentReceipt>;
  pending: Map<string, Promise<AgentReceipt>>;
  closedReceipt?: AgentReceipt;
}

function cloneRecord(record: AgentRecord): AgentRecord {
  return {
    ...record,
    runIds: [...record.runIds],
    usage: { ...record.usage },
  };
}

function runtimeStatus(value: string): AgentRuntimeStatus {
  if (value === "done" || value === "failed" || value === "cancelled") return value;
  if (value === "waiting_approval" || value === "waiting_input") return "waiting";
  if (value === "running") return "running";
  return "starting";
}

export function createLocalAgentRuntime(driver: LocalAgentOrchestrator): AgentRuntime {
  const threads = new Map<string, ThreadState>();

  const startRun = async (
    state: ThreadState,
    task: string,
    fence?: string,
  ): Promise<string> => {
    const result = await driver.spawn({
      mode: state.record.mode,
      task,
      ...(state.spawnSpec.role ? { role: state.spawnSpec.role } : {}),
      ...(state.spawnSpec.model ? { model: state.spawnSpec.model } : {}),
      ...(state.spawnSpec.maxTurns !== undefined ? { max_turns: state.spawnSpec.maxTurns } : {}),
      ...(state.spawnSpec.resources ? { resources: state.spawnSpec.resources } : {}),
    }, {
      threadId: state.record.id,
      ...(fence !== undefined ? { fence } : {}),
    });
    if (!result.ok) throw new Error(result.output);
    const runId = parseSpawnedAgentId(result.output);
    if (runId === undefined) throw new Error("local agent spawn returned no agent_id: " + result.output);
    if (!state.record.runIds.includes(runId)) state.record.runIds.push(runId);
    state.record.currentRunId = runId;
    state.record.status = "running";
    if (fence !== undefined) state.record.fence = fence;
    state.record.updatedAt = Date.now();
    return runId;
  };

  const continuationTask = (state: ThreadState, text: string): string => [
    "[thread continuation]",
    "Original task:",
    state.originalTask,
    "",
    "Previous result:",
    state.lastSummary || "(none)",
    "",
    "Follow-up:",
    text,
  ].join("\n");

  const runSend = async (state: ThreadState, message: { id: string; text: string }, fence?: string): Promise<AgentReceipt> => {
    const existing = state.receipts.get(message.id);
    if (existing !== undefined) return { ...existing, duplicate: true };
    if (fence !== undefined && state.record.fence !== undefined && fence !== state.record.fence) {
      return { ok: false, threadId: state.record.id, messageId: message.id, duplicate: false, reason: "stale fence" };
    }

    const active = state.record.status === "running" || state.record.status === "waiting";
    if (active && state.record.currentRunId !== undefined) {
      const delivered = await driver.followUp(
        state.record.currentRunId,
        message.id,
        message.text,
        state.record.id,
        fence ?? state.record.fence,
      );
      if (delivered.ok) {
        state.messageIds.add(message.id);
        state.record.updatedAt = Date.now();
        const receipt: AgentReceipt = {
          ok: true,
          threadId: state.record.id,
          runId: state.record.currentRunId,
          messageId: message.id,
          duplicate: delivered.duplicate === true,
        };
        state.receipts.set(message.id, receipt);
        return receipt;
      }
      if (state.record.status === "running" || state.record.status === "waiting") {
        return {
          ok: false,
          threadId: state.record.id,
          runId: state.record.currentRunId,
          messageId: message.id,
          duplicate: false,
          reason: delivered.reason ?? "follow-up delivery failed",
        };
      }
    }

    const runId = await startRun(state, continuationTask(state, message.text), fence ?? randomUUID());
    state.messageIds.add(message.id);
    const receipt: AgentReceipt = {
      ok: true,
      threadId: state.record.id,
      runId,
      messageId: message.id,
      duplicate: false,
    };
    state.receipts.set(message.id, receipt);
    return receipt;
  };

  return {
    async spawn(spec: AgentSpawnSpec): Promise<AgentRecord> {
      const id = spec.threadId ?? randomUUID();
      if (threads.has(id)) throw new Error("agent thread already exists: " + id);
      const now = Date.now();
      const state: ThreadState = {
        record: {
          id,
          workspace: "",
          sessionId: "",
          task: spec.task,
          mode: spec.mode,
          ...(spec.role ? { role: spec.role } : {}),
          status: "starting",
          runIds: [],
          ...(spec.fence ? { fence: spec.fence } : {}),
          createdAt: now,
          updatedAt: now,
          usage: { inputTokens: 0, outputTokens: 0 },
        },
        spawnSpec: spec,
        originalTask: spec.task,
        lastSummary: "",
        messageIds: new Set(),
        receipts: new Map(),
        pending: new Map(),
      };
      threads.set(id, state);
      try {
        await startRun(state, spec.task, spec.fence ?? randomUUID());
      } catch (error) {
        threads.delete(id);
        throw error;
      }
      return cloneRecord(state.record);
    },

    async send(id, message, fence): Promise<AgentReceipt> {
      const state = threads.get(id);
      if (!state) return { ok: false, threadId: id, messageId: message.id, duplicate: false, reason: "unknown agent thread" };
      const pending = state.pending.get(message.id);
      if (pending !== undefined) return { ...await pending, duplicate: true };
      const task = runSend(state, message, fence);
      state.pending.set(message.id, task);
      try {
        return await task;
      } finally {
        state.pending.delete(message.id);
      }
    },

    async wait(ids, opts = {}): Promise<AgentWaitResult> {
      const unknown = ids.filter((id) => !threads.has(id));
      const known = ids.filter((id) => threads.has(id));
      const runIds = [...new Set(known.map((id) => threads.get(id)!.record.currentRunId).filter((id): id is string => id !== undefined))];
      if (runIds.length === 0) {
        return { rows: known.map((id) => cloneRecord(threads.get(id)!.record)), timedOut: [], unknown };
      }
      const joined = await driver.waitForAgents(runIds, opts.timeoutMs ?? 120_000);
      for (const row of joined.rows) {
        const state = [...threads.values()].find((candidate) => candidate.record.currentRunId === row.agent_id);
        if (state) {
          state.record.status = runtimeStatus(row.status);
          state.record.updatedAt = Date.now();
          if (row.summary !== "") {
            state.lastSummary = row.summary;
            state.record.summary = row.summary;
          }
        }
      }
      return {
        rows: known.map((id) => cloneRecord(threads.get(id)!.record)),
        timedOut: joined.timedOut,
        unknown,
      };
    },

    async resume(id, fence): Promise<AgentRecord> {
      const state = threads.get(id);
      if (!state) throw new Error("unknown agent thread: " + id);
      if (!state.record.currentRunId) throw new Error("agent thread has no resumable run");
      if (state.record.fence !== fence) throw new Error("stale fence");
      if (!driver.resumeAgent(state.record.currentRunId)) throw new Error("agent run is not resumable");
      state.record.status = "running";
      state.record.updatedAt = Date.now();
      return cloneRecord(state.record);
    },

    async close(id): Promise<AgentReceipt> {
      const state = threads.get(id);
      if (!state) return { ok: false, threadId: id, duplicate: false, reason: "unknown agent thread" };
      if (state.closedReceipt) return { ...state.closedReceipt, duplicate: true };
      const runId = state.record.currentRunId;
      if (runId) {
        driver.cancelAgent(runId);
        const stopped = await driver.waitForAgents([runId], 10_000);
        if (stopped.timedOut.includes(runId)) {
          return { ok: false, threadId: id, runId, duplicate: false, reason: "executor stop was not confirmed" };
        }
        state.record.status = "cancelled";
      }
      state.record.updatedAt = Date.now();
      state.closedReceipt = { ok: true, threadId: id, ...(runId ? { runId } : {}), duplicate: false };
      return state.closedReceipt;
    },

    async list(): Promise<AgentRecord[]> {
      return [...threads.values()]
        .map((state) => cloneRecord(state.record))
        .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id));
    },

    async cancel(ids): Promise<AgentReceipt[]> {
      return ids.map((id) => {
        const state = threads.get(id);
        if (!state) return { ok: false, threadId: id, duplicate: false, reason: "unknown agent thread" };
        const runId = state.record.currentRunId;
        const cancelled = runId !== undefined && driver.cancelAgent(runId);
        if (cancelled) state.record.status = "cancelled";
        return {
          ok: cancelled,
          threadId: id,
          ...(runId ? { runId } : {}),
          duplicate: !cancelled && state.record.status === "cancelled",
          ...(cancelled ? {} : { reason: "agent is not cancellable" }),
        };
      });
    },
  };
}

