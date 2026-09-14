// M5b provider 档位表（§m5-proposal 步骤 6）：单 provider 多档位。
// 背景（§1.1 事实 1）：四个适配器（openai/anthropic/gemini/glm）已实现但从未接入运行时——
// 本模块是它们的第一个运行时消费面。本期只装配 GLM 一家（§4.3 权衡：单 provider 多档位，
// 收益上限换零新依赖 / 零新 key 面 / 零合规风险）；registry 预留 provider 字段，M6 开白名单零重构。
import { streamGlm, type GlmMessage, type GlmToolSpec } from "./glm";
import type { ModelOutput } from "./index";

export type ModelTier = "cheap" | "standard" | "strong";

export interface ModelSpec {
  id: string;
  provider: string;
  model: string;
  tier: ModelTier;
  ctxWindow: number;
}

/** 本期只装配 GLM 一家（M5 不做真多 provider 拨号；M6 再扩白名单）。 */
export const PROVIDER_IDS = ["glm"] as const;

/** 缺省档位表。模型名为档位占位——M5b 步骤 6 实测校准（Follow-up 2：先做档位可用性抽样，
 *  若便宜档不可用或用量不降，§1.3 目标在 M5b 收口前修订）。 */
export const DEFAULT_MODEL_TABLE: readonly ModelSpec[] = [
  { id: "glm-flash", provider: "glm", model: "glm-4.5-flash", tier: "cheap", ctxWindow: 128_000 },
  { id: "glm-standard", provider: "glm", model: "glm-5.2", tier: "standard", ctxWindow: 128_000 },
  { id: "glm-strong", provider: "glm", model: "glm-5.2-pro", tier: "strong", ctxWindow: 256_000 },
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

/** 薄适配器：GlmToolSpec → ProviderToolSpec 映射照抄 glm.ts 的 unified 段；按 spec.model 拨号。 */
export function toWorkerModel(spec: ModelSpec): RegistryWorkerModel {
  return (messages, tools) => streamGlm(messages, { model: spec.model }, tools);
}
