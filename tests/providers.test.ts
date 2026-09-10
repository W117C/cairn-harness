import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { mergeAssistantDeltas, type AgentEvent, type AssistantDeltaEvent, type ToolCallEvent, type UsageEvent } from "../src/events";
import type { ProviderMessage, ProviderToolSpec } from "../src/providers";
import { streamOpenAI } from "../src/providers/openai";
import { streamAnthropic } from "../src/providers/anthropic";
import { streamGemini } from "../src/providers/gemini";

const ROOT = join(import.meta.dirname, "..");
const FIX = (p: string) => join(ROOT, "fixtures", "providers", p);
const SPEC: ProviderToolSpec = {
  name: "read_file",
  description: "读取",
  parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
};
const USER: ProviderMessage[] = [{ role: "user", content: "hi" }];

async function loadLines(rel: string): Promise<string[]> {
  const raw = await readFile(FIX(rel), "utf8");
  return raw.split("\n").filter((l) => l.trim().length > 0);
}

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

function deltasOf(events: AgentEvent[]): AssistantDeltaEvent[] {
  return events.filter((e): e is AssistantDeltaEvent => e.type === "assistant_delta");
}
function callsOf(events: AgentEvent[]): ToolCallEvent[] {
  return events.filter((e): e is ToolCallEvent => e.type === "tool_call");
}
function usageOf(events: AgentEvent[]): UsageEvent | undefined {
  return events.find((e): e is UsageEvent => e.type === "usage");
}

describe.each([
  { key: "openai", dir: "openai", stream: streamOpenAI },
  { key: "anthropic", dir: "anthropic", stream: streamAnthropic },
  { key: "gemini", dir: "gemini", stream: streamGemini },
])("$key 适配器 fixture 回放（任务2/3/4/5 验收）", ({ dir, stream }) => {
  it("①文本流：fixture 回放产出「你好，世界」+ usage > 0（测试直接消费各家原始字段）", async () => {
    const events = await collect(stream(USER, { apiKey: "test", fetchImpl: stubFetch(await loadLines(join(dir, "text-stream.sse"))) }, [SPEC]));
    expect(mergeAssistantDeltas(deltasOf(events))).toBe("你好，世界");
    const usage = usageOf(events);
    expect(usage).toBeDefined();
    expect(usage!.inputTokens).toBe(11);
    expect(usage!.outputTokens).toBe(7);
  });

  it("②工具调用：fixture 回放产出两条 read_file，参数为完整 JSON（分片拼接/并行调用）", async () => {
    const events = await collect(stream(USER, { apiKey: "test", fetchImpl: stubFetch(await loadLines(join(dir, "tool-call.sse"))) }, [SPEC]));
    expect(callsOf(events)).toEqual([
      { type: "tool_call", id: expect.any(String), name: "read_file", args: { path: "a.ts" } },
      { type: "tool_call", id: expect.any(String), name: "read_file", args: { path: "b.ts" } },
    ]);
  });

  it("③错误事件：fixture 回放抛可读错误", async () => {
    await expect(async () => {
      await collect(stream(USER, { apiKey: "test", fetchImpl: stubFetch(await loadLines(join(dir, "error.sse"))) }, [SPEC]));
    }).rejects.toThrow(/流错误/);
  });

  it("④未知事件：fixture 回放优雅跳过不抛错，正常文本继续", async () => {
    const events = await collect(stream(USER, { apiKey: "test", fetchImpl: stubFetch(await loadLines(join(dir, "unknown.sse"))) }, [SPEC]));
    expect(mergeAssistantDeltas(deltasOf(events))).toBe("你好，世界");
  });
});

describe("anthropic 协议细节（任务3 验收）", () => {
  it("message_delta 的 usage 是累计值：多次出现不重复累加", async () => {
    const base = await loadLines("anthropic/text-stream.sse");
    const withTwoDeltas = [
      ...base.slice(0, base.findIndex((l) => l.includes("message_delta"))),
      'data: {"type":"message_delta","delta":{"stop_reason":null},"usage":{"input_tokens":11,"output_tokens":3}}',
      base[base.findIndex((l) => l.includes("message_delta"))],
      ...base.slice(base.findIndex((l) => l.includes("message_delta")) + 1),
    ];
    const events = await collect(streamAnthropic(USER, { apiKey: "test", fetchImpl: stubFetch(withTwoDeltas) }));
    expect(usageOf(events)).toEqual({ type: "usage", inputTokens: 11, outputTokens: 7 }); // 取最后累计值，不 3+7
  });

  it("input_json_delta 分片拼接：逐片累积后解析完整 JSON（不取首片）", async () => {
    const events = await collect(streamAnthropic(USER, { apiKey: "test", fetchImpl: stubFetch(await loadLines("anthropic/tool-call.sse")) }));
    expect(callsOf(events)[0].args).toEqual({ path: "a.ts" }); // '{"pa' + 'th":"a.ts"}' 两片拼接
  });

  it("key 缺失直接报错（不静默降级）", async () => {
    await expect(async () => {
      for await (const _e of streamAnthropic(USER, { apiKey: "" })) void _e;
    }).rejects.toThrow(/ANTHROPIC_API_KEY/);
  });
});

describe("gemini 协议细节（任务4 验收）", () => {
  it("一个 chunk 多个并行 functionCall 全部解析（fixture 已含 2 个；再构造 3 个）", async () => {
    const lines = [
      'data: {"candidates":[{"content":{"parts":[{"functionCall":{"name":"t1","args":{"a":1}}},{"functionCall":{"name":"t2","args":{"b":2}}},{"functionCall":{"name":"t3"}}],"role":"model"},"finishReason":"STOP","index":0}],"usageMetadata":{"promptTokenCount":5,"candidatesTokenCount":9,"thoughtsTokenCount":2,"totalTokenCount":16}}',
    ];
    const events = await collect(streamGemini(USER, { apiKey: "test", fetchImpl: stubFetch(lines) }));
    expect(callsOf(events).map((c) => c.name)).toEqual(["t1", "t2", "t3"]);
    expect(callsOf(events)[0].args).toEqual({ a: 1 });
    // thoughtsTokenCount 计入 outputTokens（candidatesTokenCount + thoughtsTokenCount）
    expect(usageOf(events)).toEqual({ type: "usage", inputTokens: 5, outputTokens: 11 });
  });

  it("functionResponse 回传格式正确（name 从配对 tool_call 反查，response 为对象）", async () => {
    const { toGeminiBody } = await import("../src/providers/gemini");
    const body = toGeminiBody([
      { role: "user", content: "hi" },
      { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "read_file", arguments: '{"path":"a.ts"}' } }] },
      { role: "tool", tool_call_id: "c1", content: "{\"ok\":true}" },
    ]);
    expect(body.contents).toEqual([
      { role: "user", parts: [{ text: "hi" }] },
      { role: "model", parts: [{ functionCall: { name: "read_file", args: { path: "a.ts" } } }] },
      { role: "user", parts: [{ functionResponse: { name: "read_file", response: { ok: true } } }] },
    ]);
  });

  it("key 缺失直接报错（不静默降级）", async () => {
    await expect(async () => {
      for await (const _e of streamGemini(USER, { apiKey: "" })) void _e;
    }).rejects.toThrow(/GEMINI_API_KEY/);
  });
});

describe("跨 provider 契约（任务6：同一逻辑对话三家等价）", () => {
  it("三家文本逐字相同 + tool_call 名与参数相同 + usage 均 > 0", async () => {
    const turns = await Promise.all(
      [
        { dir: "openai", stream: streamOpenAI },
        { dir: "anthropic", stream: streamAnthropic },
        { dir: "gemini", stream: streamGemini },
      ].map(async (a) => {
        const events = await collect(
          a.stream(USER, { apiKey: "test", fetchImpl: stubFetch(await loadLines(join(a.dir, "tool-call.sse"))) }, [SPEC]),
        );
        return {
          text: mergeAssistantDeltas(deltasOf(events)),
          calls: callsOf(events).map((c) => ({ name: c.name, args: c.args })),
          usage: usageOf(events),
        };
      }),
    );
    const texts = new Set(turns.map((t) => t.text));
    expect(texts.size).toBe(1); // anthropic tool-call fixture 无文本 → 三家同为空串
    const serialized = turns.map((t) => JSON.stringify(t.calls));
    expect(new Set(serialized).size).toBe(1);
    expect(turns[0].calls).toEqual([
      { name: "read_file", args: { path: "a.ts" } },
      { name: "read_file", args: { path: "b.ts" } },
    ]);
    for (const t of turns) {
      expect(t.usage && t.usage.inputTokens > 0 && t.usage.outputTokens > 0).toBe(true);
    }
  });
});
