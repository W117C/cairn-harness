import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import type { ModelOutput, Provider } from "../src/providers";
import type { EventLog } from "../src/events/log";
import type { AgentEvent } from "../src/events";
import { createAgentClientV1, type AgentClientHost } from "../src/interop/sdk";
import { serveAcpStdio } from "../src/interop/acp-stdio";

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

function host(provider: Provider | ((sessionId: string) => Provider)): AgentClientHost {
  return {
    createProvider: (session) => typeof provider === "function" ? provider(session.sessionId) : provider,
    createLog: () => memoryLog(),
  };
}

interface Frame {
  jsonrpc?: string;
  id?: string | number | null;
  result?: unknown;
  error?: { code: number; message: string };
  method?: string;
  params?: unknown;
}

function outputFrames(output: PassThrough): { frames: Frame[]; waitFor: (predicate: (frames: Frame[]) => boolean) => Promise<void> } {
  const frames: Frame[] = [];
  let buffer = "";
  output.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    for (;;) {
      const newline = buffer.indexOf("\n");
      if (newline < 0) break;
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (line.trim() !== "") frames.push(JSON.parse(line) as Frame);
    }
  });
  return {
    frames,
    waitFor: (predicate) => vi.waitFor(() => { expect(predicate(frames)).toBe(true); }, { timeout: 4_000, interval: 10 }),
  };
}

describe("ACP stdio transport", () => {
  it("serves initialize / session/new / prompt and forwards session/update notifications", async () => {
    const client = createAgentClientV1(host(scriptedProvider([
      [
        { type: "assistant_delta", callId: "a1", text: "Hel" },
        { type: "assistant_message", content: "Hello" },
        { type: "usage", inputTokens: 3, outputTokens: 1 },
      ],
    ])));
    const input = new PassThrough();
    const output = new PassThrough();
    const server = serveAcpStdio({ client, input, output });
    const { frames, waitFor } = outputFrames(output);

    input.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: 1 } }) + "\n");
    await waitFor((list) => list.some((f) => f.id === 1));
    expect(frames.find((f) => f.id === 1)?.result).toMatchObject({ protocolVersion: 1 });

    input.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "session/new", params: { cwd: process.cwd() } }) + "\n");
    await waitFor((list) => list.some((f) => f.id === 2));
    const sessionId = (frames.find((f) => f.id === 2)?.result as { sessionId: string }).sessionId;

    input.write(JSON.stringify({
      jsonrpc: "2.0",
      id: 3,
      method: "session/prompt",
      params: { sessionId, prompt: [{ type: "text", text: "hi" }] },
    }) + "\n");
    await waitFor((list) => list.some((f) => f.id === 3));
    expect(frames.find((f) => f.id === 3)?.result).toEqual({ stopReason: "end_turn" });
    const updates = frames.filter((f) => f.method === "session/update").map((f) => f.params as { update: { sessionUpdate: string; content?: { text?: string } } });
    expect(updates.length).toBeGreaterThan(0);
    expect(updates.at(-1)?.update.content?.text).toBe("Hel");

    input.write("{not json\n");
    await waitFor((list) => list.some((f) => f.error?.code === -32700));
    input.end();
    await server;
    expect(output.writableEnded).toBe(false);
    output.end();
  });

  it("rejects oversized frames and keeps the connection alive", async () => {
    const client = createAgentClientV1(host(scriptedProvider([])));
    const input = new PassThrough();
    const output = new PassThrough();
    const server = serveAcpStdio({ client, input, output, maxLineBytes: 512 });
    const { frames, waitFor } = outputFrames(output);

    input.write("x".repeat(1024) + "\n");
    await waitFor((list) => list.some((f) => f.error?.code === -32600));
    input.write(JSON.stringify({ jsonrpc: "2.0", id: 7, method: "initialize", params: { protocolVersion: 1 } }) + "\n");
    await waitFor((list) => list.some((f) => f.id === 7));
    expect(frames.find((f) => f.id === 7)?.result).toMatchObject({ protocolVersion: 1 });
    input.end();
    await server;
    output.end();
  });

  it("handles session/cancel while the prompt is still running", async () => {
    const provider: Provider = {
      async *stream(_messages, _tools, call) {
        await new Promise<void>((resolve) => {
          if (call?.signal?.aborted === true) resolve();
          else call?.signal?.addEventListener("abort", () => resolve(), { once: true });
        });
      },
    };
    const client = createAgentClientV1(host(provider));
    const input = new PassThrough();
    const output = new PassThrough();
    const server = serveAcpStdio({ client, input, output });
    const { frames, waitFor } = outputFrames(output);

    input.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "session/new", params: { cwd: process.cwd() } }) + "\n");
    await waitFor((list) => list.some((f) => f.id === 1));
    const sessionId = (frames.find((f) => f.id === 1)?.result as { sessionId: string }).sessionId;
    input.write(JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "session/prompt",
      params: { sessionId, prompt: [{ type: "text", text: "wait" }] },
    }) + "\n");
    await new Promise((resolve) => setTimeout(resolve, 20));
    input.write(JSON.stringify({ jsonrpc: "2.0", method: "session/cancel", params: { sessionId } }) + "\n");
    await waitFor((list) => list.some((f) => f.id === 2));
    expect(frames.find((f) => f.id === 2)?.result).toEqual({ stopReason: "cancelled" });
    input.end();
    await server;
    output.end();
  });

  it("多字节 UTF-8 字符被切成两个输入块时仍能拼回同一帧", async () => {
    // pipe/流按字节切块，一个汉字常被切在中间。逐块 toString("utf8") 会各吐一个 U+FFFD，
    // 整帧 JSON 解析失败（用户看到的是 -32700，而不是他的中文 prompt 被送进模型）。
    let seen = "";
    const provider: Provider = {
      async *stream(messages) {
        seen = JSON.stringify(messages);
        yield { type: "assistant_message", content: "ok" };
      },
    };
    const client = createAgentClientV1(host(provider));
    const input = new PassThrough();
    const output = new PassThrough();
    const server = serveAcpStdio({ client, input, output });
    const { frames, waitFor } = outputFrames(output);

    input.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "session/new", params: { cwd: process.cwd() } }) + "\n");
    await waitFor((list) => list.some((f) => f.id === 1));
    const sessionId = (frames.find((f) => f.id === 1)?.result as { sessionId: string }).sessionId;

    const line = JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "session/prompt",
      params: { sessionId, prompt: [{ type: "text", text: "你好，世界" }] },
    }) + "\n";
    const bytes = Buffer.from(line, "utf8");
    const split = bytes.indexOf(Buffer.from("你", "utf8")) + 1; // 切在 3 字节字符的中间
    expect(split).toBeGreaterThan(0);
    input.write(bytes.subarray(0, split));
    await new Promise((resolve) => setImmediate(resolve));
    input.write(bytes.subarray(split));

    await waitFor((list) => list.some((f) => f.id === 2));
    expect(frames.find((f) => f.id === 2)?.result).toEqual({ stopReason: "end_turn" });
    expect(seen).toContain("你好，世界");
    input.end();
    await server;
    output.end();
  });
});
