// §3.3 停止原因（三家 provider 的「这一轮为什么停了」）第一次有读者。
// 动手前的实测：fixtures/providers/**/*.sse 逐字记着 end_turn / stop / STOP / tool_use，
// 四个适配器却只在类型里声明了这些字段、源码零读取 ⇒ 被 max_tokens 砍断的一轮与答完的
// 一轮在事件流里长得一模一样，而 loop 判结束只看「有没有 tool_call」（loop.ts 收束段），
// 于是「截断」被记账成「成功」。本文件锁住这条通道，并锁住「正常路径零新事件」。
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { replay } from "../src/events";
import { createEventLog } from "../src/events";
import { normalizeStopReason, truncationOf, turnTruncatedEvent } from "../src/providers/stop-reason";
import { projectContext, truncationNote } from "../src/agent/context";
import { runLoop } from "../src/agent/loop";
import { streamAnthropic } from "../src/providers/anthropic";
import { streamOpenAI } from "../src/providers/openai";
import { streamGemini } from "../src/providers/gemini";
import type { AgentEvent } from "../src/events";
import type { ModelOutput } from "../src/providers";

async function collect(iter: AsyncIterable<ModelOutput>): Promise<ModelOutput[]> {
  const out: ModelOutput[] = [];
  for await (const e of iter) out.push(e);
  return out;
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

const USER = [{ role: "user" as const, content: "hi" }];
const truncatedOf = (events: ModelOutput[]) => events.filter((e) => e.type === "turn_truncated");

describe("停止原因解码（纯函数，三家词表）", () => {
  it("三家各自的「篇幅用尽」都归一到 output_budget", () => {
    // 逐家点名：Anthropic max_tokens / OpenAI+GLM length / Gemini MAX_TOKENS
    // ——只测一家时，另两家的拼写漏进表里不会红。
    expect(normalizeStopReason("max_tokens")).toBe("output_budget");
    expect(normalizeStopReason("length")).toBe("output_budget");
    expect(normalizeStopReason("MAX_TOKENS")).toBe("output_budget");
  });

  it("三家各自的「内容策略拦停」都归一到 content_blocked", () => {
    expect(normalizeStopReason("refusal")).toBe("content_blocked");
    expect(normalizeStopReason("content_filter")).toBe("content_blocked");
    expect(normalizeStopReason("SAFETY")).toBe("content_blocked");
    expect(normalizeStopReason("PROHIBITED_CONTENT")).toBe("content_blocked");
  });

  it("正常收尾与工具轮不算截断", () => {
    for (const ok of ["end_turn", "stop", "STOP", "stop_sequence"]) {
      expect(normalizeStopReason(ok), ok).toBe("completed");
      expect(truncationOf(ok), ok).toBeNull();
    }
    for (const tu of ["tool_use", "tool_calls"]) {
      expect(normalizeStopReason(tu), tu).toBe("tool_use");
      expect(truncationOf(tu), tu).toBeNull();
    }
  });

  it("大小写与首尾空白不造成第二种拼写；未知值一律 unknown（不把不知道说成坏）", () => {
    expect(normalizeStopReason("  Max_Tokens  ")).toBe("output_budget");
    expect(normalizeStopReason("refusal")).toBe("content_blocked");
    expect(truncationOf("REFUSAL")).toBe("content_blocked");
    for (const bad of [null, undefined, "", "   ", 42, {}, "brand_new_reason"]) {
      expect(normalizeStopReason(bad), JSON.stringify(bad)).toBe("unknown");
      expect(truncationOf(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it("turnTruncatedEvent：正常收尾返回 null；截断时存归一 token 而非线上原文", () => {
    expect(turnTruncatedEvent("c1", "end_turn", 5)).toBeNull();
    expect(turnTruncatedEvent("c1", "tool_use", 5)).toBeNull();
    expect(turnTruncatedEvent("c1", "nonsense", 5)).toBeNull();
    // 这条是模型可见文本：查表只保证 trim 后的值在表内，原文可以带任意空白 ⇒ 存 trim 后的。
    expect(turnTruncatedEvent("c1", "\n  max_tokens  \t", 8192)).toEqual({
      type: "turn_truncated", callId: "c1", outcome: "output_budget", stop_reason: "max_tokens", output_tokens: 8192,
    });
  });

  it("output_tokens：0 要如实留（0 也是读数），null/undefined 才不落字段", () => {
    // 「没上报」与「上报了 0」是两个事实；用 ?? 或 if(outputTokens) 会把后者折成前者。
    const zero = turnTruncatedEvent("c1", "max_tokens", 0);
    expect(zero?.output_tokens).toBe(0);
    expect("output_tokens" in (zero ?? {})).toBe(true);
    expect(turnTruncatedEvent("c1", "max_tokens", null)?.output_tokens).toBeUndefined();
    expect(turnTruncatedEvent("c1", "max_tokens")?.output_tokens).toBeUndefined();
  });
});

describe("三家适配器：把停止原因读出流", () => {
  // 三家的 SSE 形状各写一份（协议不同构，共用一份就等于只测一家）。
  it("anthropic：message_delta 带 max_tokens ⇒ 流尾多出一条 turn_truncated", async () => {
    const cut = await collect(streamAnthropic(USER, {
      apiKey: "test", fetchImpl: stubFetch([
        'data: {"type":"message_start","message":{"id":"msg_cut","usage":{"input_tokens":11,"output_tokens":1}}}',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"结论是"}}',
        'data: {"type":"message_delta","delta":{"stop_reason":"max_tokens","stop_sequence":null},"usage":{"input_tokens":11,"output_tokens":4096}}',
        'data: {"type":"message_stop"}',
      ]),
    }));
    const t = truncatedOf(cut);
    expect(t.length).toBe(1);
    expect(t[0]).toMatchObject({ callId: "msg_cut", outcome: "output_budget", stop_reason: "max_tokens", output_tokens: 4096 });
    // 位置：usage 之后（turn 的最后一件事才是「它为什么结束」）
    expect(cut.slice(-1)[0]?.type).toBe("turn_truncated");
    expect(cut.slice(-2)[0]?.type).toBe("usage");
  });

  it("anthropic 负控：end_turn ⇒ 一个字节都不多（既有转录不变）", async () => {
    const fine = await collect(streamAnthropic(USER, {
      apiKey: "test", fetchImpl: stubFetch([
        'data: {"type":"message_start","message":{"id":"msg_ok","usage":{"input_tokens":11,"output_tokens":1}}}',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"结论是完整的。"}}',
        'data: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"input_tokens":11,"output_tokens":7}}',
        'data: {"type":"message_stop"}',
      ]),
    }));
    expect(truncatedOf(fine)).toEqual([]);
    expect(fine.map((e) => e.type)).toEqual(["assistant_delta", "usage"]);
  });

  it("openai（glm 即其预设）：finish_reason=length ⇒ turn_truncated", async () => {
    const out = await collect(streamOpenAI(USER, {
      apiKey: "test", fetchImpl: stubFetch([
        'data: {"id":"chatcmpl-cut","choices":[{"index":0,"delta":{"content":"写到一半"},"finish_reason":null}]}',
        'data: {"id":"chatcmpl-cut","choices":[{"index":0,"delta":{},"finish_reason":"length"}],"usage":{"prompt_tokens":11,"completion_tokens":4096}}',
        "data: [DONE]",
      ]),
    }));
    const t = truncatedOf(out);
    expect(t.length).toBe(1);
    expect(t[0]).toMatchObject({ callId: "chatcmpl-cut", outcome: "output_budget", stop_reason: "length", output_tokens: 4096 });
    // 中间 chunk 的 null 不得把末 chunk 的读数盖掉（那是最常见的写法错误）
    expect(t[0]?.stop_reason).not.toBeNull();
  });

  it("gemini：finishReason=MAX_TOKENS ⇒ turn_truncated（大小写不同，表要认）", async () => {
    const out = await collect(streamGemini(USER, {
      apiKey: "test", fetchImpl: stubFetch([
        'data: {"candidates":[{"content":{"parts":[{"text":"前半句"}],"role":"model"},"finishReason":null,"index":0}]}',
        'data: {"candidates":[{"content":{"parts":[],"role":"model"},"finishReason":"MAX_TOKENS","index":0}],"usageMetadata":{"promptTokenCount":11,"candidatesTokenCount":4096,"totalTokenCount":4107}}',
      ]),
    }));
    const t = truncatedOf(out);
    expect(t.length).toBe(1);
    expect(t[0]).toMatchObject({ outcome: "output_budget", stop_reason: "MAX_TOKENS" });
  });

  it("gemini 负控：STOP ⇒ 不落（这一族的正常收尾是大写）", async () => {
    const out = await collect(streamGemini(USER, {
      apiKey: "test", fetchImpl: stubFetch([
        'data: {"candidates":[{"content":{"parts":[{"text":"完整一句"}],"role":"model"},"finishReason":"STOP","index":0}],"usageMetadata":{"promptTokenCount":11,"candidatesTokenCount":3,"totalTokenCount":14}}',
      ]),
    }));
    expect(truncatedOf(out)).toEqual([]);
  });

  it("没带停止原因的流不落证据（缺读数 ≠ 被截断）", async () => {
    const out = await collect(streamOpenAI(USER, {
      apiKey: "test", fetchImpl: stubFetch([
        'data: {"id":"a","choices":[{"index":0,"delta":{"content":"x"},"finish_reason":null}]}',
        "data: [DONE]",
      ]),
    }));
    expect(truncatedOf(out)).toEqual([]);
  });
});

describe("落盘与投影", () => {
  it("runLoop 原样落进 JSONL，且不改变收束语义（本轮只记账，不多要一轮）", async () => {
    const d = await mkdtemp(join(tmpdir(), "dsh-trunc-"));
    try {
      const logPath = join(d, "s.jsonl");
      await writeFile(logPath, "", "utf8");
      let requests = 0;
      await runLoop({
        workspace: "/tmp",
        events: createEventLog(logPath),
        userMessage: "写个函数",
        provider: {
          async *stream() {
            requests++;
            yield { type: "assistant_delta", callId: "msg_cut", text: "函数长这样：function f() { " };
            yield { type: "usage", inputTokens: 10, outputTokens: 4096 };
            yield { type: "turn_truncated", callId: "msg_cut", outcome: "output_budget", stop_reason: "max_tokens", output_tokens: 4096 };
          },
        },
      });
      const events = await replay(logPath);
      expect(events.map((e) => e.type)).toEqual(["user_message", "assistant_delta", "usage", "turn_truncated"]);
      // 诚实边界：这一轮**只**记账。动作（接着说完）尚未接线，别用断言假装它接了。
      expect(requests).toBe(1);
    } finally {
      await rm(d, { recursive: true, force: true });
    }
  });

  it("turn_truncated 能过写入口校验（未知类型会被 createEventLog 抛死）", async () => {
    const d = await mkdtemp(join(tmpdir(), "dsh-trunc2-"));
    try {
      const logPath = join(d, "s.jsonl");
      await createEventLog(logPath).append({
        type: "turn_truncated", callId: "c", outcome: "content_blocked", stop_reason: "refusal",
      } as AgentEvent);
      const raw = await readFile(logPath, "utf8");
      expect(JSON.parse(raw.trim()).outcome).toBe("content_blocked");
    } finally {
      await rm(d, { recursive: true, force: true });
    }
  });

  it("projectContext：说明紧跟在被砍断的那段正文之后（位置本身就是信息）", () => {
    const msgs = projectContext([
      { type: "user_message", content: "把 flush 讲清楚" },
      { type: "assistant_delta", callId: "m1", text: "flush 的关键是" },
      { type: "usage", inputTokens: 5, outputTokens: 4096 },
      { type: "turn_truncated", callId: "m1", outcome: "output_budget", stop_reason: "max_tokens", output_tokens: 4096 },
    ]);
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(msgs[1]?.content).toBe("flush 的关键是");
    expect(msgs[2]?.content).toBe(truncationNote({
      type: "turn_truncated", callId: "m1", outcome: "output_budget", stop_reason: "max_tokens", output_tokens: 4096,
    }));
    expect(String(msgs[2]?.content)).toContain("max_tokens");
    expect(String(msgs[2]?.content)).toContain("[harness]");
  });

  it("正常收尾的转录：projectContext 逐字节不变（零回归）", () => {
    const base = [
      { type: "user_message", content: "q" },
      { type: "assistant_delta", callId: "m1", text: "a" },
      { type: "usage", inputTokens: 5, outputTokens: 7 },
    ] as AgentEvent[];
    expect(projectContext(base).map((m) => [m.role, m.content])).toEqual([["user", "q"], ["assistant", "a"]]);
  });

  it("worker 子流的截断不进父上下文（§4.4.4：子流不越界，父只收 agent_result）", () => {
    const msgs = projectContext([
      { type: "assistant_delta", callId: "w1", text: "半句" },
      { type: "turn_truncated", callId: "w1", outcome: "output_budget", stop_reason: "max_tokens", agent_id: "worker-1" },
    ]);
    expect(msgs.filter((m) => String(m.content ?? "").includes("[harness]"))).toEqual([]);
  });
});
