// CX-02/CX-03：主会话与 worker 共用同一 model registry / capability map / provider adapter 路由。
// 本模块只做选择与只读描述；网络调用仍由 providers/registry.ts 的 toWorkerModel 承担。
import {
  listProviderCapabilities,
  type ProviderCapability,
} from "../providers/capabilities";
import { envKeyOf, type EnvKeyedProvider } from "../providers/env-keys";
import {
  DEFAULT_MODEL_TABLE,
  PROVIDER_IDS as REGISTRY_PROVIDER_IDS,
  findSpecByNameOrId,
  lookupModel,
  type ModelSpec,
} from "../providers/registry";
import type { ProviderKind } from "./settings";

export interface ProviderModelInfo extends ModelSpec {
  capability: ProviderCapability;
}

export interface ProviderInfo {
  kind: ProviderKind;
  provider: string;
  /** Provider wire model name. Demo keeps the historical explicit fixture label. */
  model: string;
  /** Stable registry id; demo has none. */
  modelId: string | null;
  /** Every real model exposed by the one shared worker/main registry. */
  models: ProviderModelInfo[];
  /** Whether the selected real provider's mapped key env is present. Never includes the value. */
  keyConfigured: boolean;
}

export type MainModelSelection =
  | { kind: "demo" }
  | { kind: EnvKeyedProvider; spec: ModelSpec; modelExplicit: boolean };

const PROVIDER_LABELS: Record<EnvKeyedProvider, string> = {
  glm: "GLM（OpenAI 兼容）",
  openai: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Gemini",
};

function isRealProviderKind(value: string): value is EnvKeyedProvider {
  return (REGISTRY_PROVIDER_IDS as readonly string[]).includes(value);
}

/** Empty env means "no override"; unknown non-empty values fail visibly instead of falling through. */
export function providerKindFromEnv(raw: string | undefined): ProviderKind | undefined {
  if (raw === undefined || raw === "") return undefined;
  if (raw === "demo" || raw === "mock") return "demo";
  if (isRealProviderKind(raw)) return raw;
  throw new Error(`未知 M0A_PROVIDER: ${JSON.stringify(raw)}（允许 demo 或 ${REGISTRY_PROVIDER_IDS.join(" / ")}）`);
}

function defaultModelFor(provider: EnvKeyedProvider): ModelSpec {
  const model = DEFAULT_MODEL_TABLE.find((spec) => spec.provider === provider && spec.tier === "standard")
    ?? DEFAULT_MODEL_TABLE.find((spec) => spec.provider === provider);
  if (!model) throw new Error(`Provider ${provider} 没有注册模型`);
  return model;
}

function legacyModel(raw: string, source: "settings.model" | "M0_MODEL"): ModelSpec {
  const spec = findSpecByNameOrId(DEFAULT_MODEL_TABLE, raw);
  if (!spec) {
    throw new Error(`${source} 未登记到模型表: ${JSON.stringify(raw)}`);
  }
  return spec;
}

export interface ResolveMainModelInput {
  /** Non-empty M0A_PROVIDER override, when present. */
  forcedKind?: ProviderKind;
  configuredKind: ProviderKind;
  /** RunRequest.model: stable registry id only. */
  requestModel?: string;
  /** Legacy settings field: stable id or provider model name. */
  settingsModel: string;
  /** Legacy GLM model env; consulted only for a selected GLM run with no explicit/settings model. */
  legacyEnvModel?: string;
}

export function resolveMainModel(input: ResolveMainModelInput): MainModelSelection {
  if (input.forcedKind === "demo") {
    if (input.requestModel !== undefined) throw new Error("RunRequest.model 与 M0A_PROVIDER=demo 不匹配");
    return { kind: "demo" };
  }

  if (input.requestModel !== undefined) {
    const spec = lookupModel(DEFAULT_MODEL_TABLE, input.requestModel);
    if (!spec) {
      throw new Error(`RunRequest.model 未登记（须用稳定 registry id）: ${JSON.stringify(input.requestModel)}`);
    }
    if (!isRealProviderKind(spec.provider)) throw new Error(`模型 ${spec.id} 的 provider 非法: ${spec.provider}`);
    if (input.forcedKind !== undefined && spec.provider !== input.forcedKind) {
      throw new Error(`RunRequest.model=${spec.id} 与 M0A_PROVIDER=${input.forcedKind} 不匹配`);
    }
    return { kind: spec.provider, spec, modelExplicit: true };
  }

  // Demo is an explicit no-key mode. A stale legacy model in settings must not silently reactivate a
  // real provider; only an explicit per-run model id may override demo.
  if (input.configuredKind === "demo" && input.forcedKind === undefined) return { kind: "demo" };

  const provider = input.forcedKind ?? input.configuredKind;
  if (!isRealProviderKind(provider)) throw new Error(`未知主会话 provider: ${provider}`);
  const requested = input.settingsModel !== ""
    ? input.settingsModel
    : provider === "glm" ? input.legacyEnvModel : undefined;
  if (requested !== undefined && requested !== "") {
    const spec = legacyModel(requested, provider === "glm" && input.settingsModel === "" ? "M0_MODEL" : "settings.model");
    if (spec.provider !== provider) {
      throw new Error(`模型 ${spec.id} (${spec.provider}) 与 provider=${provider} 不匹配`);
    }
    return { kind: provider, spec, modelExplicit: true };
  }
  return { kind: provider, spec: defaultModelFor(provider), modelExplicit: false };
}

export function providerKeyConfigured(
  kind: ProviderKind,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (kind === "demo") return false;
  const envName = envKeyOf(kind);
  if (envName === null) throw new Error(`Provider ${kind} 未登记 env key 映射`);
  const value = env[envName];
  return typeof value === "string" && value.trim() !== "";
}

export function assertProviderKeyConfigured(kind: ProviderKind, env: NodeJS.ProcessEnv = process.env): void {
  if (providerKeyConfigured(kind, env)) return;
  const envName = kind === "demo" ? "无（demo 不需要 key）" : envKeyOf(kind);
  throw new Error(
    `provider=${kind} 未配置 API key（${envName} 缺失）：真实模型通道不可用；` +
      "请配置该 provider 的 key，或显式切换到 demo。不会静默回落其他 provider/demo。",
  );
}

export function buildProviderInfo(
  selection: MainModelSelection,
  env: NodeJS.ProcessEnv = process.env,
): ProviderInfo {
  if (selection.kind === "demo") {
    return {
      kind: "demo",
      provider: "demo（冻结剧本，非真实模型）",
      model: "mock-script",
      modelId: null,
      models: [],
      keyConfigured: false,
    };
  }
  const capabilities = listProviderCapabilities(DEFAULT_MODEL_TABLE);
  const capabilityById = new Map(capabilities.map((capability) => [capability.modelId, capability]));
  const models = DEFAULT_MODEL_TABLE.map((spec) => {
    const capability = capabilityById.get(spec.id);
    if (!capability) throw new Error(`模型 capability 未登记: ${spec.id}`);
    return { ...spec, capability };
  });
  return {
    kind: selection.kind,
    provider: PROVIDER_LABELS[selection.kind],
    model: selection.spec.model,
    modelId: selection.spec.id,
    models,
    keyConfigured: providerKeyConfigured(selection.kind, env),
  };
}
