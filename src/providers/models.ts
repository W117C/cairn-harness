// pi-mono 式 provider/model 运行时的唯一事实源面：Models 是「provider 集合 + auth 状态 + 流便利」，
// 具体 provider 拥有元数据、auth、模型清单与流行为。本仓即便没把四支 adapter 拆成独立 Provider
// 类，数据面也必须呈现同一形状——这样 .agent/providers.json 的自定义家、上游 /models 探测、
// capability 表三条面才只有一个拼法，UI 不再各自推导。
import { listProviderCapabilities, type ProviderCapability } from "./capabilities";
import { effectiveModelTable, isKnownProviderId, type ModelSpec } from "./registry";

export interface ProviderModelInfo extends ModelSpec {
  capability: ProviderCapability;
}

export interface Models {
  /** 全部已知 provider id（内置 + 已装自定义家），保持注册表顺序。 */
  getProviders(): readonly string[];
  /** 某 provider 的模型清单（缺省 = 全量真模型）。同步读「上次已知列表」。 */
  getModels(provider?: string): readonly ModelSpec[];
  /** 按 provider+id 找模型。 */
  getModel(provider: string, id: string): ModelSpec | undefined;
  /** 模型 + capability 拼版（设置页 / 选择器 / token 面共用）。 */
  getModelInfos(provider?: string): readonly ProviderModelInfo[];
}

function providerIds(): readonly string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const spec of effectiveModelTable()) {
    if (!seen.has(spec.provider)) {
      seen.add(spec.provider);
      out.push(spec.provider);
    }
  }
  return out;
}

export function createModels(): Models {
  return {
    getProviders() {
      return providerIds().filter((id) => isKnownProviderId(id));
    },
    getModels(provider?: string) {
      const table = effectiveModelTable();
      return provider === undefined ? table : table.filter((s) => s.provider === provider);
    },
    getModel(provider: string, id: string) {
      return effectiveModelTable().find((s) => s.provider === provider && s.id === id);
    },
    getModelInfos(provider?: string) {
      const table = effectiveModelTable();
      const capabilities = listProviderCapabilities(table);
      const byId = new Map(capabilities.map((c) => [c.modelId, c]));
      return (provider === undefined ? table : table.filter((s) => s.provider === provider)).map((spec) => {
        const capability = byId.get(spec.id);
        if (!capability) throw new Error(`模型 capability 未登记: ${spec.id}`);
        return { ...spec, capability };
      });
    },
  };
}

/** 与 effectiveModelTable 同口径的默认集合；刷新通过重建 createModels() 完成（不做原地变异）。 */
export function modelsForCurrentTable(): Models {
  return createModels();
}
