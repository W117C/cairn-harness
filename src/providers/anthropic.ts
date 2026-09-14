// Anthropic Messages API 原生适配器（https://docs.anthropic.com/en/api/messages-streaming）。
// SSE 事件序：message_start → 每内容块 content_block_start / 一条或多条 content_block_delta
//（text_delta 或 input_json_delta.partial_json）/ content_block_stop（每块带 index）→
// 一条或多条 message_delta → message_stop；ping 与未知事件优雅跳过；error 事件转可读错误。
// message_delta 里的 usage 是【累计值】——直接取最后一条，不得跨事件累加。
// 解析直接消费 Anthropic 原生字段（content_block_delta.delta.text_delta 等），
// 不经过任何 OpenAI 中间格式。
import { DEFAULT_STALL_MS, stallGuard } from "../net";
import type { ModelOutput, ProviderMessage, ProviderToolSpec } from "./index";

export interface AnthropicOptions {
  /** 缺省读 process.env.ANTHROPIC_API_KEY。 */
  apiKey?: string;
  /** 缺失 key 时的环境变量名（进错误消息），缺省 ANTHROPIC_API_KEY。 */
  apiKeyEnv?: string;
  model?: string;
  /** max_tokens 为 Anthropic 必填字段（单轮输出上限），缺省 4096。 */
  maxTokens?: number;
  baseURL?: string;
  /** anthropic-version 请求头，缺省 2023-06-01。 */
  version?: string;
  /** 单测注入点（缺省全局 fetch）。 */
  fetchImpl?: typeof fetch;
  /** 错误消息前缀，缺省 "Anthropic"。 */
  label?: string;
  /** 停滞守卫静默窗口 ms（根因 4）；缺省 60s，<=0 关闭守卫。 */
  stallTimeoutMs?: number;
}

interface AnthropicSseEvent {
  type?: string;
  message?: { id?: string; usage?: { input_tokens?: number; output_tokens?: number } };
  content_block?: { type?: string; id?: string; name?: string; input?: unknown };
  index?: number;
  delta?: {
    type?: string;
    text?: string;
    partial_json?: string;
    stop_reason?: string | null;
  };
  usage?: { input_tokens?: number; output_tokens?: number };
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
  opts: { model: string; maxTokens: number; stream: boolean },
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
    wire.push({ role: "user", content: m.content ?? "" });
  }
  flushToolResults();
  const body: Record<string, unknown> = {
    model: opts.model,
    max_tokens: opts.maxTokens,
    stream: opts.stream,
    messages: wire,
  };
  if (systemParts.length > 0) body.system = systemParts.join("\n\n");
  if (tools && tools.length > 0) {
    body.tools = tools.map((t) => ({
      name: t.name,
      ...(t.description ? { description: t.description } : {}),
      input_schema: t.parameters,
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
  const maxTokens = opts.maxTokens ?? 4096;
  const doFetch = opts.fetchImpl ?? fetch;

  // 根因 4：停滞守卫（静默窗口，不是总时长）——对端挂起时不再永久悬空。
  const guard = stallGuard(opts.stallTimeoutMs ?? DEFAULT_STALL_MS, label);
  let res: Response;
  try {
    res = await doFetch(`${baseURL}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": opts.version ?? "2023-06-01",
      },
      body: JSON.stringify(toAnthropicBody(messages, { model, maxTokens, stream: true }, tools)),
      // C12（审查 P2）：取消信号与停滞守卫合并——会话取消时在途请求立即中止。
      signal: call?.signal !== undefined ? AbortSignal.any([guard.signal, call.signal]) : guard.signal,
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
  if (!res.body) {
    guard.dispose();
    throw new Error(`${label} 流式响应缺少 body`);
  }

  const decoder = new TextDecoder();
  const reader = res.body.getReader();
  let buf = "";
  let callId = "anthropic-a";
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;
  // 内容块聚合：index → { id, name, json }（input_json_delta 分片跨事件拼接）
  const blocks = new Map<number, { id: string; name: string; json: string }>();

  const handleEvent = function* (event: AnthropicSseEvent): Generator<ModelOutput> {
    switch (event.type) {
      case "message_start": {
        if (event.message?.id) callId = event.message.id;
        if (event.message?.usage?.input_tokens !== undefined) inputTokens = event.message.usage.input_tokens;
        return;
      }
      case "content_block_start": {
        const cb = event.content_block;
        if (cb?.type === "tool_use" && event.index !== undefined) {
          const seed = cb.input !== undefined && cb.input !== null && Object.keys(cb.input as object).length > 0
            ? JSON.stringify(cb.input)
            : "";
          blocks.set(event.index, { id: cb.id ?? `toolu-${String(event.index)}`, name: cb.name ?? "", json: seed });
        }
        return;
      }
      case "content_block_delta": {
        const d = event.delta;
        if (d?.type === "text_delta" && d.text) {
          yield { type: "assistant_delta", callId, text: d.text };
        } else if (d?.type === "input_json_delta" && d.partial_json && event.index !== undefined) {
          const acc = blocks.get(event.index);
          if (acc) acc.json += d.partial_json; // 分片拼接成完整 JSON（流末 block_stop 时解析）
        }
        // 其余 delta 子类型（thinking_delta / signature_delta / citations_delta …）按未知优雅跳过
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
      guard.bump(); // 有分片 → 续期（只有完全静默才会到点）
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
    if (inputTokens !== null || outputTokens !== null) {
      yield { type: "usage", inputTokens: inputTokens ?? 0, outputTokens: outputTokens ?? 0 };
    }
  } finally {
    guard.dispose();
    // 消费者提前 break / 出错退出时主动取消 body，否则连接与对端资源一直挂着。
    void reader.cancel().catch(() => {});
  }
}
