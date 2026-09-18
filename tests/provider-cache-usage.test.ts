// 缓存分块要能走到事件流（能力 9「成本可观测」的测量前置，也是 A1 写侧断点的前置）：
// 此前只有 openai 适配器内部把 cached_tokens 交给 metering，事件流里 inputTokens 一个数打包——
// 于是「这次跑到底命中了没有」在 UI/账本/回放里全都看不见。两个真实缺陷：
// ① Anthropic 的 input_tokens **不含**缓存读写量（与 OpenAI 系 prompt_tokens 含缓存相反），
//    照搬就把长会话的输入少算一个量级（底部 token 总数显示 1.5k 而模型实吃 300k）；
// ② 两家都没把分块透出，缓存价目又未标定 → 任何「值不值得开缓存」的判断都没有分母。
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createEventLog, replay, type AgentEvent, type UsageEvent } from "../src/events";
import type { ProviderMessage } from "../src/providers";
import { streamAnthropic } from "../src/providers/anthropic";
import { streamOpenAI } from "../src/providers/openai";

const USER: ProviderMessage[] = [{ role: "user", content: "hi" }];

function stubFetch(lines: string[]): typeof fetch {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const l of lines) controller.enqueue(encoder.encode(l + "\n"));
      controller.close();
    },
  });
  return (async () => new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } })) as unknown as typeof fetch;
}

async function collect(iter: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const e of iter) out.push(e);
  return out;
}

function usageOf(events: AgentEvent[]): UsageEvent {
  const u = events.find((e): e is UsageEvent => e.type === "usage");
  expect(u, "事件流里应有 usage").toBeDefined();
  return u as UsageEvent;
}

const anthropicSse = (startUsageJson: string, deltaUsageJson = '{"output_tokens":7}'): string[] => [
  `data: {"type":"message_start","message":{"id":"a1","usage":${startUsageJson}}}`,
  'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
  'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"你好"}}',
  'data: {"type":"content_block_stop","index":0}',
  `data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":${deltaUsageJson}}`,
  'data: {"type":"message_stop"}',
];

describe("anthropic 缓存分块与总输入口径", () => {
  it("input_tokens 不含缓存 ⇒ 事件 inputTokens 补成含缓存总输入，分块另列", async () => {
    const events = await collect(streamAnthropic(USER, {
      apiKey: "test",
      // 真实协议：缓存量随 message_start 起报，message_delta 回累计值
      fetchImpl: stubFetch(anthropicSse(
        '{"input_tokens":300,"cache_read_input_tokens":8000,"cache_creation_input_tokens":1200}',
        '{"input_tokens":300,"output_tokens":7,"cache_read_input_tokens":8000,"cache_creation_input_tokens":1200}',
      )),
    }));
    const u = usageOf(events);
    expect(u.inputTokens).toBe(9500); // 300 + 8000 + 1200
    expect(u.outputTokens).toBe(7);
    expect(u.cacheReadInputTokens).toBe(8000);
    expect(u.cacheWriteInputTokens).toBe(1200);
  });

  it("对端没报缓存 ⇒ 不落 0 键（缺报 ≠ 命中为零），inputTokens 逐字旧值", async () => {
    const events = await collect(streamAnthropic(USER, {
      apiKey: "test",
      fetchImpl: stubFetch(anthropicSse('{"input_tokens":11}', '{"input_tokens":11,"output_tokens":7}')),
    }));
    expect(usageOf(events)).toEqual({ type: "usage", inputTokens: 11, outputTokens: 7 });
  });

  it("缓存量只出现在 message_delta（累计帧）时也认，且不跨帧累加", async () => {
    const lines = [
      'data: {"type":"message_start","message":{"id":"a1","usage":{"input_tokens":300,"output_tokens":0}}}',
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"嗨"}}',
      'data: {"type":"content_block_stop","index":0}',
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":7,"cache_read_input_tokens":5000}}',
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":7,"cache_read_input_tokens":5000}}',
      'data: {"type":"message_stop"}',
    ];
    const u = usageOf(await collect(streamAnthropic(USER, { apiKey: "test", fetchImpl: stubFetch(lines) })));
    expect(u.cacheReadInputTokens).toBe(5000); // 两帧同值：取最后累计，不加成 10000
    expect(u.inputTokens).toBe(5300);
  });
});

describe("openai 兼容面缓存透出", () => {
  const chunk = (usageJson: string): string[] => [
    `data: {"id":"c1","choices":[{"index":0,"delta":{"content":"嗨"}}],"usage":${usageJson}}`,
    "data: [DONE]",
  ];

  it("prompt_tokens_details.cached_tokens 透出为 cacheReadInputTokens（inputTokens 保持含缓存口径）", async () => {
    const u = usageOf(await collect(streamOpenAI(USER, {
      apiKey: "test",
      fetchImpl: stubFetch(chunk('{"prompt_tokens":9500,"completion_tokens":7,"prompt_tokens_details":{"cached_tokens":8000}}')),
    })));
    expect(u.inputTokens).toBe(9500);
    expect(u.cacheReadInputTokens).toBe(8000);
    expect(u.cacheWriteInputTokens, "OpenAI 不报写桶：不得凭空补 0").toBeUndefined();
  });

  it("无缓存上报 ⇒ 事件形状与旧一致（零回归）", async () => {
    const u = usageOf(await collect(streamOpenAI(USER, {
      apiKey: "test",
      fetchImpl: stubFetch(chunk('{"prompt_tokens":12,"completion_tokens":3}')),
    })));
    expect(u).toEqual({ type: "usage", inputTokens: 12, outputTokens: 3 });
  });
});

describe("最后一跳：缓存分块必须活着经过事件日志与回放", () => {
  it("append → replay 后分块不丢（事件流是新计费口径唯一的消费者面）", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cache-usage-"));
    try {
      const logPath = join(dir, "events.jsonl");
      const log = createEventLog(logPath);
      await log.append({ type: "session_meta" } as AgentEvent);
      await log.append({
        type: "usage", inputTokens: 9500, outputTokens: 7, cacheReadInputTokens: 8000, cacheWriteInputTokens: 1200,
      } as AgentEvent);
      const back = await replay(logPath);
      const u = usageOf(back);
      expect(u.cacheReadInputTokens).toBe(8000);
      expect(u.cacheWriteInputTokens).toBe(1200);
      expect(u.inputTokens).toBe(9500);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
