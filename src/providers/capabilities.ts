import {
  effectiveModelTable,
  isFreeformModelId,
  isKnownProviderId,
  lookupModel,
  reasoningEffortsForModel,
  type ModelSpec,
} from "./registry";
import { mapUpstreamEfforts } from "./reasoning";

/** UI 与 RunRequest 共用的思考档位。Provider 不支持时只能使用 off。 */
export const THINKING_EFFORTS = ["off", "low", "medium", "high"] as const;
export type ThinkingEffort = (typeof THINKING_EFFORTS)[number];

export type ModelAvailability = "verified" | "unverified";

export interface ProviderCapability {
  /** 档位表稳定 ID。 */
  modelId: string;
  provider: string;
  /** 当前 catalog 是否经过本仓带凭据实测；未证不应直接出现在选择器。 */
  availability: ModelAvailability;
  /** 当前适配器是否真正把该档位接到 wire；不能只因模型“可能支持”就报 true。 */
  thinking: {
    supported: boolean;
    values: readonly ThinkingEffort[];
    default: ThinkingEffort;
  };
  attachments: {
    /** 本地文本引用由 Agent 工具读取，不要求 Provider 原生 file upload。 */
    text: boolean;
    /** 是否已经接入 Provider 原生视觉输入。 */
    image: boolean;
  };
}

/**
 * 当前运行时能力的事实表。
 *
 * 目前四个 adapter 尚未把 reasoning/thinking 参数接入请求体，因此不能把
 * “厂商有该模型”伪装成“DSH 已支持该档位”。等 wire 实现和测试落地后，再把
 * 对应条目的 supported/values 打开；renderer 只消费这张表。
 */
function capability(modelId: string, provider: string): ProviderCapability {
  if (!isKnownProviderId(provider)) {
    throw new Error(`Provider capability 未登记: ${JSON.stringify(provider)}`);
  }
  // 思考档位开门的**唯一**依据：有证据说明这个模型收这个参数。
  // 今天的证据只有一种——用户在 `.agent/providers.json` 给自己的模型写了 `reasoningEfforts`
  // （或从上游 `/models` 自述里探测到、写进了配置）。内置档位没有任何一条带凭据实测过，
  // 所以它们照旧是 `supported: false` —— 「不能只因模型可能支持就报 true」这条纪律没变。
  const spec = lookupModel(effectiveModelTable(), modelId);
  const declared = mapUpstreamEfforts(spec?.reasoningEfforts ?? reasoningEffortsForModel(modelId));
  // 识图能力同样要求证据：模型的输入模态声明里含 "image" 才算支持（缺席 = 上游没说，按不支持）。
  const image = spec?.inputModalities?.includes("image") === true;
  const supported = declared.length > 0;
  return {
    modelId,
    provider,
    availability: "unverified",
    thinking: {
      supported,
      values: supported ? ["off", ...declared] : ["off"],
      // 缺省仍是 off：声明了支持不等于替用户打开（思考是要花钱的）。
      default: "off",
    },
    attachments: {
      text: true,
      image,
    },
  };
}

export function capabilityForModel(spec: Pick<ModelSpec, "id" | "provider">): ProviderCapability {
  if (typeof spec.id !== "string" || spec.id.trim() === "") {
    throw new Error("模型 capability 缺少稳定 id");
  }
  const registered = lookupModel(effectiveModelTable(), spec.id);
  if (!registered) {
    /* 自由档（`--model` 点名的表外模型）按设计不进表，但仍要能被拨 ⇒ 这里合成一份**保守**能力：
     * thinking 一律 off、只给文本附件、availability 记 unverified。理由与 `capability()` 的
     * 注释同一条——不能因为「模型可能支持」就把 `supported` 报 true。缺了这一支的话自由档
     * 会在 `validateThinkingEffort` 上抛「模型 capability 未登记」而**一次都拨不出去**：
     * 不进表是为了不按假价参与路由，不是为了不让它跑。 */
    if (isFreeformModelId(spec.id)) {
      if (!isKnownProviderId(spec.provider)) {
        throw new Error(`Provider capability 未登记: ${JSON.stringify(spec.provider)}`);
      }
      return capability(spec.id, spec.provider);
    }
    throw new Error(`模型 capability 未登记: ${JSON.stringify(spec.id)}`);
  }
  if (registered.provider !== spec.provider) {
    throw new Error(`模型 capability 未登记: ${JSON.stringify(spec.id)}`);
  }
  return capability(registered.id, registered.provider);
}

export function validateThinkingEffort(
  spec: Pick<ModelSpec, "id" | "provider">,
  requested: ThinkingEffort | undefined,
): ThinkingEffort {
  const cap = capabilityForModel(spec);
  const value = requested ?? cap.thinking.default;
  if (!cap.thinking.values.includes(value)) {
    throw new Error(
      // 第 447 页：同上那把尺——「当前只支持」只有五字，读不出名字 ⇒ 写成可点名的一句。
      `模型 ${spec.id} 不支持 thinking=${JSON.stringify(value)}；当前仅支持下列取值：${cap.thinking.values.join(", ")}`,
    );
  }
  return value;
}

export function listProviderCapabilities(table: readonly ModelSpec[]): ProviderCapability[] {
  return table.map((spec) => capabilityForModel(spec));
}

/** UI 选择器的安全入口：未完成带凭据实测的 catalog 不得直接变成可选项。 */
export function listVerifiedProviderCapabilities(table: readonly ModelSpec[]): ProviderCapability[] {
  return listProviderCapabilities(table).filter((capability) => capability.availability === "verified");
}
