import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentEvent, EventRef } from "../src/events";
import { createEventLog } from "../src/events";
import { sessionToolFace } from "../src/main/agent-runner";
import { initSettingsStore, runAgent } from "../src/main/agent-runner";
import { createSearchHistoryTool, searchHistorySpec } from "../src/tools/search-history";

let dir = "";

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = "";
});

const ref = (eventId: number): EventRef => ({
  workspace: "/tmp/ws",
  sessionId: "session-1",
  eventId,
});

function entry(event: AgentEvent, eventId: number) {
  return { event, ref: ref(eventId) };
}

const ctx = { workspace: "/tmp/ws", callId: "history-1" };

describe("createSearchHistoryTool", () => {
  it("returns bounded JSON with source refs", async () => {
    const tool = createSearchHistoryTool({
      sessionId: "session-1",
      readEntries: async () => [entry({ type: "user_message", content: "ALPHA-417" }, 2)],
    });

    const result = await tool.run({ query: "ALPHA-417" }, ctx);
    expect(result.ok).toBe(true);
    expect(JSON.parse(result.output)).toMatchObject({
      kind: "ok",
      hits: [{ ref: ref(2), excerpt: expect.stringContaining("ALPHA-417") }],
    });
  });

  it("rejects model-supplied session routing and unknown fields", async () => {
    const tool = createSearchHistoryTool({
      sessionId: "session-1",
      readEntries: async () => [],
    });

    expect(await tool.run({ query: "x", sessionId: "other" }, ctx)).toMatchObject({ ok: false });
    expect(await tool.run({ query: "x", workspace: "/tmp/other" }, ctx)).toMatchObject({ ok: false });
  });

  it("reports source read failure instead of returning an empty result", async () => {
    const tool = createSearchHistoryTool({
      sessionId: "session-1",
      readEntries: async () => {
        throw new Error("source unavailable");
      },
    });

    const result = await tool.run({ query: "needle" }, ctx);
    expect(result).toMatchObject({ ok: false });
    expect(result.output).toContain("source unavailable");
  });
});

describe("search_history model surface", () => {
  it("is visible to a main read-only session", () => {
    const face = sessionToolFace(null, {
      mode: "read-only",
      pluginTools: [searchHistorySpec],
    });
    expect(face.tools.map((tool) => tool.function.name)).toContain("search_history");
  });
});

describe("search_history production wiring", () => {
  it("executes against the current session and returns a fact hidden by compaction", async () => {
    dir = await mkdtemp(join(tmpdir(), "search-history-run-"));
    const sessions = join(dir, ".agent", "sessions");
    await mkdir(sessions, { recursive: true });
    const logPath = join(sessions, "session.jsonl");
    const log = createEventLog(logPath);
    await log.append({ type: "user_message", content: "old task" });
    await log.append({ type: "tool_call", id: "old-call", name: "read_file", args: { path: "old.txt" } });
    await log.append({ type: "tool_result", callId: "old-call", ok: true, output: "ARCHIVED_FACT_77" });
    await log.append({
      type: "compaction",
      trigger: "auto",
      reason: "threshold",
      compressed_event_ids: [2, 3],
      summary: "old tool output was compacted",
      summary_offset: 4,
      tokens_before: 100,
      tokens_after: 20,
    });
    await log.close?.();

    initSettingsStore(join(dir, "settings.json"));
    vi.stubEnv("M0A_PROVIDER", "glm");
    vi.stubEnv("CAIRN_API_KEY", "offline-test-key");
    const requests: Array<{ tools?: Array<{ function: { name: string } }> }> = [];
    vi.stubGlobal("fetch", vi.fn(async (_url, init: RequestInit) => {
      requests.push(JSON.parse(String(init.body)) as { tools?: Array<{ function: { name: string } }> });
      const delta = requests.length === 1
        ? {
            tool_calls: [{
              index: 0,
              id: "find-old",
              type: "function",
              function: { name: "search_history", arguments: JSON.stringify({ query: "ARCHIVED_FACT_77" }) },
            }],
          }
        : { content: "found it" };
      return new Response(
        "data: " + JSON.stringify({
          choices: [{ delta, finish_reason: requests.length === 1 ? "tool_calls" : "stop" }],
        }) + "\n\ndata: [DONE]\n\n",
        { headers: { "content-type": "text/event-stream" } },
      );
    }));

    const events = await runAgent({
      workspace: dir,
      message: "what was the archived value?",
      mode: "read-only",
      sessionId: "session",
      logPath,
    });

    expect(requests[0]?.tools?.map((tool) => tool.function.name)).toContain("search_history");
    const toolResult = events.find((event) => event.type === "tool_result" && event.callId === "find-old");
    expect(toolResult?.type).toBe("tool_result");
    if (toolResult?.type !== "tool_result") throw new Error("missing tool result");
    expect(toolResult.ok).toBe(true);
    expect(toolResult.output).toContain("ARCHIVED_FACT_77");
    expect(toolResult.output).toContain('"eventId":3');
  });
});

