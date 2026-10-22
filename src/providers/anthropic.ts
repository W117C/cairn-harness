// Anthropic Messages API 原生适配器（https://docs.anthropic.com/en/api/messages-streaming）。
// SSE 事件序：message_start → 每内容块 content_block_start / 一条或多条 content_block_delta
//（text_delta 或 input_json_delta.partial_json）/ content_block_stop（每块带 index）→
// 一条或多条 message_delta → message_stop；ping 与未知事件优雅跳过；error 事件转可读错误。
// message_delta 里的 usage 是【累计值】——直接取最后一条，不得跨事件累加。
// 解析直接消费 Anthropic 原生字段（content_block_delta.delta.text_delta 等），
// 不经过任何 OpenAI 中间格式。
import { randomUUID } from "node:crypto";
import { DEFAULT_STALL_MS, type StallGuard } from "../net";
import { establishStream } from "./retry";
import { turnStopMissingEvent, turnTruncatedEvent } from "./stop-reason";
import type { ModelOutput, ProviderContentImage, ProviderMessage, ProviderMessageWithImage, ProviderToolSpec } from "./index";

export interface AnthropicOptions {
  /** 缺省读 process.env.ANTHROPIC_API_KEY。 */
  apiKey?: string;
  /** 缺失 key 时的环境变量名（进错误消息），缺省 ANTHROPIC_API_KEY。 */
  apiKeyEnv?: string;
  model?: string;
  /** max_tokens 为 Anthropic 必填字段（单轮输出上限），缺省 4096。 */
  maxTokens?: number;
  /** 思考预算（token）：非空则加 body.thinking = {type:"enabled", budget_tokens}。
   *  Anthropic 要求 max_tokens **严格大于** budget_tokens，故调用处会一起把 maxTokens 抬上去。 */
  thinkingBudget?: number;
  baseURL?: string;
  /** anthropic-version 请求头，缺省 2023-06-01。 */
  version?: string;
  /** 单测注入点（缺省全局 fetch）。 */
  fetchImpl?: typeof fetch;
  /** 错误消息前缀，缺省 "Anthropic"。 */
  label?: string;
  /** 停滞守卫静默窗口 ms（根因 4）；缺省 60s，<=0 关闭守卫。 */
  stallTimeoutMs?: number;
  /** prompt 缓存断点（A1 写侧）：在**静态段**尾上打 `cache_control:{type:"ephemeral"}`——
   *  末个 tool 与末个 system 块各一处（断点分层级联：工具条目恒命中，tools+system 条目只在
   *  system 未变时命中；本仓的记忆/地图随轮变化，落在 system 串内，故第二条目会周期性重写，
   *  这是排布事实不是本开关的副作用——按用户裁决「只标静态段，不动排布」）。
   *  缺省 false = 请求体逐字不变（含 `system` 仍为整串）。 */
  promptCache?: boolean;
}

interface AnthropicSseEvent {
  type?: string;
  message?: { id?: string; usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } };
  content_block?: { type?: string; id?: string; name?: string; input?: unknown };
  index?: number;
  delta?: {
    type?: string;
    text?: string;
    /** thinking_delta 子类型的思考文本（budget 开启时才有）。 */
    thinking?: string;
    partial_json?: string;
    stop_reason?: string | null;
  };
  usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
  error?: { type?: string; message?: string };
}

function parseArgs(raw: string, label: string): Record<string, unknown> {
  if (raw.trim() === "") return {};
  // 分片拼接后的参数 JSON 损坏属协议级异常，fail loud，不静默吞掉
  const parsed = JSON.parse(raw) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${label} tool_use input 不是对象: ${raw.slice(0, 100)}`);
  }
  return parsed as Record<string, unknown>;
}

// ProviderMessage → Anthropic wire 格式：system 抽成顶层 system 参数；
// user/assistant 文本；assistant 的 tool_calls → tool_use 块；tool 结果（连续合并为一条
// user 消息）→ tool_result 块。全部按 Anthropic 官方 content-block 结构原生构造。
export function toAnthropicBody(
  messages: ProviderMessage[],
  opts: { model: string; maxTokens: number; stream: boolean; promptCache?: boolean; thinkingBudget?: number },
  tools?: ProviderToolSpec[],
): Record<string, unknown> {
  const systemParts: string[] = [];
  const wire: { role: "user" | "assistant"; content: unknown }[] = [];
  const pendingToolResults: Record<string, unknown>[] = [];
  const flushToolResults = (): void => {
    if (pendingToolResults.length === 0) return;
    wire.push({ role: "user", content: pendingToolResults.splice(0) });
  };
  for (const m of messages) {
    if (m.role === "system") {
      if (m.content) systemParts.push(m.content);
      continue;
    }
    if (m.role === "tool") {
      pendingToolResults.push({ type: "tool_result", tool_use_id: m.tool_call_id ?? "", content: m.content ?? "" });
      continue;
    }
    flushToolResults();
    if (m.role === "assistant") {
      const blocks: Record<string, unknown>[] = [];
      if (m.content) blocks.push({ type: "text", text: m.content });
      for (const tc of m.tool_calls ?? []) {
        let input: unknown = {};
        try {
          input = tc.function.arguments.trim() === "" ? {} : (JSON.parse(tc.function.arguments) as unknown);
        } catch {
          input = {}; // 历史里损坏的参数按空 input 回传（原始请求已 fail loud 过）
        }
        blocks.push({ type: "tool_use", id: tc.id, name: tc.function.name, input });
      }
      wire.push({ role: "assistant", content: blocks.length > 0 ? blocks : m.content ?? "" });
      continue;
    }
    wire.push({ role: "user", content: toAnthropicUserContent(m) });
  }
  flushToolResults();

/** user 消息的 content：带图片时换成 Anthropic 的 blocks 数组（text + image 混排）。
 *  纯文本逐字保持字符串——旧形状不变，前缀缓存与网关兼容性都不动。 */
function toAnthropicUserContent(m: ProviderMessage): unknown {
  const parts = (m as ProviderMessageWithImage).contentParts;
  if (parts === undefined || parts.length === 0) return m.content ?? "";
  const blocks: Record<string, unknown>[] = [];
  if (m.content !== null && m.content !== "") blocks.push({ type: "text", text: m.content });
  for (const p of parts as readonly ProviderContentImage[]) {
    if (p.type !== "image") continue;
    const mm = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/s.exec(p.dataUrl);
    // 不是 data URL（外链图片）⇒ 不猜、不静默转成空块：这条消息会 400，让问题暴露在请求上。
    if (mm === null) {
      blocks.push({ type: "text", text: "[image: 非 data URL 的图片引用已忽略——只接受 data:image/...;base64,...]" });
      continue;
    }
    blocks.push({ type: "image", source: { type: "base64", media_type: mm[1], data: mm[2] } });
  }
  return blocks.length > 0 ? blocks : (m.content ?? "");
}
  const body: Record<string, unknown> = {
    model: opts.model,
    max_tokens: opts.maxTokens,
    // 思考档位（§S8）：开了就在请求体里说清楚 —— 预算必须小于 max_tokens，否则上游直接 400。
    // 这里做的是**抬高上限**而不是拒绝：用户要 16k 思考预算时把 max_tokens 顶到 16k+余量，
    // 比抛一句"两个数不合法"更有用（本仓对"用户意图明确、只是数值需要配合"的一律是配合而不是拒）。
    ...(opts.thinkingBudget !== undefined && opts.thinkingBudget > 0
      ? { thinking: { type: "enabled", budget_tokens: opts.thinkingBudget } }
      : {}),
    stream: opts.stream,
    messages: wire,
  };
  // 静态段断点（用户裁决「只标静态段，不动排布」）：
  // ① 末个 tool——本会话内工具表逐字不变，是唯一的纯静态段；
  // ② system 的**首块**=基础提示（composeTurnMessages 恒把 opts.system 放第一位），
  //    其后的记忆/skills/地图随轮变化，一律留在断点之后不参与缓存——
  //    给整串 system 打点会每轮重写缓存条目（写价 1.25×），比不打更贵，故不打。
  // 关闭时逐字旧行为：system 仍是 join 后的整串，且全站零 cache_control 键。
  if (systemParts.length > 0) {
    body.system = opts.promptCache === true
      ? systemParts.map((text, i) => ({ type: "text", text, ...(i === 0 ? { cache_control: { type: "ephemeral" } } : {}) }))
      : systemParts.join("\n\n");
  }
  if (tools && tools.length > 0) {
    const last = tools.length - 1;
    body.tools = tools.map((t, i) => ({
      name: t.name,
      ...(t.description ? { description: t.description } : {}),
      input_schema: t.parameters,
      ...(opts.promptCache === true && i === last ? { cache_control: { type: "ephemeral" } } : {}),
    }));
  }
  return body;
}

/** 流式一轮对话：SSE 事件 → 统一事件流。 */
export async function* streamAnthropic(
  messages: ProviderMessage[],
  opts: AnthropicOptions = {},
  tools?: ProviderToolSpec[],
  call?: { signal?: AbortSignal },
): AsyncGenerator<ModelOutput> {
  const label = opts.label ?? "Anthropic";
  const envName = opts.apiKeyEnv ?? "ANTHROPIC_API_KEY";
  const apiKey = opts.apiKey ?? process.env[envName];
  if (!apiKey) throw new Error(`${envName} 未设置（key 只从环境变量读取，不落文件）`);
  const model = opts.model ?? process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5";
  const baseURL = opts.baseURL ?? "https://api.anthropic.com";
  const thinkingBudget = opts.thinkingBudget;
  // Anthropic 的硬要求：max_tokens **严格大于** budget_tokens。用户要 16k 思考预算时，
  // 我们抬上限而不是拒跑 —— 意图是明确的，需要配合的只是数值（本仓对这类一律配合）。
  const baseMaxTokens = opts.maxTokens ?? 4096;
  const maxTokens =
    thinkingBudget !== undefined && thinkingBudget > 0 ? Math.max(baseMaxTokens, thinkingBudget + 4096) : baseMaxTokens;
  const doFetch = opts.fetchImpl ?? fetch;
  const toolRequestScope = randomUUID(); // 缺失原生 id 的序号只在本请求内复用。

  // 根因 4：停滞守卫改由 establishStream 逐次新建（静默窗口，不是总时长），成功建连后交回
  // 本函数继续管流体。建连期失败（429/5xx/网络抖动）按指数退避 + full jitter 重试；
  // 不变量：res.ok 之后绝不重放（流已产出），调用方取消与停滞都不重试。
  let guard: StallGuard | undefined;
  const est = await establishStream({
    label,
    url: `${baseURL}/v1/messages`,
    init: {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": opts.version ?? "2023-06-01",
      },
      body: JSON.stringify(
        toAnthropicBody(
          messages,
          { model, maxTokens, stream: true, promptCache: opts.promptCache === true, ...(thinkingBudget !== undefined ? { thinkingBudget } : {}) },
          tools,
        ),
      ),
    },
    fetchImpl: doFetch,
    stallMs: opts.stallTimeoutMs ?? DEFAULT_STALL_MS,
    ...(call?.signal !== undefined ? { callerSignal: call.signal } : {}),
  });
  const res = est.res;
  guard = est.guard;
  if (!res.body) {
    guard?.dispose();
    throw new Error(`${label} 流式响应缺少 body`);
  }

  const decoder = new TextDecoder();
  const reader = res.body.getReader();
  let buf = "";
  let callId = "anthropic-a";
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;
  // 缓存分块：Anthropic 的 input_tokens **不含**缓存读写量（与 OpenAI 系 prompt_tokens 含缓存相反），
  // 事件口径统一成「inputTokens = 含缓存总输入」，分块另列（未上报时不落 0）。
  let cacheRead: number | null = null;
  let cacheWrite: number | null = null;
  // 停止原因随 message_delta 到达（可能多条，取最后一条，与 usage 的累计值口径一致）。
  let stopReason: string | null | undefined;
  // 内容块聚合：index → { id, name, json }（input_json_delta 分片跨事件拼接）
  const blocks = new Map<number, { id: string; name: string; json: string }>();

  const handleEvent = function* (event: AnthropicSseEvent): Generator<ModelOutput> {
    switch (event.type) {
      case "message_start": {
        if (event.message?.id) callId = event.message.id;
        if (event.message?.usage?.input_tokens !== undefined) inputTokens = event.message.usage.input_tokens;
        if (event.message?.usage?.cache_read_input_tokens !== undefined) cacheRead = event.message.usage.cache_read_input_tokens;
        if (event.message?.usage?.cache_creation_input_tokens !== undefined) cacheWrite = event.message.usage.cache_creation_input_tokens;
        return;
      }
      case "content_block_start": {
        const cb = event.content_block;
        if (cb?.type === "tool_use" && event.index !== undefined) {
          const seed = cb.input !== undefined && cb.input !== null && Object.keys(cb.input as object).length > 0
            ? JSON.stringify(cb.input)
            : "";
          blocks.set(event.index, { id: cb.id ?? `toolu-${toolRequestScope}-${String(event.index)}`, name: cb.name ?? "", json: seed });
        }
        return;
      }
      case "content_block_delta": {
        const d = event.delta;
        if (d?.type === "text_delta" && d.text) {
          yield { type: "assistant_delta", callId, text: d.text };
        } else if (d?.type === "thinking_delta" && d.thinking) {
          // Claude 的思考块（budget 开启时吐 thinking_delta）→ 独立事件，不并进正文。
          yield { type: "thinking_delta", callId, text: d.thinking };
        } else if (d?.type === "input_json_delta" && d.partial_json && event.index !== undefined) {
          const acc = blocks.get(event.index);
          if (acc) acc.json += d.partial_json; // 分片拼接成完整 JSON（流末 block_stop 时解析）
        }
        // 其余 delta 子类型（signature_delta / citations_delta …）按未知优雅跳过
        return;
      }
      case "content_block_stop": {
        const acc = event.index !== undefined ? blocks.get(event.index) : undefined;
        if (acc) {
          yield { type: "tool_call", id: acc.id, name: acc.name, args: parseArgs(acc.json, label) };
          blocks.delete(event.index as number);
        }
        return;
      }
      case "message_delta": {
        // usage 为累计值：直接覆盖，绝不累加
        if (event.usage?.output_tokens !== undefined) outputTokens = event.usage.output_tokens;
        if (event.usage?.input_tokens !== undefined) inputTokens = event.usage.input_tokens;
        if (event.usage?.cache_read_input_tokens !== undefined) cacheRead = event.usage.cache_read_input_tokens;
        if (event.usage?.cache_creation_input_tokens !== undefined) cacheWrite = event.usage.cache_creation_input_tokens;
        // stop_reason 与 usage 同帧到达。只认真字符串：后续帧可能带 stop_reason:null，
        // 用 !== undefined 会让那个 null 把已经拿到的 max_tokens 抹掉（openai/gemini 侧同用真值判断）。
        if (typeof event.delta?.stop_reason === "string") stopReason = event.delta.stop_reason;
        return;
      }
      case "message_stop":
      case "ping":
        return; // ping 按协议要求优雅跳过
      case "error": {
        const e = event.error ?? {};
        throw new Error(`${label} 流错误 ${e.type ?? "unknown"}: ${e.message ?? ""}`);
      }
      default:
        return; // 未知事件类型：优雅跳过，不抛错
    }
  };

  try {
    let done = false;
    while (!done) {
      const read = await reader.read();
      if (read.done) break;
      guard?.bump(); // 有分片 → 续期（只有完全静默才会到点）
      buf += decoder.decode(read.value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith("data:")) continue; // event:/注释/空行跳过（type 以 data JSON 为准）
        const payload = line.slice(5).trim();
        if (!payload) continue;
        // C7（审查 P2）容错边界修正（审查 S1-6）：只对「不是帧的行」容错——注释心跳、
        // 网关塞进来的非 JSON 文本。以 { 开头的真帧 parse 失败不得静默 continue：那意味着
        // 上游把一帧截断了，跳过 = 少一截正文/少一个 tool_call 分片，而流随后正常收尾会让
        // 本轮以「不完整输出」成功收束（loop 无从得知）。同文件 parseArgs 的口径就是协议级
        // 异常 fail loud，这里与之对齐。
        let event: AnthropicSseEvent;
        try {
          event = JSON.parse(payload) as AnthropicSseEvent;
        } catch {
          if (!payload.startsWith("{")) continue; // 心跳/注释/网关杂帧：容忍
          throw new Error(`${label} SSE 帧损坏（半帧截断？）：JSON 解析失败，拒绝静默丢字`);
        }
        yield* handleEvent(event);
      }
    }
    if (inputTokens !== null || outputTokens !== null || cacheRead !== null || cacheWrite !== null) {
      yield {
        type: "usage",
        // Anthropic 的 input_tokens 是「未命中缓存的那一段」，加上读/写缓存才是本次真实输入
        inputTokens: (inputTokens ?? 0) + (cacheRead ?? 0) + (cacheWrite ?? 0),
        outputTokens: outputTokens ?? 0,
        ...(cacheRead !== null ? { cacheReadInputTokens: cacheRead } : {}),
        ...(cacheWrite !== null ? { cacheWriteInputTokens: cacheWrite } : {}),
      };
    }
    // 流正常收尾，但**原因**说这一轮没说完：正文被输出预算/内容策略收走。
    // 上面 C7 那条守的是「半帧被截断」，这里守的是「整帧到齐、模型却没被给够篇幅」——
    // 同一句注释里点名的危害（loop 无从得知），另一支一直没管。
    const truncated = turnTruncatedEvent(callId, stopReason, outputTokens);
    if (truncated) yield truncated;
    // 同位置、互斥：整个流一条 message_delta.stop_reason 都没见到 ⇒ 「不知道它说没说」的证据。
    const stopMissing = turnStopMissingEvent(callId, stopReason, outputTokens);
    if (stopMissing) yield stopMissing;
  } finally {
    guard?.dispose();
    // 消费者提前 break / 出错退出时主动取消 body，否则连接与对端资源一直挂着。
    void reader.cancel().catch(() => {});
  }
}
