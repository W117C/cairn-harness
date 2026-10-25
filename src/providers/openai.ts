// OpenAI Chat Completions 原生适配器（SSE 流式 + 非流式），由原 glm.ts 泛化而来：
// baseURL / model / 额外 body 参数（extraBody）/ 环境变量名均可配，GLM 是它的一组预设（见 glm.ts）。
// 解码规则与迁移前逐字一致：增量在 choices[0].delta.content；tool_calls 按 index 跨块累积
//（id 首块、name 非空即记、arguments 拼接）；末 chunk 带 usage（后到覆盖）；data: [DONE] 结束。
import { randomUUID } from "node:crypto";
import { DEFAULT_STALL_MS } from "../net";
import { backoffMs, establishStream, retryableStreamErrorFrame, retryableStreamFailure, StreamFailure, waitRetryDelay } from "./retry";
import { turnStopMissingEvent, turnTruncatedEvent } from "./stop-reason";
import type { ModelOutput, ProviderContentImage, ProviderMessage, ProviderMessageWithImage, ProviderToolSpec } from "./index";
import type { RequestMeter, RequestCategory, MeterUsage, RequestOutcome } from "../agent/metering";

/** `StreamFailure` 与流内 error 帧的判据已搬到 `retry.ts`（2026-10-23）：三家适配器共用同一套，
 *  名字表与「数值优先」的读法只留一份。这里再导出，保持既有 import 路径不变。 */
export { StreamFailure } from "./retry";

export type OpenAiMessage = ProviderMessage;
export type OpenAiToolSpec = ProviderToolSpec;

export interface OpenAiOptions {
  /** 缺省读 process.env[apiKeyEnv ?? "OPENAI_API_KEY"]。 */
  apiKey?: string;
  /** 缺失 key 时的环境变量名（进错误消息），缺省 OPENAI_API_KEY。 */
  apiKeyEnv?: string;
  model?: string;
  /** model 的环境变量名，缺省 OPENAI_MODEL。 */
  modelEnv?: string;
  /** model 的最终缺省值，缺省 gpt-4o-mini。 */
  defaultModel?: string;
  /** 端点：base（`https://host/v1`）或完整 URL 都行，缺 `/chat/completions` 会补齐（见 chatCompletionsEndpoint）。 */
  baseURL?: string;
  /** baseURL 的环境变量名，缺省 OPENAI_BASE_URL。 */
  baseURLEnv?: string;
  /** baseURL 的最终缺省值，缺省 OpenAI 官方端点。 */
  defaultBaseURL?: string;
  /** 额外 body 参数（GLM 预设传 tool_stream:true）；在 stream/model/messages 之后合并。 */
  extraBody?: Record<string, unknown>;
  /** 反向验证开关：false = 非流式（整段回复只算 1 个 delta），缺省 true。 */
  stream?: boolean;
  /** 错误消息前缀（GLM 预设为 "GLM"），缺省 "OpenAI"。 */
  label?: string;
  /** 单测注入点（缺省全局 fetch）。 */
  fetchImpl?: typeof fetch;
  /** 停滞守卫静默窗口 ms（根因 4）；缺省 60s，<=0 关闭守卫。 */
  stallTimeoutMs?: number;
  /** 思考档位（"low"|"medium"|"high"）：非空则写 body.reasoning_effort。
   *  传的是**档位名**而不是数值——OpenAI 兼容族收的就是这个名字（DeepSeek 的 /models 自述里
   *  `effort.supported_levels` 写明的也是这些名字）。undefined = 逐字旧行为（不出现这个字段）。 */
  reasoningEffort?: string;
  /** Opt-in wire-boundary accounting; never stores payload/key text. */
  metering?: { meter: RequestMeter; category: RequestCategory };
}

interface DeltaToolCall {
  index: number;
  id?: string;
  function?: { name?: string; arguments?: string };
}

interface ChatChunk {
  id?: string;
  choices?: {
    delta?: {
      content?: string;
      /** 推理正文：DeepSeek 系用 `reasoning_content`，OpenAI o 系用 `reasoning`。 */
      reasoning_content?: string;
      reasoning?: string;
      tool_calls?: DeltaToolCall[];
    };
    message?: { content?: string; tool_calls?: DeltaToolCall[] };
    finish_reason?: string | null;
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number }; cache_creation_input_tokens?: number } | null;
  // OpenAI 流中段错误事件（如内容审查），出现即按协议错误抛出
  error?: { message?: string; type?: string; code?: string } | null;
}

function parseArgs(raw: string | undefined, label: string): Record<string, unknown> {
  if (!raw || raw.trim() === "") return {};
  // 参数 JSON 损坏属协议级异常，fail loud，不静默吞掉
  const parsed = JSON.parse(raw) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${label} tool_call arguments 不是对象: ${raw.slice(0, 100)}`);
  }
  return parsed as Record<string, unknown>;
}

/** 计量口径统一：非数 / 负数一律算「未上报」(null)，绝不折算成 0——缺报与零命中是两件事。 */
function tokenCount(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
}

function toUsage(u: NonNullable<ChatChunk["usage"]>): ModelOutput & { type: "usage" } {
  // prompt_tokens 本身含缓存命中量 → 事件口径已一致；这里只是把分块透出，让命中率可见（缺报不落 0）
  const read = tokenCount(u.prompt_tokens_details?.cached_tokens);
  const write = tokenCount(u.cache_creation_input_tokens);
  return {
    type: "usage",
    inputTokens: u.prompt_tokens ?? 0,
    outputTokens: u.completion_tokens ?? 0,
    ...(read !== null ? { cacheReadInputTokens: read } : {}),
    ...(write !== null ? { cacheWriteInputTokens: write } : {}),
  };
}

function toWireMessages(messages: OpenAiMessage[]): unknown[] {
  return toOpenAiWireMessages(messages);
}

/** 带图消息的 wire 形状：content 从字符串换成 OpenAI 的 parts 数组。
 *  **纯文本消息不走这里**——它在 toWireMessages 里逐字保持 `content: "..."`，
 *  既不让第三方 OpenAI 兼容网关看到陌生形状，也不动前缀缓存的前缀匹配。 */
function toWireImageMessage(m: OpenAiMessage, parts: readonly ProviderContentImage[]): unknown {
  const blocks: unknown[] = [];
  if (m.content !== null && m.content !== "") blocks.push({ type: "text", text: m.content });
  for (const p of parts) {
    if (p.type !== "image") continue;
    blocks.push({ type: "image_url", image_url: { url: p.dataUrl } });
  }
  if (blocks.length === 0) return { role: m.role, content: m.content };
  return {
    role: m.role,
    content: blocks,
    ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}),
    ...(m.tool_call_id !== undefined ? { tool_call_id: m.tool_call_id } : {}),
  };
}

/** 一条消息的 wire 形状（识图那一支在这里分叉）。 */
function toWireMessage(m: OpenAiMessage): unknown {
  const parts = (m as ProviderMessageWithImage).contentParts;
  if (parts !== undefined && parts.length > 0) return toWireImageMessage(m, parts);
  return {
    role: m.role,
    content: m.content,
    ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}),
    ...(m.tool_call_id !== undefined ? { tool_call_id: m.tool_call_id } : {}),
  };
}

/** 识图消息表（纯函数，供判卷直接钉 wire 形状）。 */
export function toOpenAiWireMessages(messages: OpenAiMessage[]): unknown[] {
  return messages.map(toWireMessage);
}

function toWireTools(tools: OpenAiToolSpec[]): unknown[] {
  return tools.map((t) => ({
    type: "function",
    function: { name: t.name, ...(t.description ? { description: t.description } : {}), parameters: t.parameters },
  }));
}

/** 自建/兼容网关的端点归一：给的可以是 base（`https://host/v1`），也可以是完整 endpoint。
 *  两侧代价不对称——按原样发一个 base 出去必然 404，而重复拼 `/chat/completions` 同样打不通。
 *  后缀已经是它就原样用（GLM_ENDPOINT 那种写法保持逐字可用），否则补齐。 */
export function chatCompletionsEndpoint(base: string): string {
  const trimmed = base.replace(/\/+$/, "");
  return trimmed.endsWith("/chat/completions") ? trimmed : `${trimmed}/chat/completions`;
}

/** 流式一轮对话：把 SSE 增量转成事件 —— delta.content → assistant_delta、
 *  delta.tool_calls → 累积成 tool_call 事件（流末按 index 稳定吐出）、末 chunk usage → usage 事件。 */
export async function* streamOpenAI(
  messages: OpenAiMessage[],
  opts: OpenAiOptions = {},
  tools?: OpenAiToolSpec[],
  call?: { signal?: AbortSignal },
): AsyncGenerator<ModelOutput> {
  const label = opts.label ?? "OpenAI";
  const envName = opts.apiKeyEnv ?? "OPENAI_API_KEY";
  const apiKey = opts.apiKey ?? process.env[envName];
  if (!apiKey) throw new Error(`${envName} 未设置（key 只从环境变量读取，不落文件）`);
  const model = opts.model ?? process.env[opts.modelEnv ?? "OPENAI_MODEL"] ?? opts.defaultModel ?? "gpt-4o-mini";
  const endpoint = chatCompletionsEndpoint(
    opts.baseURL ?? process.env[opts.baseURLEnv ?? "OPENAI_BASE_URL"] ?? opts.defaultBaseURL ?? "https://api.openai.com/v1",
  );
  const stream = opts.stream ?? true;
  const rawFetch = opts.fetchImpl ?? fetch;
  // 缺失原生 id 时，序号只在这一逻辑请求内有效；重试沿用同一前缀，新请求不得碰撞。
  const toolRequestScope = randomUUID();

  const body: Record<string, unknown> = { model, messages: toWireMessages(messages), stream };
  // C8（审查 P2）：流式计量——OpenAI 兼容端点默认不回 usage，须显式开启 stream_options.include_usage，
  // 否则流式会话 token 恒 0（成本闸/用量面板全失真）。extraBody 仍可覆盖（自建网关不兼容时）。
  if (stream) body.stream_options = { include_usage: true };
  if (opts.reasoningEffort !== undefined && opts.reasoningEffort !== "") body.reasoning_effort = opts.reasoningEffort;
  if (opts.extraBody) Object.assign(body, opts.extraBody);
  if (tools && tools.length > 0) body.tools = toWireTools(tools);

  // 根因 4：停滞守卫改由 establishStream 逐次新建（静默窗口，不是总时长）；
  // 成功建连后交回本函数继续管流体（bump / dispose）。
  const serializedBody = JSON.stringify(body);
  call?.signal?.throwIfAborted();
  const metering = opts.metering;
  let requestId: number | undefined;
  let meterOutcome: RequestOutcome = "failed";
  let meterUsage: Partial<MeterUsage> = {};
  const finishMeter = (outcome: RequestOutcome): void => {
    if (requestId === undefined || metering === undefined) return;
    metering.meter.finishRequest(requestId, outcome, meterUsage);
    requestId = undefined;
  };
  // establishStream 的 HTTP 重试与下方 SSE 重试都在同一发送位置逐笔登记。
  const doFetch: typeof fetch = metering === undefined ? rawFetch : async (input, init) => {
    meterUsage = {};
    meterOutcome = "failed";
    requestId = metering.meter.beginRequest(metering.category, serializedBody);
    try {
      return await rawFetch(input, init);
    } catch (error) {
      finishMeter(call?.signal?.aborted ? "cancelled" : "failed");
      throw error;
    }
  };
  const observeUsage = (u: NonNullable<ChatChunk["usage"]>): void => {
    const input = tokenCount(u.prompt_tokens), read = tokenCount(u.prompt_tokens_details?.cached_tokens);
    // OpenAI/GLM do not report a disjoint cache-write bucket. Do not invent zero.
    const write = tokenCount(u.cache_creation_input_tokens);
    meterUsage = { inputTokens: input !== null ? Math.max(0, input - (read ?? 0) - (write ?? 0)) : null,
      outputTokens: tokenCount(u.completion_tokens), cacheReadInputTokens: read, cacheWriteInputTokens: write };
  };
  try {
  /* 流内重试（2026-09-30 实测动因）：`establishStream` 只管到「响应体尚未被消费」那一段，
   * 而对端把 5xx **塞进 SSE 体里**（HTTP 200 + 一帧 `{"error":{"type":"502",…}}`）时它管不着。
   * 实测 OpenRouter 的 `502 Provider returned an empty response` 正是这个形状：
   * 简单请求 200，多轮工具调用一到第 3~9 轮必挂，连续 7 次把整轮任务打死。
   *
   * **安全边界**：只有本次尝试「一个输出都还没吐出去」时才允许重放。
   * 一旦吐过 delta/tool_call，重放会把同一轮内容吐两遍——那比失败更糟（模型看到重复内容），
   * 建连段那条不变量（上面写着「绝不重放」）正是为这个立的。
   * 判据三件缺一不可：① 没吐过输出；② 还有次数；③ 不是调用方取消。 */
  // 非流式分支（摘要器 / 反向验证用）：整段回复转成同一条事件管线，delta 只有 1 个。
  // 它**不参与流内重试**：没有 delta 边界可言，失败即整轮失败，重放语义归调用方定。
  if (!stream) {
    const estNs = await establishStream({
      label,
      url: endpoint,
      init: {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: serializedBody,
      },
      fetchImpl: doFetch,
      onRetry: () => finishMeter("failed"),
      stallMs: opts.stallTimeoutMs ?? DEFAULT_STALL_MS,
      ...(call?.signal !== undefined ? { callerSignal: call.signal } : {}),
    });
    const resNs = estNs.res;
    try {
      const data = (await resNs.json()) as ChatChunk;
      if (data.usage) observeUsage(data.usage);
      const callId = data.id ?? "a-0";
      const msg = data.choices?.[0]?.message;
      if (msg?.content) yield { type: "assistant_delta", callId, text: msg.content };
      for (const [index, c] of (msg?.tool_calls ?? []).entries()) {
        yield {
          type: "tool_call",
          id: c.id ?? `call-${toolRequestScope}-${String(c.index ?? index)}`,
          name: c.function?.name ?? "",
          args: parseArgs(c.function?.arguments, label),
        };
      }
      if (data.usage) yield toUsage(data.usage);
      // 非流式分支同一家、同一个字段：整段回复一样会被 length 砍断。
      // 这条尤其不能省——本分支唯一的真调用者是压缩摘要器，而摘要正是长任务上旧事件被排除后
      // 唯一的存活通道；一份砍了一半的摘要落进记录，比不落更坏（它会以「完整结论」的形态被读到）。
      const truncated = turnTruncatedEvent(callId, data.choices?.[0]?.finish_reason, data.usage?.completion_tokens);
      if (truncated) yield truncated;
      const stopMissing = turnStopMissingEvent(callId, data.choices?.[0]?.finish_reason, data.usage?.completion_tokens);
      if (stopMissing) yield stopMissing;
      meterOutcome = "ok";
    } finally {
      estNs.guard.dispose();
    }
    return;
  }

  const STREAM_ATTEMPTS = 3;
  const streamOnce = async function* (): AsyncGenerator<ModelOutput, void, undefined> {
    let attempt = 0;
    let emitted = false;
    for (;;) {
      attempt += 1;
      const est = await establishStream({
        label,
        url: endpoint,
        init: {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: serializedBody,
        },
        fetchImpl: doFetch,
        onRetry: () => finishMeter("failed"),
        stallMs: opts.stallTimeoutMs ?? DEFAULT_STALL_MS,
        ...(call?.signal !== undefined ? { callerSignal: call.signal } : {}),
        ...(attempt > 1 ? { attempts: 1 } : {}), // 建连段那一层重试上一轮已付过
      });
      const res2 = est.res;
      if (!res2.body) {
        est.guard.dispose();
        throw new Error(`${label} 流式响应缺少 body`);
      }
      const reader2 = res2.body.getReader();
      // 每次尝试单独解码；半个 UTF-8 字符、buf 与 tool_call 分片都不能带入下一轮。
      const decoder = new TextDecoder();
      let buf2 = "";
      let finished2 = false;
      let callId2 = "a-0";
      const pending2 = new Map<number, { id?: string; name: string; args: string }>();
      let usage2: (ModelOutput & { type: "usage" }) | null = null;
      let finishReason2: string | null | undefined;
      let retryError: unknown;
      try {
        while (!finished2) {
          const { done, value } = await reader2.read();
          if (done) break;
          est.guard.bump();
          buf2 += decoder.decode(value, { stream: true });
          let nl: number;
          while ((nl = buf2.indexOf("\n")) >= 0) {
            const line = buf2.slice(0, nl).trim();
            buf2 = buf2.slice(nl + 1);
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (!payload) continue;
            if (payload === "[DONE]") { finished2 = true; break; }
            let chunk: ChatChunk;
            try {
              chunk = JSON.parse(payload) as ChatChunk;
            } catch {
              if (!payload.startsWith("{")) continue; // 心跳/注释/网关杂帧：容忍
              throw new StreamFailure(`${label} SSE 帧损坏（半帧截断？）：JSON 解析失败，拒绝静默丢字`, false);
            }
            if (chunk.error) {
              const e = chunk.error;
              const named = typeof e.type === "string" ? e.type : undefined;
              // 数值可能落在 `type` 也可能落在 `code`，且可能是字符串形式（OpenRouter 实测
              // `"type": "502"`）。判据住 `retry.ts`：三家共用一份名字表与「数值优先」的读法。
              throw new StreamFailure(
                `${label} 流错误 ${named ?? e.code ?? "unknown"}: ${e.message ?? ""}`,
                retryableStreamErrorFrame({ names: [e.type, e.code] }),
              );
            }
            if (chunk.id) callId2 = chunk.id;
            if (chunk.usage) { usage2 = toUsage(chunk.usage); observeUsage(chunk.usage); }
            const fr = chunk.choices?.[0]?.finish_reason;
            if (fr) finishReason2 = fr;
            const delta = chunk.choices?.[0]?.delta;
            // 推理增量（`reasoning_content` / `reasoning`）→ **thinking_delta**（与正文分开的事件）。
            // 2026-10-07 之前这里刻意不读（怕污染转录），现在用户要求显示思考过程：
            // 关键是**走独立事件**而不是并进 content —— 转录里正文仍是正文，思考单独一段，
            // 回放与转录都干净（思考块在多数家本就不可回传）。
            const thinking = delta?.reasoning_content ?? delta?.reasoning;
            if (typeof thinking === "string" && thinking !== "") {
              emitted = true;
              yield { type: "thinking_delta", callId: callId2, text: thinking };
            }
            if (delta?.content) {
              emitted = true;
              yield { type: "assistant_delta", callId: callId2, text: delta.content };
            }
            if (delta?.tool_calls) {
              emitted = true;
              for (const tc of delta.tool_calls) {
                const acc = pending2.get(tc.index) ?? { id: undefined, name: "", args: "" };
                if (tc.id) acc.id = tc.id;
                if (tc.function?.name) acc.name = tc.function.name;
                if (tc.function?.arguments) acc.args += tc.function.arguments;
                pending2.set(tc.index, acc);
              }
            }
          }
        }
        // 收尾三件，顺序与原实现逐字一致：
        // ① truncated 必须在 tool_call 冲刷**之前**（被截断的 write_file 参数会让 parseArgs 抛，
        //    排在其后这条记录就永远发不出去——而那恰是最常见的截断形状）；
        // ② 累积的 tool_call 按 index 稳定排序后吐出；
        // ③ usage 最后。
        const truncated = turnTruncatedEvent(callId2, finishReason2, usage2?.outputTokens ?? null);
        if (truncated) yield truncated;
        // 与 truncated 同一位置、同一理由：先于 tool_call 冲刷与 usage（args 解析若抛，
        // 这条证据不能跟着陪葬）。两者互斥：有原文走 truncated，没原文走这一枚。
        const stopMissing = turnStopMissingEvent(callId2, finishReason2, usage2?.outputTokens ?? null);
        if (stopMissing) yield stopMissing;
        const ordered = [...pending2.entries()].sort((a, b) => a[0] - b[0]);
        for (const [index, acc] of ordered) {
          yield {
            type: "tool_call",
            id: acc.id ?? `call-${toolRequestScope}-${String(index)}`,
            name: acc.name,
            args: parseArgs(acc.args, label),
          };
        }
        if (usage2) yield usage2;
        return;
      } catch (err) {
        finishMeter(call?.signal?.aborted ? "cancelled" : "failed");
        const cancelled = call?.signal?.aborted === true;
        // 不可重放的失败（协议级：帧损坏 / 非 5xx 的 error 帧）立刻抛，不拿它去打转。
        // stall 守卫触发也不重放：重放会把静默窗当网络抖动再烧一遍全长超时。
        const stalledByGuard = est.guard.stalled();
        const retryable = stalledByGuard ? false : retryableStreamFailure(err);
        if (emitted || attempt >= STREAM_ATTEMPTS || cancelled || !retryable) throw err;
        retryError = err;
      } finally {
        // 包括消费者在 yield 处提前 return；重试退避前也先回收本次响应。
        est.guard.dispose();
        void reader2.cancel().catch(() => {});
        reader2.releaseLock();
      }
      const delay = backoffMs(attempt, 300, 2_000, Math.random);
      console.warn(
        `[${label}] 流内失败（第 ${String(attempt)} 次，尚未产出任何输出）⇒ ${String(delay)}ms 后重试：`
        + (retryError instanceof Error ? retryError.message : String(retryError)),
      );
      try {
        await waitRetryDelay(delay, call?.signal);
      } catch (error) {
        call?.signal?.throwIfAborted();
        throw error;
      }
    }
  };
  // 流式分支的全部产出（含流内重试与收尾三件）都在 streamOnce 里，这里只负责调用。
  yield* streamOnce();
  meterOutcome = "ok";
  } finally {
    finishMeter(call?.signal?.aborted ? "cancelled" : meterOutcome);
  }
}
