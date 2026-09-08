import { createEventLog, replay, type AgentEvent, type UsageEvent } from "../events";
import type { ModelOutput, Provider } from "./index.js";

export interface GlmOptions {
  /** OpenAI 兼容 base url，如 https://api.b.ai/v1 */
  baseUrl: string;
  apiKey: string;
  model: string;
  /** 事件日志路径：重放历史 + 追加 usage */
  eventLogPath: string;
  /** 注入点：测试用 fake fetch，默认全局 fetch */
  fetchImpl?: typeof fetch;
  /** 单次请求超时毫秒 */
  timeoutMs?: number;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

const SYSTEM_PROMPT = [
  "你是一个桌面编程 agent，在指定 workspace 里修复失败的测试。",
  "可用工具：read_file（读文件）、write_file（写文件）、run_shell（在 workspace 下执行命令）。",
  "规则：",
  "1. 路径一律用 workspace 相对路径（如 src/todo.ts）。",
  "2. 先读代码定位根因，再修改，最后运行 pnpm test 验证。",
  "3. 不要修改 tests/ 目录下的任何测试文件。",
  "4. 测试全部通过后，用一句中文总结修复内容，不再调用工具。",
].join("\n");

// 三个工具的 JSON Schema（名字与 src/tools 对齐）
export const TOOL_SCHEMAS = [
  {
    type: "function",
    function: {
      name: "read_file",
      description: "读取 workspace 内的文本文件（UTF-8），超过 50KB 截断",
      parameters: { type: "object", properties: { path: { type: "string", description: "workspace 相对路径" } }, required: ["path"] },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "把完整内容写入 workspace 内的文件（整体覆写；超过 50KB 拒绝）",
      parameters: { type: "object", properties: { path: { type: "string", description: "workspace 相对路径" }, content: { type: "string", description: "完整文件内容" } }, required: ["path", "content"] },
    },
  },
  {
    type: "function",
    function: {
      name: "run_shell",
      description: "在 workspace 目录下用 bash 执行命令，超时 60 秒，输出上限 32KB",
      parameters: { type: "object", properties: { command: { type: "string", description: "要执行的命令" } }, required: ["command"] },
    },
  },
] as const;

// 纯函数：事件历史 → OpenAI 协议消息数组（usage 是元数据，跳过）
export function buildMessages(history: AgentEvent[]): ChatMessage[] {
  const messages: ChatMessage[] = [{ role: "system", content: SYSTEM_PROMPT }];
  for (const e of history) {
    switch (e.type) {
      case "user_message":
        messages.push({ role: "user", content: e.content });
        break;
      case "assistant_message":
        messages.push({ role: "assistant", content: e.content });
        break;
      case "tool_call":
        messages.push({
          role: "assistant",
          content: null,
          tool_calls: [{ id: e.id, type: "function", function: { name: e.name, arguments: JSON.stringify(e.args) } }],
        });
        break;
      case "tool_result":
        messages.push({ role: "tool", tool_call_id: e.callId, content: e.output });
        break;
      case "usage":
        break;
    }
  }
  return messages;
}

// 纯函数：API 响应 → 输出队列（文本在前，tool_calls 按序在后）+ usage 换算
export function parseResponse(
  message: { content?: string | null; tool_calls?: { id: string; function: { name: string; arguments?: string } }[] },
  usage: { prompt_tokens?: number; completion_tokens?: number } | undefined,
): { outputs: ModelOutput[]; usage: UsageEvent } {
  const outputs: ModelOutput[] = [];
  const content = typeof message.content === "string" ? message.content : "";
  if (content.trim().length > 0) outputs.push({ type: "assistant_message", content });
  for (const tc of message.tool_calls ?? []) {
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(tc.function.arguments || "{}") as Record<string, unknown>;
    } catch {
      args = {}; // 参数坏 → 空参交给工具，由工具回错误让模型自纠
    }
    outputs.push({ type: "tool_call", id: tc.id, name: tc.function.name, args });
  }
  return {
    outputs,
    usage: { type: "usage", inputTokens: usage?.prompt_tokens ?? 0, outputTokens: usage?.completion_tokens ?? 0 },
  };
}

// 真实 provider：队列语义（一次响应可能含 1 条文本 + N 个 tool_call，逐个吐出）。
// 结束条件：本轮响应没有任何 tool_call（模型给出最终回答）→ 队列吐完后 next() 恒为 null。
export function createGlmProvider(opts: GlmOptions): Provider {
  const eventLog = createEventLog(opts.eventLogPath);
  const doFetch = opts.fetchImpl ?? fetch;
  let queue: ModelOutput[] = [];
  let finished = false;

  return {
    async next(): Promise<ModelOutput | null> {
      if (finished) return null;
      if (queue.length === 0) {
        const history = await replay(opts.eventLogPath);
        const url = opts.baseUrl.replace(/\/$/, "") + "/chat/completions";
        const res = await doFetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + opts.apiKey },
          body: JSON.stringify({
            model: opts.model,
            messages: buildMessages(history),
            tools: TOOL_SCHEMAS,
            tool_choice: "auto",
          }),
          signal: AbortSignal.timeout(opts.timeoutMs ?? 120_000),
        });
        if (!res.ok) {
          const body = (await res.text()).slice(0, 500);
          throw new Error("GLM API " + res.status + ": " + body);
        }
        const data = (await res.json()) as {
          choices?: { message?: { content?: string | null; tool_calls?: { id: string; function: { name: string; arguments?: string } }[] } }[];
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };
        const parsed = parseResponse(data.choices?.[0]?.message ?? {}, data.usage);
        await eventLog.append(parsed.usage); // token 用量落事件流
        queue = parsed.outputs;
        if (!queue.some((o) => o.type === "tool_call")) finished = true;
        if (queue.length === 0) return null;
      }
      return queue.shift() ?? null;
    },
  };
}
