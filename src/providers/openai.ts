// OpenAI Chat Completions 原生适配器（SSE 流式 + 非流式），由原 glm.ts 泛化而来：
// baseURL / model / 额外 body 参数（extraBody）/ 环境变量名均可配，GLM 是它的一组预设（见 glm.ts）。
// 解码规则与迁移前逐字一致：增量在 choices[0].delta.content；tool_calls 按 index 跨块累积
//（id 首块、name 非空即记、arguments 拼接）；末 chunk 带 usage（后到覆盖）；data: [DONE] 结束。
import { DEFAULT_STALL_MS, type StallGuard } from "../net";
import { establishStream } from "./retry";
import { turnTruncatedEvent } from "./stop-reason";
import type { ModelOutput, ProviderMessage, ProviderToolSpec } from "./index";
import type { RequestMeter, RequestCategory, MeterUsage, RequestOutcome } from "../agent/metering";

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
  /** 完整请求 URL（含 /chat/completions 路径）。 */
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
    delta?: { content?: string; tool_calls?: DeltaToolCall[] };
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
  return messages.map((m) => ({
    role: m.role,
    content: m.content,
    ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}),
    ...(m.tool_call_id !== undefined ? { tool_call_id: m.tool_call_id } : {}),
  }));
}

function toWireTools(tools: OpenAiToolSpec[]): unknown[] {
  return tools.map((t) => ({
    type: "function",
    function: { name: t.name, ...(t.description ? { description: t.description } : {}), parameters: t.parameters },
  }));
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
  const endpoint =
    opts.baseURL ?? process.env[opts.baseURLEnv ?? "OPENAI_BASE_URL"] ?? opts.defaultBaseURL ?? "https://api.openai.com/v1/chat/completions";
  const stream = opts.stream ?? true;
  const doFetch = opts.fetchImpl ?? fetch;

  const body: Record<string, unknown> = { model, messages: toWireMessages(messages), stream };
  // C8（审查 P2）：流式计量——OpenAI 兼容端点默认不回 usage，须显式开启 stream_options.include_usage，
  // 否则流式会话 token 恒 0（成本闸/用量面板全失真）。extraBody 仍可覆盖（自建网关不兼容时）。
  if (stream) body.stream_options = { include_usage: true };
  if (opts.extraBody) Object.assign(body, opts.extraBody);
  if (tools && tools.length > 0) body.tools = toWireTools(tools);

  // 根因 4：停滞守卫改由 establishStream 逐次新建（静默窗口，不是总时长）；
  // 成功建连后交回本函数继续管流体（bump / dispose）。
  let guard: StallGuard | undefined;
  let res: Response;
  const serializedBody = JSON.stringify(body);
  call?.signal?.throwIfAborted();
  const requestId = opts.metering?.meter.beginRequest(opts.metering.category, serializedBody);
  let meterOutcome: RequestOutcome = "failed";
  let meterUsage: Partial<MeterUsage> = {};
  const observeUsage = (u: NonNullable<ChatChunk["usage"]>): void => {
    const input = tokenCount(u.prompt_tokens), read = tokenCount(u.prompt_tokens_details?.cached_tokens);
    // OpenAI/GLM do not report a disjoint cache-write bucket. Do not invent zero.
    const write = tokenCount(u.cache_creation_input_tokens);
    meterUsage = { inputTokens: input !== null && read !== null && write !== null && input >= read + write ? input - read - write : null,
      outputTokens: tokenCount(u.completion_tokens), cacheReadInputTokens: read, cacheWriteInputTokens: write };
  };
  try {
  // 建连段：停滞守卫 + 429/5xx/网络抖动的指数退避重试都在 establishStream 里。
  // 不变量：一旦 res.ok 就交回本函数，**绝不重放**（流已开始产出后重放会把同一轮 delta 吐两遍）；
  // 调用方取消与停滞都不重试（前者是用户意图，后者重试等于白挂三分钟）。
  const est = await establishStream({
    label,
    url: endpoint,
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: serializedBody,
    },
    fetchImpl: doFetch,
    stallMs: opts.stallTimeoutMs ?? DEFAULT_STALL_MS,
    ...(call?.signal !== undefined ? { callerSignal: call.signal } : {}),
  });
  res = est.res;
  guard = est.guard;

  if (!stream) {
    // 非流式分支（摘要器/反向验证用）：整段回复转成同一条事件管线，delta 只有 1 个
    try {
      const data = (await res.json()) as ChatChunk;
      if (data.usage) observeUsage(data.usage);
      const callId = data.id ?? "a-0";
      const msg = data.choices?.[0]?.message;
      if (msg?.content) yield { type: "assistant_delta", callId, text: msg.content };
      for (const c of msg?.tool_calls ?? []) {
        yield {
          type: "tool_call",
          id: c.id ?? `call-${String(c.index)}`,
          name: c.function?.name ?? "",
          args: parseArgs(c.function?.arguments, label),
        };
      }
      if (data.usage) yield toUsage(data.usage);
      meterOutcome = "ok";
    } finally {
      guard?.dispose();
    }
    return;
  }

  if (!res.body) {
    guard?.dispose();
    throw new Error(`${label} 流式响应缺少 body`);
  }
  const decoder = new TextDecoder();
  const reader = res.body.getReader();
  let buf = "";
  let finished = false;
  let callId = "a-0";
  // 跨块累积的工具调用：index → { id, name, arguments }
  const pending = new Map<number, { id?: string; name: string; args: string }>();
  let usage: (ModelOutput & { type: "usage" }) | null = null;
  // finish_reason 只在末 chunk 带（非末 chunk 是 null）：记最后一个非空的，别让 null 覆盖掉读数。
  let finishReason: string | null | undefined;

  try {
    while (!finished) {
      const { done, value } = await reader.read();
      if (done) break;
      guard?.bump(); // 有分片 → 续期（只有完全静默才会到点）
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload) continue;
        if (payload === "[DONE]") {
          finished = true;
          break;
        }
        // C7（审查 P2）容错边界修正（审查 S1-6）：只对「不是帧的行」容错——注释心跳、
        // 网关塞进来的非 JSON 文本。以 { 开头的真帧 parse 失败不得静默 continue：那意味着
        // 上游把一帧截断了，跳过 = 少一截正文/少一个 tool_call 分片，而流随后正常收尾会让
        // 本轮以「不完整输出」成功收束（loop 无从得知）。同文件 parseArgs 的口径就是协议级
        // 异常 fail loud，这里与之对齐。
        let chunk: ChatChunk;
        try {
          chunk = JSON.parse(payload) as ChatChunk;
        } catch {
          if (!payload.startsWith("{")) continue; // 心跳/注释/网关杂帧：容忍
          throw new Error(`${label} SSE 帧损坏（半帧截断？）：JSON 解析失败，拒绝静默丢字`);
        }
        if (chunk.error) {
          const e = chunk.error;
          throw new Error(`${label} 流错误 ${e.type ?? e.code ?? "unknown"}: ${e.message ?? ""}`);
        }
        if (chunk.id) callId = chunk.id;
        if (chunk.usage) { usage = toUsage(chunk.usage); observeUsage(chunk.usage); }
        const fr = chunk.choices?.[0]?.finish_reason;
        if (fr) finishReason = fr;
        const delta = chunk.choices?.[0]?.delta;
        if (delta?.content) {
          yield { type: "assistant_delta", callId, text: delta.content };
        }
        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const acc = pending.get(tc.index) ?? { id: undefined, name: "", args: "" };
            if (tc.id) acc.id = tc.id;
            if (tc.function?.name) acc.name = tc.function.name; // name 只在首块出现
            if (tc.function?.arguments) acc.args += tc.function.arguments; // arguments 跨块拼接
            pending.set(tc.index, acc);
          }
        }
      }
    }

    // 流结束：吐出累积完成的 tool_call（按 index 稳定排序），再吐 usage
    const ordered = [...pending.entries()].sort((a, b) => a[0] - b[0]);
    for (const [index, acc] of ordered) {
      yield {
        type: "tool_call",
        id: acc.id ?? `call-${String(index)}`,
        name: acc.name,
        args: parseArgs(acc.args, label),
      };
    }
    if (usage) yield usage;
    // 流正常收尾，但 finish_reason 说这一轮没说完（length＝输出预算到点 / content_filter＝被拦）。
    // 上面 C7 那条守的是「半帧被截断」，这里守的是「帧到齐、篇幅没给够」——同一句注释点名的
    // 危害（loop 无从得知），另一支一直没管。
    const truncated = turnTruncatedEvent(callId, finishReason, usage?.outputTokens ?? null);
    if (truncated) yield truncated;
    meterOutcome = "ok";
  } finally {
    guard?.dispose();
    // 消费者提前 break / 出错退出时主动取消 body，否则连接与对端资源一直挂着。
    void reader.cancel().catch(() => {});
  }
  } finally {
    guard?.dispose();
    if (requestId !== undefined) opts.metering!.meter.finishRequest(requestId, call?.signal?.aborted ? "cancelled" : meterOutcome, meterUsage);
  }
}
