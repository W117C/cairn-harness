import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGlmSessionProvider, gateToolSpecs } from "../src/agent/glm-session";
import { createEventLog, type EventLog } from "../src/events";
import type { ModelOutput } from "../src/providers";
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

/* 上下文预算认模型（A-2）：registry.ModelSpec.ctxWindow 此前在 src/ 零消费者，主会话无论路由到
   哪个模型都吃硬编码 128_000 ⇒ 256k/200k/1M 档上提前压缩或误拒（多烧一次摘要 + 白丢冷细节）。 */
describe("主会话预算随模型窗口（128k 帽不再一刀切）", () => {
  /** 无 usage 事件 ⇒ 校准 factor 缺省 4 chars/token：600k chars ≈ 150k token，
   *  落在 128k 帽（可用 119.8k）之上、256k 窗（可用 247.8k）之下。 */
  const BIG = "x".repeat(600_000);

  const drain = async (path: string, opts: Parameters<typeof createGlmSessionProvider>[1]) => {
    const provider = createGlmSessionProvider(path, {
      map: false, workspace: dir,
      ...opts,
      transport: async function* (): AsyncGenerator<ModelOutput> {
        yield { type: "assistant_message", content: "ok" };
      },
    });
    for await (const _ of provider.stream([])) { /* drain */ }
  };

  it("同一份历史：缺省 128k 帽下 fail-closed 拒发，换 256k 窗口模型后照常发出", async () => {
    const path = await setup();
    await log.append({ type: "assistant_message", content: BIG });
    await expect(drain(path, {})).rejects.toThrow("context_budget_exceeded");
    await drain(path, { model: "glm-5.2-pro" }); // 不抛 ⇒ 预算真认模型（同一份历史、同一条代码路径）
  });

  it("显式 config 只能往下调，不许越过模型真实窗口", async () => {
    const path = await setup();
    await log.append({ type: "assistant_message", content: BIG });
    // 128k 窗口的模型上把 inputLimit 写成 900k：本地必须钳回 128k（超窗 = 远端 400，不留给远端）
    await expect(drain(path, {
      model: "glm-standard",
      compaction: { config: { inputLimit: 900_000 } },
    })).rejects.toThrow("context_budget_exceeded");
    // 同一条显式值在 256k 窗口的模型上仍被钳到 256k ⇒ 150k 历史放行
    await drain(path, { model: "glm-5.2-pro", compaction: { config: { inputLimit: 900_000 } } });
  });
});
