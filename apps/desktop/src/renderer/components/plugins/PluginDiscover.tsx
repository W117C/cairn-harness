// 插件发现（2026-11-05 业主裁：市场对齐开源 ZCode 的 PluginStoreCard 语言）：
// 双列卡片网格：40px 能力方块 + 名称/版本/来源徽标 + 单行描述 + 能力行；
// 未安装 → 「安装」胶囊钮（忙时转圈）；已安装 → 启停 Switch + 悬停露出的卸载（走确认弹窗）。
// 收藏保留（ZCode 没有此物，Cairn 既有功能不丢），同样悬停露出。
// 判卷锚不动：data-catalog-state / data-plugin-row="discover" / data-plugin-id。
import { AlertTriangle, Download, Loader2, Puzzle, Star, Trash2, WifiOff } from "lucide-react";
import { useMemo, useState } from "react";
import type { PluginRowView } from "../../derived/plugins";
import type { PluginsMarketplaceState } from "../../state/plugins-marketplace";
import { ConfirmDialog } from "../ConfirmDialog";
import { Switch } from "../Switch";
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
  onUninstall: (row: PluginRowView) => void;
  onToggle: (row: PluginRowView, enabled: boolean) => void;
  busy: boolean;
  mutationBlocked: boolean;
}): React.JSX.Element {
  const row = props.row;
  const disabled = props.busy || props.mutationBlocked || row.state === "name-conflict" || row.state === "unmanaged";
  const installed = row.installed !== null;
  const enabled = row.installed?.enabled === true;
  return (
    <article className="plugin-store-card" data-plugin-row="discover" data-plugin-id={row.id}>
      <button type="button" className="plugin-store-main" onClick={() => { props.onSelect(row.id); }}>
        <span className="plugin-mark lg" aria-hidden="true"><Puzzle size={20} /></span>
        <span className="plugin-store-copy">
          <span className="plugin-store-title">
            <strong>{row.name}</strong>
            {row.version !== null && <span className="plugin-pill">{row.version}</span>}
            <span className="plugin-pill subtle">{sourceKindLabel(row.sourceKind)}</span>
          </span>
          <span className="plugin-store-desc">{row.summary}</span>
          <span className="plugin-store-meta">{capabilityText(row)}</span>
        </span>
      </button>
      <div className="plugin-store-actions">
        <button
          type="button"
          className="plugin-icon-btn plugin-hover-act"
          aria-label={row.favorite ? `取消收藏 ${row.name}` : `收藏 ${row.name}`}
          title={row.favorite ? "取消收藏" : "收藏"}
          aria-pressed={row.favorite}
          onClick={() => { props.onFavorite(row.id); }}
        >
          <Star size={14} fill={row.favorite ? "currentColor" : "none"} aria-hidden="true" />
        </button>
        {installed ? (
          <>
            <Switch
              checked={enabled}
              busy={props.busy}
              disabled={props.mutationBlocked || row.state === "name-conflict" || row.state === "unmanaged"}
              label={`启用 ${row.name}`}
              onChange={(next) => { props.onToggle(row, next); }}
            />
            <button
              type="button"
              className="plugin-icon-btn plugin-danger plugin-hover-act"
              aria-label={`卸载 ${row.name}`}
              title="卸载"
              disabled={disabled}
              onClick={() => { props.onUninstall(row); }}
            >
              <Trash2 size={14} aria-hidden="true" />
            </button>
          </>
        ) : (
          <button
            type="button"
            className="plugin-pill-btn"
            aria-label={`安装 ${row.name}`}
            title={row.state === "name-conflict" ? "存在同名插件" : "安装"}
            disabled={disabled}
            onClick={() => { props.onInstall(row.id); }}
          >
            {props.busy ? <Loader2 size={13} className="spin" aria-hidden="true" /> : <Download size={13} aria-hidden="true" />}
            安装
          </button>
        )}
      </div>
    </article>
  );
}

export interface PluginDiscoverProps {
  readonly state: PluginsMarketplaceState;
  readonly rows: readonly PluginRowView[];
  readonly showShelves: boolean;
  readonly mutationBlocked: boolean;
  /** 有作业在跑（ZCode StoreCard 的 spinner/禁用口径）。 */
  readonly busy?: boolean;
}

export function PluginDiscover(props: PluginDiscoverProps): React.JSX.Element {
  const catalog = props.state.catalog;
  const entries = catalog.catalog?.entries ?? [];
  const stale = catalog.origin === "cache" || catalog.stale;
  // React #310 防回归（2026-11-13）：hooks 必须先于下面三个条件早退——loading→ready 翻转时
  // hooks 数量曾变过，真实 app 插件屏整屏崩进错误边界（design-audit 23-plugins 起 15 miss/13 dup）。
  // 判据：plugin-discover-index 的源序钉。
  const [uninstall, setUninstall] = useState<PluginRowView | null>(null);
  const catalogData = catalog.catalog;
  const rowById = useMemo(() => new Map(props.rows.map((row) => [row.id, row] as const)), [props.rows]);
  const { shelfRows, remaining } = useMemo(() => {
    const shelfRows = new Map<string, readonly PluginRowView[]>();
    const consumed = new Set<string>();
    for (const shelf of catalogData?.shelves ?? []) {
      const rows = shelf.entryIds
        .map((id) => rowById.get(id))
        .filter((row): row is PluginRowView => row !== undefined);
      for (const row of rows) consumed.add(row.id);
      shelfRows.set(shelf.id, rows);
    }
    return { shelfRows, remaining: props.rows.filter((row) => !consumed.has(row.id)) };
  }, [catalogData, rowById, props.rows]);
  const renderRow = (row: PluginRowView): React.JSX.Element => (
    <DiscoverRow
      key={row.id}
      row={row}
      onSelect={(id) => { props.state.select(id); }}
      onInstall={(id) => { void props.state.installPlugin(id, props.state.workspace === null ? "user" : "project"); }}
      onFavorite={props.state.toggleFavorite}
      onUninstall={setUninstall}
      onToggle={(row, next) => { void props.state.setPluginEnabled(row, next); }}
      busy={props.busy === true}
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

  // 第 1105/1159 页的 shelf 索引逻辑已整体上移到 hooks 区（React #310 修复，见组件顶部注释）。
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
          <strong>目录为空</strong>
          <span>先导入本地插件，或换一个有目录的源；安装后能力会列在这里。</span>
        </div>
      ) : props.rows.length === 0 ? (
        <div className="plugin-state-block">
          <strong>没有匹配的插件</strong>
          <span>清空搜索或切回「全部能力」再看看。</span>
        </div>
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
