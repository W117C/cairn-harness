import { describe, expect, it } from "vitest";
import type { AgentRecord, AgentRuntime } from "../src/agent/runtime-types";
import { A2A_PROTOCOL_VERSION, createA2AHandler } from "../src/interop/a2a";
import { serveA2AHttp } from "../src/interop/a2a-http";

interface FakeRuntime extends AgentRuntime {
  records: Map<string, AgentRecord>;
  spawns: number;
  sends: number;
  setStatus(id: string, status: AgentRecord["status"], summary?: string): void;
}

function fakeRuntime(): FakeRuntime {
  const records = new Map<string, AgentRecord>();
  let seq = 0;
  const runtime: FakeRuntime = {
    records,
    spawns: 0,
    sends: 0,
    async spawn(spec) {
      runtime.spawns++;
      const id = spec.threadId ?? "agent-" + String(++seq);
      const record: AgentRecord = {
        id,
        workspace: "/tmp/ws",
        sessionId: "s-" + id,
        task: spec.task,
        mode: spec.mode,
        status: "running",
        runIds: ["run-" + id + "-1"],
        currentRunId: "run-" + id + "-1",
        ...(spec.fence ? { fence: spec.fence } : {}),
        createdAt: seq,
        updatedAt: seq,
        usage: { inputTokens: 0, outputTokens: 0 },
      };
      records.set(id, record);
      return record;
    },
    async send(id, message) {
      runtime.sends++;
      const record = records.get(id);
      return record === undefined
        ? { ok: false, threadId: id, messageId: message.id, duplicate: false, reason: "unknown" }
        : { ok: true, threadId: id, runId: record.currentRunId, messageId: message.id, duplicate: false };
    },
    async wait(ids) {
      return {
        rows: ids.map((id) => records.get(id)).filter((r): r is AgentRecord => r !== undefined).map((r) => ({ ...r, runIds: [...r.runIds], usage: { ...r.usage } })),
        timedOut: [],
        unknown: ids.filter((id) => !records.has(id)),
      };
    },
    async resume(id, fence) {
      const record = records.get(id);
      if (!record) throw new Error("unknown agent thread");
      if (record.fence !== fence) throw new Error("stale fence");
      record.status = "running";
      return { ...record };
    },
    async close(id) {
      return { ok: true, threadId: id, duplicate: false };
    },
    async list() {
      return [...records.values()];
    },
    async cancel(ids) {
      return ids.map((id) => {
        const record = records.get(id);
        if (record) record.status = "cancelled";
        return { ok: record !== undefined, threadId: id, duplicate: false };
      });
    },
    setStatus(id, status, summary) {
      const record = records.get(id);
      if (!record) throw new Error("unknown task " + id);
      record.status = status;
      if (summary !== undefined) record.summary = summary;
    },
  };
  return runtime;
}

const TEXT = [{ kind: "text", text: "do work" }];

function rpc(url: string, body: unknown, contentType = "application/json"): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": contentType },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>;
}

describe("A2A HTTP transport", () => {
  it("serves the agent card and JSON-RPC message/send + tasks/get over loopback HTTP", async () => {
    const runtime = fakeRuntime();
    const server = await serveA2AHttp({ handler: createA2AHandler({ runtime }) });
    try {
      const card = await fetch(server.url + "/.well-known/agent-card.json");
      expect(card.status).toBe(200);
      expect(await card.json()).toMatchObject({ protocolVersion: A2A_PROTOCOL_VERSION, capabilities: { streaming: true } });

      const sent = await rpc(server.url + "/", {
        jsonrpc: "2.0",
        id: 1,
        method: "message/send",
        params: { message: { role: "user", messageId: "m1", taskId: "thread-1", parts: TEXT } },
      });
      expect(sent.status).toBe(200);
      const task = (await json(sent)).result as { id: string; status: { state: string }; history: unknown[] };
      expect(task.id).toBe("thread-1");
      expect(task.status.state).toBe("working");
      expect(task.history).toHaveLength(1);

      const duplicate = await rpc(server.url + "/", {
        jsonrpc: "2.0",
        id: 2,
        method: "message/send",
        params: { message: { role: "user", messageId: "m1", taskId: "thread-1", parts: TEXT } },
      });
      expect(runtime.spawns).toBe(1);
      expect((await json(duplicate)).result).toMatchObject({ id: "thread-1" });

      runtime.setStatus("thread-1", "done", "the result");
      const got = await rpc(server.url + "/", { jsonrpc: "2.0", id: 3, method: "tasks/get", params: { id: "thread-1" } });
      const gotTask = (await json(got)).result as { status: { state: string }; artifacts: Array<{ artifactId: string }> };
      expect(gotTask.status.state).toBe("completed");
      expect(gotTask.artifacts[0]?.artifactId).toMatch(/^sha256:[0-9a-f]{64}$/);
    } finally {
      await server.close();
    }
  });

  it("enforces fence/protocol on cancel and returns JSON-RPC errors over HTTP", async () => {
    const runtime = fakeRuntime();
    const server = await serveA2AHttp({ handler: createA2AHandler({ runtime }) });
    try {
      const sent = await rpc(server.url + "/", {
        jsonrpc: "2.0",
        id: 1,
        method: "message/send",
        params: { message: { role: "user", messageId: "m1", taskId: "t", parts: TEXT } },
      });
      const task = (await json(sent)).result as { metadata: { fence: string } };
      const fence = task.metadata.fence;

      const stale = await rpc(server.url + "/", {
        jsonrpc: "2.0",
        id: 2,
        method: "tasks/cancel",
        params: { id: "t", metadata: { protocolVersion: A2A_PROTOCOL_VERSION, fence: "stale" } },
      });
      expect((await json(stale)).error).toMatchObject({ code: -32001 });

      const canceled = await rpc(server.url + "/", {
        jsonrpc: "2.0",
        id: 3,
        method: "tasks/cancel",
        params: { id: "t", metadata: { protocolVersion: A2A_PROTOCOL_VERSION, fence } },
      });
      expect((await json(canceled)).result).toMatchObject({ status: { state: "canceled" } });

      const unknown = await rpc(server.url + "/", { jsonrpc: "2.0", id: 4, method: "tasks/nope", params: {} });
      expect((await json(unknown)).error).toMatchObject({ code: -32601 });
    } finally {
      await server.close();
    }
  });

  it("rejects wrong content-type, malformed bodies, oversized bodies, and wrong methods", async () => {
    const runtime = fakeRuntime();
    const server = await serveA2AHttp({ handler: createA2AHandler({ runtime }), maxBodyBytes: 1024 });
    try {
      const wrongType = await rpc(server.url + "/", { jsonrpc: "2.0", id: 1, method: "tasks/get", params: { id: "x" } }, "text/plain");
      expect(wrongType.status).toBe(415);

      const malformed = await rpc(server.url + "/", "{not json");
      expect(malformed.status).toBe(400);
      expect((await json(malformed)).error).toMatchObject({ code: -32700 });

      const oversized = await rpc(server.url + "/", "x".repeat(2048));
      expect(oversized.status).toBe(413);

      const notFound = await fetch(server.url + "/nope");
      expect(notFound.status).toBe(404);

      const getRpc = await fetch(server.url + "/");
      expect(getRpc.status).toBe(405);
      expect(getRpc.headers.get("allow")).toBe("POST");

      const getCardPost = await rpc(server.url + "/.well-known/agent-card.json", { jsonrpc: "2.0", id: 1, method: "tasks/get", params: {} });
      expect(getCardPost.status).toBe(405);
    } finally {
      await server.close();
    }
  });
});
