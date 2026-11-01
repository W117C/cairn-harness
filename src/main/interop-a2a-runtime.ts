/** 产品级 A2A AgentRuntime：用 `handleAgentRun` 的真实会话/权限/日志装配承载任务线程。
 *
 *  远端 A2A 只允许只读任务；这里拒绝 write 模式，工作区固定，session id 必须是路径安全名。
 *  follow-up 在 run 运行时排队，等当前 run 收束后按 message id 顺序投递。 */

import { randomUUID } from "node:crypto";
import type {
  AgentReceipt,
  AgentRecord,
  AgentRuntime,
  AgentSpawnSpec,
  AgentWaitOptions,
  AgentWaitResult,
} from "../agent/runtime-types";
import { A2A_TASK_ID_PATTERN } from "../interop/a2a";
import type { ClientEventV1, RunHandle } from "../interop/sdk";
import { createProductAgentClientV1, type ProductInteropOptions } from "./interop-host";

interface PendingMessage {
  id: string;
  text: string;
}

interface ThreadState {
  record: AgentRecord;
  fence: string;
  activeRun?: RunHandle;
  activeDone?: Promise<void>;
  pending: PendingMessage[];
  receipts: Map<string, AgentReceipt>;
  closed: boolean;
}

function clone(record: AgentRecord): AgentRecord {
  return { ...record, runIds: [...record.runIds], usage: { ...record.usage } };
}

function receipt(id: string, runId: string | undefined, messageId: string, duplicate = false): AgentReceipt {
  return { ok: true, threadId: id, ...(runId !== undefined ? { runId } : {}), messageId, duplicate };
}

export async function createProductA2ARuntime(opts: ProductInteropOptions): Promise<AgentRuntime> {
  const client = await createProductAgentClientV1({ ...opts, mode: "read-only", unattended: true });
  const threads = new Map<string, ThreadState>();

  const settle = async (thread: ThreadState, timeoutMs: number): Promise<boolean> => {
    if (thread.activeDone === undefined) return true;
    if (timeoutMs <= 0) return false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), timeoutMs);
    });
    const done = thread.activeDone.then(() => true).catch(() => true);
    const result = await Promise.race([done, timeout]);
    if (timer !== undefined) clearTimeout(timer);
    return result;
  };

  const start = async (thread: ThreadState, text: string): Promise<RunHandle> => {
    const run = await client.send({ sessionId: thread.record.id }, { text });
    thread.activeRun = run;
    thread.record.currentRunId = run.runId;
    if (!thread.record.runIds.includes(run.runId)) thread.record.runIds.push(run.runId);
    thread.record.status = "running";
    thread.record.updatedAt = Date.now();
    const done = (async () => {
      try {
        for await (const event of client.stream(run)) {
          if (event.type === "assistant.message") thread.record.summary = event.text;
          else if (event.type === "usage") {
            thread.record.usage.inputTokens += event.inputTokens;
            thread.record.usage.outputTokens += event.outputTokens;
          } else if (event.type === "run.completed") {
            thread.record.status = event.status === "completed" ? "done" : event.status === "cancelled" ? "cancelled" : "failed";
          }
        }
      } catch {
        thread.record.status = "failed";
      } finally {
        thread.activeRun = undefined;
        thread.activeDone = undefined;
        thread.record.updatedAt = Date.now();
        const next = thread.pending.shift();
        if (next !== undefined && !thread.closed) {
          try {
            const nextRun = await start(thread, next.text);
            thread.receipts.set(next.id, receipt(thread.record.id, nextRun.runId, next.id));
          } catch (error) {
            thread.record.status = "failed";
            thread.receipts.set(next.id, {
              ok: false,
              threadId: thread.record.id,
              messageId: next.id,
              duplicate: false,
              reason: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }
    })();
    thread.activeDone = done;
    return run;
  };

  const requireThread = (id: string): ThreadState => {
    const thread = threads.get(id);
    if (!thread) throw new Error("unknown agent thread: " + id);
    return thread;
  };

  return {
    async spawn(spec: AgentSpawnSpec): Promise<AgentRecord> {
      if (spec.mode !== "read") throw new Error("product A2A runtime only accepts read-mode tasks");
      const id = spec.threadId ?? randomUUID();
      if (!A2A_TASK_ID_PATTERN.test(id)) throw new Error("agent thread id must match " + A2A_TASK_ID_PATTERN.source);
      if (threads.has(id)) throw new Error("agent thread already exists: " + id);
      await client.createSession({ workspace: opts.workspace, sessionId: id });
      const fence = spec.fence ?? randomUUID();
      const now = Date.now();
      const record: AgentRecord = {
        id,
        workspace: opts.workspace,
        sessionId: id,
        task: spec.task,
        mode: "read",
        status: "starting",
        runIds: [],
        fence,
        createdAt: now,
        updatedAt: now,
        usage: { inputTokens: 0, outputTokens: 0 },
      };
      const thread: ThreadState = { record, fence, pending: [], receipts: new Map(), closed: false };
      threads.set(id, thread);
      try {
        await start(thread, spec.task);
      } catch (error) {
        threads.delete(id);
        throw error;
      }
      return clone(thread.record);
    },

    async send(id, message): Promise<AgentReceipt> {
      const thread = requireThread(id);
      if (thread.closed) return { ok: false, threadId: id, messageId: message.id, duplicate: false, reason: "thread is closed" };
      const existing = thread.receipts.get(message.id);
      if (existing !== undefined) return { ...existing, duplicate: true };
      if (thread.activeRun !== undefined) {
        thread.pending.push({ id: message.id, text: message.text });
        const queued = receipt(id, thread.activeRun.runId, message.id);
        thread.receipts.set(message.id, queued);
        return queued;
      }
      try {
        const run = await start(thread, message.text);
        const r = receipt(id, run.runId, message.id);
        thread.receipts.set(message.id, r);
        return r;
      } catch (error) {
        return { ok: false, threadId: id, messageId: message.id, duplicate: false, reason: error instanceof Error ? error.message : String(error) };
      }
    },

    async wait(ids: readonly string[], waitOpts: AgentWaitOptions = {}): Promise<AgentWaitResult> {
      const timeoutMs = waitOpts.timeoutMs ?? 120_000;
      const rows: AgentRecord[] = [];
      const timedOut: string[] = [];
      const unknown: string[] = [];
      for (const id of ids) {
        const thread = threads.get(id);
        if (!thread) { unknown.push(id); continue; }
        const settled = await settle(thread, timeoutMs);
        if (!settled) timedOut.push(id);
        rows.push(clone(thread.record));
      }
      return { rows, timedOut, unknown };
    },

    async resume(id, fence): Promise<AgentRecord> {
      const thread = requireThread(id);
      if (thread.fence !== fence) throw new Error("stale fence");
      if (thread.record.status === "running") return clone(thread.record);
      throw new Error("agent run is not resumable");
    },

    async close(id): Promise<AgentReceipt> {
      const thread = threads.get(id);
      if (!thread) return { ok: false, threadId: id, duplicate: false, reason: "unknown agent thread" };
      if (thread.closed) return { ok: true, threadId: id, duplicate: true };
      thread.closed = true;
      thread.pending.length = 0;
      if (thread.activeRun !== undefined) {
        await client.cancel(thread.activeRun).catch(() => undefined);
        await thread.activeDone?.catch(() => undefined);
      }
      thread.record.status = "cancelled";
      thread.record.updatedAt = Date.now();
      return { ok: true, threadId: id, ...(thread.record.currentRunId !== undefined ? { runId: thread.record.currentRunId } : {}), duplicate: false };
    },

    async list(): Promise<AgentRecord[]> {
      return [...threads.values()]
        .map((thread) => clone(thread.record))
        .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id));
    },

    async cancel(ids): Promise<AgentReceipt[]> {
      const out: AgentReceipt[] = [];
      for (const id of ids) {
        const thread = threads.get(id);
        if (!thread) { out.push({ ok: false, threadId: id, duplicate: false, reason: "unknown agent thread" }); continue; }
        if (thread.activeRun === undefined) {
          out.push({ ok: false, threadId: id, duplicate: thread.record.status === "cancelled", reason: "agent is not running" });
          continue;
        }
        const runId = thread.activeRun.runId;
        await client.cancel(thread.activeRun).catch(() => undefined);
        thread.record.status = "cancelled";
        thread.record.updatedAt = Date.now();
        out.push({ ok: true, threadId: id, runId, duplicate: false });
      }
      return out;
    },
  };
}
