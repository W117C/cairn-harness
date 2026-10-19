import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { establishStream, type Established } from "../src/providers/retry";

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

type Outcome = { kind: "connected"; value: Established } | { kind: "failed"; error: unknown };

function setup(status = 503, headers: Record<string, string> = {}) {
  const controller = new AbortController();
  let sink!: ReadableStreamDefaultController<Uint8Array>;
  let detachAbort = () => {};
  const cancelBody = vi.fn(() => { detachAbort(); });
  const body = new ReadableStream<Uint8Array>({ start(c) { sink = c; }, cancel: cancelBody });
  const response = new Response(body, { status, headers });
  let signal: AbortSignal | null | undefined;
  const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (_input, init) => {
    signal = init?.signal;
    // 与真实 fetch 一样，让请求 signal 的取消中断响应体读取。
    const activeSignal = signal;
    if (activeSignal) {
      const abort = () => { detachAbort(); sink.error(activeSignal.reason); };
      detachAbort = () => { activeSignal.removeEventListener("abort", abort); };
      activeSignal.addEventListener("abort", abort, { once: true });
      if (activeSignal.aborted) abort();
    }
    return response;
  });
  const onRetry = vi.fn();
  let settled = false;
  const pending = establishStream({
    label: "TEST", url: "https://example.invalid/messages", init: {},
    fetchImpl, callerSignal: controller.signal, stallMs: 100, attempts: 3,
    sleep: async () => {}, onRetry,
  }).then((value): Outcome => ({ kind: "connected", value }), (error: unknown): Outcome => ({ kind: "failed", error }))
    .then((outcome) => { settled = true; return outcome; });
  return {
    controller, fetchImpl, onRetry, pending, response, body, cancelBody,
    settled: () => settled, signal: () => signal,
    emit: (text: string) => { sink.enqueue(new TextEncoder().encode(text)); },
    close: () => { detachAbort(); sink.close(); },
    error: (error: Error) => { detachAbort(); sink.error(error); },
    cleanup: async () => {
      controller.abort(new Error("test cleanup"));
      const outcome = await pending;
      if (outcome.kind === "connected") outcome.value.guard.dispose();
    },
  };
}

describe("HTTP 错误正文的读取边界", () => {
  it("错误状态后正文停滞：仍由同一守卫超时，不重试，保留停滞原因", async () => {
    const s = setup();
    try {
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(101);
      expect(s.settled()).toBe(true);
      const outcome = await s.pending;
      expect(outcome.kind).toBe("failed");
      if (outcome.kind === "failed") {
        expect(outcome.error).toBe(s.signal()?.reason);
        expect(String(outcome.error)).toContain("TEST 停滞超时：100ms");
      }
      expect(s.fetchImpl).toHaveBeenCalledTimes(1);
      expect(s.onRetry).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally { await s.cleanup(); }
  });

  it("读取错误正文时用户取消：原取消原因上抛，不被改写成 HTTP 故障", async () => {
    const s = setup();
    const reason = new Error("user stopped error-body read");
    try {
      await vi.advanceTimersByTimeAsync(0);
      s.controller.abort(reason);
      await vi.advanceTimersByTimeAsync(0);
      const outcome = await s.pending;
      expect(outcome.kind).toBe("failed");
      if (outcome.kind === "failed") expect(outcome.error).toBe(reason);
      expect(s.fetchImpl).toHaveBeenCalledTimes(1);
      expect(s.onRetry).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally { await s.cleanup(); }
  });

  it.each([false, true])("错误正文持续输出，声明长度超限=%s：仅取有限前缀，取消余下正文并释放读锁", async (declared) => {
    const s = setup(400, declared ? { "content-length": "100000" } : {});
    try {
      s.emit("provider rejected request: " + "x".repeat(100_000));
      await vi.advanceTimersByTimeAsync(0);
      expect(s.settled()).toBe(true);
      const outcome = await s.pending;
      expect(outcome.kind).toBe("failed");
      if (outcome.kind === "failed") expect(String(outcome.error)).toContain("TEST 请求失败 HTTP 400: provider rejected request: ");
      expect(s.cancelBody).toHaveBeenCalledTimes(1);
      expect(s.body.locked).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    } finally { await s.cleanup(); }
  });

  it("错误正文持续有进展：每块续期，允许总时长超过一个静默窗口", async () => {
    const s = setup(400);
    try {
      for (const part of ["first ", "second ", "third ", "fourth "]) {
        s.emit(part);
        await vi.advanceTimersByTimeAsync(80);
        expect(s.settled()).toBe(false);
      }
      s.close();
      await vi.advanceTimersByTimeAsync(0);
      const outcome = await s.pending;
      expect(outcome.kind).toBe("failed");
      if (outcome.kind === "failed") expect(String(outcome.error)).toBe("Error: TEST 请求失败 HTTP 400: first second third fourth ");
      expect(s.signal()?.aborted).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    } finally { await s.cleanup(); }
  });

  it("可重试错误的正文被截断后，仍按原规则重试并交还成功响应", async () => {
    const s = setup();
    const success = new Response("ok");
    s.fetchImpl.mockResolvedValueOnce(success);
    try {
      s.emit("temporary overload: " + "x".repeat(100_000));
      await vi.advanceTimersByTimeAsync(0);
      expect(s.settled()).toBe(true);
      const outcome = await s.pending;
      expect(outcome.kind).toBe("connected");
      if (outcome.kind === "connected") {
        expect(outcome.value.res).toBe(success);
        outcome.value.guard.dispose();
      }
      expect(s.fetchImpl).toHaveBeenCalledTimes(2);
      expect(s.onRetry).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ status: 503, reason: expect.stringContaining("temporary overload: ") }));
      expect(s.cancelBody).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally { await s.cleanup(); }
  });

  it("成功响应的正文由调用方消费，守卫所有权照常交还", async () => {
    const s = setup(200);
    try {
      const outcome = await s.pending;
      expect(outcome.kind).toBe("connected");
      if (outcome.kind === "connected") {
        expect(outcome.value.res.bodyUsed).toBe(false);
        expect(vi.getTimerCount()).toBe(1);
        outcome.value.guard.dispose();
      }
      await vi.advanceTimersByTimeAsync(1_000);
      expect(s.signal()?.aborted).toBe(false);
      expect(s.cancelBody).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally { await s.cleanup(); }
  });

  it("普通错误正文读取失败仍保留 HTTP 状态，不把它冒充成取消或停滞", async () => {
    const s = setup(400);
    try {
      s.error(new Error("body disconnected"));
      const outcome = await s.pending;
      expect(outcome.kind).toBe("failed");
      if (outcome.kind === "failed") expect(String(outcome.error)).toBe("Error: TEST 请求失败 HTTP 400: ");
      expect(s.signal()?.aborted).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    } finally { await s.cleanup(); }
  });
});
