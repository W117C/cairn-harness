import { describe, expect, it } from "vitest";
import * as interop from "../src/interop";
import type { ModelOutput, Provider } from "../src/providers";
import type { EventLog } from "../src/events/log";
import type { AgentEvent } from "../src/events";
import type { PermissionMode } from "../src/permissions";
import {
  AGENT_CLIENT_PROTOCOL_VERSION,
  createAgentClientV1,
  negotiateCapabilities,
  toClientEvents,
  type AgentClientHost,
} from "../src/interop/sdk";
import {
  createAcpAdapter,
  dispatchAcpRequest,
  toAcpUpdates,
  type AcpUpdate,
} from "../src/interop/acp";

function scriptedProvider(rounds: ModelOutput[][]): Provider {
  let cursor = 0;
  return {
    async *stream() {
      const round = rounds[cursor] ?? [];
      cursor++;
      yield* round;
    },
  };
}

function memoryLog(): EventLog & { events: AgentEvent[] } {
  const events: AgentEvent[] = [];
  return {
    events,
    async append(event) {
      events.push(event);
    },
  };
}

function host(provider: Provider | ((sessionId: string) => Provider), opts: { maxSteps?: number; mode?: PermissionMode; tools?: AgentClientHost["tools"] } = {}): AgentClientHost & { logs: Map<string, EventLog & { events: AgentEvent[] }> } {
  const logs = new Map<string, EventLog & { events: AgentEvent[] }>();
  return {
    logs,
    createProvider: (session) => typeof provider === "function" ? provider(session.sessionId) : provider,
    createLog: (session) => {
      const log = memoryLog();
      logs.set(session.sessionId, log);
      return log;
    },
    ...(opts.tools !== undefined ? { tools: opts.tools } : {}),
    ...(opts.maxSteps !== undefined ? { maxSteps: opts.maxSteps } : {}),
    ...(opts.mode !== undefined ? { mode: opts.mode } : {}),
  };
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const value of iterable) out.push(value);
  return out;
}

const ROUND_ONE: ModelOutput[] = [
  { type: "assistant_delta", callId: "a1", text: "Hel" },
  { type: "assistant_delta", callId: "a1", text: "lo" },
  { type: "assistant_message", content: "Hello" },
  { type: "usage", inputTokens: 11, outputTokens: 3 },
];

describe("AgentClientV1", () => {
  it("is reachable through the interop barrel", () => {
    expect(interop.AGENT_CLIENT_PROTOCOL_VERSION).toBe(1);
    expect(typeof interop.createAgentClientV1).toBe("function");
    expect(typeof interop.createAcpAdapter).toBe("function");
    expect(typeof interop.createA2AHandler).toBe("function");
    expect(typeof interop.adaptHarborTasks).toBe("function");
  });

  it("negotiates capabilities explicitly and rejects unknown versions", () => {
    expect(negotiateCapabilities({ protocolVersion: AGENT_CLIENT_PROTOCOL_VERSION, capabilities: ["sessions", "teleport"] }))
      .toMatchObject({ ok: true, capabilities: ["sessions"], rejected: ["teleport"] });
    const bad = negotiateCapabilities({ protocolVersion: 99 });
    expect(bad).toMatchObject({ ok: false, error: "unsupported_protocol_version" });
  });

  it("streams a scripted run as public events and keeps the session reusable", async () => {
    const client = createAgentClientV1(host(scriptedProvider([
      ROUND_ONE,
      [{ type: "assistant_message", content: "Second" }],
    ])));
    const session = await client.createSession({ workspace: process.cwd() });
    expect(session.protocolVersion).toBe(1);
    expect(session.capabilities).toContain("streaming");
    const run = await client.send({ sessionId: session.sessionId }, { text: "hi" });
    const events = await collect(client.stream(run));
    expect(events.map((e) => e.type)).toEqual([
      "run.started",
      "assistant.delta",
      "assistant.delta",
      "assistant.message",
      "usage",
      "run.completed",
    ]);
    const completed = events.at(-1);
    expect(completed).toMatchObject({ type: "run.completed", status: "completed" });
    expect(events.filter((e) => e.type === "assistant.delta").map((e) => (e as { text: string }).text).join("")).toBe("Hello");

    const second = await client.send({ sessionId: session.sessionId }, { text: "again" });
    const secondEvents = await collect(client.stream(second));
    expect(secondEvents.filter((e) => e.type === "assistant.message").map((e) => (e as { text: string }).text))
      .toEqual(["Second"]);
    await client.close({ sessionId: session.sessionId });
    await expect(client.send({ sessionId: session.sessionId }, { text: "after close" })).rejects.toThrow(/closed/);
  });

  it("rejects a second send while a run is active", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const provider: Provider = {
      async *stream() {
        await gate;
        yield { type: "assistant_message", content: "done" } as ModelOutput;
      },
    };
    const client = createAgentClientV1(host(provider));
    const session = await client.createSession({ workspace: process.cwd() });
    const run = await client.send({ sessionId: session.sessionId }, { text: "one" });
    await expect(client.send({ sessionId: session.sessionId }, { text: "two" })).rejects.toThrow(/session_busy/);
    release();
    await collect(client.stream(run));
  });

  it("cancels a run through the SDK and reports cancelled, not failed", async () => {
    const provider: Provider = {
      async *stream(_messages, _tools, call) {
        await new Promise<void>((resolve) => {
          if (call?.signal?.aborted === true) resolve();
          else call?.signal?.addEventListener("abort", () => resolve(), { once: true });
        });
      },
    };
    const client = createAgentClientV1(host(provider));
    const session = await client.createSession({ workspace: process.cwd() });
    const run = await client.send({ sessionId: session.sessionId }, { text: "wait" });
    await new Promise((resolve) => setTimeout(resolve, 10));
    await client.cancel(run);
    const events = await collect(client.stream(run));
    expect(events.at(-1)).toMatchObject({ type: "run.completed", status: "cancelled" });
  });

  it("redacts secrets in the public projection", () => {
    const secret = "sk-" + "a".repeat(24);
    const call = toClientEvents(
      { type: "tool_call", id: "c1", name: "run_shell", args: { command: "echo " + secret } },
      { sessionId: "s", runId: "r", ts: 1 },
    )[0]!;
    expect(call.type).toBe("tool.call");
    expect(JSON.stringify(call)).not.toContain(secret);
    const result = toClientEvents(
      { type: "tool_result", callId: "c1", ok: true, output: "token " + secret },
      { sessionId: "s", runId: "r", ts: 2 },
    )[0]!;
    expect(result.type).toBe("tool.result");
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it("runs a host callback without a provider or local log", async () => {
    const client = createAgentClientV1({
      run: async ({ text, emit }) => {
        emit({ type: "assistant_message", content: "runner:" + text });
      },
    });
    const session = await client.createSession({ workspace: process.cwd() });
    const run = await client.send({ sessionId: session.sessionId }, { text: "hi" });
    const events = await collect(client.stream(run));
    expect(events.map((e) => e.type)).toEqual(["run.started", "assistant.message", "run.completed"]);
    expect(events.find((e) => e.type === "assistant.message")).toMatchObject({ text: "runner:hi" });
  });

  it("rejects a host that offers neither run() nor the loop primitives", async () => {
    const client = createAgentClientV1({});
    await expect(client.createSession({ workspace: process.cwd() })).rejects.toThrow(/provide run/);
  });

  it("fails closed by default: no host tool table means the static TOOLS are unreachable", async () => {
    const client = createAgentClientV1(host(scriptedProvider([
      [
        { type: "tool_call", id: "w1", name: "write_file", args: { path: "should-not-exist.txt", content: "x" } },
        { type: "assistant_message", content: "done" },
      ],
      [{ type: "assistant_message", content: "finished" }],
    ]), { mode: "auto" }));
    const session = await client.createSession({ workspace: process.cwd() });
    const run = await client.send({ sessionId: session.sessionId }, { text: "write" });
    const events = await collect(client.stream(run));
    const results = events.filter((e): e is Extract<typeof e, { type: "tool.result" }> => e.type === "tool.result");
    expect(results[0]).toMatchObject({ callId: "w1", ok: false, output: "unknown tool: write_file" });
  });

  it("executes only the tools the host injects", async () => {
    const client = createAgentClientV1(host(scriptedProvider([
      [
        { type: "tool_call", id: "e1", name: "echo_tool", args: { text: "hi" } },
        { type: "assistant_message", content: "done" },
      ],
      [{ type: "assistant_message", content: "finished" }],
    ]), {
      tools: () => ({
        echo_tool: {
          name: "echo_tool",
          async run(args) { return { ok: true, output: String(args.text) }; },
        },
      }),
    }));
    const session = await client.createSession({ workspace: process.cwd() });
    const run = await client.send({ sessionId: session.sessionId }, { text: "echo" });
    const events = await collect(client.stream(run));
    expect(events.find((e) => e.type === "tool.result")).toMatchObject({ callId: "e1", ok: true, output: "hi" });
  });
});

describe("ACP adapter", () => {
  it("produces the same public events as the SDK for one scripted run", async () => {
    const sdkClient = createAgentClientV1(host(scriptedProvider([ROUND_ONE])));
    const sdkSession = await sdkClient.createSession({ workspace: process.cwd() });
    const run = await sdkClient.send({ sessionId: sdkSession.sessionId }, { text: "hi" });
    const sdkEvents = await collect(sdkClient.stream(run));
    const expected: AcpUpdate[] = [];
    let sawDelta = false;
    for (const event of sdkEvents) {
      if (event.type === "assistant.delta") sawDelta = true;
      expected.push(...toAcpUpdates(event, { sawDelta }));
    }

    const client = createAgentClientV1(host(scriptedProvider([ROUND_ONE])));
    const notifications: Array<{ method: string; params: unknown }> = [];
    const acp = createAcpAdapter({
      client,
      emit: (method, params) => { notifications.push({ method, params }); },
    });
    const init = await dispatchAcpRequest(acp, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: 1 } });
    expect(init?.result).toMatchObject({ protocolVersion: 1, agentInfo: { name: "cairn" } });
    const created = await dispatchAcpRequest(acp, { jsonrpc: "2.0", id: 2, method: "session/new", params: { cwd: process.cwd() } });
    const sessionId = (created?.result as { sessionId: string }).sessionId;

    const prompt = await dispatchAcpRequest(acp, {
      jsonrpc: "2.0",
      id: 3,
      method: "session/prompt",
      params: { sessionId, prompt: [{ type: "text", text: "hi" }] },
    });
    expect(prompt?.result).toEqual({ stopReason: "end_turn" });
    expect(notifications.every((n) => n.method === "session/update")).toBe(true);
    const normalize = (updates: unknown[]): unknown[] => updates.map((u) => ({ ...(u as Record<string, unknown>), sessionId: "s" }));
    expect(normalize(notifications.map((n) => n.params))).toEqual(normalize(expected));
    // 有增量时完整消息不重复上屏。
    expect(notifications.map((n) => n.params)).toHaveLength(2);
  });

  it("rejects unsupported prompt blocks and protocol versions at the wire boundary", async () => {
    const client = createAgentClientV1(host(scriptedProvider([ROUND_ONE])));
    const acp = createAcpAdapter({ client, emit: () => undefined });
    const badVersion = await dispatchAcpRequest(acp, { jsonrpc: "2.0", id: 9, method: "initialize", params: { protocolVersion: 7 } });
    expect(badVersion?.error?.code).toBe(-32000);
    const created = await dispatchAcpRequest(acp, { jsonrpc: "2.0", id: 10, method: "session/new", params: { cwd: process.cwd() } });
    const sessionId = (created?.result as { sessionId: string }).sessionId;
    const badPrompt = await dispatchAcpRequest(acp, {
      jsonrpc: "2.0",
      id: 11,
      method: "session/prompt",
      params: { sessionId, prompt: [{ type: "image", data: "…" }] },
    });
    expect(badPrompt?.error).toMatchObject({ code: -32602 });
    const notification = await dispatchAcpRequest(acp, { jsonrpc: "2.0", method: "session/cancel", params: { sessionId } });
    expect(notification).toBeNull();
  });
});
