// DeepSeek provider（OpenAI 兼容协议）—— openai 适配器的预设，与 glm.ts 同族。
// 实测依据（2026-10-25 官方 api-docs.deepseek.com 实读）：
//   · 调用名 `deepseek-flash`（背后是 DeepSeek-V4.1-Flash-1017，文本+图像输入）与
//     `deepseek-v4-pro`（V4-Pro-0813，只收文本）；旧名 deepseek-v4-flash / -vision-exp 仍收
//     但等价转发到 V4.1 Flash。两模型 1M 上下文、单次输出上限 393216。
//   · `thinking` 缺省 **enabled**（默认就在思考，effort 缺省 high）——这与别家「不发字段＝不思考」
//     相反：本仓的思考档位缺省是 off，所以预设层必须把「未给」**归一成显式 off** 再递给适配器，
//     否则每一次没点名思考的调用都在按思考档计费、按思考档等待。
//   · 顶层 `reasoning_effort` 控制档位，`thinking.type` 显式控制开关（见 openai.ts）。
//   · usage 的缓存命中量：`prompt_tokens_details.cached_tokens` 与旧字段
//     `prompt_cache_hit_tokens` 同值，读法在 openai.ts 统一兜底。
// key 只从环境变量 DEEPSEEK_API_KEY 读，模型从 DEEPSEEK_MODEL 读（缺省 deepseek-flash）；
// 端点可被 DEEPSEEK_ENDPOINT 覆盖。key 不落文件、不进日志。
import { streamOpenAI, type OpenAiOptions } from "./openai";
import type { ModelOutput, ProviderMessage, ProviderToolSpec } from "./index";

export const DEEPSEEK_ENDPOINT = "https://api.deepseek.com/chat/completions";

/** 未显式给 model 时的真实模型名（DeepSeek-V4.1-Flash-1017 的对外调用名）。
 *  单一事实源：`toOpenAiOptions` 的 defaultModel 与 `deepseekDefaultModelName()` 都从这里取。 */
export const DEEPSEEK_DEFAULT_MODEL = "deepseek-flash";

/** Default Chat Completions output limit, including reasoning tokens. */
export function deepSeekOutputReserve(effort?: string): number {
  if (effort === "max") return 128 * 1024;
  return effort === undefined || effort === "off" ? 8 * 1024 : 64 * 1024;
}

/** `streamDeepSeek(messages, {})` 真实会用的模型名（价格标签/归因按它反查）。 */
export function deepseekDefaultModelName(): string {
  return process.env.DEEPSEEK_MODEL ?? DEEPSEEK_DEFAULT_MODEL;
}

export type DeepSeekMessage = ProviderMessage;

/** DeepSeek 工具规格（OpenAI 兼容 wire 形态）。 */
export interface DeepSeekToolSpec {
  type: "function";
  function: { name: string; description?: string; parameters: Record<string, unknown> };
}

export interface DeepSeekOptions {
  /** 缺省读 process.env.DEEPSEEK_API_KEY。 */
  apiKey?: string;
  /** 缺省读 process.env.DEEPSEEK_MODEL ?? "deepseek-flash"。 */
  model?: string;
  /** 缺省读 process.env.DEEPSEEK_ENDPOINT ?? 官方端点。 */
  endpoint?: string;
  /** 反向验证开关：false = 非流式，缺省 true。 */
  stream?: boolean;
  /** 思考档位。**与 GLM 预设不同：未给 ≠ 逐字旧行为，而是归一成 "off"** —— DeepSeek V4.1
   *  不发 thinking 字段时服务端默认开思考（官方文档），「不表态」在这家等于「表态开」，
   *  预设层替用户把缺省钉回 off（要思考就在 settings 里显式选低/高）。 */
  reasoningEffort?: string;
  /** 单测注入点（缺省全局 fetch）。 */
  fetchImpl?: typeof fetch;
  metering?: OpenAiOptions["metering"];
  extraBody?: OpenAiOptions["extraBody"];
}

/** 未给 / 空串 ⇒ "off"（DeepSeek 的「不表态」是服务端默认开思考，见文件头）。 */
function resolveEffort(effort: string | undefined): string {
  return effort === undefined || effort === "" ? "off" : effort;
}

function toOpenAiOptions(opts: DeepSeekOptions): OpenAiOptions {
  return {
    apiKey: opts.apiKey,
    apiKeyEnv: "DEEPSEEK_API_KEY",
    model: opts.model,
    modelEnv: "DEEPSEEK_MODEL",
    defaultModel: DEEPSEEK_DEFAULT_MODEL,
    baseURL: opts.endpoint,
    baseURLEnv: "DEEPSEEK_ENDPOINT",
    defaultBaseURL: DEEPSEEK_ENDPOINT,
    // 镜像和中转端点沿用 DeepSeek 的请求协议。
    deepseekNative: true,
    reasoningEffort: resolveEffort(opts.reasoningEffort),
    ...(opts.extraBody !== undefined ? { extraBody: opts.extraBody } : {}),
    stream: opts.stream,
    label: "DeepSeek",
    fetchImpl: opts.fetchImpl,
    metering: opts.metering,
  };
}

/** 流式一轮对话：SSE 增量 → 事件（解码/重试/计量全由 openai 适配器承载）。 */
export async function* streamDeepSeek(
  messages: DeepSeekMessage[],
  opts: DeepSeekOptions = {},
  tools?: DeepSeekToolSpec[],
  call?: { signal?: AbortSignal },
): AsyncGenerator<ModelOutput> {
  const unified: ProviderToolSpec[] | undefined = tools?.map((t) => ({
    name: t.function.name,
    ...(t.function.description !== undefined ? { description: t.function.description } : {}),
    parameters: t.function.parameters,
  }));
  yield* streamOpenAI(messages, toOpenAiOptions(opts), unified, call);
}
