import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSessionProvider, gateToolSpecs } from "../src/agent/session-provider";
import { createEventLog, type EventLog } from "../src/events";
import type { ModelOutput } from "../src/providers";
import type { GlmMessage } from "../src/providers/glm";

vi.mock("../src/agent/memory/inject", async () =>
  (await import("./helpers/memory-inject-mock")).memoryInjectMock({ project: null, global: null }));

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
    const provider = createSessionProvider(path, {
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
    const provider = createSessionProvider(path, {
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

/* 注入面与逐请求工具面到模型眼前：此前"每轮组装注入了什么"只在装载侧有判据，没有任何一条测
   看过模型那一端 ⇒ provider 少拼一段、或多留一份过期说明都不会红。 */
describe("注入面与逐请求工具面到模型眼前", () => {
  type Observation = { system: string; tools: string[] };

  async function rounds(opts: Parameters<typeof createSessionProvider>[1], between?: () => void): Promise<Observation[]> {
    const path = await setup();
    const seen: Observation[] = [];
    const provider = createSessionProvider(path, {
      map: false, workspace: dir, ...opts,
      transport: async function* (messages, _o, specs): AsyncGenerator<ModelOutput> {
        seen.push({
          system: messages.filter((m) => m.role === "system").map((m) => String(m.content)).join("\n"),
          tools: (specs ?? []).map((s) => s.function.name),
        });
        yield { type: "assistant_message", content: "ok" };
      },
    });
    for await (const _ of provider.stream([])) { /* 第一轮 */ }
    between?.(); // 两轮之间发生的事（模型点起一条带申报的 skill 就在这个位置）
    await log.append({ type: "assistant_message", content: "r1" });
    for await (const _ of provider.stream([])) { /* 第二轮 */ }
    return seen;
  }

  it("路由清单 / hook 上下文 / 摘除说明三段都到位，两轮都在（少一段即红）", async () => {
    const seen = await rounds({
      plugins: { skillsRouting: "ROUTING-LIST", hookContext: "HOOK-CONTEXT" },
      requestFace: () => ({ tools: gateToolSpecs("default"), note: "[skill 工具面] grep 已由 /pol:sec 摘除" }),
    });
    expect(seen).toHaveLength(2);
    for (const one of seen) {
      expect(one.system).toContain("ROUTING-LIST");
      expect(one.system).toContain("HOOK-CONTEXT");
      expect(one.system).toContain("/pol:sec");
    }
  });

  it("run 中途激活的 skill：下一轮清单里就没有那把、说明同刻出现（不必再靠 loop 白拒一次）", async () => {
    const denied = new Set<string>();
    const seen = await rounds({
      plugins: { skillsRouting: "ROUTING" },
      requestFace: () => ({
        tools: gateToolSpecs("default").filter((s) => !denied.has(s.function.name)),
        ...(denied.has("grep") ? { note: "[skill 工具面] grep 已由 /pol:sec 摘除" } : {}),
      }),
    }, () => { denied.add("grep"); }); // 模型在第一轮里点起了那条 skill
    expect(seen[0]?.tools).toContain("grep");
    expect(seen[0]?.system).not.toContain("skill 工具面"); // 第一轮没人申报 ⇒ 不凭空解释
    expect(seen[1]?.tools).not.toContain("grep");
    expect(seen[1]?.system).toContain("/pol:sec");
    expect(seen[1]?.tools.length).toBe((seen[0]?.tools.length ?? 0) - 1); // 只摘申报的那一把
  });

  it("没给 requestFace ⇒ 用构造时那份 tools，也不注摘除说明（既有会话零回归）", async () => {
    const seen = await rounds({ tools: gateToolSpecs("read-only") });
    expect(seen[0]?.tools).toEqual(gateToolSpecs("read-only").map((s) => s.function.name));
    expect(seen[1]?.tools).toEqual(seen[0]?.tools);
    expect(seen[1]?.system).toBe("");
  });
});

/* 上下文预算认模型（A-2）：registry.ModelSpec.ctxWindow 此前在 src/ 零消费者，主会话无论路由到
   哪个模型都吃硬编码 128_000 ⇒ 256k/200k/1M 档上提前压缩或误拒（多烧一次摘要 + 白丢冷细节）。 */
describe("主会话预算随模型窗口（128k 帽不再一刀切）", () => {
  /** 无 usage 事件 ⇒ 校准 factor 缺省 4 chars/token：600k chars ≈ 150k token，
   *  落在 128k 帽（可用 119.8k）之上、256k 窗（可用 247.8k）之下。 */
  const BIG = "x".repeat(600_000);

  const drain = async (path: string, opts: Parameters<typeof createSessionProvider>[1]) => {
    const provider = createSessionProvider(path, {
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
    // 128k 窗口的模型（gpt-4o-mini）上把 inputLimit 写成 900k：本地必须钳回 128k
    // （超窗 = 远端 400，不留给远端）。原先这条用 glm-standard 当 128k 样板——
    // 2026-09-19 按官方页把它的窗口校准成 1M 后，样板必须换成真·128k 的档位。
    await expect(drain(path, {
      model: "gpt-4o-mini",
      compaction: { config: { inputLimit: 900_000 } },
    })).rejects.toThrow("context_budget_exceeded");
    // 同一条显式值在 256k 窗口的模型上仍被钳到 256k ⇒ 150k 历史放行
    await drain(path, { model: "glm-5.2-pro", compaction: { config: { inputLimit: 900_000 } } });
    // 1M 窗口的 glm-standard 放行同一份历史 ⇒ 窗口校准确实落到预算面（不是只改了个数）
    await drain(path, { model: "glm-standard", compaction: { config: { inputLimit: 900_000 } } });
  });
});

/* M-1：`--model` 自由档位的模型名按定义**不在档位表里**，所以 `budgetConfig()` 那条
   `findSpecByNameOrId(DEFAULT_MODEL_TABLE, opts.model)` 查表恒为 undefined ⇒ 这一路的预算
   只能吃硬编码 128k。硬编码值对**更小**的模型是高估，而高估那一侧正是「撞远端 400」。
   这一组量的是「窗口真的落到预算面」——不是 spec 上那个字段改了没有（那只是声明）。 */
describe("自由档位的窗口申报落到预算面（M-1）", () => {
  /** 80k token：落在申报的 32k **之上**、128k 缺省**之下**——只有真认了窗口才会拒。
   *  （拿 150k 那份来试是无效的：它在 128k 缺省之上，认不认窗口都拒，测不出接线。） */
  const MID = "x".repeat(320_000);
  /** 150k token：落在 128k 缺省之上、申报的 256k 之下——反方向的那一格。 */
  const BIG = "x".repeat(600_000);
  /** 表外名字：自由档位按定义没有登记，查表那条对它必然 undefined。 */
  const FREEFORM = "stealth/small-window-model";

  const drain = async (path: string, opts: Parameters<typeof createSessionProvider>[1]) => {
    const provider = createSessionProvider(path, {
      map: false, workspace: dir,
      ...opts,
      transport: async function* (): AsyncGenerator<ModelOutput> {
        yield { type: "assistant_message", content: "ok" };
      },
    });
    for await (const _ of provider.stream([])) { /* drain */ }
  };

  it("申报 32k ⇒ 80k 历史本地 fail-closed 拒发（不送到远端吃 400）", async () => {
    const path = await setup();
    await log.append({ type: "assistant_message", content: MID });
    await expect(drain(path, { model: FREEFORM, ctxWindow: 32_000 }))
      .rejects.toThrow("context_budget_exceeded");
  });

  it("反向对照：同一个表外名字、窗口报 256k ⇒ 150k 历史照常发出（认的是窗口，不是名字）", async () => {
    const path = await setup();
    await log.append({ type: "assistant_message", content: BIG });
    await drain(path, { model: FREEFORM, ctxWindow: 256_000 });
  });

  it("缺申报的表外模型仍按 128k 缺省判：80k 放行、150k 拒（这组修的是洞，不是把默认改严了）", async () => {
    const ok = await setup();
    await log.append({ type: "assistant_message", content: MID });
    await drain(ok, { model: FREEFORM }); // 80k < 128k 缺省 ⇒ 放行
    const over = await setup();
    await log.append({ type: "assistant_message", content: BIG });
    await expect(drain(over, { model: FREEFORM })).rejects.toThrow("context_budget_exceeded"); // 150k > 128k ⇒ 拒
  });
});
