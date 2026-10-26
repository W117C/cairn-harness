import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { createProvider } from "../src/main/provider-assembly";
import { resolveMainModel } from "../src/main/provider-runtime";
import { createEventLog, type AgentEvent } from "../src/events";
import { DEFAULT_COMPACTION_CONFIG } from "../src/agent/compaction";

let dir = "";

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = "";
});

function warmEvents(): AgentEvent[] {
  return [
    { type: "user_message", content: "goal" },
    { type: "assistant_message", content: "a".repeat(800) },
    { type: "assistant_message", content: "b".repeat(800) },
    { type: "assistant_message", content: "c".repeat(300) },
  ];
}

async function waitFor(condition: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("condition timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

it("main provider assembly enables a background predictive summary", async () => {
  dir = await mkdtemp(join(tmpdir(), "provider-prediction-wiring-"));
  const logPath = join(dir, "session.jsonl");
  const log = createEventLog(logPath);
  for (const event of warmEvents()) await log.append(event);
  await log.close?.();

  vi.stubEnv("CAIRN_API_KEY", "offline-test-key");
  let requests = 0;
  vi.stubGlobal("fetch", vi.fn(async () => {
    requests += 1;
    return new Response(
      "data: " + JSON.stringify({
        choices: [{ delta: { content: "ok" }, finish_reason: "stop" }],
      }) + "\n\ndata: [DONE]\n\n",
      { headers: { "content-type": "text/event-stream" } },
    );
  }));
  const selection = resolveMainModel({
    forcedKind: "glm",
    configuredKind: "glm",
    settingsModel: "",
    legacyEnvModel: "",
  });
  const provider = createProvider("goal", undefined, selection, {
    logPath,
    workspace: dir,
    attachments: [],
    emit: async (event) => {
      const sink = createEventLog(logPath);
      await sink.append(event);
      await sink.close?.();
    },
    requestFace: () => ({ tools: [], note: "" }),
    compactionConfig: {
      ...DEFAULT_COMPACTION_CONFIG,
      inputLimit: 1_000,
      maxOutputReserve: 100,
      ratio: 0.7,
      tailMinTokens: 1,
      tailMaxTokens: 50,
      summaryCapTokens: 500,
      retryBackoffMs: 1,
    },
    prediction: { enabled: true, startRatio: 0.8 },
  });

  for await (const _event of provider.stream([], [])) {
    // The direct provider path is enough to verify assembly wiring.
  }
  await waitFor(() => requests >= 2);
  expect(requests).toBeGreaterThanOrEqual(2);
});

