// GLM provider（智谱 OpenAI 兼容协议，流式 SSE）。
// 实测（2026-09-09）：端点 /api/paas/v4/chat/completions；鉴权 Authorization: Bearer <key>；
// stream:true 走 SSE，增量在 choices[0].delta.content，最后一个 chunk 带 finish_reason 与 usage；
// 工具调用流式要额外 tool_stream:true，delta 里有 tool_calls（按 index 跨块累积 arguments）。
// key 只从环境变量 M0_API_KEY 读，模型从 M0_MODEL 读（缺省 glm-5.2）；key 不落文件、不进日志。
import type { AgentEvent, ToolCallEvent, UsageEvent } from "../events";

export const GLM_ENDPOINT = "https://open.bigmodel.cn/api/paas/v4/chat/completions";

export interface GlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}
export interface GlmToolSpec {
  type: "function";
  function: { name: string; description?: string; parameters: Record<string, unknown> };
}

export interface GlmOptions {
  /** 缺省读 process.env.M0_API_KEY。 */
  apiKey?: string;
  /** 缺省读 process.env.M0_MODEL ?? "glm-5.2"。 */
  model?: string;
  /** 缺省读 process.env.M0_ENDPOINT ?? 智谱 OpenAI 兼容端点。 */
  endpoint?: string;
  /** 反向验证开关：false = 非流式（整段回复只算 1 个 delta），缺省 true。 */
  stream?: boolean;
  /** 单测注入点（缺省全局 fetch）。 */
  fetchImpl?: typeof fetch;
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
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
}

function parseArgs(raw: string | undefined): Record<string, unknown> {
  if (!raw || raw.trim() === "") return {};
  // 参数 JSON 损坏属协议级异常，fail loud，不静默吞掉
  const parsed = JSON.parse(raw) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`GLM tool_call arguments 不是对象: ${raw.slice(0, 100)}`);
  }
  return parsed as Record<string, unknown>;
}

function toUsage(u: NonNullable<ChatChunk["usage"]>): UsageEvent {
  return { type: "usage", inputTokens: u.prompt_tokens ?? 0, outputTokens: u.completion_tokens ?? 0 };
}

/** 流式一轮对话：把 SSE 增量转成事件 —— delta.content → assistant_delta、
 *  delta.tool_calls → 累积成现有 tool_call 事件、末 chunk usage → usage 事件。 */
export async function* streamGlm(
  messages: GlmMessage[],
  opts: GlmOptions = {},
  tools?: GlmToolSpec[],
): AsyncGenerator<AgentEvent> {
  const apiKey = opts.apiKey ?? process.env.M0_API_KEY;
  if (!apiKey) throw new Error("M0_API_KEY 未设置（key 只从环境变量读取，不落文件）");
  const model = opts.model ?? process.env.M0_MODEL ?? "glm-5.2";
  const endpoint = opts.endpoint ?? process.env.M0_ENDPOINT ?? GLM_ENDPOINT;
  const stream = opts.stream ?? true;
  const doFetch = opts.fetchImpl ?? fetch;

  const body: Record<string, unknown> = { model, messages, stream };
  if (stream) body.tool_stream = true; // 工具调用流式要额外打开
  if (tools && tools.length > 0) body.tools = tools;

  const res = await doFetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`GLM 请求失败 HTTP ${String(res.status)}: ${text.slice(0, 300)}`);
  }

  if (!stream) {
    // 非流式分支（反向验证用）：整段回复转成同一条事件管线，delta 只有 1 个
    const data = (await res.json()) as ChatChunk;
    const callId = data.id ?? "a-0";
    const msg = data.choices?.[0]?.message;
    if (msg?.content) yield { type: "assistant_delta", callId, text: msg.content };
    for (const c of msg?.tool_calls ?? []) {
      const event: ToolCallEvent = {
        type: "tool_call",
        id: c.id ?? `call-${String(c.index)}`,
        name: c.function?.name ?? "",
        args: parseArgs(c.function?.arguments),
      };
      yield event;
    }
    if (data.usage) yield toUsage(data.usage);
    return;
  }

  if (!res.body) throw new Error("GLM 流式响应缺少 body");
  const decoder = new TextDecoder();
  const reader = res.body.getReader();
  let buf = "";
  let finished = false;
  let callId = "a-0";
  // 跨块累积的工具调用：index → { id, name, arguments }
  const pending = new Map<number, { id?: string; name: string; args: string }>();
  let usage: UsageEvent | null = null;

  while (!finished) {
    const { done, value } = await reader.read();
    if (done) break;
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
      const chunk = JSON.parse(payload) as ChatChunk;
      if (chunk.id) callId = chunk.id;
      if (chunk.usage) usage = toUsage(chunk.usage);
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
    const event: ToolCallEvent = {
      type: "tool_call",
      id: acc.id ?? `call-${String(index)}`,
      name: acc.name,
      args: parseArgs(acc.args),
    };
    yield event;
  }
  if (usage) yield usage;
}
