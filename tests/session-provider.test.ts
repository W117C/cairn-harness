import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGlmSessionProvider, gateToolSpecs } from "../src/agent/glm-session";
import { createEventLog, type EventLog } from "../src/events";
import type { GlmMessage } from "../src/providers/glm";

vi.mock("../src/agent/memory/inject", () => ({
  buildMemoryInjection: async () => ({ project: null, global: null }),
}));

let dir: string;
let log: EventLog;
async function setup() {
  dir = await mkdtemp(join(tmpdir(), "session-provider-"));
  const path = join(dir, "events.jsonl");
  log = createEventLog(path);
  await log.append({ type: "user_message", content: "TASK" });
  return path;
}
afterEach(async () => {
  await log?.close?.();
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe("session provider transport", () => {
  it("yields the first delta before pulling the rest of the transport", async () => {
    const path = await setup();
    let resumed = false;
    let closed = false;
    const provider = createGlmSessionProvider(path, {
      map: false, workspace: dir,
      transport: async function* () {
        try {
          yield { type: "assistant_delta", callId: "a1", text: "first" };
          resumed = true;
          yield { type: "assistant_delta", callId: "a1", text: "second" };
        } finally { closed = true; }
      },
    });
    const iterator = provider.stream([])[Symbol.asyncIterator]();
    expect((await iterator.next()).value).toEqual({ type: "assistant_delta", callId: "a1", text: "first" });
    expect(resumed).toBe(false);
    await iterator.return?.();
    expect(closed).toBe(true);
  });

  it("reassembles log history and forwards tools and cancellation on every request", async () => {
    const path = await setup();
    const abort = new AbortController();
    const requests: GlmMessage[][] = [];
    const tools = gateToolSpecs("read-only");
    const provider = createGlmSessionProvider(path, {
      map: false, workspace: dir, tools, system: "SYSTEM",
      transport: async function* (messages, _options, specs, call) {
        expect(call?.signal).toBe(abort.signal);
        expect(specs).toEqual(tools);
        requests.push(messages);
        yield { type: "assistant_message", content: "response" };
      },
    });
    for await (const _ of provider.stream([], undefined, { signal: abort.signal })) { /* drain */ }
    await log.append({ type: "tool_call", id: "c1", name: "read_file", args: {} });
    await log.append({ type: "tool_result", callId: "c1", ok: true, output: "FEEDBACK" });
    for await (const _ of provider.stream([], undefined, { signal: abort.signal })) { /* drain */ }
    expect(requests).toHaveLength(2);
    expect(requests[0]?.[0]).toEqual({ role: "system", content: "SYSTEM" });
    expect(requests[1]?.at(-1)).toEqual({ role: "tool", tool_call_id: "c1", content: "FEEDBACK" });
    abort.abort();
    await expect(async () => {
      for await (const _ of provider.stream([], undefined, { signal: abort.signal })) { /* drain */ }
    }).rejects.toThrow();
    expect(requests).toHaveLength(2);
  });
});
