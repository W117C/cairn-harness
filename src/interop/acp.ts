/** ACP（Agent Client Protocol）适配器：把 AgentClientV1 映射到 ACP 的 JSON-RPC 方法面。
 *
 *  只做**映射**，不复制执行：`session/prompt` 直通 SDK 的 send/stream，`session/cancel`
 *  直通 cancel。因此 ACP 与 SDK 对同一脚本 run 产生同一串公开事件。
 *
 *  未声明的能力一律显式拒绝：图片/资源 prompt、未知方法、错误协议版本都返回错误，
 *  不静默降级。 */

import {
  AGENT_CLIENT_PROTOCOL_VERSION,
  negotiateCapabilities,
  type AgentClientV1,
  type ClientEventV1,
  type RunHandle,
} from "./sdk";
import { isRecord } from "../is-record";

export interface AcpContentBlock {
  type: string;
  text?: string;
}

export interface AcpUpdate {
  sessionId: string;
  update: Record<string, unknown>;
}

export interface AcpAdapterOptions {
  client: AgentClientV1;
  /** 发 `session/update` 通知（transport 由调用方决定）。 */
  emit: (method: string, params: unknown) => void | Promise<void>;
}

export interface AcpAdapter {
  initialize(params: unknown): Promise<Record<string, unknown>>;
  newSession(params: unknown): Promise<{ sessionId: string }>;
  prompt(params: unknown): Promise<{ stopReason: string }>;
  cancel(params: unknown): Promise<void>;
  handle(method: string, params: unknown): Promise<unknown>;
}

export interface JsonRpcRequest {
  jsonrpc?: "2.0";
  id?: string | number;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string };
}

export class AcpError extends Error {
  code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

const ACP_PROTOCOL_VERSION = 1;

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new AcpError(-32602, label + " must be a non-empty string");
  return value;
}

/** 只接受文本块：其余类型没有被 `initialize` 声明，不能在 prompt 里偷渡。 */
export function promptText(prompt: unknown): string {
  if (!Array.isArray(prompt) || prompt.length === 0) throw new AcpError(-32602, "prompt must be a non-empty ContentBlock array");
  const parts: string[] = [];
  for (const block of prompt) {
    if (!isRecord(block) || block.type !== "text" || typeof block.text !== "string") {
      throw new AcpError(-32602, "unsupported prompt content block; only text is advertised");
    }
    parts.push(block.text);
  }
  return parts.join("\n");
}

/** ACP 没有 usage / compaction / 内部错误事件的对应面：这些公开事件只留在 SDK 流里。
 *  工具调用与消息走 ACP 的通知形状；`assistant.message` 在已收到 delta 后不再重复上屏。 */
export function toAcpUpdates(event: ClientEventV1, ctx: { sawDelta: boolean }): AcpUpdate[] {
  switch (event.type) {
    case "assistant.delta":
      return [{
        sessionId: event.sessionId,
        update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: event.text } },
      }];
    case "assistant.message":
      if (ctx.sawDelta) return [];
      return [{
        sessionId: event.sessionId,
        update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: event.text } },
      }];
    case "tool.call":
      return [{
        sessionId: event.sessionId,
        update: {
          sessionUpdate: "tool_call",
          toolCallId: event.callId,
          title: event.name,
          kind: "other",
          status: "pending",
          rawInput: event.args,
        },
      }];
    case "tool.result":
      return [{
        sessionId: event.sessionId,
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: event.callId,
          status: event.ok ? "completed" : "failed",
          content: [{ type: "content", content: { type: "text", text: event.output } }],
        },
      }];
    default:
      return [];
  }
}

function stopReasonOf(status: "completed" | "cancelled" | "failed"): string {
  return status === "completed" ? "end_turn" : status === "cancelled" ? "cancelled" : "refusal";
}

export function createAcpAdapter(opts: AcpAdapterOptions): AcpAdapter {
  const runs = new Map<string, RunHandle>();

  const prompt = async (params: unknown): Promise<{ stopReason: string }> => {
    if (!isRecord(params)) throw new AcpError(-32602, "session/prompt params must be an object");
    const sessionId = requiredString(params.sessionId, "sessionId");
    const text = promptText(params.prompt);
    let run: RunHandle;
    try {
      run = await opts.client.send({ sessionId }, { text });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new AcpError(message.startsWith("session_busy") ? -32001 : -32000, message);
    }
    runs.set(sessionId, run);
    let sawDelta = false;
    let stopReason = "end_turn";
    try {
      for await (const event of opts.client.stream(run)) {
        if (event.type === "assistant.delta") sawDelta = true;
        for (const update of toAcpUpdates(event, { sawDelta })) {
          await opts.emit("session/update", update);
        }
        if (event.type === "run.completed") {
          stopReason = stopReasonOf(event.status);
        }
      }
    } finally {
      if (runs.get(sessionId)?.runId === run.runId) runs.delete(sessionId);
    }
    return { stopReason };
  };

  return {
    async initialize(params) {
      if (!isRecord(params)) throw new AcpError(-32602, "initialize params must be an object");
      const requestedVersion = typeof params.protocolVersion === "number" ? params.protocolVersion : ACP_PROTOCOL_VERSION;
      const negotiation = negotiateCapabilities({
        protocolVersion: requestedVersion,
        ...(Array.isArray(params.clientCapabilities)
          ? { capabilities: params.clientCapabilities.filter((c): c is string => typeof c === "string") }
          : {}),
      });
      if (!negotiation.ok) throw new AcpError(-32000, negotiation.message);
      return {
        protocolVersion: AGENT_CLIENT_PROTOCOL_VERSION,
        agentCapabilities: {
          promptCapabilities: { image: false, audio: false, embeddedContext: false },
          loadSession: false,
        },
        agentInfo: { name: "cairn", version: "0.1.0" },
        authMethods: [],
        capabilities: negotiation.capabilities,
        rejectedCapabilities: negotiation.rejected,
      };
    },

    async newSession(params) {
      if (!isRecord(params)) throw new AcpError(-32602, "session/new params must be an object");
      const cwd = requiredString(params.cwd, "cwd");
      const session = await opts.client.createSession({ workspace: cwd });
      return { sessionId: session.sessionId };
    },

    prompt,

    async cancel(params) {
      if (!isRecord(params)) throw new AcpError(-32602, "session/cancel params must be an object");
      const sessionId = requiredString(params.sessionId, "sessionId");
      const run = runs.get(sessionId);
      if (!run) return; // 没有在途 run = 已经是取消后的稳态，幂等
      await opts.client.cancel(run);
    },

    async handle(method, params) {
      switch (method) {
        case "initialize":
          return this.initialize(params);
        case "session/new":
          return this.newSession(params);
        case "session/prompt":
          return prompt(params);
        case "session/cancel":
          await this.cancel(params);
          return {};
        default:
          throw new AcpError(-32601, "method not found: " + method);
      }
    },
  };
}

/** JSON-RPC 分派：通知（无 id）不产生响应。 */
export async function dispatchAcpRequest(adapter: AcpAdapter, request: JsonRpcRequest): Promise<JsonRpcResponse | null> {
  const id = request.id ?? null;
  try {
    const result = await adapter.handle(request.method, request.params);
    return request.id === undefined ? null : { jsonrpc: "2.0", id, result };
  } catch (error) {
    if (request.id === undefined) return null;
    const code = error instanceof AcpError ? error.code : -32603;
    const message = error instanceof Error ? error.message : String(error);
    return { jsonrpc: "2.0", id, error: { code, message } };
  }
}
