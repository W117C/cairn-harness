/** AgentClientV1：传输中立的 SDK 内核。
 *
 *  设计边界（docs/superpowers/specs/2026-10-27-interop-ecosystem-design.md）：
 *  - 事件是**公开判别联合**，只暴露已文档化的字段；thinking_delta / 原始压缩摘要 /
 *    worker 内部投影一律不出；
 *  - 所有出站字符串过 `redactSecrets`，内部事件原件只进本地日志；
 *  - 能力协商显式：不认识的版本/能力在握手期就被点名，不靠运行期降级猜。
 *
 *  这一层包在既有 `runLoop` 外面，不复制 agent 实现；本地日志与执行语义全部沿原路径。 */

import { randomUUID } from "node:crypto";
import type { AgentEvent } from "../events";
import { redactEventForLog, redactSecrets } from "../events";
import type { EventLog } from "../events/log";
import { runLoop } from "../agent/loop";
import type { PermissionMode } from "../permissions";
import type { LegacyNextProvider, Provider } from "../providers";

export const AGENT_CLIENT_PROTOCOL_VERSION = 1 as const;
export const CLIENT_EVENT_SCHEMA_VERSION = 1 as const;

export const AGENT_CLIENT_CAPABILITIES = [
  "sessions",
  "streaming",
  "tools",
  "usage",
  "compaction",
  "cancel",
  "close",
] as const;
export type ClientCapability = (typeof AGENT_CLIENT_CAPABILITIES)[number];

export interface CapabilityRequest {
  protocolVersion: number;
  capabilities?: readonly string[];
}

export interface CapabilityNegotiation {
  ok: true;
  protocolVersion: typeof AGENT_CLIENT_PROTOCOL_VERSION;
  capabilities: ClientCapability[];
  /** 请求了但本端没有的能力：显式列出，不假装支持。 */
  rejected: string[];
}

export interface CapabilityRejection {
  ok: false;
  error: "unsupported_protocol_version";
  message: string;
  supportedProtocolVersions: readonly number[];
}

/** 客户端声明版本与能力；服务端返回**交集**。未知能力拒收而非静默忽略。 */
export function negotiateCapabilities(request: CapabilityRequest): CapabilityNegotiation | CapabilityRejection {
  if (request.protocolVersion !== AGENT_CLIENT_PROTOCOL_VERSION) {
    return {
      ok: false,
      error: "unsupported_protocol_version",
      message: "unsupported protocol version " + String(request.protocolVersion)
        + " (supported: " + String(AGENT_CLIENT_PROTOCOL_VERSION) + ")",
      supportedProtocolVersions: [AGENT_CLIENT_PROTOCOL_VERSION],
    };
  }
  const requested = new Set(request.capabilities ?? AGENT_CLIENT_CAPABILITIES);
  const capabilities = AGENT_CLIENT_CAPABILITIES.filter((capability) => requested.has(capability));
  const rejected = [...requested].filter((capability) => !(AGENT_CLIENT_CAPABILITIES as readonly string[]).includes(capability));
  return { ok: true, protocolVersion: AGENT_CLIENT_PROTOCOL_VERSION, capabilities, rejected };
}

export interface CreateSessionInput {
  workspace: string;
  sessionId?: string;
  title?: string;
}

export interface SessionHandle {
  sessionId: string;
  workspace: string;
  title?: string;
  protocolVersion: typeof AGENT_CLIENT_PROTOCOL_VERSION;
  capabilities: readonly ClientCapability[];
  createdAt: number;
}

export interface SessionRef {
  sessionId: string;
}

export interface UserInput {
  text: string;
}

export interface RunHandle {
  runId: string;
  sessionId: string;
}

export interface RunRef {
  runId: string;
  sessionId: string;
}

interface ClientEventCommon {
  schemaVersion: typeof CLIENT_EVENT_SCHEMA_VERSION;
  sessionId: string;
  ts: number;
}

/** 公开事件。新增字段只能追加；语义变更必须升 schemaVersion。 */
export type ClientEventV1 =
  | (ClientEventCommon & { type: "run.started"; runId: string })
  | (ClientEventCommon & { type: "assistant.delta"; runId: string; text: string })
  | (ClientEventCommon & { type: "assistant.message"; runId: string; text: string })
  | (ClientEventCommon & { type: "tool.call"; runId: string; callId: string; name: string; args: Record<string, unknown> })
  | (ClientEventCommon & { type: "tool.result"; runId: string; callId: string; ok: boolean; output: string })
  | (ClientEventCommon & { type: "usage"; runId: string; inputTokens: number; outputTokens: number })
  | (ClientEventCommon & { type: "context.compacted"; runId: string; tokensBefore: number; tokensAfter: number })
  | (ClientEventCommon & { type: "run.error"; runId: string; message: string })
  | (ClientEventCommon & { type: "run.completed"; runId: string; status: "completed" | "cancelled" | "failed"; error?: string })
  | { schemaVersion: typeof CLIENT_EVENT_SCHEMA_VERSION; type: "session.closed"; sessionId: string; ts: number };

export interface AgentClientV1 {
  createSession(input: CreateSessionInput): Promise<SessionHandle>;
  send(session: SessionRef, input: UserInput): Promise<RunHandle>;
  stream(run: RunRef, signal?: AbortSignal): AsyncIterable<ClientEventV1>;
  cancel(run: RunRef): Promise<void>;
  close(session: SessionRef): Promise<void>;
}

export interface AgentClientRunContext {
  session: SessionHandle;
  text: string;
  signal: AbortSignal;
  /** Host must emit events before resolving; the SDK maps them to public events.
   *  A runner host is responsible for its own persistence (e.g. `handleAgentRun`). */
  emit: (event: AgentEvent) => void;
}

export interface AgentClientHost {
  /** 每个会话一个 provider（脚本/真模型都由调用方决定）；同一会话的多次 send 共用它。
   *  提供 `run` 时可省略。 */
  createProvider?: (session: SessionHandle) => Provider | LegacyNextProvider;
  /** 本地事件日志；SDK 只 append，不改变既有落盘/脱敏语义。提供 `run` 时可省略。 */
  createLog?: (session: SessionHandle) => EventLog;
  /** 直接执行一轮的宿主（典型：产品 `handleAgentRun`）。给了它就不走内置 `runLoop`。 */
  run?: (ctx: AgentClientRunContext) => Promise<void>;
  /** 宿主注入的工具执行表。**缺省 = 空表 = 任何工具调用都 fail-closed**。
   *  SDK 不能替调用方接上静态 `TOOLS`：那是绕过权限门的一条执行路径。生产宿主必须注入
   *  `gatedTool`/`gatedMcpTool` 包装后的同一张表（或等价的权限网关）。`run` 宿主自行负责。 */
  tools?: () => Record<string, import("../tools").Tool>;
  mode?: PermissionMode;
  maxSteps?: number;
  now?: () => number;
  newSessionId?: () => string;
  newRunId?: () => string;
}

interface RunState {
  runId: string;
  sessionId: string;
  abort: AbortController;
  events: ClientEventV1[];
  status: "running" | "completed" | "cancelled" | "failed";
  waiters: Set<() => void>;
  done: Promise<void>;
}

interface SessionState {
  handle: SessionHandle;
  provider?: Provider | LegacyNextProvider;
  log?: EventLog;
  closed: boolean;
  run: RunState | null;
}

function text(value: string): string {
  return redactSecrets(value).text;
}

/** 把内部事件投影成公开事件。**只认白名单**：thinking / session_meta / agent_* 等一律不出。 */
export function toClientEvents(event: AgentEvent, ctx: { sessionId: string; runId: string; ts: number }): ClientEventV1[] {
  const common = { schemaVersion: CLIENT_EVENT_SCHEMA_VERSION, sessionId: ctx.sessionId, ts: ctx.ts } as const;
  switch (event.type) {
    case "assistant_delta":
      return [{ ...common, type: "assistant.delta", runId: ctx.runId, text: text(event.text) }];
    case "assistant_message":
      return [{ ...common, type: "assistant.message", runId: ctx.runId, text: text(event.content) }];
    case "tool_call":
      return [{
        ...common,
        type: "tool.call",
        runId: ctx.runId,
        callId: event.id,
        name: event.name,
        args: redactEventForLog(event.args) as Record<string, unknown>,
      }];
    case "tool_result":
      return [{ ...common, type: "tool.result", runId: ctx.runId, callId: event.callId, ok: event.ok, output: text(event.output) }];
    case "usage":
      return [{ ...common, type: "usage", runId: ctx.runId, inputTokens: event.inputTokens, outputTokens: event.outputTokens }];
    case "compaction":
      return [{
        ...common,
        type: "context.compacted",
        runId: ctx.runId,
        tokensBefore: event.tokens_before,
        tokensAfter: event.tokens_after,
      }];
    case "error":
      return [{ ...common, type: "run.error", runId: ctx.runId, message: text(event.message) }];
    default:
      return [];
  }
}

function waitForChange(run: RunState, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const wake = (): void => {
      run.waiters.delete(wake);
      signal?.removeEventListener("abort", wake);
      resolve();
    };
    run.waiters.add(wake);
    signal?.addEventListener("abort", wake, { once: true });
  });
}

async function* drain(run: RunState, signal?: AbortSignal): AsyncIterable<ClientEventV1> {
  let cursor = 0;
  for (;;) {
    while (cursor < run.events.length) {
      const event = run.events[cursor]!;
      cursor++;
      yield event;
    }
    if (run.status !== "running" || signal?.aborted === true) return;
    await waitForChange(run, signal);
  }
}

export function createAgentClientV1(host: AgentClientHost): AgentClientV1 {
  const now = host.now ?? (() => Date.now());
  const sessions = new Map<string, SessionState>();
  const runs = new Map<string, RunState>();

  const requireSession = (ref: SessionRef): SessionState => {
    const state = sessions.get(ref.sessionId);
    if (!state) throw new Error("unknown session: " + ref.sessionId);
    if (state.closed) throw new Error("session is closed: " + ref.sessionId);
    return state;
  };

  const finish = (run: RunState, status: "completed" | "cancelled" | "failed", error?: string): void => {
    if (run.status !== "running") return;
    run.status = status;
    run.events.push({
      schemaVersion: CLIENT_EVENT_SCHEMA_VERSION,
      type: "run.completed",
      sessionId: run.sessionId,
      runId: run.runId,
      ts: now(),
      status,
      ...(error !== undefined ? { error: text(error) } : {}),
    });
    for (const wake of [...run.waiters]) wake();
  };

  return {
    async createSession(input) {
      if (typeof input.workspace !== "string" || input.workspace.trim() === "") {
        throw new Error("createSession: workspace must be a non-empty string");
      }
      const sessionId = input.sessionId ?? host.newSessionId?.() ?? randomUUID();
      if (sessions.has(sessionId)) throw new Error("session already exists: " + sessionId);
      const handle: SessionHandle = {
        sessionId,
        workspace: input.workspace,
        ...(input.title !== undefined ? { title: input.title } : {}),
        protocolVersion: AGENT_CLIENT_PROTOCOL_VERSION,
        capabilities: AGENT_CLIENT_CAPABILITIES,
        createdAt: now(),
      };
      const provider = host.run === undefined ? host.createProvider?.(handle) : undefined;
      const log = host.run === undefined ? host.createLog?.(handle) : undefined;
      if (host.run === undefined && (provider === undefined || log === undefined)) {
        throw new Error("AgentClientHost: provide run(), or both createProvider() and createLog()");
      }
      sessions.set(sessionId, { handle, ...(provider !== undefined ? { provider } : {}), ...(log !== undefined ? { log } : {}), closed: false, run: null });
      return { ...handle };
    },

    async send(sessionRef, input) {
      const session = requireSession(sessionRef);
      if (typeof input.text !== "string" || input.text.trim() === "") {
        throw new Error("send: text must be a non-empty string");
      }
      if (session.run !== null && session.run.status === "running") {
        throw new Error("session_busy: " + session.handle.sessionId + " already has a running run " + session.run.runId);
      }
      const runId = host.newRunId?.() ?? randomUUID();
      const abort = new AbortController();
      const run: RunState = {
        runId,
        sessionId: session.handle.sessionId,
        abort,
        events: [],
        status: "running",
        waiters: new Set(),
        done: Promise.resolve(),
      };
      run.events.push({
        schemaVersion: CLIENT_EVENT_SCHEMA_VERSION,
        type: "run.started",
        sessionId: session.handle.sessionId,
        runId,
        ts: now(),
      });
      session.run = run;
      runs.set(runId, run);
      const emit = (event: AgentEvent): void => {
        const mapped = toClientEvents(event, { sessionId: session.handle.sessionId, runId, ts: now() });
        if (mapped.length > 0) {
          run.events.push(...mapped);
          for (const wake of [...run.waiters]) wake();
        }
      };
      const tee: EventLog = {
        async append(event) {
          if (session.log !== undefined) await session.log.append(event);
          emit(event);
        },
      };
      run.done = (async () => {
        try {
          if (host.run !== undefined) {
            await host.run({ session: session.handle, text: input.text, signal: abort.signal, emit });
          } else {
            await runLoop({
              provider: session.provider!,
              events: tee,
              workspace: session.handle.workspace,
              userMessage: input.text,
              tools: host.tools?.() ?? {},
              ...(host.mode !== undefined ? { mode: host.mode } : {}),
              ...(host.maxSteps !== undefined ? { maxSteps: host.maxSteps } : {}),
              signal: abort.signal,
            });
          }
          finish(run, abort.signal.aborted ? "cancelled" : "completed");
        } catch (error) {
          const name = typeof error === "object" && error !== null ? (error as { name?: unknown }).name : undefined;
          const reason = error instanceof Error ? error.message : String(error);
          finish(run, abort.signal.aborted || name === "AbortError" ? "cancelled" : "failed", reason);
        }
      })();
      return { runId, sessionId: session.handle.sessionId };
    },

    stream(runRef, signal) {
      const run = runs.get(runRef.runId);
      if (!run || run.sessionId !== runRef.sessionId) {
        throw new Error("unknown run: " + runRef.runId);
      }
      return drain(run, signal);
    },

    async cancel(runRef) {
      const run = runs.get(runRef.runId);
      if (!run || run.sessionId !== runRef.sessionId) throw new Error("unknown run: " + runRef.runId);
      if (run.status !== "running") return;
      run.abort.abort();
      await run.done;
    },

    async close(sessionRef) {
      const session = sessions.get(sessionRef.sessionId);
      if (!session) return; // 关闭幂等：已关闭/未知会话不制造第二个错误面
      if (session.closed) return;
      if (session.run !== null && session.run.status === "running") {
        session.run.abort.abort();
        await session.run.done;
      }
      session.closed = true;
      session.run = null;
      const closed: ClientEventV1 = {
        schemaVersion: CLIENT_EVENT_SCHEMA_VERSION,
        type: "session.closed",
        sessionId: session.handle.sessionId,
        ts: now(),
      };
      for (const run of runs.values()) {
        if (run.sessionId !== session.handle.sessionId) continue;
        run.events.push(closed);
        for (const wake of [...run.waiters]) wake();
      }
    },
  };
}
