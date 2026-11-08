import { describe, expect, it } from "vitest";
import type { AgentRecord, AgentRuntime } from "../src/agent/runtime-types";
import { createA2AHandler } from "../src/interop/a2a";
import { bearerTokensMatch, serveA2AHttp } from "../src/interop/a2a-http";

// 复用 interop-a2a-http.test.ts 的最小替身形状；这里只关心认证路径，不执行真实任务。
function fakeRuntime(): AgentRuntime {
  const records = new Map<string, AgentRecord>();
  const record: AgentRecord = {
    id: "t",
    workspace: "/tmp/ws",
    sessionId: "s",
    task: "x",
    mode: "read",
    status: "running",
    runIds: ["r1"],
    currentRunId: "r1",
    createdAt: 1,
    updatedAt: 1,
    usage: { inputTokens: 0, outputTokens: 0 },
  };
  records.set("t", record);
  return {
    async spawn() { return record; },
    async send(_id, message) { return { ok: true, threadId: "t", runId: "r1", messageId: message.id, duplicate: false }; },
    async wait(ids) {
      return { rows: [], timedOut: [], unknown: [...ids] };
    },
    async resume() { return record; },
    async close(id) { return { ok: true, threadId: id, duplicate: false }; },
    async list() { return [record]; },
    async cancel(ids) { return ids.map((id) => ({ ok: true, threadId: id, duplicate: false })); },
  } as AgentRuntime;
}

const RPC = { jsonrpc: "2.0", id: 1, method: "tasks/get", params: { id: "t" } };

describe("A2A HTTP bearer auth", () => {
  it("matches tokens in constant time and rejects length mismatch", () => {
    expect(bearerTokensMatch("secret-token", "secret-token")).toBe(true);
    expect(bearerTokensMatch("secret-token", "secret-tokeN")).toBe(false);
    expect(bearerTokensMatch("secret-token", "secret")).toBe(false);
    expect(bearerTokensMatch("secret-token", "")).toBe(false);
    expect(bearerTokensMatch("", "")).toBe(false);
  });

  it("401s every request without a valid token, including the agent card, and advertises Bearer", async () => {
    const server = await serveA2AHttp({ handler: createA2AHandler({ runtime: fakeRuntime() }), authToken: "secret-token" });
    try {
      const noAuth = await fetch(server.url + "/.well-known/agent-card.json");
      expect(noAuth.status).toBe(401);
      expect(noAuth.headers.get("www-authenticate")).toContain("Bearer");

      const badToken = await fetch(server.url + "/", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer wrong" },
        body: JSON.stringify(RPC),
      });
      expect(badToken.status).toBe(401);
      expect(((await badToken.json()) as { error: { code: number } }).error.code).toBe(-32000);

      const notBearer = await fetch(server.url + "/", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Basic dXNlcjpwYXNz" },
        body: JSON.stringify(RPC),
      });
      expect(notBearer.status).toBe(401);

      const goodCard = await fetch(server.url + "/.well-known/agent-card.json", {
        headers: { authorization: "Bearer secret-token" },
      });
      expect(goodCard.status).toBe(200);

      const goodRpc = await fetch(server.url + "/", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer secret-token" },
        body: JSON.stringify(RPC),
      });
      expect(goodRpc.status).toBe(200);
    } finally {
      await server.close();
    }
  });

  it("stays open when no authToken is configured", async () => {
    const server = await serveA2AHttp({ handler: createA2AHandler({ runtime: fakeRuntime() }) });
    try {
      const card = await fetch(server.url + "/.well-known/agent-card.json");
      expect(card.status).toBe(200);
    } finally {
      await server.close();
    }
  });
});
