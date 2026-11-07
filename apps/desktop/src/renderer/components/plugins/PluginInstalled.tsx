import { useState } from "react";
import {
  ArrowUpCircle,
  Puzzle,
  RefreshCw,
  Trash2,
} from "lucide-react";
import type { PluginRowView } from "../../derived/plugins";
import type { PluginsMarketplaceState } from "../../state/plugins-marketplace";
import { ConfirmDialog } from "../ConfirmDialog";
import { Switch } from "../Switch";
import { scopeLabelOf, sourceKindLabel } from "./labels";

function stateLabel(row: PluginRowView): string {
  if (row.state === "enabled") return "已启用";
  if (row.state === "disabled") return "已停用";
  if (row.state === "unmanaged") return "未托管";
  if (row.state === "name-conflict") return "名称冲突";
  return "已安装";
}

function InstalledRow(props: {
  row: PluginRowView;
  state: PluginsMarketplaceState;
  busy: boolean;
  mutationBlocked: boolean;
  onConfirmUninstall: (row: PluginRowView) => void;
}): React.JSX.Element {
  const installed = props.row.installed;
  const unmanaged = installed === null;
  const conflict = props.row.state === "name-conflict";
  const disabled = props.busy || props.mutationBlocked || unmanaged || conflict;
  const enabled = installed?.enabled === true;
  return (
    <article
      className="plugin-store-card"
      data-plugin-row="installed"
      data-plugin-id={props.row.id}
      data-plugin-state={props.row.state}
    >
      <button type="button" className="plugin-store-main" onClick={() => { props.state.select(props.row.id); }}>
        <span className="plugin-mark lg" aria-hidden="true"><Puzzle size={20} /></span>
        <span className="plugin-store-copy">
          <span className="plugin-store-title">
            <strong>{props.row.name}</strong>
            {props.row.version !== null && <span className="plugin-pill">{props.row.version}</span>}
            {!unmanaged && <span className="plugin-pill subtle">{scopeLabelOf(props.row.installed?.scope === "project" ? "project" : "user")}</span>}
            <span className={"plugin-pill subtle" + (enabled ? "" : " warn")}>{stateLabel(props.row)}</span>
          </span>
          <span className="plugin-store-desc">{props.row.summary}</span>
          <span className="plugin-store-meta">{sourceKindLabel(props.row.sourceKind)}</span>
        </span>
      </button>
      <div className="plugin-store-actions">
        {!unmanaged && !conflict && (
          <>
            <Switch
              checked={enabled}
              busy={props.busy}
              disabled={props.mutationBlocked}
              label={`${enabled ? "停用" : "启用"} ${props.row.name}`}
              onChange={(next) => { void props.state.setPluginEnabled(props.row, next); }}
            />
            <button
              type="button"
              className="plugin-icon-btn plugin-hover-act"
              aria-label={`检查更新 ${props.row.name}`}
              title="检查更新"
              disabled={disabled}
              onClick={() => { void props.state.checkPluginUpdate(props.row); }}
            >
              <RefreshCw size={14} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="plugin-icon-btn plugin-hover-act"
              aria-label={`更新 ${props.row.name}`}
              title="更新"
              disabled={disabled}
              onClick={() => { void props.state.updatePlugin(props.row); }}
            >
              <ArrowUpCircle size={14} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="plugin-icon-btn plugin-danger plugin-hover-act"
              aria-label={`卸载 ${props.row.name}`}
              title="卸载"
              disabled={disabled}
              onClick={() => { props.onConfirmUninstall(props.row); }}
            >
              <Trash2 size={14} aria-hidden="true" />
            </button>
          </>
        )}
      </div>
    </article>
  );
}

export interface PluginInstalledProps {
  readonly state: PluginsMarketplaceState;
  readonly rows: readonly PluginRowView[];
  readonly busy: boolean;
  readonly mutationBlocked: boolean;
}

export function PluginInstalled(props: PluginInstalledProps): React.JSX.Element {
  const [uninstall, setUninstall] = useState<PluginRowView | null>(null);
  const installed = props.rows.filter((row) => row.installed !== null);
  const unmanaged = props.rows.filter((row) => row.installed === null && row.runtime !== null);
  return (
    <section className="plugin-installed" data-marketplace-view="installed">
      {installed.length === 0 && unmanaged.length === 0 ? (
        <div className="plugin-state-block">
          <strong>还没有插件</strong>
          <span>到「发现」里挑一个，或用页头的「导入」接入本地插件。</span>
        </div>
      ) : (
        <>
          {installed.length > 0 && (
            <section className="plugin-operational-list" aria-labelledby="plugin-installed-title">
              <h2 id="plugin-installed-title">已安装</h2>
              {installed.map((row) => (
                <InstalledRow
                  key={row.id}
                  row={row}
                  state={props.state}
                  busy={props.busy}
                  mutationBlocked={props.mutationBlocked}
                  onConfirmUninstall={setUninstall}
                />
              ))}
            </section>
          )}
          {unmanaged.length > 0 && (
            <section className="plugin-operational-list" aria-labelledby="plugin-unmanaged-title">
              <h2 id="plugin-unmanaged-title">未托管</h2>
              {unmanaged.map((row) => (
                <InstalledRow
                  key={row.id}
                  row={row}
                  state={props.state}
                  busy={props.busy}
                  mutationBlocked={props.mutationBlocked}
                  onConfirmUninstall={setUninstall}
                />
              ))}
            </section>
          )}
        </>
      )}
      {uninstall !== null && (
        <ConfirmDialog
          title={`卸载「${uninstall.name}」？`}
          note="将删除插件包、信任记录、配置和已保存的敏感值。"
          confirmLabel="卸载"
          danger
          onClose={() => { setUninstall(null); }}
          onConfirm={() => {
            const row = uninstall;
            setUninstall(null);
            void props.state.uninstallPlugin(row);
          }}
        />
      )}
    </section>
  );
}
