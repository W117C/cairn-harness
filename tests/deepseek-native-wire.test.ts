// DeepSeek Chat Completions: explicit mode, top-level effort, and reasoning replay for tool conversations.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { streamDeepSeek, type DeepSeekToolSpec } from "../src/providers/deepseek";
import type { ProviderMessage } from "../src/providers";

const KEY = "sk-test-deepseek";
const STANDARD = "https://api.deepseek.com/chat/completions";
const BETA = "https://api.deepseek.com/beta/chat/completions";
const MIRROR = "https://deepseek.example/v1/chat/completions";
const TOOLS: DeepSeekToolSpec[] = [{ type: "function", function: { name: "probe", parameters: { type: "object" } } }];

type Captured = { body: Record<string, unknown>; events: { type: string; [k: string]: unknown }[] };

async function run(opts: {
  endpoint?: string;
  reasoningEffort?: "off" | "none" | "low" | "high" | "max";
  messages?: ProviderMessage[];
  tools?: DeepSeekToolSpec[];
  sse?: string;
}): Promise<Captured> {
  const bodies: Record<string, unknown>[] = [];
  const fetchImpl = (async (_url: unknown, init: unknown) => {
    bodies.push(JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>);
    return new Response(opts.sse ?? 'data: {"choices":[{"delta":{"content":"好"}}]}\n\ndata: [DONE]\n\n', {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  }) as unknown as typeof fetch;
  const events: { type: string; [k: string]: unknown }[] = [];
  for await (const e of streamDeepSeek(opts.messages ?? [{ role: "user", content: "hi" }], {
    apiKey: KEY,
    model: "deepseek-flash",
    endpoint: opts.endpoint ?? STANDARD,
    fetchImpl,
    ...(opts.reasoningEffort !== undefined ? { reasoningEffort: opts.reasoningEffort } : {}),
  }, opts.tools)) {
    events.push(e as unknown as { type: string; [k: string]: unknown });
  }
  return { body: bodies[0]!, events };
}

/** 与适配器内部同一条来源哈希：sha256(endpoint + "\0" + model)。 */
function reasoningSource(endpoint: string, model = "deepseek-flash"): string {
  return createHash("sha256").update(endpoint + "\0" + model).digest("hex");
}

describe("thinking 开关：DeepSeek 的「不表态」= 开，适配层必须显式写", () => {
  it("未给 effort / off ⇒ thinking:{type:'disabled'}，且不发顶层 reasoning_effort", async () => {
    for (const effort of [undefined, "off", "none"] as const) {
      const { body } = await run(effort === undefined ? {} : { reasoningEffort: effort });
      expect(body.thinking).toEqual({ type: "disabled" });
      expect("reasoning_effort" in body).toBe(false);
    }
  });

  it("标准和镜像端点都使用 thinking.type 和顶层 reasoning_effort", async () => {
    for (const effort of ["low", "high", "max"] as const) {
      const { body } = await run({ reasoningEffort: effort, endpoint: effort === "max" ? MIRROR : STANDARD });
      expect(body.thinking).toEqual({ type: "enabled" });
      expect(body.reasoning_effort).toBe(effort);
    }
  });
});

describe("reasoning_content 按工具面和来源回放", () => {
  const history = (source: string): ProviderMessage[] => [
    { role: "user", content: "上一问" },
    {
      role: "assistant",
      content: "上一答",
      reasoning: { content: "上一次的思考", source },
    } as ProviderMessage,
    { role: "user", content: "接着来" },
  ];

  it("没有工具时省略标准端点不使用的推理内容", async () => {
    const { body } = await run({ messages: history(reasoningSource(STANDARD)), reasoningEffort: "high", tools: [] });
    const msgs = body.messages as Record<string, unknown>[];
    const assistant = msgs.find((m) => m.role === "assistant");
    expect(assistant).toBeDefined();
    expect("reasoning_content" in assistant!).toBe(false);
  });

  it.each([STANDARD, MIRROR, BETA])("带工具时原样回放先前纯回答的推理内容 %s", async (endpoint) => {
    const { body } = await run({ endpoint, messages: history(reasoningSource(endpoint)), reasoningEffort: "high", tools: TOOLS });
    const msgs = body.messages as Record<string, unknown>[];
    const assistant = msgs.find((m) => m.role === "assistant");
    expect(assistant?.reasoning_content).toBe("上一次的思考");
  });

  it("来源 hash 不匹配（别家/别端点留下的思考）⇒ 不回放（不拿错模型的思考喂输入）", async () => {
    const { body } = await run({ messages: history("not-this-source"), reasoningEffort: "high", tools: TOOLS });
    const msgs = body.messages as Record<string, unknown>[];
    expect("reasoning_content" in msgs.find((m) => m.role === "assistant")!).toBe(false);
  });

  it("keeps tool pairs usable when old history has no replayable reasoning", async () => {
    const { body } = await run({ reasoningEffort: "max", tools: TOOLS, messages: [
      { role: "user", content: "read the probe" },
      { role: "assistant", content: null,
        reasoning: { source: "other-model", content: "unrelated thought" },
        tool_calls: [{ id: "old", type: "function", function: { name: "probe", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "old", content: "7" },
    ] });
    const messages = body.messages as Record<string, unknown>[];
    expect(messages[1]).toMatchObject({ role: "assistant", reasoning_content: "", tool_calls: [{ id: "old" }] });
    expect(messages[2]).toMatchObject({ role: "tool", tool_call_id: "old", content: "7" });
  });
});

describe("流式与计量", () => {
  it("reasoning_content 增量进 thinking_delta，正文不混；缓存读数照收", async () => {
    const sse =
      'data: {"choices":[{"delta":{"reasoning_content":"先想一步"}}]}\n\n' +
      'data: {"choices":[{"delta":{"content":"结论"}}]}\n\n' +
      'data: {"choices":[],"usage":{"prompt_tokens":100,"completion_tokens":10,"prompt_cache_hit_tokens":80}}\n\n' +
      "data: [DONE]\n\n";
    const { events } = await run({ sse });
    expect(events.filter((e) => e.type === "thinking_delta").map((e) => e.text)).toEqual(["先想一步"]);
    expect(events.filter((e) => e.type === "assistant_delta").map((e) => e.text)).toEqual(["结论"]);
    const usage = events.find((e) => e.type === "usage");
    // 事件层约定（pricing.ts）：inputTokens **含**缓存读，cacheRead 是其中一部分；
    // costUsd 定价时先剥出未命中段——这里照契约钉，别把「含缓存」误记成「加上缓存」。
    expect(usage).toMatchObject({ inputTokens: 100, outputTokens: 10, cacheReadInputTokens: 80 });
  });

  it("图像 parts 走 OpenAI image_url 形状（deepseek-flash 收图）", async () => {
    const msg = {
      role: "user",
      content: "看图",
      contentParts: [{ type: "image", dataUrl: "data:image/png;base64,AAAA" }],
    } as unknown as ProviderMessage;
    const { body } = await run({ messages: [msg] });
    const wire = (body.messages as Record<string, unknown>[])[0]!;
    expect(wire.content).toEqual([
      { type: "text", text: "看图" },
      { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
    ]);
  });
});
