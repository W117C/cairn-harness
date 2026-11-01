import { ArrowUpCircle, RefreshCw } from "lucide-react";
import type { PluginRowView, PluginUpdateRow } from "../../derived/plugins";
import type { PluginsMarketplaceState } from "../../state/plugins-marketplace";

function updateDetail(row: PluginUpdateRow): string {
  if (row.sourceKind === "catalog") {
    return `${row.currentVersion ?? "未声明版本"} → ${row.nextVersion ?? "未声明版本"}`;
  }
  if (row.sourceKind === "git") return "Git 有新提交";
  return "本地目录内容已变化";
}

export interface PluginUpdatesProps {
  readonly state: PluginsMarketplaceState;
  readonly updates: readonly PluginUpdateRow[];
  readonly installedRows: readonly PluginRowView[];
  readonly busy: boolean;
  readonly mutationBlocked: boolean;
}

export function PluginUpdates(props: PluginUpdatesProps): React.JSX.Element {
  const checking = Object.values(props.state.updateChecks).some((check) => check.status === "checking");
  return (
    <section className="plugin-updates" data-marketplace-view="updates">
      <div className="plugin-updates-toolbar">
        <span>{checking ? "正在检查更新" : props.updates.length === 0 ? "没有可用更新" : `${String(props.updates.length)} 项可更新`}</span>
        <button
          type="button"
          className="plugin-secondary"
          disabled={checking || props.busy || props.mutationBlocked || props.installedRows.length === 0}
          onClick={() => {
            for (const row of props.installedRows) void props.state.checkPluginUpdate(row);
          }}
        >
          <RefreshCw size={14} aria-hidden="true" />
          检查更新
        </button>
      </div>
      {props.updates.length > 0 && (
        <div className="plugin-operational-list">
          {props.updates.map((update) => (
            <article key={update.id} className="plugin-operational-row" data-plugin-row="update" data-plugin-id={update.id}>
              <button type="button" className="plugin-operational-main" onClick={() => { props.state.select(update.id); }}>
                <span className="plugin-row-copy">
                  <strong>{update.row.name}</strong>
                  <span>{updateDetail(update)}</span>
                </span>
                <span className="plugin-row-meta">
                  <span>{update.sourceKind === "catalog" ? "官方目录" : update.sourceKind === "git" ? "Git" : "本地"}</span>
                  {update.check.detail !== undefined && <span>{update.check.detail}</span>}
                </span>
              </button>
              <div className="plugin-row-actions">
                <button
                  type="button"
                  className="plugin-row-action"
                  aria-label={`更新 ${update.row.name}`}
                  title="更新"
                  disabled={props.busy || props.mutationBlocked}
                  onClick={() => { void props.state.updatePlugin(update.row); }}
                >
                  <ArrowUpCircle size={16} aria-hidden="true" />
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
