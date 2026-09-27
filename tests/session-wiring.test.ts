import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withoutTs } from "./helpers/stream-equals";
import { afterEach, expect, it, vi } from "vitest";
import { handleRunCancel, initSettingsStore, runAgent } from "../src/main/agent-runner";
import { createEventLog, replay, type AgentEvent } from "../src/events";
import { DISTILL_INSTRUCTION } from "../src/agent/memory/distill";
import { AskGate } from "../src/main/ask-gate";
import { remember } from "../src/tools/remember";
import { PluginRuntime } from "../src/agent/plugins";

let dir = "";
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  if (dir) await rm(dir, { recursive: true, force: true });
});

it("UI cancellation settles the distillation approval immediately without writing memory", async () => {
  dir = await mkdtemp(join(tmpdir(), "distill-approval-cancel-"));
  initSettingsStore(join(dir, "settings.json"));
  vi.stubEnv("M0A_PROVIDER", "glm");
  vi.stubEnv("M0_API_KEY", "offline-test-key");
  const write = vi.spyOn(remember, "run");
  let requests = 0;
  vi.stubGlobal("fetch", vi.fn(async () => {
    requests++;
    const delta = requests === 1 ? { content: "TASK_COMPLETED" } : {
      tool_calls: [{ index: 0, id: "distill-remember", type: "function", function: {
        name: "remember", arguments: JSON.stringify({ scope: "project", kind: "memory", type: "user", topic: "language", content: "Chinese" }),
      } }],
    };
    return new Response("data: " + JSON.stringify({ choices: [{ delta, finish_reason: requests === 1 ? "stop" : "tool_calls" }] }) + "\n\ndata: [DONE]\n\n", {
      headers: { "content-type": "text/event-stream" },
    });
  }));
  const outcomes: string[] = [];
  let pendingAfterCancel: number | undefined;
  const askGate = new AskGate({
    timeoutMs: 100,
    notify: () => {
      expect(handleRunCancel().ok).toBe(true);
      pendingAfterCancel = askGate.pendingCount;
    },
    notifyOutcome: (_id, _outcome, reason) => { outcomes.push(reason); },
  });
  await runAgent({ workspace: dir, message: "USER_TASK", mode: "default", logPath: join(dir, "session.jsonl"), askGate });
  expect(requests).toBe(2);
  expect(pendingAfterCancel).toBe(0);
  expect(outcomes).toEqual(["user"]);
  expect(askGate.pendingCount).toBe(0);
  expect(write).not.toHaveBeenCalled();
});

it("distillation consumes session history and its instruction with only remember exposed", async () => {
  dir = await mkdtemp(join(tmpdir(), "session-distill-"));
  initSettingsStore(join(dir, "settings.json"));
  vi.stubEnv("M0A_PROVIDER", "glm");
  vi.stubEnv("M0_API_KEY", "offline-test-key");
  const requests: Array<{ messages: Array<{ role: string; content: string }>; tools: Array<{ function: { name: string } }> }> = [];
  const signals: Array<AbortSignal | null | undefined> = [];
  vi.stubGlobal("fetch", vi.fn(async (_url, init: RequestInit) => {
    requests.push(JSON.parse(String(init.body)));
    signals.push(init.signal);
    const content = requests.length === 1 ? "TASK_COMPLETED" : "无";
    return new Response("data: " + JSON.stringify({ choices: [{ delta: { content }, finish_reason: "stop" }] }) + "\n\ndata: [DONE]\n\n", {
      headers: { "content-type": "text/event-stream" },
    });
  }));
  const result = await runAgent({ workspace: dir, message: "USER_TASK", mode: "default", logPath: join(dir, "session.jsonl") });
  expect(requests).toHaveLength(2);
  expect(requests[1].messages).toContainEqual({ role: "user", content: "USER_TASK" });
  expect(requests[1].messages).toContainEqual({ role: "assistant", content: "TASK_COMPLETED" });
  expect(requests[1].messages.at(-1)).toEqual({ role: "user", content: DISTILL_INSTRUCTION });
  expect(requests[1].tools.map((tool) => tool.function.name)).toEqual(["remember"]);
  expect(signals.every((signal) => signal instanceof AbortSignal)).toBe(true);
  expect(result.some((event) => event.type === "user_message" && event.content === DISTILL_INSTRUCTION)).toBe(false);
});

it("production GLM run restores history and sends tool feedback in a fresh request", async () => {
  dir = await mkdtemp(join(tmpdir(), "session-wiring-"));
  initSettingsStore(join(dir, "settings.json"));
  vi.stubEnv("M0A_PROVIDER", "glm");
  vi.stubEnv("M0_API_KEY", "offline-test-key");
  await writeFile(join(dir, "input.txt"), "WORKSPACE_FEEDBACK");
  const logPath = join(dir, "session.jsonl");
  const log = createEventLog(logPath);
  await log.append({ type: "user_message", content: "PRIOR_HISTORY" });
  await log.append({ type: "assistant_message", content: "prior answer" });
  await log.close?.();
  const requests: Array<{ messages: Array<Record<string, unknown>>; tools?: Array<{ function: { name: string } }> }> = [];
  vi.stubGlobal("fetch", vi.fn(async (_url, init: RequestInit) => {
    requests.push(JSON.parse(String(init.body)));
    const delta = requests.length === 1
      ? { tool_calls: [{ index: 0, id: "read-one", type: "function", function: { name: "read_file", arguments: JSON.stringify({ path: "input.txt" }) } }] }
      : { content: "finished" };
    return new Response('data: ' + JSON.stringify({ id: "reply", choices: [{ delta, finish_reason: requests.length === 1 ? "tool_calls" : "stop" }] }) + '\n\ndata: [DONE]\n\n', {
      headers: { "content-type": "text/event-stream" },
    });
  }));
  const live: AgentEvent[] = [];
  const result = await runAgent({
    workspace: dir, message: "read input.txt", mode: "read-only", sessionId: "session", logPath,
    onEvent: (event) => live.push(event),
  });
  expect(requests).toHaveLength(2);
  expect(requests[0]?.messages).toContainEqual({ role: "user", content: "PRIOR_HISTORY" });
  expect(requests[0]?.tools?.map((tool) => tool.function.name)).toContain("read_file");
  expect(requests[0]?.tools?.map((tool) => tool.function.name)).not.toContain("write_file");
  expect(requests[1]?.messages).toContainEqual(expect.objectContaining({ role: "tool", tool_call_id: "read-one", content: expect.stringContaining("WORKSPACE_FEEDBACK") }));
  expect(withoutTs(result[0]!)).toEqual({ type: "user_message", content: "PRIOR_HISTORY" });
  // 落盘戳盖在事件本身上 ⇒ live 与重放必须是同一个式子（不剥字段）
  expect(live).toEqual(result.slice(2));
  const resumed = await runAgent({
    workspace: dir, message: "FOLLOW_UP", mode: "read-only", sessionId: "session", logPath,
  });
  expect(requests).toHaveLength(3);
  expect(requests[2]?.messages).toContainEqual({ role: "user", content: "PRIOR_HISTORY" });
  expect(requests[2]?.messages).toContainEqual({ role: "user", content: "FOLLOW_UP" });
  expect(requests[2]?.messages).toContainEqual(expect.objectContaining({ role: "tool", content: expect.stringContaining("WORKSPACE_FEEDBACK") }));
  expect(resumed.slice(0, result.length)).toEqual(result);
});

it("UI cancellation reaches the request even when the caller supplies a signal", async () => {
  dir = await mkdtemp(join(tmpdir(), "session-cancel-"));
  initSettingsStore(join(dir, "settings.json"));
  vi.stubEnv("M0A_PROVIDER", "glm");
  vi.stubEnv("M0_API_KEY", "offline-test-key");
  const caller = new AbortController();
  let requestAborted = false;
  let cancelAccepted = false;
  vi.stubGlobal("fetch", vi.fn(async (_url, init: RequestInit) => {
    cancelAccepted = handleRunCancel().ok;
    requestAborted = init.signal?.aborted === true;
    return new Response("data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
  }));
  await runAgent({
    workspace: dir, message: "stop", mode: "read-only", logPath: join(dir, "session.jsonl"),
    signal: caller.signal,
  });
  expect(cancelAccepted).toBe(true);
  expect(caller.signal.aborted).toBe(false);
  expect(requestAborted).toBe(true);
});

it.each([false, true])("production GLM compaction publishes only completed summaries (cancel=%s)", async (cancel) => {
  const remount = vi.spyOn(PluginRuntime.prototype, "remountFromEvents").mockImplementation((events) => ({
    text: events.some((event) => event.type === "compaction") ? "REMOUNTED_SKILL" : null,
    mounted: [], tokens: 0,
  }));
  dir = await mkdtemp(join(tmpdir(), "session-compact-"));
  initSettingsStore(join(dir, "settings.json"));
  vi.stubEnv("M0A_PROVIDER", "glm");
  vi.stubEnv("M0_API_KEY", "offline-test-key");
  const logPath = join(dir, "session.jsonl");
  const log = createEventLog(logPath);
  await log.append({ type: "user_message", content: "ORIGINAL_TASK" });
  for (let i = 0; i < 60; i++) {
    await log.append({ type: "assistant_message", content: `OLD_${i}:` + "x".repeat(7500) });
  }
  await log.close?.();
  const live: AgentEvent[] = [];
  const requests: Array<{ stream: boolean; messages: Array<{ content: string }> }> = [];
  vi.stubGlobal("fetch", vi.fn(async (_url, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    requests.push(body);
    if (body.stream === false) {
      if (cancel) {
        expect(handleRunCancel().ok).toBe(true);
        expect(init.signal?.aborted).toBe(true);
      }
      return Response.json({ id: "summary", choices: [{ message: { content: "COMPACTED_HISTORY" }, finish_reason: "stop" }] });
    }
    return new Response("data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
  }));
  const run = runAgent({
    workspace: dir, message: "LATEST_TASK", mode: "read-only", sessionId: "session", logPath,
    onEvent: (event) => live.push(event),
  });
  if (cancel) {
    await expect(run).rejects.toThrow();
    expect(requests).toHaveLength(1);
    expect(live.some((e) => e.type === "compaction")).toBe(false);
    expect((await replay(logPath)).some((e) => e.type === "compaction")).toBe(false);
    return;
  }
  const result = await run;
  expect(requests).toHaveLength(2);
  expect(requests[0].stream).toBe(false);
  expect(requests[1].messages.some((m) => m.content?.includes("COMPACTED_HISTORY"))).toBe(true);
  expect(requests[1].messages).toContainEqual({ role: "user", content: "LATEST_TASK" });
  expect(requests[1].messages).toContainEqual({ role: "system", content: "REMOUNTED_SKILL" });
  expect(remount).toHaveBeenCalledTimes(2);
  const compact = live.find((e) => e.type === "compaction");
  expect(compact).toMatchObject({ trigger: "auto", reason: "threshold" });
  expect(result.slice(61)).toEqual(live);
  if (compact?.type === "compaction") expect(compact.tokens_after).toBeLessThan(compact.tokens_before);
});
