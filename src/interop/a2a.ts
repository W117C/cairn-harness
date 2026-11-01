/** A2A（Agent2Agent）任务桥：把稳定的逻辑 agent 线程投影成 A2A Task。
 *
 *  映射（设计稿 §A2A）：
 *  - task id = 逻辑 agent id（spawn 的 threadId）；
 *  - message id = 幂等键（重复 messageId 返回当前任务，不二次执行）；
 *  - artifact id 由内容哈希派生；
 *  - 状态只映射公开生命周期，不暴露内部投影；
 *  - cancel / resume 携带 protocolVersion + fence，陈旧 fence 拒收。
 *
 *  远端只能交文本：file/data 块一律拒收，因此 A2A 调用方无法选本地文件；
 *  消息正文始终是**数据**，处理器不解析其中的指令。 */

import { createHash, randomUUID } from "node:crypto";
import type { AgentRecord, AgentRuntime } from "../agent/runtime-types";
import { isRecord } from "../is-record";

export const A2A_PROTOCOL_VERSION = "1.0";
export const A2A_MAX_TEXT_CHARS = 100_000;
/** Task id becomes a logical agent/session id; keep it path-safe. */
export const A2A_TASK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

export type A2ATaskState =
  | "submitted"
  | "working"
  | "input-required"
  | "completed"
  | "canceled"
  | "failed"
  | "rejected"
  | "auth-required"
  | "unknown";

export interface A2APart {
  kind: string;
  text?: string;
  file?: unknown;
  data?: unknown;
  [key: string]: unknown;
}

export interface A2AMessage {
  role: "user" | "agent";
  parts: A2APart[];
  messageId: string;
  taskId?: string;
  contextId?: string;
  metadata?: Record<string, unknown>;
}

export interface A2AArtifact {
  artifactId: string;
  parts: A2APart[];
  name?: string;
}

export interface A2ATask {
  id: string;
  contextId: string;
  status: { state: A2ATaskState; timestamp: string; message?: A2AMessage };
  artifacts: A2AArtifact[];
  history: A2AMessage[];
  metadata: Record<string, unknown>;
}

export interface A2AHandler {
  agentCard(): Record<string, unknown>;
  messageSend(params: unknown): Promise<A2ATask>;
  tasksGet(params: unknown): Promise<A2ATask>;
  tasksCancel(params: unknown): Promise<A2ATask>;
  tasksResume(params: unknown): Promise<A2ATask>;
  /** message/stream 的 SSE 事件源；可选能力，缺省时 HTTP 层对该方法显式拒绝。 */
  messageStream?(params: unknown): AsyncIterable<A2AStreamEvent>;
  handle(method: string, params: unknown): Promise<unknown>;
}

/** message/stream 的单个事件：快照式状态更新；`final` 为真后流结束。 */
export interface A2AStreamEvent {
  kind: "status-update";
  taskId: string;
  contextId: string;
  status: A2ATask["status"];
  final: boolean;
}

export class A2AError extends Error {
  code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

interface TaskEntry {
  id: string;
  contextId: string;
  fence: string;
  record: AgentRecord;
  messages: Map<string, A2AMessage>;
  artifacts: Map<string, A2AArtifact>;
}

export interface A2AHandlerOptions {
  runtime: AgentRuntime;
  /** 任务历史的保留条数（含用户与 agent 消息）；缺省 40。 */
  historyLimit?: number;
  now?: () => number;
  /** message/stream 轮询间隔毫秒；缺省 250。 */
  streamPollMs?: number;
  /** message/stream 非终态下的最长等待毫秒，超时按当时快照收流；缺省 60_000。 */
  streamDeadlineMs?: number;
}

function stateOf(status: AgentRecord["status"]): A2ATaskState {
  switch (status) {
    case "starting":
      return "submitted";
    case "running":
      return "working";
    case "waiting":
      return "input-required";
    case "done":
      return "completed";
    case "failed":
      return "failed";
    case "cancelled":
      return "canceled";
    default:
      return "unknown";
  }
}

/** 只接受文本：远端没有声明 file/data 能力，也就不该偷渡本地路径。 */
export function messageText(message: A2AMessage): string {
  if (message.role !== "user") throw new A2AError(-32602, "message.role must be user");
  if (!Array.isArray(message.parts) || message.parts.length === 0) {
    throw new A2AError(-32602, "message.parts must be a non-empty array");
  }
  const texts: string[] = [];
  for (const part of message.parts) {
    if (!isRecord(part) || part.kind !== "text" || typeof part.text !== "string") {
      throw new A2AError(-32002, "unsupported content part; only text is accepted (remote callers cannot select local files)");
    }
    texts.push(part.text);
  }
  const text = texts.join("\n");
  if (text.trim() === "") throw new A2AError(-32602, "message text must be non-empty");
  if (text.length > A2A_MAX_TEXT_CHARS) {
    throw new A2AError(-32602, "message text exceeds " + String(A2A_MAX_TEXT_CHARS) + " characters");
  }
  return text;
}

function requiredProtocol(metadata: unknown): void {
  if (!isRecord(metadata)) throw new A2AError(-32602, "metadata.protocolVersion is required");
  if (metadata.protocolVersion !== A2A_PROTOCOL_VERSION) {
    throw new A2AError(-32000, "unsupported protocol version " + String(metadata.protocolVersion)
      + " (supported: " + A2A_PROTOCOL_VERSION + ")");
  }
}

function requiredFence(metadata: unknown): string {
  if (!isRecord(metadata) || typeof metadata.fence !== "string" || metadata.fence.trim() === "") {
    throw new A2AError(-32602, "metadata.fence is required");
  }
  return metadata.fence;
}

function contentAddress(parts: readonly A2APart[]): string {
  return "sha256:" + createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

/** 流在这些状态收束：进行中的状态继续轮询。 */
const STREAM_TERMINAL_STATES: ReadonlySet<A2ATaskState> = new Set([
  "completed",
  "canceled",
  "failed",
  "rejected",
  "input-required",
  "auth-required",
  "unknown",
]);

export function createA2AHandler(opts: A2AHandlerOptions): A2AHandler {
  const now = opts.now ?? (() => Date.now());
  const historyLimit = Math.max(2, opts.historyLimit ?? 40);
  const streamPollMs = Math.max(1, opts.streamPollMs ?? 250);
  const streamDeadlineMs = Math.max(streamPollMs, opts.streamDeadlineMs ?? 60_000);
  const tasks = new Map<string, TaskEntry>();

  const timestamp = (): string => new Date(now()).toISOString();

  const snapshot = (entry: TaskEntry): A2ATask => {
    const summary = entry.record.summary ?? "";
    if (summary !== "") {
      const parts: A2APart[] = [{ kind: "text", text: summary }];
      const artifactId = contentAddress(parts);
      if (!entry.artifacts.has(artifactId)) {
        entry.artifacts.set(artifactId, { artifactId, parts, name: "agent-summary" });
      }
    }
    return {
      id: entry.id,
      contextId: entry.contextId,
      status: {
        state: stateOf(entry.record.status),
        timestamp: timestamp(),
        ...(summary !== "" ? { message: { role: "agent", parts: [{ kind: "text", text: summary }], messageId: "artifact-" + contentAddress([{ kind: "text", text: summary }]).slice(7, 19) } } : {}),
      },
      artifacts: [...entry.artifacts.values()],
      history: [...entry.messages.values()].slice(-historyLimit),
      metadata: { fence: entry.fence, protocolVersion: A2A_PROTOCOL_VERSION },
    };
  };

  const refresh = async (entry: TaskEntry): Promise<void> => {
    const joined = await opts.runtime.wait([entry.id], { timeoutMs: 0 });
    const row = joined.rows.find((record) => record.id === entry.id);
    if (row !== undefined) entry.record = row;
  };

  const requireTask = (id: string): TaskEntry => {
    const entry = tasks.get(id);
    if (!entry) throw new A2AError(-32001, "unknown task: " + id);
    return entry;
  };

  const sendMessage = async (message: A2AMessage): Promise<A2ATask> => {
    if (!isRecord(message) || typeof message.messageId !== "string" || message.messageId.trim() === "") {
      throw new A2AError(-32602, "message.messageId is required");
    }
    if (message.taskId !== undefined) {
      if (typeof message.taskId !== "string" || !A2A_TASK_ID_PATTERN.test(message.taskId)) {
        throw new A2AError(-32602, "message.taskId must match " + A2A_TASK_ID_PATTERN.source);
      }
    }
    const taskId = typeof message.taskId === "string" && message.taskId.trim() !== "" ? message.taskId : randomUUID();
    const existing = tasks.get(taskId);
    if (existing !== undefined) {
      if (existing.messages.has(message.messageId)) {
        await refresh(existing);
        return snapshot(existing);
      }
      const text = messageText(message);
      const receipt = await opts.runtime.send(taskId, { id: message.messageId, text }, existing.fence);
      if (!receipt.ok) throw new A2AError(-32001, receipt.reason ?? "send failed");
      existing.messages.set(message.messageId, { ...message, taskId });
      await refresh(existing);
      return snapshot(existing);
    }

    const text = messageText(message);
    const contextId = typeof message.contextId === "string" ? message.contextId : randomUUID();
    const fence = randomUUID();
    const record = await opts.runtime.spawn({ threadId: taskId, task: text, mode: "read", fence });
    const entry: TaskEntry = {
      id: taskId,
      contextId,
      fence,
      record,
      messages: new Map([[message.messageId, { ...message, taskId, contextId }]]),
      artifacts: new Map(),
    };
    tasks.set(taskId, entry);
    await refresh(entry);
    return snapshot(entry);
  };

  const delay = (ms: number): Promise<void> => new Promise((resolveDelay) => setTimeout(resolveDelay, ms));

  /** 快照式流：先落消息（幂等），再轮询任务直到终态或 deadline；状态/工件/摘要变化才发事件。 */
  async function* messageStreamGen(params: unknown): AsyncIterable<A2AStreamEvent> {
    if (!isRecord(params) || !isRecord(params.message)) throw new A2AError(-32602, "message/stream requires { message }");
    if (params.metadata !== undefined) requiredProtocol(params.metadata);
    const task = await sendMessage(params.message as unknown as A2AMessage);
    const entry = requireTask(task.id);
    const deadline = now() + streamDeadlineMs;
    let last = "";
    for (;;) {
      const snap = snapshot(entry);
      const sig = JSON.stringify([
        snap.status.state,
        snap.artifacts.length,
        snap.status.message?.parts[0]?.text ?? "",
      ]);
      if (sig !== last) {
        last = sig;
        const final = STREAM_TERMINAL_STATES.has(snap.status.state);
        yield { kind: "status-update", taskId: snap.id, contextId: snap.contextId, status: snap.status, final };
        if (final) return;
      }
      if (now() >= deadline) {
        yield { kind: "status-update", taskId: snap.id, contextId: snap.contextId, status: snap.status, final: true };
        return;
      }
      await delay(streamPollMs);
      await refresh(entry);
    }
  }

  const handler: A2AHandler = {
    agentCard() {
      return {
        protocolVersion: A2A_PROTOCOL_VERSION,
        name: "cairn",
        description: "Cairn agent threads exposed as A2A tasks",
        capabilities: { streaming: true, pushNotifications: false },
        defaultInputModes: ["text/plain"],
        defaultOutputModes: ["text/plain"],
        skills: [],
        security: { localFileSelection: false, bypassApprovals: false },
      };
    },

    async messageSend(params) {
      if (!isRecord(params) || !isRecord(params.message)) throw new A2AError(-32602, "message/send requires { message }");
      if (params.metadata !== undefined) requiredProtocol(params.metadata);
      return sendMessage(params.message as unknown as A2AMessage);
    },

    async tasksGet(params) {
      if (!isRecord(params) || typeof params.id !== "string") throw new A2AError(-32602, "tasks/get requires { id }");
      const entry = requireTask(params.id);
      await refresh(entry);
      return snapshot(entry);
    },

    async tasksCancel(params) {
      if (!isRecord(params) || typeof params.id !== "string") throw new A2AError(-32602, "tasks/cancel requires { id }");
      requiredProtocol(params.metadata);
      const fence = requiredFence(params.metadata);
      const entry = requireTask(params.id);
      if (fence !== entry.fence) throw new A2AError(-32001, "stale fence");
      const [receipt] = await opts.runtime.cancel([entry.id]);
      if (!receipt?.ok && !receipt?.duplicate) throw new A2AError(-32001, receipt?.reason ?? "cancel failed");
      await refresh(entry);
      return snapshot(entry);
    },

    async tasksResume(params) {
      if (!isRecord(params) || typeof params.id !== "string") throw new A2AError(-32602, "tasks/resume requires { id }");
      requiredProtocol(params.metadata);
      const fence = requiredFence(params.metadata);
      const entry = requireTask(params.id);
      if (fence !== entry.fence) throw new A2AError(-32001, "stale fence");
      entry.record = await opts.runtime.resume(entry.id, fence);
      return snapshot(entry);
    },

    messageStream: messageStreamGen,

    async handle(method, params) {
      switch (method) {
        case "agent/card":
          return this.agentCard();
        case "message/send":
          return this.messageSend(params);
        case "tasks/get":
          return this.tasksGet(params);
        case "tasks/cancel":
          return this.tasksCancel(params);
        case "tasks/resume":
          return this.tasksResume(params);
        default:
          throw new A2AError(-32601, "method not found: " + method);
      }
    },
  };
  return handler;
}

export interface A2AJsonRpcRequest {
  jsonrpc?: "2.0";
  id?: string | number;
  method: string;
  params?: unknown;
}

export interface A2AJsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string };
}

export async function dispatchA2ARequest(handler: A2AHandler, request: A2AJsonRpcRequest): Promise<A2AJsonRpcResponse | null> {
  try {
    const result = await handler.handle(request.method, request.params);
    return request.id === undefined ? null : { jsonrpc: "2.0", id: request.id, result };
  } catch (error) {
    if (request.id === undefined) return null;
    const code = error instanceof A2AError ? error.code : -32603;
    const message = error instanceof Error ? error.message : String(error);
    return { jsonrpc: "2.0", id: request.id, error: { code, message } };
  }
}
