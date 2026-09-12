// OpenAI Chat Completions 原生适配器（SSE 流式 + 非流式），由原 glm.ts 泛化而来：
// baseURL / model / 额外 body 参数（extraBody）/ 环境变量名均可配，GLM 是它的一组预设（见 glm.ts）。
// 解码规则与迁移前逐字一致：增量在 choices[0].delta.content；tool_calls 按 index 跨块累积
//（id 首块、name 非空即记、arguments 拼接）；末 chunk 带 usage（后到覆盖）；data: [DONE] 结束。
import { DEFAULT_STALL_MS, stallGuard } from "../net";
import type { ModelOutput, ProviderMessage, ProviderToolSpec } from "./index";

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

function toUsage(u: NonNullable<ChatChunk["usage"]>): ModelOutput & { type: "usage" } {
  return { type: "usage", inputTokens: u.prompt_tokens ?? 0, outputTokens: u.completion_tokens ?? 0 };
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
  if (opts.extraBody) Object.assign(body, opts.extraBody);
  if (tools && tools.length > 0) body.tools = toWireTools(tools);

  // 根因 4：停滞守卫（静默窗口，不是总时长）——对端挂起时不再永久悬空。
  const guard = stallGuard(opts.stallTimeoutMs ?? DEFAULT_STALL_MS, label);
  let res: Response;
  try {
    res = await doFetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: guard.signal,
    });
  } catch (err) {
    guard.dispose(); // 建连阶段失败：看门狗不能留下
    throw err;
  }
  if (!res.ok) {
    guard.dispose();
    const text = await res.text().catch(() => "");
    throw new Error(`${label} 请求失败 HTTP ${String(res.status)}: ${text.slice(0, 300)}`);
  }

  if (!stream) {
    // 非流式分支（摘要器/反向验证用）：整段回复转成同一条事件管线，delta 只有 1 个
    try {
      const data = (await res.json()) as ChatChunk;
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
    } finally {
      guard.dispose();
    }
    return;
  }

  if (!res.body) {
    guard.dispose();
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

  try {
    while (!finished) {
      const { done, value } = await reader.read();
      if (done) break;
      guard.bump(); // 有分片 → 续期（只有完全静默才会到点）
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
        if (chunk.error) {
          const e = chunk.error;
          throw new Error(`${label} 流错误 ${e.type ?? e.code ?? "unknown"}: ${e.message ?? ""}`);
        }
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
      yield {
        type: "tool_call",
        id: acc.id ?? `call-${String(index)}`,
        name: acc.name,
        args: parseArgs(acc.args, label),
      };
    }
    if (usage) yield usage;
  } finally {
    guard.dispose();
    // 消费者提前 break / 出错退出时主动取消 body，否则连接与对端资源一直挂着。
    void reader.cancel().catch(() => {});
  }
}
