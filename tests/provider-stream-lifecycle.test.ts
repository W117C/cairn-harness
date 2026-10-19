import { createServer, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RequestMeter } from "../src/agent/metering";
import type { ModelOutput, ProviderMessage } from "../src/providers";
import { streamOpenAI } from "../src/providers/openai";

const messages: ProviderMessage[] = [{ role: "user", content: "fixture" }];
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
const frame = (data: unknown): string => `data: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`;
const delta = (value: Record<string, unknown>, finish: string | null = null) => ({ id: "fixture", choices: [{ delta: value, finish_reason: finish }] });
const completed = frame(delta({ content: "recovered" }, "stop")) + frame("[DONE]");

function responseFixture(text: string, status = 200, tail?: Uint8Array) {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({
    start(value) {
      controller = value;
      const encoded = new TextEncoder().encode(text);
      value.enqueue(tail ? Buffer.concat([encoded, tail]) : encoded);
    },
    cancel,
  });
  const response = new Response(body, { status, headers: { "content-type": "text/event-stream" } });
  const fetchImpl = vi.fn(async () => response);
  const dispose = () => { try { controller.close(); } catch { /* already cancelled */ } };
  return { body, cancel, fetchImpl, dispose };
}

async function collect(iterator: AsyncIterable<ModelOutput>, events: ModelOutput[] = []) {
  for await (const event of iterator) events.push(event);
  return events;
}

describe("OpenAI 兼容响应流生命周期", () => {
  const cases = {
    text: { data: frame(delta({ content: "hello" })), type: "assistant_delta" },
    thinking: { data: frame(delta({ reasoning_content: "thought" })), type: "thinking_delta" },
    tool: { data: frame(delta({ tool_calls: [{ index: 0, id: "call-1", function: { name: "read_file", arguments: '{"path":"a.ts"}' } }] }, "tool_calls")) + frame("[DONE]"), type: "tool_call" },
  };
  it.each(["text", "thinking", "tool"] as const)("消费者在 %s 输出后提前结束，也取消响应体并释放读取锁", async (kind) => {
    const fixture = responseFixture(cases[kind].data);
    const iterator = streamOpenAI(messages, { apiKey: "fixture", fetchImpl: fixture.fetchImpl, stallTimeoutMs: 0 });
    try {
      const first = await iterator.next();
      expect(first.done).toBe(false);
      expect(first.value?.type).toBe(cases[kind].type);
      await iterator.return(undefined);
      expect(fixture.cancel).toHaveBeenCalledTimes(1);
      expect(fixture.body.locked).toBe(false);
      expect(fixture.fetchImpl).toHaveBeenCalledTimes(1);
    } finally {
      await iterator.return(undefined);
      fixture.dispose();
    }
  });

  it("完整流式响应在计量中记录为成功，并保留累计 usage", async () => {
    const meter = new RequestMeter();
    const fixture = responseFixture(frame(delta({ content: "hello" }, "stop"))
      + frame({ choices: [], usage: { prompt_tokens: 9, completion_tokens: 3 } }) + frame("[DONE]"));
    try {
      const events = await collect(streamOpenAI(messages, { apiKey: "fixture", fetchImpl: fixture.fetchImpl, stallTimeoutMs: 0, metering: { meter, category: "main" } }));
      expect(events.some((event) => event.type === "assistant_delta")).toBe(true);
      const report = meter.snapshot();
      expect(report.requests).toHaveLength(1);
      expect(report.requests[0].outcome).toBe("ok");
      expect(report.requests[0].usage).toMatchObject({ inputTokens: 9, outputTokens: 3 });
    } finally { fixture.dispose(); }
  });

  it("损坏的帧仍然报错并记为失败，不重试协议错误", async () => {
    const meter = new RequestMeter();
    const fixture = responseFixture("data: {broken}\n\n");
    try {
      await expect(collect(streamOpenAI(messages, { apiKey: "fixture", fetchImpl: fixture.fetchImpl, stallTimeoutMs: 0, metering: { meter, category: "main" } }))).rejects.toThrow("SSE 帧损坏");
      expect(meter.snapshot().requests.map((request) => request.outcome)).toEqual(["failed"]);
      expect(fixture.cancel).toHaveBeenCalledTimes(1);
      expect(fixture.fetchImpl).toHaveBeenCalledTimes(1);
    } finally { fixture.dispose(); }
  });

  it("调用方取消仍记为取消，退出时释放响应体", async () => {
    const meter = new RequestMeter();
    const abort = new AbortController();
    const fixture = responseFixture(frame(delta({ content: "hello" })));
    const iterator = streamOpenAI(messages, { apiKey: "fixture", fetchImpl: fixture.fetchImpl, stallTimeoutMs: 0, metering: { meter, category: "main" } }, undefined, { signal: abort.signal });
    try {
      await iterator.next();
      abort.abort(new Error("caller cancelled"));
      await iterator.return(undefined);
      expect(meter.snapshot().requests.map((request) => request.outcome)).toEqual(["cancelled"]);
      expect(fixture.cancel).toHaveBeenCalledTimes(1);
    } finally { await iterator.return(undefined); fixture.dispose(); }
  });

  it.each(["reasoning_content", "reasoning"])("%s 已展示后收到服务端错误，不重放已产出的思考", async (field) => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const first = responseFixture(frame(delta({ [field]: "thought" })) + frame({ error: { type: "server_error", message: "fixture failure" } }));
    const next = responseFixture(completed);
    const fetchImpl = vi.fn().mockImplementationOnce(first.fetchImpl).mockImplementation(next.fetchImpl);
    const events: ModelOutput[] = [];
    try {
      const result = await collect(streamOpenAI(messages, { apiKey: "fixture", fetchImpl, stallTimeoutMs: 0 }), events).then(
        () => "unexpected success", (error: Error) => error.message,
      );
      expect(result).toContain("fixture failure");
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(events.filter((event) => event.type === "thinking_delta")).toHaveLength(1);
      expect(events.some((event) => event.type === "assistant_delta")).toBe(false);
    } finally { first.dispose(); next.dispose(); }
  });

  it("尚未产出内容的服务端错误仍可重试，恢复后仅交付一次正文", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const first = responseFixture(frame({ error: { type: "server_error", message: "retryable" } }));
    const next = responseFixture(completed);
    const fetchImpl = vi.fn().mockImplementationOnce(first.fetchImpl).mockImplementation(next.fetchImpl);
    try {
      const events = await collect(streamOpenAI(messages, { apiKey: "fixture", fetchImpl, stallTimeoutMs: 0 }));
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(events.filter((event) => event.type === "assistant_delta")).toEqual([{ type: "assistant_delta", callId: "fixture", text: "recovered" }]);
      expect(first.cancel).toHaveBeenCalledTimes(1);
      expect(next.cancel).toHaveBeenCalledTimes(1);
    } finally { first.dispose(); next.dispose(); }
  });
});

describe("真实 HTTP 响应连接回收", () => {
  it("消费者提前结束后，服务端能观察到响应连接关闭", async () => {
    let closed!: () => void;
    const responseClosed = new Promise<void>((resolve) => { closed = resolve; });
    const server: Server = createServer((_request, response) => {
      response.on("close", closed);
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write(frame(delta({ content: "hello" })));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("HTTP fixture has no port");
    const iterator = streamOpenAI(messages, { apiKey: "fixture", baseURL: `http://127.0.0.1:${address.port}/v1`, stallTimeoutMs: 0 });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      expect((await iterator.next()).value).toMatchObject({ type: "assistant_delta", text: "hello" });
      await iterator.return(undefined);
      await Promise.race([
        responseClosed,
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("consumer ended but HTTP response is still open")), 1000); }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      await iterator.return(undefined);
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});

describe("请求计量逐笔覆盖真实传输尝试", () => {
  beforeEach(() => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("HTTP 失败后恢复，保留失败与成功两笔记录", async () => {
    const meter = new RequestMeter();
    const first = responseFixture("transient", 503);
    // 错误正文没有 EOF 时会等停滞；本例模拟完整 HTTP 错误响应。
    first.dispose();
    const next = responseFixture(completed);
    const fetchImpl = vi.fn().mockImplementationOnce(first.fetchImpl).mockImplementation(next.fetchImpl);
    try {
      await collect(streamOpenAI(messages, { apiKey: "fixture", fetchImpl, stallTimeoutMs: 0, metering: { meter, category: "main" } }));
      const requests = meter.snapshot().requests;
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(requests.map((request) => request.outcome)).toEqual(["failed", "ok"]);
      expect(requests.map((request) => request.id)).toEqual([1, 2]);
      expect(requests[0].bodySha256).toBe(requests[1].bodySha256);
    } finally { first.dispose(); next.dispose(); }
  });

  it("HTTP 重试耗尽时每次请求都留痕，不把三次失败并成一次", async () => {
    const meter = new RequestMeter();
    const fetchImpl = vi.fn(async () => new Response("unavailable", { status: 503 }));
    await expect(collect(streamOpenAI(messages, { apiKey: "fixture", fetchImpl, stallTimeoutMs: 0, metering: { meter, category: "main" } }))).rejects.toThrow("HTTP 503");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(meter.snapshot().requests.map((request) => request.outcome)).toEqual(["failed", "failed", "failed"]);
  });

  it("网络错误后的重试也各自计量", async () => {
    const meter = new RequestMeter();
    const next = responseFixture(completed);
    const fetchImpl = vi.fn().mockRejectedValueOnce(new TypeError("fixture network failure")).mockImplementation(next.fetchImpl);
    try {
      await collect(streamOpenAI(messages, { apiKey: "fixture", fetchImpl, stallTimeoutMs: 0, metering: { meter, category: "main" } }));
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(meter.snapshot().requests.map((request) => request.outcome)).toEqual(["failed", "ok"]);
    } finally { next.dispose(); }
  });

  it("非流式请求同样逐次计量，并保留摘要类别", async () => {
    const meter = new RequestMeter();
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response("transient", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "summary", choices: [{ message: { content: "summary" }, finish_reason: "stop" }], usage: { prompt_tokens: 9, completion_tokens: 3 } })));
    await collect(streamOpenAI(messages, { apiKey: "fixture", fetchImpl, stream: false, stallTimeoutMs: 0, metering: { meter, category: "summary" } }));
    const requests = meter.snapshot().requests;
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(requests.map((request) => request.outcome)).toEqual(["failed", "ok"]);
    expect(requests.map((request) => request.category)).toEqual(["summary", "summary"]);
    expect(requests[1].usage).toMatchObject({ inputTokens: 9, outputTokens: 3 });
  });

  it.each([false, true])("SSE 失败尝试的 usage 不会混入下一次请求（后续上报=%s）", async (finalUsage) => {
    const meter = new RequestMeter();
    const first = responseFixture(frame({ choices: [], usage: { prompt_tokens: 11, completion_tokens: 4 } })
      + frame({ error: { type: "server_error", message: "retryable" } }));
    const next = responseFixture(frame(delta({ content: "recovered" }, "stop"))
      + (finalUsage ? frame({ choices: [], usage: { prompt_tokens: 5, completion_tokens: 2 } }) : "") + frame("[DONE]"));
    const fetchImpl = vi.fn().mockImplementationOnce(first.fetchImpl).mockImplementation(next.fetchImpl);
    try {
      await collect(streamOpenAI(messages, { apiKey: "fixture", fetchImpl, stallTimeoutMs: 0, metering: { meter, category: "main" } }));
      const requests = meter.snapshot().requests;
      expect(requests.at(-1)?.usage).toMatchObject({ inputTokens: finalUsage ? 5 : null, outputTokens: finalUsage ? 2 : null });
      expect(requests).toHaveLength(2);
      expect(requests[0].usage).toMatchObject({ inputTokens: 11, outputTokens: 4 });
      expect(requests.map((request) => request.outcome)).toEqual(["failed", "ok"]);
    } finally { first.dispose(); next.dispose(); }
  });

  it("调用前已取消时，不产生未发送请求的计量记录", async () => {
    const meter = new RequestMeter();
    const abort = new AbortController();
    abort.abort(new Error("already cancelled"));
    const fetchImpl = vi.fn();
    await expect(collect(streamOpenAI(messages, { apiKey: "fixture", fetchImpl, metering: { meter, category: "main" } }, undefined, { signal: abort.signal }))).rejects.toThrow("already cancelled");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(meter.snapshot().requests).toEqual([]);
  });

  it("本地 HTTP 服务收到两次请求时，计量也准确记录两笔", async () => {
    const received: string[] = [];
    const meter = new RequestMeter();
    const server = createServer((request, response) => {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk: string) => { body += chunk; });
      request.on("end", () => {
        received.push(body);
        if (received.length === 1) { response.writeHead(503); response.end("transient"); }
        else { response.writeHead(200, { "content-type": "text/event-stream" }); response.end(completed); }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("HTTP fixture has no port");
    try {
      await collect(streamOpenAI(messages, { apiKey: "fixture", baseURL: `http://127.0.0.1:${address.port}/v1`, stallTimeoutMs: 0, metering: { meter, category: "main" } }));
      expect(received).toHaveLength(2);
      expect(meter.snapshot().requests.map((request) => request.outcome)).toEqual(["failed", "ok"]);
      expect(meter.snapshot().requests.map((request) => request.bytes)).toEqual(received.map((body) => Buffer.byteLength(body)));
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});

describe("流内重试的解码与取消边界", () => {
  beforeEach(() => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it.each([0xe4, 0xf0])("失败响应残留 UTF-8 起始字节 %s，不污染下一次成功响应", async (byte) => {
    const first = responseFixture(frame({ error: { type: "server_error", message: "retryable" } }), 200, Uint8Array.of(byte));
    const next = responseFixture(frame(delta({ content: "新结果" }, "stop")) + frame("[DONE]"));
    const fetchImpl = vi.fn().mockImplementationOnce(first.fetchImpl).mockImplementation(next.fetchImpl);
    try {
      const events = await collect(streamOpenAI(messages, { apiKey: "fixture", fetchImpl, stallTimeoutMs: 0 }));
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(events.filter((event) => event.type === "assistant_delta")).toEqual([{ type: "assistant_delta", callId: "fixture", text: "新结果" }]);
    } finally { first.dispose(); next.dispose(); }
  });

  it("同一次响应内的 UTF-8 字符跨块时仍能正确拼接", async () => {
    const bytes = new TextEncoder().encode(frame(delta({ content: "你好" }, "stop")) + frame("[DONE]"));
    const split = bytes.indexOf(0xe4) + 1;
    expect(split).toBeGreaterThan(0);
    const fetchImpl = vi.fn(async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(bytes.subarray(0, split)); controller.enqueue(bytes.subarray(split)); controller.close(); },
    })));
    const events = await collect(streamOpenAI(messages, { apiKey: "fixture", fetchImpl, stallTimeoutMs: 0 }));
    expect(events.filter((event) => event.type === "assistant_delta")).toEqual([{ type: "assistant_delta", callId: "fixture", text: "你好" }]);
  });

  it.each([new Error("cancelled during backoff"), "cancelled during backoff"])("退避期间取消立即结束等待并保留原始原因：%s", async (reason) => {
    vi.useFakeTimers();
    vi.mocked(Math.random).mockReturnValue(0.9);
    const abort = new AbortController();
    let started!: () => void;
    const backoffStarted = new Promise<void>((resolve) => { started = resolve; });
    vi.mocked(console.warn).mockImplementation(() => { abort.abort(reason); started(); });
    const fixture = responseFixture(frame({ error: { type: "server_error", message: "retryable" } }));
    let settled = false;
    const pending = collect(streamOpenAI(messages, { apiKey: "fixture", fetchImpl: fixture.fetchImpl, stallTimeoutMs: 0 }, undefined, { signal: abort.signal })).then(
      () => { settled = true; return "unexpected success"; },
      (error: unknown) => { settled = true; return error; },
    );
    try {
      await backoffStarted;
      await vi.advanceTimersByTimeAsync(0);
      const settledOnAbort = settled;
      const timersOnAbort = vi.getTimerCount();
      // 也释放修复前的退避，避免失败用例留下悬空等待。
      await vi.advanceTimersByTimeAsync(300);
      const result = await pending;
      expect(settledOnAbort).toBe(true);
      expect(timersOnAbort).toBe(0);
      expect(result).toBe(reason);
      expect(fixture.fetchImpl).toHaveBeenCalledTimes(1);
    } finally { fixture.dispose(); }
  });
});
