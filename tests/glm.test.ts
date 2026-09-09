import { describe, expect, it } from "vitest";
import {
  mergeAssistantDeltas,
  type AgentEvent,
  type AssistantDeltaEvent,
  type ToolCallEvent,
  type UsageEvent,
} from "../src/events";
import { streamGlm } from "../src/providers/glm";

function stubFetchSse(lines: string[]): typeof fetch {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const l of lines) controller.enqueue(encoder.encode(l + "\n"));
      controller.close();
    },
  });
  return (async () => new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } })) as unknown as typeof fetch;
}

async function collect(gen: AsyncGenerator<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

// 用 JSON.stringify 生成 SSE 数据行，避免手写转义 JSON
function sseLine(obj: unknown): string {
  return "data: " + JSON.stringify(obj);
}

describe("GLM provider（离线解析验证，stub fetch，不联网）", () => {
  it("SSE 增量转事件：delta 合成原文、tool_calls 跨块累积、末 chunk usage 映射", async () => {
    const fetchImpl = stubFetchSse([
      sseLine({ id: "chatcmpl-1", choices: [{ delta: { role: "assistant", content: "你好" } }] }),
      sseLine({ id: "chatcmpl-1", choices: [{ delta: { content: "，世界" } }] }),
      "", // 空行容错
      sseLine({
        id: "chatcmpl-1",
        choices: [
          { delta: { tool_calls: [{ index: 0, id: "call-9", type: "function", function: { name: "read_file", arguments: '{"pa' } }] } },
        ],
      }),
      sseLine({
        id: "chatcmpl-1",
        choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'th":"a.ts"}' } }] } }],
      }),
      sseLine({
        id: "chatcmpl-1",
        choices: [{ delta: {}, finish_reason: "tool_calls" }],
        usage: { prompt_tokens: 11, completion_tokens: 7 },
      }),
      "data: [DONE]",
    ]);
    const events = await collect(
      streamGlm([{ role: "user", content: "hi" }], { apiKey: "test", fetchImpl }),
    );
    const deltas = events.filter((e): e is AssistantDeltaEvent => e.type === "assistant_delta");
    const calls = events.filter((e): e is ToolCallEvent => e.type === "tool_call");
    const usage = events.find((e): e is UsageEvent => e.type === "usage");

    expect(deltas).toHaveLength(2);
    expect(deltas.every((d) => d.callId === "chatcmpl-1")).toBe(true);
    expect(mergeAssistantDeltas(deltas)).toBe("你好，世界");
    // arguments 跨块拼接后解析出完整参数
    expect(calls).toEqual([{ type: "tool_call", id: "call-9", name: "read_file", args: { path: "a.ts" } }]);
    expect(usage).toEqual({ type: "usage", inputTokens: 11, outputTokens: 7 });
  });

  it("非流式分支（stream:false）：整段回复只产生 1 个 delta（反向验证时 ≥2 delta 断言变红）", async () => {
    const body = {
      id: "chatcmpl-2",
      choices: [
        {
          message: {
            content: "一次成型，没有增量。",
            tool_calls: [{ index: 0, id: "call-1", function: { name: "noop", arguments: '{"x":1}' } }],
          },
        },
      ],
      usage: { prompt_tokens: 5, completion_tokens: 2 },
    };
    const fetchImpl = (async () =>
      new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
    const events = await collect(
      streamGlm([{ role: "user", content: "hi" }], { apiKey: "test", stream: false, fetchImpl }),
    );
    const deltas = events.filter((e): e is AssistantDeltaEvent => e.type === "assistant_delta");
    expect(deltas).toHaveLength(1);
    expect(mergeAssistantDeltas(deltas)).toBe("一次成型，没有增量。");
    expect(events.some((e) => e.type === "tool_call" && (e as ToolCallEvent).args["x"] === 1)).toBe(true);
    expect(events.some((e) => e.type === "usage" && (e as UsageEvent).inputTokens === 5)).toBe(true);
  });

  it("key 缺失直接报错（不静默降级）", async () => {
    await expect(async () => {
      for await (const _e of streamGlm([{ role: "user", content: "hi" }], { apiKey: "" })) {
        void _e;
      }
    }).rejects.toThrow(/M0_API_KEY/);
  });
});
