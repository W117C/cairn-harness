// M5b/M6 provider 档位表（§m5-proposal 步骤 6 + M6 白名单）：多 provider 多档位。
// 背景（§1.1 事实 1）：四个适配器（openai/anthropic/gemini/glm）已实现但从未接入运行时——
// 本模块是它们的运行时消费面。M5 只装配 GLM（§4.3 权衡）；M6 开白名单到四家（registry 的
// provider 字段按 §4.3 预留，开白名单零重构）。
// 档位模型名与价格为**占位**——需联网实测校准（m5-acceptance C5：provider 可用性抽样 + 价格核实）。
import { streamGlm, type GlmMessage, type GlmToolSpec } from "./glm";
import { streamOpenAI } from "./openai";
import { streamAnthropic } from "./anthropic";
import { streamGemini } from "./gemini";
import type { ModelOutput, ProviderMessage, ProviderToolSpec } from "./index";

export type ModelTier = "cheap" | "standard" | "strong";

export interface ModelSpec {
  id: string;
  provider: string;
  model: string;
  tier: ModelTier;
  ctxWindow: number;
}

/** M6：真多 provider 白名单（§4.3 预留面开闸；M5 期只装配 glm）。 */
export const PROVIDER_IDS = ["glm", "openai", "anthropic", "gemini"] as const;

/** 缺省档位表（表序 = 档位默认的 provider 优先级：glm 第一——tier-default 取 direct[0]）。
 *  id 命名：glm 沿用 M5 的 flash/standard/strong；其余用 <provider>-<tier>。 */
export const DEFAULT_MODEL_TABLE: readonly ModelSpec[] = [
  // GLM（M5 既有，id 不变）
  { id: "glm-flash", provider: "glm", model: "glm-4.5-flash", tier: "cheap", ctxWindow: 128_000 },
  { id: "glm-standard", provider: "glm", model: "glm-5.2", tier: "standard", ctxWindow: 128_000 },
  { id: "glm-strong", provider: "glm", model: "glm-5.2-pro", tier: "strong", ctxWindow: 256_000 },
  // OpenAI（M6 白名单）
  { id: "openai-cheap", provider: "openai", model: "gpt-4o-mini", tier: "cheap", ctxWindow: 128_000 },
  { id: "openai-standard", provider: "openai", model: "gpt-4o", tier: "standard", ctxWindow: 128_000 },
  { id: "openai-strong", provider: "openai", model: "o3", tier: "strong", ctxWindow: 200_000 },
  // Anthropic（M6 白名单）
  { id: "anthropic-cheap", provider: "anthropic", model: "claude-3-5-haiku-latest", tier: "cheap", ctxWindow: 200_000 },
  { id: "anthropic-standard", provider: "anthropic", model: "claude-3-5-sonnet-latest", tier: "standard", ctxWindow: 200_000 },
  { id: "anthropic-strong", provider: "anthropic", model: "claude-opus-4-latest", tier: "strong", ctxWindow: 200_000 },
  // Gemini（M6 白名单）
  { id: "gemini-cheap", provider: "gemini", model: "gemini-2.0-flash", tier: "cheap", ctxWindow: 1_000_000 },
  { id: "gemini-standard", provider: "gemini", model: "gemini-2.5-pro", tier: "standard", ctxWindow: 1_000_000 },
  { id: "gemini-strong", provider: "gemini", model: "gemini-2.5-pro-exp", tier: "strong", ctxWindow: 1_000_000 },
];

/** 档位表查询（纯函数）。 */
export function lookupModel(table: readonly ModelSpec[], id: string): ModelSpec | undefined {
  return table.find((s) => s.id === id);
}

/** 按档位取候选（纯函数）。 */
export function specsByTier(table: readonly ModelSpec[], tier: ModelTier): ModelSpec[] {
  return table.filter((s) => s.tier === tier);
}

/** 按 id 解析；未知 id fail-visible 报错，绝不静默回落（路由策略层的底座纪律）。 */
export function resolveModel(table: readonly ModelSpec[], id: string): ModelSpec {
  const spec = lookupModel(table, id);
  if (!spec) throw new Error(`未知 model id: ${JSON.stringify(id)}（档位表：${table.map((s) => s.id).join(", ")}）`);
  return spec;
}

/** WorkerModel 签名（与 orchestrator 的 WorkerModel 同形；registry 不自引编排层避免环依赖）。
 *  构造零拨号——无 key 时**调用**才失败（fail-closed）。 */
export type RegistryWorkerModel = (messages: GlmMessage[], tools: GlmToolSpec[]) => AsyncIterable<ModelOutput>;

/** GlmToolSpec（openai wire）→ ProviderToolSpec（统一中立面）：照抄 glm.ts 的 unified 映射。 */
export function toProviderTools(tools: GlmToolSpec[] | undefined): ProviderToolSpec[] | undefined {
  return tools?.map((t) => ({
    name: t.function.name,
    ...(t.function.description !== undefined ? { description: t.function.description } : {}),
    parameters: t.function.parameters,
  }));
}

export interface ToWorkerModelOptions {
  /** 测试注入点（各适配器 fetchImpl；缺省全局 fetch）。 */
  fetchImpl?: typeof fetch;
}

/** 薄适配器：按 spec.provider 路由到对应适配器（M6 白名单）。未知 provider fail-visible 抛错。 */
export function toWorkerModel(spec: ModelSpec, opts: ToWorkerModelOptions = {}): RegistryWorkerModel {
  const fetchImpl = opts.fetchImpl;
  switch (spec.provider) {
    case "glm":
      return (messages, tools) => streamGlm(messages, { model: spec.model, ...(fetchImpl ? { fetchImpl } : {}) }, tools);
    case "openai":
      return (messages, tools) =>
        streamOpenAI(messages as ProviderMessage[], { model: spec.model, ...(fetchImpl ? { fetchImpl } : {}) }, toProviderTools(tools));
    case "anthropic":
      return (messages, tools) =>
        streamAnthropic(messages, { model: spec.model, ...(fetchImpl ? { fetchImpl } : {}) }, toProviderTools(tools));
    case "gemini":
      return (messages, tools) =>
        streamGemini(messages, { model: spec.model, ...(fetchImpl ? { fetchImpl } : {}) }, toProviderTools(tools));
    default:
      throw new Error(`未知 provider: ${JSON.stringify(spec.provider)}（白名单：${PROVIDER_IDS.join(", ")}）`);
  }
}
