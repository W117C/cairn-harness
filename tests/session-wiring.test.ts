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
  /* 沉淀轮的请求形状（2026-09-30 P2 改口径后）：它是**主会话前缀 + 沉淀指令**。
     改前这格断的是 `messages.at(-1) === DISTILL_INSTRUCTION` —— 那时 provider 没有 system、
     没有 requestFace，请求里只有这一条指令；改成同前缀之后，最后一条是投影历史的尾部，
     指令**不在其中**。
     这条断言顺带把一个更早的问题钉住了（见下面那条 it 的说明）：走**真** session provider 时，
     指令根本到不了模型——provider 以事件日志为唯一事实源，而指令只在内存 messages 里。 */
  expect(requests[1].messages.at(-1)).toEqual({ role: "assistant", content: "TASK_COMPLETED" });
  // 前缀同形：system 与工具面都与主会话一致（缓存能不能命中就看这两格）
  expect(requests[1].messages[0]).toEqual(requests[0].messages[0]);
  expect(requests[1].tools.map((tool) => tool.function.name)).toEqual(requests[0].tools.map((tool) => tool.function.name));
  expect(signals.every((signal) => signal instanceof AbortSignal)).toBe(true);
  expect(result.some((event) => event.type === "user_message" && event.content === DISTILL_INSTRUCTION)).toBe(false);
});

/* ⚠️ 已知缺口（2026-09-30 实测发现，**尚未修**）：沉淀指令到不了真模型。
   走**真** session provider 时，provider 以事件日志为唯一事实源（`glm-session.ts` 的
   `stream(_messages, _tools)` 明确忽略入参），而 `runSessionEndDistill` 把指令放在**内存的
   messages 数组**里（`distill.ts` 的 `[...projectContext(events), { role: "user", content: instruction }]`）
   ⇒ 实测那一轮的请求是 `[system, user:"USER_TASK", assistant:"TASK_COMPLETED"]`，
   **指令一个字都不在里面**。
   影响：模型收到的是「用户又发了一遍原任务」，不知道这是在沉淀（不知道四类型纪律、不知道
   只许调 remember），于是它答「无」——那恰好是常见终态，所以这个洞一直没被人看见。
   现有的 `tests/distill.test.ts` 全绿是因为它喂的是**脚本化 provider**（直接 yield 预设输出），
   走的不是真 provider 的取历史路径。
   为什么先记在这里而不是当场改（判据见 goal 的纪律：先量再改）：
   修它要给 session provider 开一条「本轮额外追加一条 user 消息」的通道，
   涉及 context 投影与压缩边界（指令落进日志就会被下一轮重放）。
   本测试**断言的是当前（错）行为**，它绿不代表对——修好之后这一条必须翻成
   `expect(instructionDelivered).toBe(true)`，那时它会红，逼人把注释一起改掉。 */
it("⚠️ 缺口记录：沉淀指令当前到不了真模型（修好后本断言要翻面）", async () => {
  dir = await mkdtemp(join(tmpdir(), "session-distill-instruction-"));
  initSettingsStore(join(dir, "settings.json"));
  vi.stubEnv("M0A_PROVIDER", "glm");
  vi.stubEnv("M0_API_KEY", "offline-test-key");
  const requests: Array<{ messages: Array<{ role: string; content: unknown }> }> = [];
  vi.stubGlobal("fetch", vi.fn(async (_url, init: RequestInit) => {
    requests.push(JSON.parse(String(init.body)) as { messages: Array<{ role: string; content: unknown }> });
    const content = requests.length === 1 ? "TASK_COMPLETED" : "无";
    return new Response("data: " + JSON.stringify({ choices: [{ delta: { content }, finish_reason: "stop" }] }) + "\n\ndata: [DONE]\n\n", {
      headers: { "content-type": "text/event-stream" },
    });
  }));
  await runAgent({ workspace: dir, message: "USER_TASK", mode: "auto", logPath: join(dir, "session.jsonl") });
  expect(requests).toHaveLength(2);
  const instructionDelivered = requests[1]!.messages.some(
    (m) => typeof m.content === "string" && m.content.includes(DISTILL_INSTRUCTION.slice(0, 20)),
  );
  expect(instructionDelivered).toBe(false); // ← 当前行为；修好后改成 true
});

/* P2（2026-09-30）：沉淀轮的 provider 必须与主会话同前缀，否则前缀缓存一次也命中不了。
   动因是实测：改前沉淀轮 input 4,417 tok、cacheRead **181**（几乎全价），占整场有效代价 27.4%；
   改后 cacheRead 8,010/8,116（98.8%），占 5.8%——4,254 → 907 有效 tok。
   根因：旧写法 `createProvider(promptText, undefined, modelSelection)` 没传 sessionOptions ⇒
   provider 拿不到 system、也拿不到 requestFace，发出去的请求在很靠前的地方就与主会话分叉。
   这条钉的就是那两样：**system 载荷与主会话逐字一致**、工具面走同一个 requestFace。 */
it("沉淀轮的请求与主会话共享同一个前缀（system 同形 + 工具面同形）", async () => {
  dir = await mkdtemp(join(tmpdir(), "session-distill-prefix-"));
  initSettingsStore(join(dir, "settings.json"));
  vi.stubEnv("M0A_PROVIDER", "glm");
  vi.stubEnv("M0_API_KEY", "offline-test-key");
  const requests: Array<Record<string, unknown>> = [];
  vi.stubGlobal("fetch", vi.fn(async (_url, init: RequestInit) => {
    requests.push(JSON.parse(String(init.body)) as Record<string, unknown>);
    const content = requests.length === 1 ? "done" : "无";
    return new Response("data: " + JSON.stringify({ choices: [{ delta: { content }, finish_reason: "stop" }] }) + "\n\ndata: [DONE]\n\n", {
      headers: { "content-type": "text/event-stream" },
    });
  }));
  await runAgent({ workspace: dir, message: "T", mode: "auto", logPath: join(dir, "session.jsonl") });
  expect(requests).toHaveLength(2);
  type Msg = { role: string; content: unknown };
  const sys = (r: Record<string, unknown>): unknown => (r["messages"] as Msg[])[0]?.content;
  // system 必须同形：旧写法这一格是 undefined（provider 根本没有 system）
  expect(sys(requests[1]!)).toBeDefined();
  expect(sys(requests[1]!)).toEqual(sys(requests[0]!));
  const names = (r: Record<string, unknown>): string[] =>
    ((r["tools"] as Array<{ function: { name: string } }> | undefined) ?? []).map((t) => t.function.name);
  expect(names(requests[1]!)).toEqual(names(requests[0]!));
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
