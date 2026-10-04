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
  vi.stubEnv("CAIRN_API_KEY", "offline-test-key");
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
  vi.stubEnv("CAIRN_API_KEY", "offline-test-key");
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
  /* 沉淀轮的请求形状（2026-09-30 P2 定稿）：**主会话前缀 + 末尾一条沉淀指令**。
     历史沿革——这格被改过两次，两次都是因为现实变了而不是为了让测试变绿：
     ① 最初：`messages.at(-1) === DISTILL_INSTRUCTION`。那时 provider 既没 system 也没 requestFace，
        请求里就只有这一条指令——**而那条指令其实到不了模型**（脚本化通道才读 messages）。
     ② P2 修缓存：provider 与主会话同前缀 ⇒ 末条变成投影历史尾部，指令不在其中；
        这一格当时如实断成 `{role:"assistant"}`，并在注释里记下「指令到不了模型」这个缺口。
     ③ P2 修缺口（本格现状）：指令经 `ephemeralUserTurn` 送到**末尾** ⇒ 末条又是指令，
        但**前缀同时与主会话同形**（下面两条断的就是这个）。三者互不矛盾：
        追加在尾部不影响前缀缓存，这也是沉淀轮能拿到 98.8% 命中的原因。 */
  const last = requests[1].messages.at(-1);
  expect(last?.role).toBe("user");
  expect(String(last?.content)).toContain(DISTILL_INSTRUCTION.slice(0, 20));
  // 前缀同形：system 与工具面都与主会话一致（缓存能不能命中就看这两格）
  expect(requests[1].messages[0]).toEqual(requests[0].messages[0]);
  expect(requests[1].tools.map((tool) => tool.function.name)).toEqual(requests[0].tools.map((tool) => tool.function.name));
  expect(signals.every((signal) => signal instanceof AbortSignal)).toBe(true);
  expect(result.some((event) => event.type === "user_message" && event.content === DISTILL_INSTRUCTION)).toBe(false);
});

/* 沉淀指令**必须**到达真模型（2026-09-30 修复）。
   缺口原状：真 session provider 以事件日志为唯一事实源（`stream(_messages,_tools)` 明确忽略入参），
   而 `runSessionEndDistill` 把指令放在**内存的 messages 数组**里 ⇒ 实测那一轮请求是
   `[system, user:"USER_TASK", assistant:"TASK_COMPLETED"]`，**指令一个字都不在里面**。
   后果：模型把沉淀轮读成「用户又发了一遍原任务」，不知道四类型纪律、不知道只许调 remember；
   它照样答「无」，而那恰是常见合法终态，所以这个洞长期没被发现
   （旧的 tests/distill.test.ts 全绿是因为它喂脚本化 provider，走不到这条路径）。
   修法：给 session provider 开一条 `ephemeralUserTurn` 通道，指令进**请求末尾**——
   既不落日志（落日志会被下一轮 context 投影当用户发言重放），又不打掉前缀缓存（追加在尾部）。
   这条同时钉住两个性质：**送达** 与 **不落日志**（后者由上面那条 user_message 断言守）。 */
it("沉淀指令真的进到请求里（走真 session provider 这条路）", async () => {
  dir = await mkdtemp(join(tmpdir(), "session-distill-instruction-"));
  initSettingsStore(join(dir, "settings.json"));
  vi.stubEnv("M0A_PROVIDER", "glm");
  vi.stubEnv("CAIRN_API_KEY", "offline-test-key");
  const requests: Array<{ messages: Array<{ role: string; content: unknown }> }> = [];
  vi.stubGlobal("fetch", vi.fn(async (_url, init: RequestInit) => {
    requests.push(JSON.parse(String(init.body)) as { messages: Array<{ role: string; content: unknown }> });
    const content = requests.length === 1 ? "TASK_COMPLETED" : "无";
    return new Response("data: " + JSON.stringify({ choices: [{ delta: { content }, finish_reason: "stop" }] }) + "\n\ndata: [DONE]\n\n", {
      headers: { "content-type": "text/event-stream" },
    });
  }));
  const result = await runAgent({ workspace: dir, message: "USER_TASK", mode: "auto", logPath: join(dir, "session.jsonl") });
  expect(requests).toHaveLength(2);
  const last = requests[1]!.messages.at(-1)!;
  expect(last.role).toBe("user");
  expect(String(last.content)).toContain(DISTILL_INSTRUCTION.slice(0, 20));
  // 送达但不落日志：会话事件流里不许出现这条指令（否则下一轮会被当用户发言重放）
  expect(result.some((e) => e.type === "user_message" && e.content === DISTILL_INSTRUCTION)).toBe(false);
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
  vi.stubEnv("CAIRN_API_KEY", "offline-test-key");
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
  vi.stubEnv("CAIRN_API_KEY", "offline-test-key");
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
  vi.stubEnv("CAIRN_API_KEY", "offline-test-key");
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
  vi.stubEnv("CAIRN_API_KEY", "offline-test-key");
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
