// DeepSeek native wire 判卷（2026-10-30）：官方 V4.1 形状与别家「OpenAI 兼容」有三处硬差别——
//   ① `thinking` 缺省 **enabled**：不发字段 = 服务端开思考 ⇒ 适配层必须**永远显式**写开关；
//   ② effort 放进 `thinking.reasoning_effort`（顶层 reasoning_effort 是 OpenAI 家形状）；
//   ③ 标准端点对输入里的 `reasoning_content` 是 400 ⇒ 回放只在 /beta 路径上发生。
// 外加：缓存读数（prompt_cache_hit_tokens / prompt_tokens_details.cached_tokens）、图像 parts。
// 这组此前没有专门判卷（reasoning-wire 只覆盖通用 OpenAI 形状），native 分支等于裸奔。
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { streamDeepSeek } from "../src/providers/deepseek";
import type { ProviderMessage } from "../src/providers";

const KEY = "sk-test-deepseek";
const STANDARD = "https://api.deepseek.com/chat/completions";
const BETA = "https://api.deepseek.com/beta/chat/completions";

type Captured = { body: Record<string, unknown>; events: { type: string; [k: string]: unknown }[] };

async function run(opts: {
  endpoint?: string;
  reasoningEffort?: "off" | "low" | "medium" | "high" | "max";
  messages?: ProviderMessage[];
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
  })) {
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
    for (const effort of [undefined, "off"] as const) {
      const { body } = await run(effort === undefined ? {} : { reasoningEffort: effort });
      expect(body.thinking).toEqual({ type: "disabled" });
      expect("reasoning_effort" in body).toBe(false);
    }
  });

  it("给了档位 ⇒ thinking:{type:'enabled', reasoning_effort}（effort 在 thinking 里，不在顶层）", async () => {
    for (const effort of ["low", "high", "max"] as const) {
      const { body } = await run({ reasoningEffort: effort });
      expect(body.thinking).toEqual({ type: "enabled", reasoning_effort: effort });
      expect("reasoning_effort" in body).toBe(false);
    }
  });
});

describe("reasoning_content 回放分域：标准端点不带、/beta 带", () => {
  const history = (source: string): ProviderMessage[] => [
    { role: "user", content: "上一问" },
    {
      role: "assistant",
      content: "上一答",
      reasoning: { content: "上一次的思考", source },
    } as ProviderMessage,
    { role: "user", content: "接着来" },
  ];

  it("标准端点：assistant 消息不带 reasoning_content（带了会 400）", async () => {
    const { body } = await run({ messages: history(reasoningSource(STANDARD)) });
    const msgs = body.messages as Record<string, unknown>[];
    const assistant = msgs.find((m) => m.role === "assistant");
    expect(assistant).toBeDefined();
    expect("reasoning_content" in assistant!).toBe(false);
  });

  it("/beta 端点 + 同来源：reasoning_content 原样回放（前缀补全通道才有这条）", async () => {
    const source = createHash("sha256").update(BETA + "\0deepseek-flash").digest("hex");
    const { body } = await run({ endpoint: BETA, messages: history(source) });
    const msgs = body.messages as Record<string, unknown>[];
    const assistant = msgs.find((m) => m.role === "assistant");
    expect(assistant?.reasoning_content).toBe("上一次的思考");
  });

  it("来源 hash 不匹配（别家/别端点留下的思考）⇒ 不回放（不拿错模型的思考喂输入）", async () => {
    const { body } = await run({ endpoint: BETA, messages: history("not-this-source") });
    const msgs = body.messages as Record<string, unknown>[];
    expect("reasoning_content" in msgs.find((m) => m.role === "assistant")!).toBe(false);
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
