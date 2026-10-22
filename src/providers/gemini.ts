// Gemini 原生适配器（https://ai.google.dev/api/generate-content）。
// POST {baseURL}/v1beta/models/{model}:streamGenerateContent?alt=sse，鉴权 x-goog-api-key。
// chunk 里 candidates[0].content.parts[]：每项是 { text } 或 { functionCall: { name, args, id? } }；
// 一个 chunk 可含多个 functionCall（并行调用，全部解析成一条条 tool_call）；
// usageMetadata 含 promptTokenCount / candidatesTokenCount / thoughtsTokenCount / totalTokenCount
//（chunk 间累计，末 chunk 为准——直接覆盖不累加）。解析直接消费 Gemini 原生字段，不经 OpenAI 中间格式。
import { randomUUID } from "node:crypto";
import { DEFAULT_STALL_MS } from "../net";
import {
  backoffMs, establishStream, retryableStreamErrorFrame, retryableStreamFailure, StreamFailure, waitRetryDelay,
} from "./retry";
import { turnStopMissingEvent, turnTruncatedEvent } from "./stop-reason";
import type { ModelOutput, ProviderContentImage, ProviderMessage, ProviderMessageWithImage, ProviderToolSpec } from "./index";

export interface GeminiOptions {
  /** 缺省读 process.env.GEMINI_API_KEY。 */
  apiKey?: string;
  /** 缺失 key 时的环境变量名（进错误消息），缺省 GEMINI_API_KEY。 */
  apiKeyEnv?: string;
  model?: string;
  /** 思考预算（token）：非空则加 generationConfig.thinkingConfig.thinkingBudget。 */
  thinkingBudget?: number;
  baseURL?: string;
  /** 单测注入点（缺省全局 fetch）。 */
  fetchImpl?: typeof fetch;
  /** 错误消息前缀，缺省 "Gemini"。 */
  label?: string;
  /** 停滞守卫静默窗口 ms（根因 4）；缺省 60s，<=0 关闭守卫。 */
  stallTimeoutMs?: number;
}

interface GeminiChunk {
  candidates?: {
    content?: {
      parts?: {
        text?: string;
        /** thought=true 的 part 是思考内容（thinkingBudget 开启时才有）。 */
        thought?: boolean;
        functionCall?: { name?: string; args?: Record<string, unknown>; id?: string };
      }[];
      role?: string;
    };
    finishReason?: string | null;
    index?: number;
  }[];
  /** prompt 级拦截（安全策略在整段输入上就判了）时 **candidates 整个缺席**，原因只在这里——
   *  只看 candidates[0].finishReason 的读法会永远撞不到这一支。 */
  promptFeedback?: { blockReason?: string };
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
    totalTokenCount?: number;
    /** 本次请求命中**隐式缓存**的那部分输入 token 数（2026-10-05 第 387 页补）。
     *  为什么必须读它：Gemini 2.5+ 的**隐式缓存默认开着**（官方原文：enabled by default for all
     *  Gemini 2.5 and newer models；there is nothing you need to do in order to enable this），
     *  所以不发 `cachedContent` 也会命中。而 `promptTokenCount` **含**缓存那一部分
     *  （官方原文：when `cached_content` is set, this also includes the number of tokens in the
     *  cached content）⇒ 不读这个分块，本地按 token 算的成本就把命中段按**全价输入**计了，
     *  而 Google 实际是打折收的（官方原文：we automatically pass on cost savings）。 */
    cachedContentTokenCount?: number;
  };
  error?: { code?: number; message?: string; status?: string };
}

function parseArgs(args: Record<string, unknown> | undefined, label: string): Record<string, unknown> {
  if (!args || Object.keys(args).length === 0) return {};
  // Gemini 的 functionCall.args 本身就是对象（非 JSON 字符串），直通；只做形状防御
  if (typeof args !== "object" || Array.isArray(args)) {
    throw new Error(`${label} functionCall.args 不是对象`);
  }
  return args;
}

// ProviderMessage → Gemini contents：system 抽成 systemInstruction；user/assistant 文本；
// assistant 的 tool_calls → model 侧 functionCall parts；tool 结果 → user 侧 functionResponse parts
//（连续合并进同一条 contents，name/response 为官方字段）。全部按 Gemini 官方结构原生构造。
export function toGeminiBody(
  messages: ProviderMessage[],
  tools?: ProviderToolSpec[],
  opts: { thinkingBudget?: number } = {},
): Record<string, unknown> {
  const systemParts: string[] = [];
  const contents: { role: "user" | "model"; parts: Record<string, unknown>[] }[] = [];
  const push = (role: "user" | "model", part: Record<string, unknown>): void => {
    const last = contents[contents.length - 1];
    if (last && last.role === role) last.parts.push(part);
    else contents.push({ role, parts: [part] });
  };
  // functionResponse.name 为官方必填：从配对 tool_call 反查（tool_call_id → function name）
  const toolNames = new Map<string, string>();
  for (const m of messages) {
    if (m.role === "assistant") for (const tc of m.tool_calls ?? []) toolNames.set(tc.id, tc.function.name);
  }
  for (const m of messages) {
    if (m.role === "system") {
      if (m.content) systemParts.push(m.content);
      continue;
    }
    if (m.role === "tool") {
      let parsed: unknown = {};
      try {
        parsed = m.content && m.content.trim() !== "" ? (JSON.parse(m.content) as unknown) : {};
      } catch {
        parsed = { output: m.content ?? "" }; // 非对象结果包成 {output}（官方 response 需为对象）
      }
      push("user", {
        functionResponse: {
          name: toolNames.get(m.tool_call_id ?? "") ?? "",
          response: parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : { output: String(parsed) },
        },
      });
      continue;
    }
    const role = m.role === "assistant" ? "model" : "user";
    if (m.role === "assistant" && m.tool_calls) {
      if (m.content) push("model", { text: m.content });
      for (const tc of m.tool_calls) {
        let args: Record<string, unknown> = {};
        try {
          const raw = tc.function.arguments.trim() === "" ? {} : (JSON.parse(tc.function.arguments) as unknown);
          if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) args = raw as Record<string, unknown>;
        } catch {
          args = {};
        }
        push("model", { functionCall: { name: tc.function.name, args } });
      }
      continue;
    }
    // user 侧带图：先 text 再 inlineData（官方 parts 数组混排）。assistant 侧不产图片。
    const imageParts = m.role === "user" ? geminiImageParts(m) : [];
    if (m.content !== null && m.content !== "") push(role, { text: m.content });
    for (const part of imageParts) push(role, part);
    if ((m.content === null || m.content === "") && imageParts.length === 0) push(role, { text: "" });
  }
  const body: Record<string, unknown> = { contents };

/** user 消息的图片 parts：data URL 拆成 Gemini 官方的 inlineData（mimeType + base64 data）。
 *  非 data URL 不猜：宁可用一个 text part 说明「这张图没带上」，也不发一个空 inlineData
 *  （上游对空 data 的 400 与「图没到」是两件事，后者至少能从对话里看出来）。 */
function geminiImageParts(m: ProviderMessage): Record<string, unknown>[] {
  const parts = (m as ProviderMessageWithImage).contentParts;
  if (parts === undefined || parts.length === 0) return [];
  const out: Record<string, unknown>[] = [];
  for (const p of parts as readonly ProviderContentImage[]) {
    if (p.type !== "image") continue;
    const mm = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/s.exec(p.dataUrl);
    if (mm === null) {
      out.push({ text: "[image: 非 data URL 的图片引用已忽略——只接受 data:image/...;base64,...]" });
      continue;
    }
    out.push({ inlineData: { mimeType: mm[1], data: mm[2] } });
  }
  return out;
}
  // 思考档位（§S8）：Gemini 收的是 token 预算，放在 generationConfig.thinkingConfig 里。
  if (opts.thinkingBudget !== undefined && opts.thinkingBudget > 0) {
    body.generationConfig = { thinkingConfig: { thinkingBudget: opts.thinkingBudget } };
  }
  if (systemParts.length > 0) body.systemInstruction = { parts: [{ text: systemParts.join("\n\n") }] };
  if (tools && tools.length > 0) {
    body.tools = [
      {
        functionDeclarations: tools.map((t) => ({
          name: t.name,
          ...(t.description ? { description: t.description } : {}),
          parameters: t.parameters,
        })),
      },
    ];
  }
  return body;
}

/** 流式一轮对话：SSE chunk → 统一事件流。 */
export async function* streamGemini(
  messages: ProviderMessage[],
  opts: GeminiOptions = {},
  tools?: ProviderToolSpec[],
  call?: { signal?: AbortSignal },
): AsyncGenerator<ModelOutput> {
  const label = opts.label ?? "Gemini";
  const envName = opts.apiKeyEnv ?? "GEMINI_API_KEY";
  const apiKey = opts.apiKey ?? process.env[envName];
  if (!apiKey) throw new Error(`${envName} 未设置（key 只从环境变量读取，不落文件）`);
  const model = opts.model ?? process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
  const baseURL = opts.baseURL ?? "https://generativelanguage.googleapis.com";
  const doFetch = opts.fetchImpl ?? fetch;
  const toolRequestScope = randomUUID(); // 不同请求的缺省调用 id 不能共用从零开始的序号。

  // 根因 4：停滞守卫改由 establishStream 逐次新建（静默窗口，不是总时长），成功建连后交回
  // 本函数继续管流体。建连期失败（429/5xx/网络抖动）按指数退避 + full jitter 重试。
  /** 一次尝试的全部产出。**流内重试**（2026-10-23 补齐，与 openai/anthropic 两侧同一判据）：
   *  `establishStream` 只管到「响应体尚未被消费」那一段；Gemini 把 `RESOURCE_EXHAUSTED`（429）/
   *  `UNAVAILABLE`（503）/ `INTERNAL` 塞进 SSE 体（HTTP 200）时它管不着 ⇒ 此前一次就把整轮任务打死。
   *
   *  **安全边界**三家逐字同源：① 本次尝试一个输出都没吐出去；② 还有次数；③ 不是调用方取消；
   *  ④ 停滞守卫触发不重放。判据（名字表 + 数值优先）住 `retry.ts`，别在这里抄第二份。 */
  const STREAM_ATTEMPTS = 3;
  const streamOnce = async function* (): AsyncGenerator<ModelOutput, void, undefined> {
    let attempt = 0;
    let emitted = false;
    let retryError: unknown;
    for (;;) {
      attempt += 1;
      const est = await establishStream({
        label,
        url: `${baseURL}/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`,
        init: {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
          body: JSON.stringify(toGeminiBody(messages, tools, { ...(opts.thinkingBudget !== undefined ? { thinkingBudget: opts.thinkingBudget } : {}) })),
        },
        fetchImpl: doFetch,
        stallMs: opts.stallTimeoutMs ?? DEFAULT_STALL_MS,
        ...(call?.signal !== undefined ? { callerSignal: call.signal } : {}),
        ...(attempt > 1 ? { attempts: 1 } : {}), // 建连段那一层重试上一轮已付过
      });
      const res = est.res;
      if (!res.body) {
        est.guard.dispose();
        throw new Error(`${label} 流式响应缺少 body`);
      }

      const decoder = new TextDecoder();
      const reader = res.body.getReader();
      let buf = "";
      let callId = "gemini-a";
      let inputTokens: number | null = null;
      let outputTokens: number | null = null;
      /** 缓存命中分块：**缺报时不落 0**（与 anthropic/openai 两侧同一条规矩：缺报 ≠ 命中为零）。 */
      let cacheRead: number | null = null;
      // 调用序号**跨尝试重置**：重放的那一次是同一个逻辑请求，缺省 id 不能因为重试而漂移。
      let callSeq = 0;
      // finishReason 随候选块到达（中间 chunk 常是 null）：记最后一个非空的。
      let finishReason: string | null | undefined;
      // prompt 级拦截的第二份量纲：这一支到用时 candidates 缺席，光看 finishReason 一条道会全盲。
      let blockReason: string | undefined;

      try {
        let done = false;
        while (!done) {
          const read = await reader.read();
          if (read.done) break;
          est.guard.bump(); // 有分片 → 续期（只有完全静默才会到点）
          buf += decoder.decode(read.value, { stream: true });
          let nl: number;
          while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (!payload) continue;
            // C7（审查 P2）容错边界修正（审查 S1-6）：只对「不是帧的行」容错——注释心跳、
            // 网关塞进来的非 JSON 文本。以 { 开头的真帧 parse 失败不得静默 continue：那意味着
            // 上游把一帧截断了，跳过 = 少一截正文/少一个 tool_call 分片，而流随后正常收尾会让
            // 本轮以「不完整输出」成功收束（loop 无从得知）。同文件 parseArgs 的口径就是协议级
            // 异常 fail loud，这里与之对齐。
            let chunk: GeminiChunk;
            try {
              chunk = JSON.parse(payload) as GeminiChunk;
            } catch {
              if (!payload.startsWith("{")) continue; // 心跳/注释/网关杂帧：容忍
              throw new StreamFailure(`${label} SSE 帧损坏（半帧截断？）：JSON 解析失败，拒绝静默丢字`, false);
            }
            if (chunk.error) {
              const e = chunk.error;
              // Gemini 把配额/可用性故障塞进 body（HTTP 200）：`code` 是数值（429/503），
              // `status` 是名字（RESOURCE_EXHAUSTED/UNAVAILABLE）。判据住 `retry.ts`，三家共用一份。
              throw new StreamFailure(
                `${label} 流错误 ${e.status ?? String(e.code ?? "unknown")}: ${e.message ?? ""}`,
                retryableStreamErrorFrame({ names: [e.code, e.status] }),
              );
            }
            if (chunk.usageMetadata) {
              // chunk 间为累计值：直接覆盖，绝不累加
              const u = chunk.usageMetadata;
              inputTokens = u.promptTokenCount ?? inputTokens;
              outputTokens = (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0) || outputTokens;
              cacheRead = u.cachedContentTokenCount ?? cacheRead;
            }
            const cand = chunk.candidates?.[0];
            if (cand?.finishReason) finishReason = cand.finishReason;
            // 两个字段互斥出现（被拦的那一帧没有 candidates），所以各读各的、末尾合并。
            if (chunk.promptFeedback?.blockReason) blockReason = chunk.promptFeedback.blockReason;
            const parts = cand?.content?.parts ?? [];
            for (const part of parts) {
              // thought=true 的 part 是思考内容（thinkingBudget 开启时才有）→ 独立事件。
              if (part.thought === true && part.text) {
                emitted = true;
                yield { type: "thinking_delta", callId, text: part.text };
              }
              if (part.text && part.thought !== true) {
                emitted = true;
                yield { type: "assistant_delta", callId, text: part.text };
              } else if (part.functionCall) {
                const fc = part.functionCall;
                emitted = true;
                yield {
                  type: "tool_call",
                  id: fc.id ?? `gemini-call-${toolRequestScope}-${String(callSeq++)}`,
                  name: fc.name ?? "",
                  args: parseArgs(fc.args, label),
                };
              }
              // 其余 part 形态（未知扩展）优雅跳过
            }
          }
        }
        if (inputTokens !== null || outputTokens !== null || cacheRead !== null) {
          yield {
            type: "usage",
            // 口径与另两个适配器**同一个**：`inputTokens` 含缓存总量，分块是其中的一部分
            // （所以这里**不加**——`promptTokenCount` 本来就含，与 anthropic 那边「不含、要加」正相反）。
            inputTokens: inputTokens ?? 0,
            outputTokens: outputTokens ?? 0,
            ...(cacheRead !== null ? { cacheReadInputTokens: cacheRead } : {}),
          };
        }
        // 流正常收尾，但停止读数说这一轮没说完（MAX_TOKENS＝篇幅不够 / SAFETY 家族＝被拦）。
        // candidates[0].finishReason 与 promptFeedback.blockReason 互斥到值：谁在场用谁。
        // 上面 C7 那条守的是「半帧被截断」，这里守的是「帧到齐、篇幅没给够/被拦」。
        const truncated = turnTruncatedEvent(callId, finishReason ?? blockReason, outputTokens);
        if (truncated) yield truncated;
        // 同位置、互斥：candidates[0].finishReason 与 promptFeedback.blockReason 都没见到
        // ⇒ 「不知道它说没说」的证据（Gemini 正常收尾是有 finishReason 的，缺席同样可疑）。
        const stopMissing = turnStopMissingEvent(callId, finishReason ?? blockReason, outputTokens);
        if (stopMissing) yield stopMissing;
        return;
      } catch (err) {
        const cancelled = call?.signal?.aborted === true;
        const stalledByGuard = est.guard.stalled();
        const retryable = stalledByGuard ? false : retryableStreamFailure(err);
        if (emitted || attempt >= STREAM_ATTEMPTS || cancelled || !retryable) throw err;
        retryError = err;
      } finally {
        // 包括消费者在 yield 处提前 return；重试退避前也先回收本次响应。
        est.guard.dispose();
        void reader.cancel().catch(() => {});
        reader.releaseLock();
      }
      // 退避与可见重试（fail-visible：静默重试等于把故障藏起来）。
      const backoff = backoffMs(attempt, 300, 2_000, Math.random);
      console.warn(
        `[${label}] 流内失败（第 ${String(attempt)} 次，尚未产出任何输出）⇒ ${String(backoff)}ms 后重试：`
        + (retryError instanceof Error ? retryError.message : String(retryError)),
      );
      try {
        await waitRetryDelay(backoff, call?.signal);
      } catch (error) {
        call?.signal?.throwIfAborted();
        throw error;
      }
    }
  };
  yield* streamOnce();
}
