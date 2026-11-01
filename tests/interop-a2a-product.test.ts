import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createA2AHandler } from "../src/interop/a2a";
import { serveA2AHttp } from "../src/interop/a2a-http";
import { createProductA2ARuntime } from "../src/main/interop-a2a-runtime";
import type { AgentRuntime } from "../src/agent/runtime-types";

const roots: string[] = [];
const saved = new Map<string, string | undefined>();
const ENV_KEYS = [
  "M3A_MAIN_SCRIPT", "M3A_AGENTS_DEMO", "M1B_GATE_FLOW", "M1C_AUTONOMY_SCRIPT",
  "M2A_LSP_DEMO", "M0A_PROVIDER", "M0B_WORKSPACE", "CAIRN_MODEL",
] as const;
for (const key of ENV_KEYS) saved.set(key, process.env[key]);

afterAll(async () => {
  for (const [key, value] of saved) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

async function rpc(url: string, body: unknown): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return await response.json() as Record<string, unknown>;
}

describe("product A2A runtime + HTTP", () => {
  it("runs a real read-only task to completion and serves it over A2A", async () => {
    const root = await mkdtemp(join(tmpdir(), "a2a-product-"));
    roots.push(root);
    const workspace = join(root, "ws");
    await mkdir(join(workspace, ".agent"), { recursive: true });
    await writeFile(join(workspace, ".agent", "settings.json"), JSON.stringify({ provider: "demo", model: "" }), "utf8");
    const script = join(root, "main.jsonl");
    await writeFile(script, JSON.stringify({ type: "assistant_message", content: "hello a2a product" }) + "\n", "utf8");
    for (const key of ENV_KEYS) delete process.env[key];
    process.env.M3A_MAIN_SCRIPT = script;

    const runtime: AgentRuntime = await createProductA2ARuntime({ workspace });
    const server = await serveA2AHttp({ handler: createA2AHandler({ runtime }) });
    try {
      const sent = await rpc(server.url + "/", {
        jsonrpc: "2.0",
        id: 1,
        method: "message/send",
        params: { message: { role: "user", messageId: "m1", taskId: "task-a2a-product", parts: [{ kind: "text", text: "say hello" }] } },
      });
      expect((sent.result as { status: { state: string } }).status.state).toBe("working");

      const deadline = Date.now() + 15_000;
      let task: { status: { state: string }; artifacts: Array<{ parts: Array<{ text?: string }> }> } | undefined;
      while (Date.now() < deadline) {
        const got = await rpc(server.url + "/", { jsonrpc: "2.0", id: 2, method: "tasks/get", params: { id: "task-a2a-product" } });
        task = got.result as typeof task;
        if (task?.status.state === "completed") break;
        await new Promise((done) => setTimeout(done, 20));
      }
      expect(task?.status.state).toBe("completed");
      expect(task?.artifacts[0]?.parts[0]?.text).toContain("hello a2a product");

      const duplicate = await rpc(server.url + "/", {
        jsonrpc: "2.0",
        id: 3,
        method: "message/send",
        params: { message: { role: "user", messageId: "m1", taskId: "task-a2a-product", parts: [{ kind: "text", text: "different" }] } },
      });
      expect((duplicate.result as { status: { state: string } }).status.state).toBe("completed");
    } finally {
      await runtime.close("task-a2a-product").catch(() => undefined);
      await server.close();
    }
  }, 60_000);
});
