// 流内重试的三家一致性（2026-10-23）。
//
// 动因是一次**实测出来的不对称**：`streamOpenAI` 早在 2026-09-30 就有了「对端把 5xx 塞进 SSE 体
//（HTTP 200）」的流内重试，而 anthropic / gemini 两个适配器**一次就打死整轮任务**。
// 实测（同一条探针，只换适配器）：
//   OpenAI  首帧 server_error      ⇒ FETCH CALLS = 2，正常收尾
//   Anthropic 首帧 overloaded_error ⇒ FETCH CALLS = 1，抛错
//   Gemini  首帧 RESOURCE_EXHAUSTED ⇒ FETCH CALLS = 1，抛错
// 三家共用同一份判据（`retry.ts` 的 `retryableStreamErrorFrame` / `retryableStreamFailure` /
// `StreamFailure`），所以本组判据也按「三家同一组边界」写：每一条不变量在三个适配器上各钉一次。
// **只钉一家就是半个判据**（第 675 页那个教训的同一形状）。
import { describe, expect, it } from "vitest";
import { mergeAssistantDeltas, type AssistantDeltaEvent } from "../src/events";
import type { ModelOutput, ProviderMessage } from "../src/providers";
import { streamAnthropic } from "../src/providers/anthropic";
import { streamGemini } from "../src/providers/gemini";
import { streamOpenAI } from "../src/providers/openai";
import { retryableStreamErrorFrame, StreamFailure } from "../src/providers/retry";

const USER: ProviderMessage[] = [{ role: "user", content: "hi" }];
const enc = new TextEncoder();

/** 每次调用**新造**一个 Response：body 是一次性的（读过即 locked），
 *  重试路径上复用同一个实例会拿到 "body object should not be disturbed or locked"
 *  —— 那条错会盖住真正要验的重试语义。 */
const sse = (frames: readonly string[]): Response =>
  new Response(new ReadableStream<Uint8Array>({
    start(c) { for (const f of frames) c.enqueue(enc.encode(f + "\n")); c.close(); },
  }), { status: 200, headers: { "content-type": "text/event-stream" } });

async function collect(iter: AsyncIterable<ModelOutput>): Promise<ModelOutput[]> {
  const out: ModelOutput[] = [];
  for await (const e of iter) out.push(e);
  return out;
}
const textOf = (events: ModelOutput[]): string =>
  mergeAssistantDeltas(events.filter((e): e is AssistantDeltaEvent => e.type === "assistant_delta"));

// ---- 三家各自的「成功收尾」与「未吐输出的可重试错误」帧 ----
interface Arm {
  readonly name: string;
  /** 只含文本增量的一次正常收尾。 */
  readonly ok: readonly string[];
  /** 一个输出都没吐就报错、且**应当**重试的帧（HTTP 200 的 SSE 体内）。 */
  readonly retryable: readonly string[];
  /** 吐了半句正文。 */
  readonly partial: readonly string[];
  /** 一个输出都没吐就报错、且**不应**重试的帧（请求本身的问题）。 */
  readonly fatal: readonly string[];
  readonly stream: (fetchImpl: typeof fetch, signal?: AbortSignal) => AsyncIterable<ModelOutput>;
}

const ARMS: readonly Arm[] = [
  {
    name: "OpenAI 兼容",
    ok: ["data: " + JSON.stringify({ choices: [{ delta: { content: "ok" } }] }), "data: [DONE]"],
    retryable: ["data: " + JSON.stringify({ error: { type: "server_error", message: "boom" } })],
    partial: ["data: " + JSON.stringify({ choices: [{ delta: { content: "半" } }] })],
    fatal: ["data: " + JSON.stringify({ error: { type: "invalid_request_error", message: "bad" } })],
    stream: (f, signal) => streamOpenAI(USER, { apiKey: "t", baseURL: "https://x.test/v1", fetchImpl: f }, undefined, signal === undefined ? undefined : { signal }),
  },
  {
    name: "Anthropic",
    ok: [
      'event: content_block_delta',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"ok"}}',
    ],
    retryable: [
      'event: error',
      'data: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}',
    ],
    partial: [
      'event: content_block_delta',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"半"}}',
    ],
    fatal: [
      'event: error',
      'data: {"type":"error","error":{"type":"invalid_request_error","message":"bad"}}',
    ],
    stream: (f, signal) => streamAnthropic(USER, { apiKey: "t", fetchImpl: f }, undefined, signal === undefined ? undefined : { signal }),
  },
  {
    name: "Gemini",
    ok: ['data: {"candidates":[{"content":{"parts":[{"text":"ok"}]}}]}'],
    retryable: ['data: {"error":{"code":429,"message":"quota","status":"RESOURCE_EXHAUSTED"}}'],
    partial: ['data: {"candidates":[{"content":{"parts":[{"text":"半"}]}}]}'],
    fatal: ['data: {"error":{"code":400,"message":"bad","status":"INVALID_ARGUMENT"}}'],
    stream: (f, signal) => streamGemini(USER, { apiKey: "t", fetchImpl: f }, undefined, signal === undefined ? undefined : { signal }),
  },
];

describe.each(ARMS)("$name：流内失败的统一重试边界", (arm) => {
  it("首帧就是可重试错误（一个输出都没吐）⇒ 重试一次并把这一轮正常跑完", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return calls === 1 ? sse(arm.retryable) : sse(arm.ok);
    }) as unknown as typeof fetch;
    const events = await collect(arm.stream(fetchImpl));
    expect(calls, "这一家没有重试 ⇒ 一次过载就打死了整轮任务").toBe(2);
    // 拿到的是**第二次**的内容，不是两次拼起来的两遍
    expect(textOf(events)).toBe("ok");
  });

  it("★ 反向哨兵：已经吐过正文之后再失败 ⇒ **不许重放**（重放会把同一轮吐两遍）", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return sse([...arm.partial, ...arm.retryable]);
    }) as unknown as typeof fetch;
    await expect(collect(arm.stream(fetchImpl))).rejects.toThrow(/流错误/);
    expect(calls, "吐过输出还重放 = 模型看到重复内容，比失败更糟").toBe(1);
  });

  it("不可重放的错误不重试（请求本身的问题，重放只会再错一次并白烧预算）", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return sse(arm.fatal);
    }) as unknown as typeof fetch;
    await expect(collect(arm.stream(fetchImpl))).rejects.toThrow(/流错误/);
    expect(calls).toBe(1);
  });

  it("重试次数有上限：连续失败不会无限打转", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return sse(arm.retryable);
    }) as unknown as typeof fetch;
    await expect(collect(arm.stream(fetchImpl))).rejects.toThrow(/流错误/);
    expect(calls).toBeGreaterThan(1); // 确实重试过
    expect(calls).toBeLessThanOrEqual(3); // 但没有无限重试
  });

  it("退避期间调用方取消 ⇒ 立刻收束，不再打第二次", async () => {
    let calls = 0;
    const controller = new AbortController();
    const fetchImpl = (async () => {
      calls += 1;
      // 第一次就拿到可重试错误；随后在退避窗口里取消 ⇒ 重试必须被丢掉。
      queueMicrotask(() => controller.abort(new Error("用户停止")));
      return sse(arm.retryable);
    }) as unknown as typeof fetch;
    await expect(collect(arm.stream(fetchImpl, controller.signal))).rejects.toThrow();
    expect(calls, "取消之后还去打了第二次 = 把用户的停止当没看见").toBe(1);
  });
});

describe("三家共用同一份判据（`retry.ts`），不许各抄一份名字表", () => {
  it("数值优先：字符串形式的 502 也算可重试（OpenRouter 实测 `\"type\": \"502\"`）", () => {
    expect(retryableStreamErrorFrame({ names: ["502"] })).toBe(true);
    expect(retryableStreamErrorFrame({ names: [502] })).toBe(true);
    expect(retryableStreamErrorFrame({ names: [undefined, null] })).toBe(false);
  });

  it("名字表覆盖三家的过载/限流/可用性形状（大小写不敏感）", () => {
    for (const name of ["server_error", "overloaded_error", "api_error", "rate_limit_error", "timeout"]) {
      expect(retryableStreamErrorFrame({ names: [name] }), name).toBe(true);
    }
    for (const name of ["RESOURCE_EXHAUSTED", "UNAVAILABLE", "INTERNAL", "DEADLINE_EXCEEDED"]) {
      expect(retryableStreamErrorFrame({ names: [name] }), name).toBe(true);
    }
    // 网关可能把它们写成小写
    expect(retryableStreamErrorFrame({ names: ["resource_exhausted"] })).toBe(true);
  });

  it("请求本身的问题一律不可重放（400/401/403 家族与协议错）", () => {
    for (const name of ["invalid_request_error", "authentication_error", "permission_error", "INVALID_ARGUMENT"]) {
      expect(retryableStreamErrorFrame({ names: [name] }), name).toBe(false);
    }
    for (const code of [400, 401, 403, 404, 422, 451]) {
      expect(retryableStreamErrorFrame({ names: [code] }), String(code)).toBe(false);
    }
  });

  it("`StreamFailure` 的 retryable 是唯一出口：非 StreamFailure 的未知形状按可重放处理", () => {
    expect(new StreamFailure("boom", true).retryable).toBe(true);
    expect(new StreamFailure("boom", false).retryable).toBe(false);
  });
});
