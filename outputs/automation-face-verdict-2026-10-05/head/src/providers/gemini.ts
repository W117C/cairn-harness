// Gemini 原生适配器（https://ai.google.dev/api/generate-content）。
// POST {baseURL}/v1beta/models/{model}:streamGenerateContent?alt=sse，鉴权 x-goog-api-key。
// chunk 里 candidates[0].content.parts[]：每项是 { text } 或 { functionCall: { name, args, id? } }；
// 一个 chunk 可含多个 functionCall（并行调用，全部解析成一条条 tool_call）；
// usageMetadata 含 promptTokenCount / candidatesTokenCount / thoughtsTokenCount / totalTokenCount
//（chunk 间累计，末 chunk 为准——直接覆盖不累加）。解析直接消费 Gemini 原生字段，不经 OpenAI 中间格式。
import { DEFAULT_STALL_MS, type StallGuard } from "../net";
import { establishStream } from "./retry";
import { turnTruncatedEvent } from "./stop-reason";
import type { ModelOutput, ProviderMessage, ProviderToolSpec } from "./index";

export interface GeminiOptions {
  /** 缺省读 process.env.GEMINI_API_KEY。 */
  apiKey?: string;
  /** 缺失 key 时的环境变量名（进错误消息），缺省 GEMINI_API_KEY。 */
  apiKeyEnv?: string;
  model?: string;
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
export function toGeminiBody(messages: ProviderMessage[], tools?: ProviderToolSpec[]): Record<string, unknown> {
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
    push(role, { text: m.content ?? "" });
  }
  const body: Record<string, unknown> = { contents };
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

  // 根因 4：停滞守卫改由 establishStream 逐次新建（静默窗口，不是总时长），成功建连后交回
  // 本函数继续管流体。建连期失败（429/5xx/网络抖动）按指数退避 + full jitter 重试；
  // 不变量：res.ok 之后绝不重放（流已产出），调用方取消与停滞都不重试。
  let guard: StallGuard | undefined;
  const est = await establishStream({
    label,
    url: `${baseURL}/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`,
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(toGeminiBody(messages, tools)),
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
  let callId = "gemini-a";
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;
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
      guard?.bump(); // 有分片 → 续期（只有完全静默才会到点）
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
          throw new Error(`${label} SSE 帧损坏（半帧截断？）：JSON 解析失败，拒绝静默丢字`);
        }
        if (chunk.error) {
          const e = chunk.error;
          throw new Error(`${label} 流错误 ${e.status ?? String(e.code ?? "unknown")}: ${e.message ?? ""}`);
        }
        if (chunk.usageMetadata) {
          // chunk 间为累计值：直接覆盖，绝不累加
          const u = chunk.usageMetadata;
          inputTokens = u.promptTokenCount ?? inputTokens;
          outputTokens = (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0) || outputTokens;
        }
        const cand = chunk.candidates?.[0];
        if (cand?.finishReason) finishReason = cand.finishReason;
        // 两个字段互斥出现（被拦的那一帧没有 candidates），所以各读各的、末尾合并。
        if (chunk.promptFeedback?.blockReason) blockReason = chunk.promptFeedback.blockReason;
        const parts = cand?.content?.parts ?? [];
        for (const part of parts) {
          if (part.text) {
            yield { type: "assistant_delta", callId, text: part.text };
          } else if (part.functionCall) {
            const fc = part.functionCall;
            yield {
              type: "tool_call",
              id: fc.id ?? `gemini-call-${String(callSeq++)}`,
              name: fc.name ?? "",
              args: parseArgs(fc.args, label),
            };
          }
          // 其余 part 形态（未知扩展）优雅跳过
        }
      }
    }
    if (inputTokens !== null || outputTokens !== null) {
      yield { type: "usage", inputTokens: inputTokens ?? 0, outputTokens: outputTokens ?? 0 };
    }
    // 流正常收尾，但停止读数说这一轮没说完（MAX_TOKENS＝篇幅不够 / SAFETY 家族＝被拦）。
    // candidates[0].finishReason 与 promptFeedback.blockReason 互斥到值：谁在场用谁。
    // 上面 C7 那条守的是「半帧被截断」，这里守的是「帧到齐、篇幅没给够/被拦」。
    const truncated = turnTruncatedEvent(callId, finishReason ?? blockReason, outputTokens);
    if (truncated) yield truncated;
  } finally {
    guard?.dispose();
    // 消费者提前 break / 出错退出时主动取消 body，否则连接与对端资源一直挂着。
    void reader.cancel().catch(() => {});
  }
}
