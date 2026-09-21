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
import { serializeConversation } from "../src/agent/compaction";
import { goalStopDecision, lastTurnWasTruncated, projectGoal } from "../src/agent/goal";
import { runLoop } from "../src/agent/loop";
import { createMockProvider } from "../src/providers/mock";
import { createGlmSessionProvider } from "../src/agent/glm-session";
import type { GlmMessage } from "../src/providers/glm";
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

// 「剧本 → runLoop → JSONL」这一跳：上面几条用的是手写 provider，而 e2e/gym/agents-check
// 走的是 createMockProvider。它原先只收 assistant_message/tool_call/usage ⇒ 截断在**冻结剧本
// 里根本表达不出来**，任何端到端判据都只能靠手工注入事件（那测不到生产那一跳）。
describe("剧本入口（createMockProvider）", () => {
  async function scriptDir(): Promise<string> {
    return await mkdtemp(join(tmpdir(), "dsh-trunc-script-"));
  }

  it("剧本可以带 turn_truncated，并按序原样产出（不折进正文、不丢）", async () => {
    const d = await scriptDir();
    try {
      const p = join(d, "s.jsonl");
      await writeFile(p, [
        JSON.stringify({ type: "assistant_message", content: "函数长这样：function f() {" }),
        JSON.stringify({ type: "usage", inputTokens: 10, outputTokens: 4096 }),
        JSON.stringify({ type: "turn_truncated", callId: "msg_1", outcome: "output_budget", stop_reason: "max_tokens", output_tokens: 4096 }),
      ].join("\n") + "\n", "utf8");
      const got = await collect(createMockProvider(p).stream([]));
      expect(got.map((e) => e.type)).toEqual(["assistant_message", "usage", "turn_truncated"]);
      expect(got[2]).toMatchObject({ outcome: "output_budget", stop_reason: "max_tokens", output_tokens: 4096 });
    } finally {
      await rm(d, { recursive: true, force: true });
    }
  });

  it("负控仍在：运行时产物（tool_result）依旧拒收——放行它等于让剧本伪造工具回执", async () => {
    const d = await scriptDir();
    try {
      const p = join(d, "s.jsonl");
      await writeFile(p, JSON.stringify({ type: "tool_result", callId: "c", ok: true, output: "x" }) + "\n", "utf8");
      await expect(collect(createMockProvider(p).stream([]))).rejects.toThrow("只允许");
    } finally {
      await rm(d, { recursive: true, force: true });
    }
  });

  it("端到端：剧本驱动 runLoop，截断确实落到盘上那一行", async () => {
    const d = await scriptDir();
    try {
      const logPath = join(d, "out.jsonl");
      await writeFile(logPath, "", "utf8");
      const scriptPath = join(d, "script.jsonl");
      await writeFile(scriptPath, [
        JSON.stringify({ type: "assistant_message", content: "答案的一半：" }),
        JSON.stringify({ type: "usage", inputTokens: 8, outputTokens: 4096 }),
        JSON.stringify({ type: "turn_truncated", callId: "msg_e2e", outcome: "output_budget", stop_reason: "max_tokens" }),
      ].join("\n") + "\n", "utf8");
      await runLoop({
        workspace: "/tmp",
        events: createEventLog(logPath),
        userMessage: "讲一半就行",
        provider: createMockProvider(scriptPath),
      });
      const events = await replay(logPath);
      const line = events.find((e) => e.type === "turn_truncated");
      expect(line, "截断必须进转录，否则下一轮与面板都无从得知").toMatchObject({
        callId: "msg_e2e", outcome: "output_budget", stop_reason: "max_tokens",
      });
    } finally {
      await rm(d, { recursive: true, force: true });
    }
  });
});

// 上面那几条只证明「projectContext 里有这一行」。生产入口是会话型 provider（它以事件日志为
// 唯一事实源、忽略 loop 传入的 messages），跨轮那句「模型真的看得到」只能在这里判。
describe("跨轮真请求体（会话型 provider 的 transport 抓包）", () => {
  async function sessionWith(truncated: boolean): Promise<{ flat: string; dir: string }> {
    const dir = await mkdtemp(join(tmpdir(), "dsh-trunc-xturn-"));
    const path = join(dir, "events.jsonl");
    const log = createEventLog(path);
    await log.append({ type: "user_message", content: "把 flush 讲清楚" });
    await log.append({ type: "assistant_message", content: "flush 的关键在于把" });
    await log.append({ type: "usage", inputTokens: 20, outputTokens: 4096 });
    if (truncated) {
      await log.append({ type: "turn_truncated", callId: "msg_1", outcome: "output_budget", stop_reason: "max_tokens", output_tokens: 4096 });
    }
    const requests: GlmMessage[][] = [];
    const provider = createGlmSessionProvider(path, {
      map: false,
      workspace: dir,
      transport: async function* (messages): AsyncGenerator<never> {
        requests.push(messages);
        yield { type: "assistant_message", content: "收到" } as never;
      },
    });
    for await (const _e of provider.stream([])) void _e;
    await log.close?.();
    return { flat: (requests[0] ?? []).map((m) => (typeof m.content === "string" ? m.content : "")).join("\n"), dir };
  }

  it("下一轮的真请求体里带着「上一条没说完」", async () => {
    const { flat, dir } = await sessionWith(true);
    try {
      expect(flat).toContain("[harness] 上一条助手回复没说完就被截断");
      expect(flat).toContain("max_tokens");
      // 位置：紧跟在那半句正文之后（顺序错了，模型会把说明安到别的轮上）
      expect(flat.indexOf("flush 的关键在于把")).toBeLessThan(flat.indexOf("[harness] 上一条助手回复"));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("负控：答完的一轮，请求体里一个字的说明都没有", async () => {
    const { flat, dir } = await sessionWith(false);
    try {
      expect(flat).not.toContain("[harness] 上一条助手回复");
      expect(flat).toContain("flush 的关键在于把");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// 压缩会**排除**被摘要掉的旧事件，所以摘要输入是截断在长任务上唯一的存活通道。
// 这条不接，等于「越长的任务（最容易撞 max_tokens 的那条路）越会把半句洗成完整结论」。
describe("摘要输入（serializeConversation）", () => {
  const events = (truncated: boolean, withTokens: boolean): AgentEvent[] => {
    const out: AgentEvent[] = [
      { type: "user_message", content: "把 flush 讲清楚" },
      { type: "assistant_message", content: "flush 的关键在于把" },
    ];
    if (truncated) {
      out.push({
        type: "turn_truncated", callId: "m1", outcome: "output_budget", stop_reason: "max_tokens",
        ...(withTokens ? { output_tokens: 4096 } : {}),
      });
    }
    return out;
  };

  it("截断有自己一行，紧跟被砍断的那段正文，且带上是哪个原因", () => {
    const s = serializeConversation(events(true, true), 2000);
    expect(s).toContain("[Assistant 回复被截断]");
    expect(s).toContain("max_tokens");
    expect(s).toContain("4096");
    expect(s.indexOf("flush 的关键在于把")).toBeLessThan(s.indexOf("[Assistant 回复被截断]"));
    // 只落事实，不落指令：摘要器自己的规范写着「不要提及压缩过程本身」，行内也不该塞劝告
    expect(s).not.toContain("不要把它");
  });

  it("负控：答完的一轮不因此多一行", () => {
    const s = serializeConversation(events(false, false), 2000);
    expect(s).not.toContain("[Assistant 回复被截断]");
    expect(s).toContain("[Assistant] flush 的关键在于把");
  });

  it("output_tokens 缺席时不落那半句（缺 = 没上报，不等于 0）", () => {
    const s = serializeConversation(events(true, false), 2000);
    expect(s).toContain("[Assistant 回复被截断]");
    expect(s).not.toContain("已用");
    expect(s).not.toContain("0 输出 token");
  });

  it("内容策略中止与篇幅用尽各说各的（两种原因的下一步不同）", () => {
    const s = serializeConversation([
      { type: "assistant_message", content: "这段被" },
      { type: "turn_truncated", callId: "m2", outcome: "content_blocked", stop_reason: "refusal" },
    ], 2000);
    expect(s).toContain("内容策略");
    expect(s).toContain("refusal");
    expect(s).not.toContain("篇幅");
  });

  it("delta 形态的正文先落位再落截断行（不吞掉半句，也不把说明插到半句前面）", () => {
    const s = serializeConversation([
      { type: "assistant_delta", callId: "m3", text: "半句 A" },
      { type: "assistant_delta", callId: "m3", text: " + 半句 B" },
      { type: "turn_truncated", callId: "m3", outcome: "output_budget", stop_reason: "max_tokens" },
    ], 2000);
    expect(s).toContain("[Assistant] 半句 A + 半句 B");
    expect(s.indexOf("半句 A + 半句 B")).toBeLessThan(s.indexOf("[Assistant 回复被截断]"));
  });
});

// goal 模式：被砍断的一轮原本与「模型宣布完成」同一个形状，于是最要命的地方在于——
// 它会**停下来**并对用户说「这个目标没有可验证的产出，自动续跑只会白花钱」。
// 把「被打断」擦成「没产出」，正是目标所要求的「遇到失败能重试、换路径，而不是卡死」的反面。
describe("goal 续跑判据", () => {
  const trunc = { type: "turn_truncated", callId: "m1", outcome: "output_budget", stop_reason: "max_tokens" } as const;
  const SPEC = { objective: "讲清楚 flush", maxTurns: 8, maxUsd: 0 };

  it("被收走的那一轮 ⇒ 继续，而不是宣布「没有可验证的产出」", () => {
    const d = goalStopDecision({ turn: 1, spec: SPEC, spentUsd: null, evidence: "absent", wrote: false, truncated: true });
    expect(d.kind).toBe("continue");
    if (d.kind !== "continue") throw new Error("不该停");
    expect(d.note).toContain("不是模型宣布完成");
  });

  it("负控（回归锁）：模型自己说完且没产出 ⇒ 仍然停，理由逐字不变", () => {
    const d = goalStopDecision({ turn: 1, spec: SPEC, spentUsd: null, evidence: "absent", wrote: false, truncated: false });
    expect(d.kind).toBe("stop");
    if (d.kind !== "stop") throw new Error("该停");
    expect(d.reason).toBe(
      "没有写过任何文件、也没有任何验证证据 ⇒ 这个目标没有可验证的产出，自动续跑只会白花钱；纯问答/查代码类目标请关掉 goal 模式",
    );
  });

  // 这两条是本改动的安全边界：continue 只可能在轮次闸与美元闸**之后**才走到，
  // 所以「被截断」不可能换来无界花费。摘掉这个次序（把 truncated 提到最前面判）必红其中之一。
  it("轮次上限已用尽 + 被截断 ⇒ 仍然停（截断不给额外的轮）", () => {
    const d = goalStopDecision({ turn: 8, spec: SPEC, spentUsd: null, evidence: "absent", wrote: false, truncated: true });
    expect(d.kind).toBe("stop");
    if (d.kind !== "stop") throw new Error("该停");
    expect(d.reason).toContain("轮次上限");
  });

  it("美元上限已花到 + 被截断 ⇒ 仍然停（截断不给额外的钱）", () => {
    const d = goalStopDecision({
      turn: 1, spec: { ...SPEC, maxUsd: 0.5 }, spentUsd: 0.5, evidence: "absent", wrote: false, truncated: true,
    });
    expect(d.kind).toBe("stop");
    if (d.kind !== "stop") throw new Error("该停");
    expect(d.reason).toContain("美元上限");
  });

  it("读过事件流就能拿到这个判断（projectGoal 算了不许丢——「两头断」防线）", () => {
    const view = projectGoal([
      { type: "goal_set", objective: "讲清楚 flush", max_turns: 8, max_usd: 0 },
      { type: "user_message", content: "讲清楚 flush" },
      { type: "assistant_delta", callId: "m1", text: "关键在于" },
      { type: "usage", inputTokens: 20, outputTokens: 4096 },
      trunc,
    ]);
    expect(view?.truncated).toBe(true);
    expect(view?.wrote).toBe(false);
    // 用 view 直接喂决策：证明字段不是算完就丢
    expect(goalStopDecision({
      turn: view!.turn, spec: view!.spec, spentUsd: null, evidence: view!.evidence,
      wrote: view!.wrote, truncated: view!.truncated,
    }).kind).toBe("continue");
  });

  it("新提示已经进来 ⇒ 打断不再是当前态（旧截断不该替这一轮说话）", () => {
    const truncAt = { ...trunc };
    expect(lastTurnWasTruncated([truncAt])).toBe(true);
    // 纯计量与纯证据事件不算「新内容」：自动验证拍就落在截断之后
    expect(lastTurnWasTruncated([
      truncAt, { type: "usage", inputTokens: 1, outputTokens: 1 },
      { type: "verify_result", callId: "harness-auto-verify", ok: false, attempt: 1, maxAttempts: 3, results: [], auto: true },
    ])).toBe(true);
    expect(lastTurnWasTruncated([truncAt, { type: "user_message", content: "接着说" }])).toBe(false);
    expect(lastTurnWasTruncated([{ type: "assistant_message", content: "说完了" }])).toBe(false);
    // worker 子流的截断不替父目标表态（§4.4.4：父只收 agent_result）
    expect(lastTurnWasTruncated([{ ...truncAt, agent_id: "worker-1" }])).toBe(false);
    expect(lastTurnWasTruncated([])).toBe(false);
  });
});
