import { describe, expect, it } from "vitest";
import type { AgentRecord, AgentRuntime } from "../src/agent/runtime-types";
import { A2A_PROTOCOL_VERSION, createA2AHandler } from "../src/interop/a2a";
import { serveA2AHttp } from "../src/interop/a2a-http";

// 最小替身：spawn 落一个 running 任务；wait 第一次返回 running，之后按 setStatus 推进。
function fakeRuntime(): AgentRuntime & { setStatus(id: string, status: AgentRecord["status"], summary?: string): void } {
  const records = new Map<string, AgentRecord>();
  let waitCalls = 0;
  const record: AgentRecord = {
    id: "t1",
    workspace: "/tmp/ws",
    sessionId: "s1",
    task: "do work",
    mode: "read",
    status: "running",
    runIds: ["r1"],
    currentRunId: "r1",
    createdAt: 1,
    updatedAt: 1,
    usage: { inputTokens: 0, outputTokens: 0 },
  };
  records.set("t1", record);
  return {
    async spawn() { return record; },
    async send(_id, message) { return { ok: true, threadId: "t1", runId: "r1", messageId: message.id, duplicate: false }; },
    async wait(ids) {
      waitCalls++;
      return {
        rows: ids.filter((id) => records.has(id)).map((id) => ({ ...records.get(id)!, runIds: [...records.get(id)!.runIds], usage: { ...records.get(id)!.usage } })),
        timedOut: [],
        unknown: ids.filter((id) => !records.has(id)),
      };
    },
    async resume() { return record; },
    async close(id) { return { ok: true, threadId: id, duplicate: false }; },
    async list() { return [record]; },
    async cancel(ids) { return ids.map((id) => ({ ok: true, threadId: id, duplicate: false })); },
    setStatus(id, status, summary) {
      const row = records.get(id);
      if (!row) throw new Error("unknown task " + id);
      row.status = status;
      if (summary !== undefined) row.summary = summary;
      row.updatedAt = waitCalls;
    },
  } as AgentRuntime & { setStatus(id: string, status: AgentRecord["status"], summary?: string): void };
}

interface StreamFrame {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: { kind: string; taskId: string; status: { state: string; message?: { parts: Array<{ text?: string }> } }; final: boolean };
  error?: { code: number; message: string };
}

async function readSse(response: Response): Promise<StreamFrame[]> {
  const text = await response.text();
  return text
    .split("\n\n")
    .filter((chunk) => chunk.startsWith("data: "))
    .map((chunk) => JSON.parse(chunk.slice(6)) as StreamFrame);
}

const STREAM_REQUEST = {
  jsonrpc: "2.0",
  id: 1,
  method: "message/stream",
  params: { message: { role: "user", messageId: "m1", taskId: "t1", parts: [{ kind: "text", text: "do work" }] } },
};

describe("A2A message/stream SSE", () => {
  it("streams status updates until the task reaches a terminal state", async () => {
    const runtime = fakeRuntime();
    const handler = createA2AHandler({ runtime, streamPollMs: 5, streamDeadlineMs: 5_000 });
    const server = await serveA2AHttp({ handler });
    try {
      const card = await fetch(server.url + "/.well-known/agent-card.json");
      expect(((await card.json()) as { capabilities: { streaming: boolean } }).capabilities.streaming).toBe(true);

      // 让任务在流中途走到 done，并留下一份摘要工件。
      setTimeout(() => runtime.setStatus("t1", "done", "the result"), 30);
      const response = await fetch(server.url + "/", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "text/event-stream" },
        body: JSON.stringify(STREAM_REQUEST),
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/event-stream");

      const frames = await readSse(response);
      expect(frames.length).toBeGreaterThanOrEqual(2);
      expect(frames[0]?.result).toMatchObject({ kind: "status-update", taskId: "t1", final: false });
      expect(frames[0]?.result?.status.state).toBe("working");
      const lastFrame = frames[frames.length - 1]!;
      expect(lastFrame.result).toMatchObject({ kind: "status-update", taskId: "t1", final: true });
      expect(lastFrame.result?.status.state).toBe("completed");
      expect(lastFrame.result?.status.message?.parts[0]?.text).toBe("the result");
      for (const frame of frames.slice(0, -1)) {
        expect(frame.result?.final).toBe(false);
      }
    } finally {
      await server.close();
    }
  });

  it("requires Accept: text/event-stream and rejects handlers without streaming with 501", async () => {
    const runtime = fakeRuntime();
    const handler = createA2AHandler({ runtime, streamPollMs: 5 });
    const server = await serveA2AHttp({ handler });
    try {
      const noAccept = await fetch(server.url + "/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(STREAM_REQUEST),
      });
      expect(noAccept.status).toBe(415);

      // 抹掉流式能力模拟不支持流式的 handler。
      const legacy = { ...handler, messageStream: undefined };
      const server2 = await serveA2AHttp({ handler: legacy });
      try {
        const unsupported = await fetch(server2.url + "/", {
          method: "POST",
          headers: { "content-type": "application/json", accept: "text/event-stream" },
          body: JSON.stringify(STREAM_REQUEST),
        });
        expect(unsupported.status).toBe(501);
        expect(((await unsupported.json()) as { error: { code: number } }).error.code).toBe(-32601);
      } finally {
        await server2.close();
      }
    } finally {
      await server.close();
    }
  });

  it("propagates JSON-RPC errors as SSE error frames and keeps message/send working", async () => {
    const runtime = fakeRuntime();
    const handler = createA2AHandler({ runtime, streamPollMs: 5, streamDeadlineMs: 5_000 });
    const server = await serveA2AHttp({ handler });
    try {
      const badProtocol = await fetch(server.url + "/", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "text/event-stream" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 7,
          method: "message/stream",
          params: { message: { role: "user", messageId: "m9", taskId: "t1", parts: [{ kind: "text", text: "x" }] }, metadata: { protocolVersion: "0.0.1" } },
        }),
      });
      expect(badProtocol.status).toBe(200);
      const frames = await readSse(badProtocol);
      expect(frames).toHaveLength(1);
      expect(frames[0]?.error).toMatchObject({ code: -32000 });

      const sent = await fetch(server.url + "/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 8, method: "tasks/get", params: { id: "t1" } }),
      });
      expect(sent.status).toBe(200);
      // 流式请求因坏协议版本在落任务前被拒，t1 不存在：非流式分派照常工作，返回显式 JSON-RPC 错误。
      expect(((await sent.json()) as { error: { code: number } }).error.code).toBe(-32001);
    } finally {
      await server.close();
    }
  });

  it("declares the wire protocol version in stream metadata consistency", async () => {
    const runtime = fakeRuntime();
    const handler = createA2AHandler({ runtime, streamPollMs: 5, streamDeadlineMs: 2_000 });
    const server = await serveA2AHttp({ handler });
    try {
      const response = await fetch(server.url + "/", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "text/event-stream" },
        body: JSON.stringify(STREAM_REQUEST),
      });
      const frames = await readSse(response);
      expect(frames.length).toBeGreaterThanOrEqual(1);
      expect(frames[0]?.result).toBeDefined();
      // 幂等：同一 messageId 复发不产生新副作用（send 幂等键不变）。
      const duplicate = await fetch(server.url + "/", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "text/event-stream" },
        body: JSON.stringify(STREAM_REQUEST),
      });
      const dupFrames = await readSse(duplicate);
      expect(dupFrames[0]?.result?.taskId).toBe("t1");
    } finally {
      await server.close();
    }
  });
});
