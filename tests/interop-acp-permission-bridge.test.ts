import { describe, expect, it } from "vitest";
import { PassThrough } from "node:stream";
import { createAcpAskGate } from "../src/main/interop-acp-ask-gate";
import { serveAcpStdio } from "../src/interop/acp-stdio";
import type { AgentClientV1 } from "../src/interop/sdk";

// —— 1. 映射单元：selected/allow_once→approved；其余一律 fail-closed ——
describe("ACP permission bridge mapping", () => {
  function gateWith(response: () => Promise<unknown>) {
    let sent: { method: string; params: unknown } | null = null;
    const gate = createAcpAskGate({
      send: async (method, params) => {
        sent = { method, params };
        return await response();
      },
      timeoutMs: 1_000,
    });
    return { gate, sent: () => sent as { method: string; params: unknown } | null };
  }
  const ask = { tool: "write_file", args: { path: "a.txt", content: "x" }, reason: "默认档逐次审批", risk: "high" as const, sessionId: "s1" };

  it("approves only selected + allow_once, with scope once", async () => {
    const { gate } = gateWith(async () => ({ outcome: { outcome: "selected", optionId: "allow_once" } }));
    const result = await gate.request(ask.tool, ask.args, { reason: ask.reason, risk: ask.risk, sessionId: ask.sessionId });
    expect(result).toMatchObject({ outcome: "approved", scope: "once" });
  });

  it("rejects reject_once, cancelled, and unknown optionIds as user decisions", async () => {
    for (const outcome of [
      { outcome: "selected", optionId: "reject_once" },
      { outcome: "cancelled" },
      { outcome: "selected", optionId: "allow_always" }, // 不认识的 optionId 不授予
    ]) {
      const { gate } = gateWith(async () => ({ outcome }));
      const result = await gate.request(ask.tool, ask.args, {});
      expect(result.outcome).toBe("rejected");
      expect(result.scope).toBe("once");
    }
  });

  it("maps transport failure to a timeout rejection and sends a well-formed request", async () => {
    const { gate, sent } = gateWith(async () => { throw new Error("outbound request timed out"); });
    const result = await gate.request(ask.tool, ask.args, { reason: ask.reason, risk: ask.risk, sessionId: ask.sessionId });
    expect(result).toEqual({ outcome: "rejected", scope: "once", reason: "timeout" });
    const payload = sent();
    expect(payload).not.toBeNull();
    expect(payload!.method).toBe("session/request_permission");
    const params = payload!.params as { sessionId: string; toolCall: { toolCallId: string; title: string; rawInput: Record<string, unknown> }; options: Array<{ optionId: string }> };
    expect(params.sessionId).toBe("s1");
    expect(params.toolCall.title).toBe("write_file");
    expect(params.options.map((o) => o.optionId).sort()).toEqual(["allow_once", "reject_once"]);
  });

  it("offers no persistent scopes: options never include session_kind or always", async () => {
    const { gate, sent } = gateWith(async () => ({ outcome: { outcome: "selected", optionId: "allow_once" } }));
    await gate.request(ask.tool, ask.args, {});
    const noAlwaysParams = sent()!.params as { options: Array<{ kind: string }> };
    for (const option of noAlwaysParams.options) {
      expect(option.kind).not.toBe("allow_always");
      expect(option.kind).not.toBe("reject_always");
    }
  });
});

// —— 2. 传输回环：出站请求经真实 serveAcpStdio 关联响应；EOF/超时按错误收束 ——
// 这几条只驱动出站请求面，client 不会被调用；给一个最小桩满足类型即可。
const stubClient = {} as AgentClientV1;

async function roundtrip(clientReply: (params: unknown) => unknown, requestOpts?: { timeoutMs?: number }): Promise<{ result?: unknown; error?: string }> {
  const input = new PassThrough();
  const output = new PassThrough();
  let resolveReady: (transport: { request: (method: string, params: unknown, opts?: { timeoutMs?: number }) => Promise<unknown> }) => void;
  const ready = new Promise<typeof resolveReady extends (t: infer T) => void ? T : never>((r) => { resolveReady = r as typeof resolveReady; });
  const lines: string[] = [];
  let buf = "";
  output.on("data", (chunk: Buffer) => {
    buf += chunk.toString("utf8");
    for (;;) {
      const nl = buf.indexOf("\n");
      if (nl < 0) break;
      lines.push(buf.slice(0, nl));
      buf = buf.slice(nl + 1);
      void respond();
    }
  });
  const served = serveAcpStdio({ client: stubClient, input, output, attach: (transport) => resolveReady(transport) });
  const transport = await ready;
  const pending = transport.request("session/request_permission", { toolCall: { title: "t" } }, requestOpts).then(
    (result) => ({ result }),
    (error: Error) => ({ error: error.message }),
  );
  async function respond(): Promise<void> {
    while (lines.length > 0) {
      const line = lines.shift()!;
      const frame = JSON.parse(line) as { id?: string; method?: string; params?: unknown };
      if (frame.method === "session/request_permission") {
        try {
          input.write(JSON.stringify({ jsonrpc: "2.0", id: frame.id, result: clientReply(frame.params) }) + "\n");
        } catch (error: unknown) {
          // 客户端选择以 JSON-RPC 错误应答：写回 error 帧。
          const message = error instanceof Error ? error.message : String(error);
          input.write(JSON.stringify({ jsonrpc: "2.0", id: frame.id, error: { code: -32000, message } }) + "\n");
        }
      }
    }
  }
  const outcome = await pending;
  input.end();
  await served;
  return outcome;
}

describe("ACP stdio outbound request transport", () => {
  it("correlates a client response by id through the real transport", async () => {
    const outcome = await roundtrip(() => ({ outcome: { outcome: "selected", optionId: "allow_once" } }));
    expect(outcome.result).toEqual({ outcome: { outcome: "selected", optionId: "allow_once" } });
  });

  it("rejects with an error when the client answers with a JSON-RPC error", async () => {
    const outcome = await roundtrip(() => {
      throw new Error("client denied");
    });
    expect(outcome.error).toBe("outbound request rejected: client denied");
  });

  it("times out fail-closed when the client never answers", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    let resolveReady: (t: { request: (method: string, params: unknown, opts?: { timeoutMs?: number }) => Promise<unknown> }) => void;
    const ready = new Promise<{ request: (method: string, params: unknown, opts?: { timeoutMs?: number }) => Promise<unknown> }>((r) => { resolveReady = r as typeof resolveReady; });
    const served = serveAcpStdio({ client: stubClient, input, output, attach: (t) => resolveReady(t) });
    const transport = await ready;
    const pending = transport.request("session/request_permission", {}, { timeoutMs: 20 });
    await expect(pending).rejects.toThrow("timed out");
    input.end();
    await served;
  });

  it("rejects all pending outbound requests when input ends", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    let resolveReady: (t: { request: (method: string, params: unknown, opts?: { timeoutMs?: number }) => Promise<unknown> }) => void;
    const ready = new Promise<{ request: (method: string, params: unknown, opts?: { timeoutMs?: number }) => Promise<unknown> }>((r) => { resolveReady = r as typeof resolveReady; });
    const served = serveAcpStdio({ client: stubClient, input, output, attach: (t) => resolveReady(t) });
    const transport = await ready;
    const pending = transport.request("session/request_permission", {}, { timeoutMs: 5_000 });
    input.end();
    await expect(pending).rejects.toThrow("transport input ended");
    await served;
  });
});
