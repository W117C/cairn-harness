import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { createSessionProvider } from "../src/agent/session-provider";
import { createEventLog, replay } from "../src/events";
import { createProvider } from "../src/main/provider-assembly";
import type { GlmMessage } from "../src/providers/glm";
import { DEFAULT_MODEL_TABLE, resolveModel } from "../src/providers/registry";
vi.mock("../src/agent/memory/inject", async () =>
  (await import("./helpers/memory-inject-mock")).memoryInjectMock({ project: null, global: null }));
let dir: string;
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  if (dir) await rm(dir, { recursive: true, force: true });
});
it("checks final remounted request before transport and preserves complete log", async () => {
  dir = await mkdtemp(join(process.env.PI_SCRATCH_DIR!, "final-budget-"));
  const path = join(dir, "events.jsonl");
  const original = JSON.stringify({ type: "user_message", content: "TASK" }) + "\n";
  await writeFile(path, original);
  let requests = 0;
  const transport = async function* () { requests++; yield { type: "assistant_message" as const, content: "ok" }; };
  const blocked = createSessionProvider(path, { map: false, workspace: dir, transport,
    plugins: { deriveRemount: () => "x".repeat(600_000) } });
  await expect(async () => { for await (const _ of blocked.stream([])) {} }).rejects.toThrow("context_budget_exceeded");
  expect(requests).toBe(0);
  expect(await readFile(path, "utf8")).toBe(original);
  const normal = createSessionProvider(path, { map: false, workspace: dir, transport });
  for await (const _ of normal.stream([])) {}
  expect(requests).toBe(1);
});

it("automatically compacts when a tail instruction pushes the assembled request over budget", async () => {
  dir = await mkdtemp(join(process.env.PI_SCRATCH_DIR!, "final-budget-tail-"));
  const path = join(dir, "events.jsonl");
  const coldDetail = "old detail ".repeat(105);
  const continuation = "continue with current requirements ".repeat(120);
  await writeFile(path, [
    { type: "user_message", content: "initial request" },
    { type: "assistant_message", content: coldDetail },
    { type: "assistant_message", content: "recent detail ".repeat(75) },
    { type: "user_message", content: "latest request" },
  ].map((event) => JSON.stringify(event) + "\n").join(""));
  const sent: GlmMessage[][] = [];
  const provider = createSessionProvider(path, {
    map: false, workspace: dir,
    requestIntervention: () => continuation,
    compaction: { config: { inputLimit: 1_800, maxOutputReserve: 200 } },
    transport: async function* (messages) {
      sent.push(messages);
      yield { type: "assistant_delta", callId: "response", text: "ok" };
    },
  });

  for await (const _ of provider.stream([])) { /* drain */ }

  expect(sent).toHaveLength(1);
  expect(sent[0]).toContainEqual({ role: "user", content: "latest request" });
  expect(sent[0]?.at(-1)).toEqual({ role: "user", content: continuation });
  expect(sent[0]).not.toContainEqual({ role: "assistant", content: coldDetail });
  const events = await replay(path);
  expect(events.filter((event) => event.type === "compaction")).toEqual([
    expect.objectContaining({ trigger: "overflow", reason: "hard_buffer" }),
  ]);
  expect(events).toContainEqual({ type: "assistant_message", content: coldDetail });
});

it("fits the overflow budget with a large old tool result and keeps the current tool pair", async () => {
  dir = await mkdtemp(join(process.env.PI_SCRATCH_DIR!, "final-budget-overflow-"));
  const path = join(dir, "events.jsonl");
  const currentOutput = "latest file text ".repeat(1_500);
  const initial = [
    { type: "user_message", content: "keep the public API compatible" },
    ...Array.from({ length: 8 }, () => ({ type: "assistant_message", content: "old note ".repeat(12) })),
    { type: "tool_call", id: "earlier", name: "read_file", args: { path: "earlier.ts" } },
    { type: "tool_result", callId: "earlier", ok: true, output: "old file text ".repeat(1_350) },
    { type: "user_message", content: "continue with current.ts" },
    { type: "tool_call", id: "current", name: "read_file", args: { path: "current.ts" } },
    { type: "tool_result", callId: "current", ok: true, output: currentOutput },
  ].map((event) => JSON.stringify(event) + "\n").join("");
  await writeFile(path, initial);
  const sent: GlmMessage[][] = [];
  const provider = createSessionProvider(path, {
    map: false, workspace: dir,
    compaction: { config: { inputLimit: 10_000, maxOutputReserve: 2_000 } },
    transport: async function* (messages) {
      sent.push(messages);
      yield { type: "assistant_delta", callId: "response", text: "ok" };
    },
  });

  for await (const _ of provider.stream([])) { /* drain */ }

  expect(sent).toHaveLength(1);
  expect(sent[0]).toContainEqual({ role: "user", content: "keep the public API compatible" });
  expect(sent[0]).toContainEqual({ role: "user", content: "continue with current.ts" });
  expect(sent[0]?.filter((message) => message.role === "assistant" && message.content === "old note ".repeat(12))).toHaveLength(8);
  expect(sent[0]?.flatMap((message) => message.tool_calls ?? []).map((call) => call.id)).toEqual(["current"]);
  expect(sent[0]?.filter((message) => message.role === "tool")).toEqual([
    { role: "tool", tool_call_id: "current", content: currentOutput },
  ]);
  const records = (await replay(path)).filter((event) => event.type === "compaction");
  expect(records).toEqual([expect.objectContaining({
    trigger: "overflow", reason: "hard_buffer", compressed_event_ids: [10, 11],
    summary: expect.stringContaining("已按输入预算摘除 2 条历史事件"),
  })]);
  expect(records[0]!.tokens_after).toBeLessThanOrEqual(8_000);
  expect((await readFile(path, "utf8")).startsWith(initial)).toBe(true);
});

it("uses the selected DeepSeek effort for the main budget while keeping the summary call light", async () => {
  dir = await mkdtemp(join(process.env.PI_SCRATCH_DIR!, "final-budget-deepseek-"));
  vi.stubEnv("DEEPSEEK_API_KEY", "test-only");
  const requests: Record<string, unknown>[] = [];
  vi.stubGlobal("fetch", async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    requests.push(body);
    if (body.stream === false) {
      return Response.json({ choices: [{ message: { content: "## Objective\nContinue the task" }, finish_reason: "stop" }] });
    }
    return new Response('data: {"choices":[{"delta":{"content":"done"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', {
      headers: { "content-type": "text/event-stream" },
    });
  });
  const spec = resolveModel(DEFAULT_MODEL_TABLE, "deepseek-strong");
  const seed = [
    { type: "user_message", content: "initial request" },
    { type: "assistant_message", content: "old detail. ".repeat(21_333) },
    { type: "user_message", content: "latest request" },
  ].map((event) => JSON.stringify(event) + "\n").join("");

  for (const thinking of ["off", "max"] as const) {
    requests.length = 0;
    const logPath = join(dir, thinking + ".jsonl");
    await writeFile(logPath, seed);
    const log = createEventLog(logPath);
    const provider = createProvider("latest request", "", { kind: "deepseek", spec, modelExplicit: true }, {
      logPath, workspace: dir, emit: (event) => log.append(event), requestFace: () => ({ tools: [], note: "" }),
      thinking, compactionConfig: { inputLimit: 96_000, ratio: 0.8 },
    });
    try {
      for await (const _ of provider.stream([])) { /* drain */ }
    } finally {
      await log.close?.();
    }
    if (thinking === "off") {
      expect(requests).toEqual([expect.objectContaining({ stream: true, thinking: { type: "disabled" } })]);
    } else {
      expect(requests).toEqual([
        expect.objectContaining({ stream: false, model: spec.model, thinking: { type: "disabled" } }),
        expect.objectContaining({ stream: true, model: spec.model, thinking: { type: "enabled" }, reasoning_effort: "max" }),
      ]);
      expect(requests[0]).not.toHaveProperty("reasoning_effort");
      expect((await replay(logPath)).at(-1)).toMatchObject({ type: "compaction", trigger: "auto", reason: "threshold" });
    }
  }
});
