/* 能力 4「遇到失败能重试、换路径」/ 能力 9 运维面：出网建连重试层。
   此前 provider 层零重试、无 429 处理：真实负载下首个限流响应就把整轮打死。
   测试数据全部本地 Response 替身（零真连网；与 provider 测试既有 stubFetch 同口径）。 */
import { describe, expect, it } from "vitest";
import { backoffMs, establishStream, retryAfterMs, retryableStatus } from "../src/providers/retry";
import { streamOpenAI } from "../src/providers/openai";
import { streamAnthropic } from "../src/providers/anthropic";
import { streamGemini } from "../src/providers/gemini";

const okBody = (): Response => new Response('data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n\n', {
  status: 200, headers: { "content-type": "text/event-stream" },
});
const http = (status: number, body = "boom", headers: Record<string, string> = {}): Response =>
  new Response(body, { status, headers });

/** 依次吐出给定响应的 fetch 替身；调用次数可查。 */
function scripted(...responses: (Response | Error)[]): { fetchImpl: typeof fetch; calls: () => number } {
  let n = 0;
  return {
    calls: () => n,
    fetchImpl: (async () => {
      const r = responses[Math.min(n, responses.length - 1)];
      n++;
      if (r instanceof Error) throw r;
      return r;
    }) as unknown as typeof fetch,
  };
}

const base = { label: "TEST", url: "https://example.invalid/v1/messages", init: { method: "POST" } as RequestInit };
const noSleep = { sleep: async () => {}, rand: () => 1 };

describe("可重试判定与退避（纯函数）", () => {
  it("限流/服务端临时故障/超时才重试；请求本身的问题不重放", () => {
    for (const s of [408, 409, 425, 429, 500, 502, 503, 504]) expect(retryableStatus(s)).toBe(true);
    for (const s of [400, 401, 403, 404, 422, 451]) expect(retryableStatus(s)).toBe(false);
  });

  it("Retry-After 认秒数与 HTTP-date，不可解析交回退避，且一律不超上限", () => {
    expect(retryAfterMs("3", 0, 8_000)).toBe(3_000);
    expect(retryAfterMs("0", 0, 8_000)).toBe(0);
    expect(retryAfterMs("99999", 0, 8_000)).toBe(8_000); // 钳在上限，绝不让一轮被挂死
    expect(retryAfterMs("Tue, 15 Nov 2028 01:00:00 GMT", Date.UTC(2028, 10, 15, 0, 0, 0), 8_000)).toBe(8_000);
    expect(retryAfterMs("not-a-date", 0, 8_000)).toBeNull();
    expect(retryAfterMs(null, 0, 8_000)).toBeNull();
  });

  it("退避指数增长封顶，且 full jitter 下 rand()=0 不产生等待", () => {
    expect(backoffMs(1, 500, 8_000, () => 1)).toBe(500);
    expect(backoffMs(2, 500, 8_000, () => 1)).toBe(1_000);
    expect(backoffMs(4, 500, 8_000, () => 1)).toBe(4_000);
    expect(backoffMs(10, 500, 8_000, () => 1)).toBe(8_000); // 封顶
    expect(backoffMs(3, 500, 8_000, () => 0)).toBe(0);
  });
});

describe("establishStream：只重试「响应体尚未消费」的失败", () => {
  it("429 两次后成功：共 3 次请求、两次重试可查、Retry-After 被遵从", async () => {
    const f = scripted(http(429, "slow down", { "retry-after": "3" }), http(429, "slow down", { "retry-after": "3" }), okBody());
    const seen: { attempt: number; status: number | null; delayMs: number }[] = [];
    let slept = 0;
    const r = await establishStream({
      ...base, fetchImpl: f.fetchImpl, rand: () => 1,
      onRetry: (i) => seen.push({ attempt: i.attempt, status: i.status, delayMs: i.delayMs }),
      sleep: async () => { slept++; },
    });
    expect(r.res.ok).toBe(true);
    expect(f.calls()).toBe(3);
    expect(seen.map((s) => [s.attempt, s.status, s.delayMs])).toEqual([[1, 429, 3_000], [2, 429, 3_000]]);
    expect(slept).toBe(2); // 每次重试前确实等过一次（不是只记账不等）
  });

  it("400 是请求本身的问题：一次即抛，文案与迁移前逐字一致", async () => {
    const f = scripted(http(400, "bad request"));
    await expect(establishStream({ ...base, fetchImpl: f.fetchImpl, ...noSleep }))
      .rejects.toThrow("TEST 请求失败 HTTP 400: bad request");
    expect(f.calls()).toBe(1);
  });

  it("网络错误重试后成功；持续失败则耗尽次数后原样上抛", async () => {
    const down = scripted(new Error("fetch failed: ENOTFOUND api.example.invalid"), okBody());
    expect((await establishStream({ ...base, fetchImpl: down.fetchImpl, ...noSleep })).res.ok).toBe(true);
    expect(down.calls()).toBe(2);

    const always = scripted(new Error("ECONNRESET"));
    await expect(establishStream({ ...base, fetchImpl: always.fetchImpl, attempts: 3, ...noSleep }))
      .rejects.toThrow("ECONNRESET");
    expect(always.calls()).toBe(3);
  });

  it("调用方取消不是故障：不重试、不吞取消", async () => {
    const abort = new AbortController();
    const f = scripted(http(503));
    const p = establishStream({
      ...base, fetchImpl: f.fetchImpl, ...noSleep, attempts: 5, callerSignal: abort.signal,
      sleep: async () => { abort.abort(); },
    });
    await expect(p).rejects.toThrow();
    expect(f.calls()).toBe(1); // 第 1 次重试的等待里取消 ⇒ 下一次请求不得启动

    // 正文读取期间取消也要保留原原因，并且不能宣告一笔不会执行的新重试。
    const bodyAbort = new AbortController();
    const reason = new Error("stop while reading error body");
    const body = new ReadableStream<Uint8Array>({
      pull(controller) { bodyAbort.abort(reason); controller.error(reason); },
    }, { highWaterMark: 0 });
    const duringBody = scripted(new Response(body, { status: 503 }));
    const retries: unknown[] = [];
    const error = await establishStream({
      ...base, fetchImpl: duringBody.fetchImpl, ...noSleep, callerSignal: bodyAbort.signal,
      onRetry: (info) => { retries.push(info); },
    }).then(({ guard }) => { guard.dispose(); return null; }, (err: unknown) => err);
    expect(error).toBe(reason);
    expect(duringBody.calls()).toBe(1);
    expect(retries).toEqual([]);
  });

  it("停滞不重试（60s 量级等三次 = 白挂三分钟），直接把可读原因抛回上层", async () => {
    const hangs: typeof fetch = (async (_u: unknown, init?: { signal?: AbortSignal }) =>
      new Promise((_res, rej) => {
        init?.signal?.addEventListener("abort", () => rej(new Error("出网调用 停滞超时：5ms 内无任何数据")));
      })) as unknown as typeof fetch;
    const r = await establishStream({ ...base, fetchImpl: hangs, stallMs: 5, attempts: 3, ...noSleep })
      .then(() => null, (e: unknown) => e);
    expect(String(r)).toContain("停滞超时");
  });

  it("attempts=1 即完全关闭重试（留位给「只想快速失败」的调用方）", async () => {
    const f = scripted(http(503), okBody());
    await expect(establishStream({ ...base, fetchImpl: f.fetchImpl, attempts: 1, ...noSleep }))
      .rejects.toThrow("HTTP 503");
    expect(f.calls()).toBe(1);
  });
});

/* 接线证据：三家 provider 真的走这条链——429 之后再来一次 400，
   若未接重试则只会请求 1 次；接上后必然 2 次且最终错误文案不变。 */
describe("provider 接线（openai / anthropic / gemini 共用同一重试链）", () => {
  const msg = [{ role: "user" as const, content: "hi" }];
  const drain = async (it: AsyncIterable<unknown>): Promise<void> => { for await (const _ of it) { /* 丢弃 */ } };

  const cases: { name: string; run: (fetchImpl: typeof fetch) => AsyncIterable<unknown> }[] = [
    { name: "openai", run: (fetchImpl) => streamOpenAI(msg, { apiKey: "k", fetchImpl, stream: false } as never) },
    { name: "anthropic", run: (fetchImpl) => streamAnthropic(msg, { apiKey: "k", fetchImpl } as never) },
    { name: "gemini", run: (fetchImpl) => streamGemini(msg, { apiKey: "k", fetchImpl } as never) },
  ];

  it.each(cases)("$name：429 会被重试，随后 400 仍按原文案失败", async ({ run }) => {
    const f = scripted(http(429, "slow down"), http(400, "bad request"));
    await expect(async () => { await drain(run(f.fetchImpl)); }).rejects.toThrow("请求失败 HTTP 400: bad request");
    expect(f.calls()).toBe(2); // 1 次 = 没接上重试
  });
});
