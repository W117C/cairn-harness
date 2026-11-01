import { AlertTriangle, Download, Puzzle, Star, WifiOff } from "lucide-react";
import type { PluginRowView } from "../../derived/plugins";
import type { PluginsMarketplaceState } from "../../state/plugins-marketplace";
import { PLUGIN_CATEGORY_LABEL, sourceKindLabel } from "./labels";

function capabilityText(row: PluginRowView): string {
  if (row.capabilities === null) return "能力未扫描";
  return Object.entries(row.capabilities)
    .filter(([, count]) => count > 0)
    .map(([kind, count]) => `${PLUGIN_CATEGORY_LABEL[kind as keyof typeof PLUGIN_CATEGORY_LABEL]} ${String(count)}`)
    .join(" · ");
}

function DiscoverRow(props: {
  row: PluginRowView;
  onSelect: (id: string) => void;
  onInstall: (id: string) => void;
  onFavorite: (id: string) => void;
  mutationBlocked: boolean;
}): React.JSX.Element {
  const disabled = props.mutationBlocked
    || props.row.state === "name-conflict"
    || props.row.state === "unmanaged"
    || props.row.installed !== null;
  return (
    <article className="plugin-discover-row" data-plugin-row="discover" data-plugin-id={props.row.id}>
      <button type="button" className="plugin-discover-main" onClick={() => { props.onSelect(props.row.id); }}>
        <span className="plugin-mark" aria-hidden="true"><Puzzle size={17} /></span>
        <span className="plugin-row-copy">
          <strong>{props.row.name}</strong>
          <span>{props.row.summary}</span>
        </span>
        <span className="plugin-row-meta">
          <span>{sourceKindLabel(props.row.sourceKind)}</span>
          <span>{props.row.version ?? "未声明版本"}</span>
          <span>{capabilityText(props.row)}</span>
        </span>
      </button>
      <button
        type="button"
        className="plugin-icon-btn plugin-favorite"
        aria-label={props.row.favorite ? `取消收藏 ${props.row.name}` : `收藏 ${props.row.name}`}
        title={props.row.favorite ? "取消收藏" : "收藏"}
        aria-pressed={props.row.favorite}
        onClick={() => { props.onFavorite(props.row.id); }}
      >
        <Star size={15} fill={props.row.favorite ? "currentColor" : "none"} aria-hidden="true" />
      </button>
      {props.row.installed === null && (
        <button
          type="button"
          className="plugin-row-action"
          aria-label={`安装 ${props.row.name}`}
          title={props.row.state === "name-conflict" ? "存在同名插件" : "安装"}
          disabled={disabled}
          onClick={() => { props.onInstall(props.row.id); }}
        >
          <Download size={15} aria-hidden="true" />
        </button>
      )}
    </article>
  );
}

export interface PluginDiscoverProps {
  readonly state: PluginsMarketplaceState;
  readonly rows: readonly PluginRowView[];
  readonly showShelves: boolean;
  readonly mutationBlocked: boolean;
}

export function PluginDiscover(props: PluginDiscoverProps): React.JSX.Element {
  const catalog = props.state.catalog;
  const entries = catalog.catalog?.entries ?? [];
  const stale = catalog.origin === "cache" || catalog.stale;
  const renderRow = (row: PluginRowView): React.JSX.Element => (
    <DiscoverRow
      key={row.id}
      row={row}
      onSelect={(id) => { props.state.select(id); }}
      onInstall={(id) => { void props.state.installPlugin(id, props.state.workspace === null ? "user" : "project"); }}
      onFavorite={props.state.toggleFavorite}
      mutationBlocked={props.mutationBlocked}
    />
  );

  if (props.state.catalogStatus === "loading" || props.state.catalogStatus === "idle") {
    return (
      <section className="plugin-discover" data-catalog-state="loading" aria-busy="true">
        {[0, 1, 2].map((index) => <div key={index} className="plugin-skeleton-row" />)}
      </section>
    );
  }
  if (props.state.catalogStatus === "error") {
    return (
      <section className="plugin-discover plugin-state-block" data-catalog-state="error" role="alert">
        <WifiOff size={20} aria-hidden="true" />
        <strong>插件目录读取失败</strong>
        <span>{props.state.catalogError}</span>
        <button type="button" className="plugin-secondary" onClick={props.state.refresh}>重试</button>
      </section>
    );
  }
  if (catalog.status !== "ready" || catalog.catalog === null) {
    return (
      <section className="plugin-discover" data-catalog-state="unavailable">
        <div className="plugin-state-block" role="status">
          <WifiOff size={20} aria-hidden="true" />
          <strong>插件目录不可用</strong>
          {catalog.note !== undefined && <span>{catalog.note}</span>}
          <button type="button" className="plugin-secondary" onClick={props.state.refresh}>重试</button>
        </div>
      </section>
    );
  }

  const shelfRows = new Map<string, readonly PluginRowView[]>();
  const consumed = new Set<string>();
  for (const shelf of catalog.catalog.shelves) {
    const rows = shelf.entryIds
      .map((id) => props.rows.find((row) => row.id === id))
      .filter((row): row is PluginRowView => row !== undefined);
    for (const row of rows) consumed.add(row.id);
    shelfRows.set(shelf.id, rows);
  }
  const remaining = props.rows.filter((row) => !consumed.has(row.id));

  return (
    <section className="plugin-discover" data-catalog-state={stale ? "stale" : "live"}>
      {stale && (
        <div className="plugin-cache-banner" role="status">
          <WifiOff size={15} aria-hidden="true" />
          <span>离线缓存</span>
          {catalog.fetchedAt !== null && <time dateTime={catalog.fetchedAt}>{new Date(catalog.fetchedAt).toLocaleString("zh-CN")}</time>}
        </div>
      )}
      {entries.length === 0 ? (
        <div className="plugin-state-block">
          <span>目录为空</span>
        </div>
      ) : props.rows.length === 0 ? (
        <div className="plugin-state-block">没有匹配的插件</div>
      ) : props.showShelves && catalog.catalog.shelves.length > 0 ? (
        <>
          {catalog.catalog.shelves.map((shelf) => {
            const rows = shelfRows.get(shelf.id) ?? [];
            if (rows.length === 0) return null;
            return (
              <section key={shelf.id} className="plugin-shelf" aria-labelledby={`plugin-shelf-${shelf.id}`}>
                <h2 id={`plugin-shelf-${shelf.id}`}>{shelf.title}</h2>
                <div className="plugin-shelf-rows">{rows.map(renderRow)}</div>
              </section>
            );
          })}
          {remaining.length > 0 && (
            <section className="plugin-shelf" aria-labelledby="plugin-shelf-more">
              <h2 id="plugin-shelf-more">全部插件</h2>
              <div className="plugin-shelf-rows">{remaining.map(renderRow)}</div>
            </section>
          )}
        </>
      ) : (
        <section className="plugin-shelf" aria-label={props.showShelves ? "全部插件" : "筛选结果"}>
          <div className="plugin-shelf-rows">{props.rows.map(renderRow)}</div>
        </section>
      )}
    </section>
  );
}
