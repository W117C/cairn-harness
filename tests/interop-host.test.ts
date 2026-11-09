import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createProductAgentClientV1 } from "../src/main/interop-host";
import type { ClientEventV1 } from "../src/interop/sdk";

const roots: string[] = [];
const saved = new Map<string, string | undefined>();
const ENV_KEYS = [
  "M3A_MAIN_SCRIPT", "M3A_AGENTS_DEMO", "M1B_GATE_FLOW", "M1C_AUTONOMY_SCRIPT",
  "M0A_PROVIDER", "M0B_WORKSPACE", "CAIRN_MODEL",
] as const;
for (const key of ENV_KEYS) saved.set(key, process.env[key]);

afterAll(async () => {
  for (const [key, value] of saved) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

async function collect(iterable: AsyncIterable<ClientEventV1>): Promise<ClientEventV1[]> {
  const out: ClientEventV1[] = [];
  for await (const event of iterable) out.push(event);
  return out;
}

describe("product ACP host", () => {
  it("runs the real handleAgentRun assembly with a demo script and fixed workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), "interop-host-"));
    roots.push(root);
    const workspace = join(root, "ws");
    await mkdir(join(workspace, ".agent"), { recursive: true });
    await writeFile(join(workspace, ".agent", "settings.json"), JSON.stringify({ provider: "demo", model: "" }), "utf8");
    const script = join(root, "main.jsonl");
    await writeFile(script, JSON.stringify({ type: "assistant_message", content: "hello from product host" }) + "\n", "utf8");
    for (const key of ENV_KEYS) delete process.env[key];
    process.env.M3A_MAIN_SCRIPT = script;

    const client = await createProductAgentClientV1({ workspace, mode: "read-only", unattended: true });
    await expect(client.createSession({ workspace: join(root, "other") })).rejects.toThrow(/fixed to/);
    const session = await client.createSession({ workspace });
    const run = await client.send({ sessionId: session.sessionId }, { text: "hello" });
    const events = await collect(client.stream(run));
    expect(events.at(-1)).toMatchObject({ type: "run.completed", status: "completed" });
    expect(events.filter((event) => event.type === "assistant.message").map((event) => (event as { text: string }).text))
      .toContain("hello from product host");
    await client.close({ sessionId: session.sessionId });
  }, 60_000);
});
