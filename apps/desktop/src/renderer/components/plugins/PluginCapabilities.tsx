import { categoryLabel, type PluginCategory } from "./labels";

export type PluginCapabilityCounts = Readonly<Record<PluginCategory, number>>;

const CATEGORY_ORDER: readonly PluginCategory[] = ["skills", "commands", "agents", "hooks", "mcp", "lsp"];

/** 能力组成：非零项出胶囊，全零收成一行小字。
 *  详情抽屉与安装审查共用这一份——同一组数字在两处长出两种形状，用户会以为是两套权限。 */
export function PluginCapabilities(props: { capabilities: PluginCapabilityCounts }): React.JSX.Element {
  const entries = CATEGORY_ORDER.map((kind) => ({ kind, count: props.capabilities[kind] }));
  const nonZero = entries.filter((entry) => entry.count > 0);
  if (nonZero.length === 0) {
    return <div className="plugin-muted">{entries.map((entry) => `${categoryLabel(entry.kind)} ${String(entry.count)}`).join(" · ")}</div>;
  }
  return (
    <div className="plugin-capability-pills">
      {nonZero.map((entry) => (
        <span className="plugin-pill" key={entry.kind}>
          {categoryLabel(entry.kind)} {String(entry.count)}
        </span>
      ))}
    </div>
  );
}
