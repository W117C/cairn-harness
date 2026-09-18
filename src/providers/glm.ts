// GLM provider（智谱 OpenAI 兼容协议）—— openai 适配器的预设（baseURL/model/环境变量名/额外参数）。
// 实测（2026-09-09）：端点 /api/paas/v4/chat/completions；鉴权 Authorization: Bearer <key>；
// stream:true 走 SSE，增量在 choices[0].delta.content，最后一个 chunk 带 finish_reason 与 usage；
// 工具调用流式要额外 tool_stream:true，delta 里有 tool_calls（按 index 跨块累积 arguments）。
// key 只从环境变量 M0_API_KEY 读，模型从 M0_MODEL 读（缺省 glm-5.2）；key 不落文件、不进日志。
// 历史签名保持不变（scripts/provider-check.ts、scripts/autonomy-check.ts、tests/glm.test.ts 冻结消费方）。
import { streamOpenAI, type OpenAiOptions } from "./openai";
import type { ModelOutput, ProviderMessage, ProviderToolSpec } from "./index";

export const GLM_ENDPOINT = "https://open.bigmodel.cn/api/paas/v4/chat/completions";

export type GlmMessage = ProviderMessage;

/** GLM 工具规格（OpenAI 兼容 wire 形态；scripts/provider-check.ts 冻结消费方按此构造）。 */
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
  metering?: OpenAiOptions["metering"];
}

function toOpenAiOptions(opts: GlmOptions): OpenAiOptions {
  return {
    apiKey: opts.apiKey,
    apiKeyEnv: "M0_API_KEY",
    model: opts.model,
    modelEnv: "M0_MODEL",
    defaultModel: "glm-5.2",
    baseURL: opts.endpoint,
    baseURLEnv: "M0_ENDPOINT",
    defaultBaseURL: GLM_ENDPOINT,
    // GLM 特有：工具调用流式要额外打开 tool_stream
    extraBody: opts.stream === false ? undefined : { tool_stream: true },
    stream: opts.stream,
    label: "GLM",
    fetchImpl: opts.fetchImpl,
    metering: opts.metering,
  };
}

/** 流式一轮对话：SSE 增量 → 事件。与迁移前 glm.ts 行为逐字等价（行为由泛化的 openai 适配器承载）。 */
export async function* streamGlm(
  messages: GlmMessage[],
  opts: GlmOptions = {},
  tools?: GlmToolSpec[],
  call?: { signal?: AbortSignal },
): AsyncGenerator<ModelOutput> {
  const unified: ProviderToolSpec[] | undefined = tools?.map((t) => ({
    name: t.function.name,
    ...(t.function.description !== undefined ? { description: t.function.description } : {}),
    parameters: t.function.parameters,
  }));
  yield* streamOpenAI(messages, toOpenAiOptions(opts), unified, call);
}
