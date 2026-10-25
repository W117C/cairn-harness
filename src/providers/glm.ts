// GLM provider（智谱 OpenAI 兼容协议）—— openai 适配器的预设（baseURL/model/环境变量名/额外参数）。
// 实测（2026-09-09）：端点 /api/paas/v4/chat/completions；鉴权 Authorization: Bearer <key>；
// stream:true 走 SSE，增量在 choices[0].delta.content，最后一个 chunk 带 finish_reason 与 usage；
// 工具调用流式要额外 tool_stream:true，delta 里有 tool_calls（按 index 跨块累积 arguments）。
// key 只从环境变量 CAIRN_API_KEY 读，模型从 CAIRN_MODEL 读（缺省 glm-5.2）；key 不落文件、不进日志。
// 历史签名保持不变（scripts/provider-check.ts、scripts/autonomy-check.ts、tests/glm.test.ts 冻结消费方）。
import { streamOpenAI, type OpenAiOptions } from "./openai";
import type { ModelOutput, ProviderMessage, ProviderToolSpec } from "./index";

export const GLM_ENDPOINT = "https://open.bigmodel.cn/api/paas/v4/chat/completions";

/** 未显式给 model 时的真实模型名。单一事实源：`toOpenAiOptions` 的 defaultModel 与
 *  `glmDefaultModelName()` 都从这里取——worker 价格标签要按真实模型名反查档位，
 *  抄第三份 `"glm-5.2"` 字面量就是本仓点名的「同族出口策略副本」。 */
export const GLM_DEFAULT_MODEL = "glm-5.2";

/** `streamGlm(messages, {})`（= `defaultWorkerModel`，未走档位路由的 worker 那条）真实会用的模型名。 */
export function glmDefaultModelName(): string {
  return process.env.CAIRN_MODEL ?? GLM_DEFAULT_MODEL;
}

export type GlmMessage = ProviderMessage;

/** GLM 工具规格（OpenAI 兼容 wire 形态；scripts/provider-check.ts 冻结消费方按此构造）。 */
export interface GlmToolSpec {
  type: "function";
  function: { name: string; description?: string; parameters: Record<string, unknown> };
}

export interface GlmOptions {
  /** 缺省读 process.env.CAIRN_API_KEY。 */
  apiKey?: string;
  /** 缺省读 process.env.CAIRN_MODEL ?? "glm-5.2"。 */
  model?: string;
  /** 缺省读 process.env.CAIRN_ENDPOINT ?? 智谱 OpenAI 兼容端点。 */
  endpoint?: string;
  /** 反向验证开关：false = 非流式（整段回复只算 1 个 delta），缺省 true。 */
  stream?: boolean;
  /** 思考档位：透传给 openai 适配器的 body.reasoning_effort（GLM 走 OpenAI 兼容协议）。 */
  reasoningEffort?: string;
  /** 单测注入点（缺省全局 fetch）。 */
  fetchImpl?: typeof fetch;
  metering?: OpenAiOptions["metering"];
  /** Compatibility controls are serialized before transport metering; omitted preserves the default wire shape. */
  extraBody?: OpenAiOptions["extraBody"];
}

/** GLM 工具调用流式要额外打开 `tool_stream`（官方必需），但**第三方 OpenAI 兼容中转会拒收未知字段**
 *  （实测 `{"code":"UNKNOWN_FIELD","field":"tool_stream"}` / HTTP 400，整个 provider:check 与所有
 *  worker spawn 第一跳即死）。因此给一个显式关闭位：缺省逐字保持现状，只认 `0|false|off`——
 *  拼错不静默当"关"（那会让人以为开关生效、实际还在 400，比报错更难查）。
 *  不自动按 host 猜：猜错一次要重踩一遍，且下一个严格代理还会再来一次。 */
export function glmToolStreamFlag(
  stream: boolean | undefined,
  env: Record<string, string | undefined> = process.env,
): { tool_stream: true } | undefined {
  if (stream === false) return undefined;
  const raw = env.CAIRN_GLM_TOOL_STREAM;
  const off = typeof raw === "string" && ["0", "false", "off"].includes(raw.trim().toLowerCase());
  return off ? undefined : { tool_stream: true };
}

function toOpenAiOptions(opts: GlmOptions): OpenAiOptions {
  return {
    apiKey: opts.apiKey,
    apiKeyEnv: "CAIRN_API_KEY",
    model: opts.model,
    modelEnv: "CAIRN_MODEL",
    defaultModel: GLM_DEFAULT_MODEL,
    baseURL: opts.endpoint,
    baseURLEnv: "CAIRN_ENDPOINT",
    defaultBaseURL: GLM_ENDPOINT,
    // GLM 特有：工具调用流式要额外打开 tool_stream（可由 CAIRN_GLM_TOOL_STREAM=0 关，见上）
    extraBody: { ...glmToolStreamFlag(opts.stream), ...opts.extraBody },
    ...(opts.reasoningEffort !== undefined ? { reasoningEffort: opts.reasoningEffort } : {}),
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
