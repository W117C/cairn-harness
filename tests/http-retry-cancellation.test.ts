import { setImmediate as nextTurn } from "node:timers/promises";
import { describe, expect, it, vi } from "vitest";
import { establishStream, type Established } from "../src/providers/retry";
import { streamOpenAI } from "../src/providers/openai";
import { streamAnthropic } from "../src/providers/anthropic";
import { streamGemini } from "../src/providers/gemini";

const base = {
  label: "TEST", url: "https://example.invalid/messages", init: { method: "POST" },
  stallMs: 0, baseDelayMs: 250, capDelayMs: 250, rand: () => 1,
};

// 成功时释放调用方接管的守卫；失败原样返回，便于核对取消原因的身份。
async function capture(request: Promise<Established>): Promise<unknown> {
  try {
    const { res, guard } = await request;
    guard.dispose();
    return res;
  } catch (error) { return error; }
}

function retryThenSuccess(kind: "network" | "http") {
  const success = new Response("ok");
  const error = new Error("ECONNRESET");
  const fetchImpl = vi.fn<typeof fetch>()
    .mockImplementationOnce(async () => {
      if (kind === "network") throw error;
      return new Response("busy", { status: 429, headers: { "retry-after": "0.25" } });
    })
    .mockResolvedValue(success);
  return { fetchImpl, success, error };
}

describe("建连重试的取消边界", () => {
  it("进入前已取消：由重试层阻止首次 fetch，保留调用方原因", async () => {
    const controller = new AbortController();
    const reason = new Error("cancel before connect");
    controller.abort(reason);
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response("must not connect"));
    expect(await capture(establishStream({ ...base, fetchImpl, callerSignal: controller.signal }))).toBe(reason);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each(["network", "http"] as const)("%s：自定义等待期间取消，下一次 fetch 不得启动", async (kind) => {
    const controller = new AbortController();
    const reason = new Error("cancel during backoff");
    const f = retryThenSuccess(kind);
    const sleep = vi.fn(async () => { controller.abort(reason); });
    expect(await capture(establishStream({ ...base, fetchImpl: f.fetchImpl, callerSignal: controller.signal, sleep }))).toBe(reason);
    expect(f.fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it.each(["network", "http"] as const)("%s：重试通知期间取消，不再开始退避等待", async (kind) => {
    const controller = new AbortController();
    const reason = new Error("cancel from retry notification");
    const f = retryThenSuccess(kind);
    const sleep = vi.fn(async () => {});
    expect(await capture(establishStream({
      ...base, fetchImpl: f.fetchImpl, callerSignal: controller.signal, sleep,
      onRetry: () => { controller.abort(reason); },
    }))).toBe(reason);
    expect(f.fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it.each(["network", "http"] as const)("%s：默认退避在取消后立即结束，不等待计时器到期", async (kind) => {
    const controller = new AbortController();
    const reason = new Error("cancel timer wait");
    const f = retryThenSuccess(kind);
    let notifyRetry!: () => void;
    const entered = new Promise<void>((resolve) => { notifyRetry = resolve; });
    let settled = false;
    const pending = capture(establishStream({
      ...base, fetchImpl: f.fetchImpl, callerSignal: controller.signal,
      onRetry: notifyRetry,
    })).then((result) => { settled = true; return result; });
    try {
      await entered;
      controller.abort(reason);
      // 只推进事件循环，不等 250ms 退避窗；取消应已经让等待方收束。
      await nextTurn();
      expect(settled).toBe(true);
      expect(await pending).toBe(reason);
      expect(f.fetchImpl).toHaveBeenCalledTimes(1);
    } finally { await pending; }
  });

  it.each(["network", "http"] as const)("%s：未取消仍遵从退避并重试成功", async (kind) => {
    const f = retryThenSuccess(kind);
    const sleep = vi.fn(async () => {});
    const onRetry = vi.fn();
    expect(await capture(establishStream({ ...base, fetchImpl: f.fetchImpl, sleep, onRetry }))).toBe(f.success);
    expect(f.fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledExactlyOnceWith(250);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("自定义等待本身失败时保留原异常，不多发请求", async () => {
    const f = retryThenSuccess("http");
    const error = new Error("custom sleep failed");
    expect(await capture(establishStream({ ...base, fetchImpl: f.fetchImpl, sleep: async () => { throw error; } }))).toBe(error);
    expect(f.fetchImpl).toHaveBeenCalledTimes(1);
  });
});

const messages = [{ role: "user" as const, content: "hi" }];
const adapters = [
  { name: "openai", run: (fetchImpl: typeof fetch, signal: AbortSignal) => streamOpenAI(messages, { apiKey: "test", fetchImpl }, [], { signal }) },
  { name: "anthropic", run: (fetchImpl: typeof fetch, signal: AbortSignal) => streamAnthropic(messages, { apiKey: "test", fetchImpl }, [], { signal }) },
  { name: "gemini", run: (fetchImpl: typeof fetch, signal: AbortSignal) => streamGemini(messages, { apiKey: "test", fetchImpl }, [], { signal }) },
];

describe("三家 provider 的真实重试接线", () => {
  it.each(adapters)("$name：Retry-After 等待期间取消，立即收束并保留原始原因", async ({ run }) => {
    const controller = new AbortController();
    const reason = new Error("stop provider during retry delay");
    let notifyFetch!: () => void;
    const entered = new Promise<void>((resolve) => { notifyFetch = resolve; });
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => {
      notifyFetch();
      return new Response("busy", { status: 503, headers: { "retry-after": "8" } });
    });
    let settled = false;
    const pending = (async () => {
      try { for await (const _ of run(fetchImpl, controller.signal)) { /* 失败响应不应有内容 */ } }
      catch (error) { return error; }
      return null;
    })().then((result) => { settled = true; return result; });
    try {
      await entered;
      await nextTurn(); // 让响应正文读完并进入退避窗。
      controller.abort(reason);
      await nextTurn();
      expect(settled).toBe(true);
      expect(await pending).toBe(reason);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    } finally {
      controller.abort(reason);
      await pending;
    }
  });
});
