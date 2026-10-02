// 会话条模型选择器（M2-4）。目录唯一事实源 = window.agent.getProviderInfo()（M1 全桥），
// main 侧 buildProviderInfo 直接铺主/worker 共享注册表的全量真模型，本层不做第二份数据。
// 选择态由 App 持有（Map<sessionId, registryId|null>，内存态，M4 才落 settings）。
import type { ChangeEvent } from "react";
import type { ProviderInfo } from "../../../../../src/main/ipc-protocol";

/** 下拉选项：registryId = null 即 demo（run 时不透传 model，走 main 侧 settings 缺省）。 */
export interface ModelOption {
  registryId: string | null;
  label: string;
  provider: string | null;
}

/** demo 常驻首项「演示」，其余按 spec 铺平（provider 分组交给 select 的 optgroup）。
 *  ProviderInfo.models 携带的是共享注册表**全量**真模型（不按当前 provider 过滤），
 *  多 ProviderInfo 条目会重复铺同一行 ⇒ 按 spec.id 去重，顺序保持首见。 */
export function flattenModels(infos: readonly ProviderInfo[]): ModelOption[] {
  const options: ModelOption[] = [{ registryId: null, label: "演示", provider: null }];
  const seen = new Set<string>();
  for (const info of infos) {
    for (const spec of info.models) {
      if (seen.has(spec.id)) continue;
      seen.add(spec.id);
      options.push({ registryId: spec.id, label: spec.model, provider: spec.provider });
    }
  }
  return options;
}

export function ModelPicker(props: {
  infos: readonly ProviderInfo[];
  /** 当前会话生效值（registryId 或 null=demo）；由 App 决定 unset 时的回落。 */
  value: string | null;
  onChange: (registryId: string | null) => void;
  disabled?: boolean;
}) {
  const options = flattenModels(props.infos);
  const demo = options.find((o) => o.registryId === null);
  const groups = new Map<string, ModelOption[]>();
  for (const opt of options) {
    if (opt.provider === null) continue;
    const bucket = groups.get(opt.provider);
    if (bucket) bucket.push(opt);
    else groups.set(opt.provider, [opt]);
  }
  const select = (e: ChangeEvent<HTMLSelectElement>) =>
    props.onChange(e.target.value === "" ? null : e.target.value);
  return (
    // 安静风格：系统 select，只用既有变量，不引新色。
    <select
      aria-label="模型选择"
      value={props.value ?? ""}
      onChange={select}
      disabled={props.disabled}
      style={{
        font: "inherit", fontSize: 11, color: "var(--text-2)",
        background: "transparent", border: "1px solid var(--hairline)",
        borderRadius: 5, padding: "1px 4px",
      }}
    >
      <option value="">{demo?.label ?? "演示"}</option>
      {[...groups].map(([provider, models]) => (
        <optgroup key={provider} label={provider}>
          {models.map((m) => (
            m.registryId !== null &&
            <option key={m.registryId} value={m.registryId}>{m.label}</option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
