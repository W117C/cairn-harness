import { useEffect } from "react";
import { AlertTriangle, CheckCircle2, LoaderCircle, RefreshCw } from "lucide-react";
import {
  filterPluginRows,
  type PluginCapabilityCategory,
  type PluginRowView,
} from "../../derived/plugins";
import {
  usePluginsMarketplace,
  type PluginsMarketplaceState,
} from "../../state/plugins-marketplace";
import { PAGE_CONTEXT_ITEMS } from "../../navigation";
import { PageFrame } from "../PageFrame";
import { PluginDetail } from "./PluginDetail";
import { PluginDiscover } from "./PluginDiscover";
import { PluginImportMenu } from "./PluginImportMenu";
import { PluginInstalled } from "./PluginInstalled";
import { PluginReview } from "./PluginReview";
import { PluginUpdates } from "./PluginUpdates";
import "./plugins.css";

const VIEW_FILTERS = new Set(["discover", "installed", "updates"]);
// 兼容入口（2026-11-02）：命令面板/持久化筛选仍可能送来旧的视图 id（如 `updates`）。
// 视图现在归页内标签条，但旧值不能静默失效 ⇒ 收到就落到页内同一份视图状态。
function normalizeView(id: string | undefined, current: "discover" | "installed" | "updates"): "discover" | "installed" | "updates" {
  return id !== undefined && VIEW_FILTERS.has(id) ? (id as "discover" | "installed" | "updates") : current;
}
const CATEGORY_FILTERS = new Set<PluginCapabilityCategory>([
  "skills",
  "commands",
  "agents",
  "hooks",
  "mcp",
  "lsp",
]);

const JOB_LABEL = {
  queued: "等待处理",
  resolving: "正在获取来源",
  verifying: "正在扫描与校验",
  review: "等待确认",
  installing: "正在写入",
  succeeded: "已完成",
  failed: "操作失败",
  cancelled: "已取消",
} as const;

export interface PluginsWorkspaceProps {
  readonly state: PluginsMarketplaceState;
  readonly className?: string;
  readonly activeFilter?: string;
  readonly onFilter?: (id: string) => void;
  readonly mutationBlocked?: boolean;
  /** 打开设置·技能中心（插件里的技能分类 ≠ 独立技能；后者要去技能中心管理）。 */
  readonly onOpenSkills?: () => void;
}

export function PluginsWorkspace(props: PluginsWorkspaceProps): React.JSX.Element {
  const { state } = props;
  const externalCategory = props.activeFilter !== undefined && CATEGORY_FILTERS.has(props.activeFilter as PluginCapabilityCategory)
    ? props.activeFilter as PluginCapabilityCategory
    : null;
  const effectiveCategory = props.activeFilter === "all" || props.activeFilter === "favorites"
    ? "all"
    : externalCategory ?? state.category;
  const favoriteOnly = props.activeFilter === undefined ? state.favoriteOnly : props.activeFilter === "favorites";
  // 2026-11-02：视图只由页内标签条决定 —— 页头筛选与左侧上下文栏都不再间接切视图
  // （此前三处入口互相改写同一个筛选值，用户点「已安装」后再点分类会被弹回发现页）。
  const effectiveView = normalizeView(props.activeFilter, state.view);
  // 分类筛选里没有视图项了：`all` = 全部能力，`favorites` = 精选。
  const activeFilter = props.activeFilter ?? (
    favoriteOnly ? "favorites" : effectiveCategory !== "all" ? effectiveCategory : "all"
  );
  const busy = state.activeJob !== null
    && state.activeJob.state !== "review"
    && state.activeJob.state !== "succeeded"
    && state.activeJob.state !== "failed"
    && state.activeJob.state !== "cancelled";
  const mutationBlocked = props.mutationBlocked === true || busy;
  const visibleRows = filterPluginRows(state.rows, state.query, effectiveCategory)
    .filter((row) => !favoriteOnly || row.favorite);
  const discoverRows = visibleRows.filter((row) => row.catalogEntry !== null);
  const selected = state.selectedId === null
    ? null
    : state.rows.find((row) => row.id === state.selectedId) ?? null;

  const selectFilter = (id: string): void => {
    props.onFilter?.(id);
    if (id === "all") {
      state.setFavoriteOnly(false);
      state.setCategory("all");
      return;
    }
    if (id === "favorites") {
      state.setFavoriteOnly(true);
      state.setCategory("all");
      return;
    }
    if (CATEGORY_FILTERS.has(id as PluginCapabilityCategory)) {
      state.setFavoriteOnly(false);
      state.setCategory(id as PluginCapabilityCategory);
    }
  };

  const closeDetail = (): void => { state.select(null); };

  return (
    <div className={`plugins-workspace${props.className === undefined ? "" : ` ${props.className}`}`} data-marketplace-view={effectiveView}>
      <PageFrame
        title="插件"
        actions={(
          <PluginImportMenu
            workspaceAvailable={state.workspace !== null}
            disabled={mutationBlocked}
            onImport={(request, scope) => state.importPlugin(request, scope)}
          />
        )}
        search={{ label: "搜索插件", value: state.query, onChange: state.setQuery }}
        onRefresh={state.refresh}
        filters={PAGE_CONTEXT_ITEMS.plugins}
        activeFilter={activeFilter}
        onFilter={selectFilter}
      >
        <nav className="plugin-tabs" aria-label="插件视图">
          {([
            ["discover", "发现"],
            ["installed", "已安装"],
            ["updates", `可更新${state.updates.length > 0 ? ` ${String(state.updates.length)}` : ""}`],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-current={effectiveView === id ? "page" : undefined}
              onClick={() => { state.setView(id); }}
            >
              {label}
            </button>
          ))}
          {props.onOpenSkills !== undefined && (
            <button
              type="button"
              className="plugin-tabs-link"
              onClick={props.onOpenSkills}
              title="管理独立技能（不随插件安装）"
            >
              技能中心…
            </button>
          )}
        </nav>

        {state.notice !== null && (
          <div className="plugin-notice" role="status">
            <span>{state.notice}</span>
            <button type="button" className="plugin-text-btn" onClick={state.dismissNotice}>关闭</button>
          </div>
        )}

        {state.installedStatus === "error" && (
          <div className="plugin-inline-state plugin-inline-error" role="alert">
            <AlertTriangle size={15} aria-hidden="true" />
            <span>已安装列表读取失败</span>
            {state.installedError !== null && <span className="plugin-muted">{state.installedError}</span>}
            <button type="button" className="plugin-text-btn" onClick={state.refresh}>重试</button>
          </div>
        )}
        {state.runtimeStatus === "error" && (
          <div className="plugin-inline-state" role="status">
            <AlertTriangle size={15} aria-hidden="true" />
            <span>运行时扫描不可用</span>
            {state.runtimeError !== null && <span className="plugin-muted">{state.runtimeError}</span>}
          </div>
        )}

        {state.activeJob !== null && state.review === null && (
          <div className="plugin-job" data-plugin-job-state={state.activeJob.state} role="status">
            {state.activeJob.state === "failed" ? <AlertTriangle size={15} aria-hidden="true" />
              : state.activeJob.state === "succeeded" ? <CheckCircle2 size={15} aria-hidden="true" />
                : <LoaderCircle className="plugin-spin" size={15} aria-hidden="true" />}
            <span>{JOB_LABEL[state.activeJob.state]}</span>
            {state.activeJob.error !== undefined && <span className="plugin-muted">{state.activeJob.error}</span>}
            {state.activeJob.state === "review" && (
              <button type="button" className="plugin-text-btn" onClick={state.reopenReview}>继续审查</button>
            )}
          </div>
        )}

        <div className="plugin-view-body">
          {effectiveView === "discover" && (
            <PluginDiscover
              state={state}
              rows={discoverRows}
              showShelves={state.query.trim() === "" && effectiveCategory === "all" && !favoriteOnly}
              mutationBlocked={mutationBlocked}
              busy={busy}
            />
          )}
          {effectiveView === "installed" && (
            <PluginInstalled
              state={state}
              rows={visibleRows}
              busy={busy}
              mutationBlocked={props.mutationBlocked === true}
            />
          )}
          {effectiveView === "updates" && (
            <PluginUpdates
              state={state}
              updates={state.updates}
              installedRows={state.rows.filter((row) => row.installed !== null)}
              busy={busy}
              mutationBlocked={props.mutationBlocked === true}
            />
          )}
        </div>
      </PageFrame>

      {state.review !== null ? (
        <PluginReview
          state={state.review}
          busy={props.mutationBlocked === true}
          onCommit={state.commitReview}
          onClose={state.closeReview}
          onCancel={state.cancelReview}
        />
      ) : selected !== null ? (
        <PluginDetail
          row={selected}
          mutationBlocked={mutationBlocked}
          onClose={closeDetail}
          onFavorite={() => { state.toggleFavorite(selected.id); }}
          onInstall={() => state.installPlugin(selected.id, state.workspace === null ? "user" : "project")}
          onUpdate={() => state.updatePlugin(selected)}
          onEnabled={(enabled) => state.setPluginEnabled(selected, enabled)}
          onUninstall={() => state.uninstallPlugin(selected)}
          onConfigure={(values) => state.configurePlugin(selected, values)}
          onImportLocal={(sourcePath) => { void state.importPlugin({ kind: "local", sourcePath }, state.workspace === null ? "user" : "project"); }}
        />
      ) : null}
    </div>
  );
}

export function PluginsDestination(props: {
  readonly workspace: string | null;
  readonly onError: (message: string) => void;
  readonly filter?: string;
  readonly onFilter?: (id: string) => void;
  readonly onUpdateCount?: (count: number) => void;
  readonly mutationBlocked?: boolean;
  readonly className?: string;
  readonly onOpenSkills?: () => void;
}): React.JSX.Element {
  const state = usePluginsMarketplace({ workspace: props.workspace, onError: props.onError });
  useEffect(() => {
    props.onUpdateCount?.(state.updates.length);
  }, [props.onUpdateCount, state.updates.length]);
  return (
    <PluginsWorkspace
      state={state}
      {...(props.filter !== undefined ? { activeFilter: props.filter } : {})}
      {...(props.onFilter !== undefined ? { onFilter: props.onFilter } : {})}
      {...(props.mutationBlocked !== undefined ? { mutationBlocked: props.mutationBlocked } : {})}
      {...(props.className !== undefined ? { className: props.className } : {})}
      {...(props.onOpenSkills !== undefined ? { onOpenSkills: props.onOpenSkills } : {})}
    />
  );
}
