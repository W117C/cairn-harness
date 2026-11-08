import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from "react";
import type { PluginPanelSnapshot } from "../../../../../src/agent/plugins";
import type {
  InstalledPluginRecord,
  MarketplaceCatalogReadout,
  PluginImportRequest,
  PluginInstallJob,
  PluginInstallReview,
  PluginInstallScope,
  PluginUpdateCheck,
} from "../../../../../src/main/ipc-protocol";
import {
  filterPluginRows,
  loadPluginFavorites,
  mergePluginRows,
  pluginUpdateCheckKey,
  pluginUpdateRows,
  savePluginFavorites,
  type PluginCapabilityCategory,
  type PluginFavoriteStorage,
  type PluginRowView,
  type PluginUpdateRow,
  type PluginView,
} from "../derived/plugins";

export type PluginDataStatus = "idle" | "loading" | "ready" | "error";
export type PluginLoadSurface = "catalog" | "installed" | "runtime";
export type PluginJobKind = "install" | "import" | "update";

export interface ScopedPluginReview {
  readonly review: PluginInstallReview;
  readonly jobId: string;
  readonly kind: PluginJobKind;
  readonly workspace: string | null;
  readonly instanceId: string;
}

export interface PluginsMarketplaceSnapshot {
  readonly workspace: string | null;
  readonly generation: number;
  readonly catalogGeneration: number;
  readonly installedGeneration: number;
  readonly runtimeGeneration: number;
  readonly catalog: MarketplaceCatalogReadout;
  readonly catalogStatus: PluginDataStatus;
  readonly catalogError: string | null;
  readonly installed: readonly InstalledPluginRecord[];
  readonly installedStatus: PluginDataStatus;
  readonly installedError: string | null;
  readonly runtime: PluginPanelSnapshot | null;
  readonly runtimeStatus: PluginDataStatus;
  readonly runtimeError: string | null;
  readonly review: ScopedPluginReview | null;
  readonly activeJob: PluginInstallJob | null;
  readonly activeJobKind: PluginJobKind | null;
  readonly updateChecks: Readonly<Record<string, PluginUpdateCheck>>;
  readonly favorites: ReadonlySet<string>;
  readonly notice: string | null;
  readonly view: PluginView;
  readonly query: string;
  readonly category: PluginCapabilityCategory | "all";
  readonly favoriteOnly: boolean;
  readonly selectedId: string | null;
  readonly scrollTop: number;
}

export type PluginsMarketplaceAction =
  | { type: "start"; surface: PluginLoadSurface; generation: number }
  | { type: "catalog"; generation: number; value: MarketplaceCatalogReadout }
  | { type: "installed"; generation: number; value: readonly InstalledPluginRecord[] }
  | { type: "runtime"; generation: number; value: PluginPanelSnapshot | null }
  | { type: "reject"; surface: PluginLoadSurface; generation: number; message: string }
  | { type: "workspace"; workspace: string | null }
  | {
      type: "review";
      review: PluginInstallReview;
      jobId: string;
      workspace: string | null;
      kind?: PluginJobKind;
      instanceId?: string;
    }
  | { type: "reviewClose"; notice?: string | null }
  | { type: "jobStart"; job: PluginInstallJob; kind: PluginJobKind }
  | { type: "job"; job: PluginInstallJob }
  | { type: "jobClear" }
  | { type: "updateCheck"; key: string; check: PluginUpdateCheck }
  | { type: "updateChecksClear" }
  | { type: "favorites"; ids: ReadonlySet<string> }
  | { type: "notice"; message: string | null }
  | { type: "view"; view: PluginView }
  | { type: "query"; query: string }
  | { type: "category"; category: PluginCapabilityCategory | "all" }
  | { type: "favoriteOnly"; value: boolean }
  | { type: "selection"; id: string | null }
  | { type: "scroll"; top: number };

const EMPTY_CATALOG: MarketplaceCatalogReadout = {
  status: "unavailable",
  origin: "none",
  catalog: null,
  fetchedAt: null,
  expiresAt: null,
  stale: false,
};

function generationOf(surface: PluginLoadSurface, state: PluginsMarketplaceSnapshot): number {
  if (surface === "catalog") return state.catalogGeneration;
  if (surface === "installed") return state.installedGeneration;
  return state.runtimeGeneration;
}

function withGeneration(
  state: PluginsMarketplaceSnapshot,
  action:
    | Extract<PluginsMarketplaceAction, { type: "start" }>
    | Extract<PluginsMarketplaceAction, { type: "catalog" }>
    | Extract<PluginsMarketplaceAction, { type: "installed" }>
    | Extract<PluginsMarketplaceAction, { type: "runtime" }>
    | Extract<PluginsMarketplaceAction, { type: "reject" }>,
): PluginsMarketplaceSnapshot {
  if (action.type === "catalog") {
    if (action.generation < state.catalogGeneration) return state;
    return {
      ...state,
      generation: Math.max(state.generation, action.generation),
      catalogGeneration: action.generation,
      catalogStatus: "ready",
      catalogError: null,
      catalog: action.value,
    };
  }
  if (action.type === "installed") {
    if (action.generation < state.installedGeneration) return state;
    return {
      ...state,
      generation: Math.max(state.generation, action.generation),
      installedGeneration: action.generation,
      installedStatus: "ready",
      installedError: null,
      installed: action.value,
      updateChecks: {},
    };
  }
  if (action.type === "runtime") {
    if (action.generation < state.runtimeGeneration) return state;
    return {
      ...state,
      generation: Math.max(state.generation, action.generation),
      runtimeGeneration: action.generation,
      runtimeStatus: "ready",
      runtimeError: null,
      runtime: action.value,
    };
  }
  if (action.generation < generationOf(action.surface, state)) return state;
  const common = {
    ...state,
    generation: Math.max(state.generation, action.generation),
  };
  if (action.surface === "catalog") {
    return action.type === "start"
      ? { ...common, catalogGeneration: action.generation, catalogStatus: "loading", catalogError: null }
      : { ...common, catalogGeneration: action.generation, catalogStatus: "error", catalogError: action.message };
  }
  if (action.surface === "installed") {
    return action.type === "start"
      ? { ...common, installedGeneration: action.generation, installedStatus: "loading", installedError: null }
      : { ...common, installedGeneration: action.generation, installedStatus: "error", installedError: action.message };
  }
  return action.type === "start"
    ? { ...common, runtimeGeneration: action.generation, runtimeStatus: "loading", runtimeError: null }
    : { ...common, runtimeGeneration: action.generation, runtimeStatus: "error", runtimeError: action.message };
}

export function createPluginsMarketplaceSnapshot(input: {
  workspace?: string | null;
  favorites?: ReadonlySet<string>;
} = {}): PluginsMarketplaceSnapshot {
  return {
    workspace: input.workspace ?? null,
    generation: 0,
    catalogGeneration: 0,
    installedGeneration: 0,
    runtimeGeneration: 0,
    catalog: EMPTY_CATALOG,
    catalogStatus: "loading",
    catalogError: null,
    installed: [],
    installedStatus: "loading",
    installedError: null,
    runtime: null,
    runtimeStatus: "loading",
    runtimeError: null,
    review: null,
    activeJob: null,
    activeJobKind: null,
    updateChecks: {},
    favorites: input.favorites ?? new Set(),
    notice: null,
    view: "discover",
    query: "",
    category: "all",
    favoriteOnly: false,
    selectedId: null,
    scrollTop: 0,
  };
}

export function pluginsMarketplaceReducer(
  state: PluginsMarketplaceSnapshot,
  action: PluginsMarketplaceAction,
): PluginsMarketplaceSnapshot {
  if (action.type === "start" || action.type === "catalog" || action.type === "installed"
    || action.type === "runtime" || action.type === "reject") {
    return withGeneration(state, action);
  }
  if (action.type === "workspace") {
    if (action.workspace === state.workspace) return state;
    return {
      ...state,
      workspace: action.workspace,
      installed: [],
      installedStatus: "loading",
      installedError: null,
      runtime: null,
      runtimeStatus: "loading",
      runtimeError: null,
      review: null,
      activeJob: null,
      activeJobKind: null,
      updateChecks: {},
      selectedId: null,
      scrollTop: 0,
      notice: state.review === null
        ? "工作区已切换，插件列表已刷新"
        : "工作区已切换，未提交的插件审查已关闭",
    };
  }
  if (action.type === "review") {
    if (action.workspace !== state.workspace) {
      return {
        ...state,
        review: null,
        notice: "工作区已变化，插件审查已关闭",
      };
    }
    const instanceId = action.instanceId ?? action.jobId;
    if (state.review !== null && state.review.instanceId !== instanceId) return state;
    return {
      ...state,
      notice: null,
      review: {
        review: action.review,
        jobId: action.jobId,
        kind: action.kind ?? "install",
        workspace: action.workspace,
        instanceId,
      },
    };
  }
  if (action.type === "reviewClose") {
    return {
      ...state,
      review: null,
      ...(action.notice === undefined ? {} : { notice: action.notice }),
    };
  }
  if (action.type === "jobStart") {
    return {
      ...state,
      activeJob: action.job,
      activeJobKind: action.kind,
      review: null,
      notice: null,
    };
  }
  if (action.type === "job") {
    if (state.activeJob !== null && state.activeJob.id !== action.job.id) return state;
    return {
      ...state,
      activeJob: action.job,
      review: action.job.state === "succeeded" || action.job.state === "cancelled"
        ? null
        : state.review,
    };
  }
  if (action.type === "jobClear") {
    return {
      ...state,
      activeJob: null,
      activeJobKind: null,
      review: null,
    };
  }
  if (action.type === "updateCheck") {
    return {
      ...state,
      updateChecks: { ...state.updateChecks, [action.key]: action.check },
    };
  }
  if (action.type === "updateChecksClear") return { ...state, updateChecks: {} };
  if (action.type === "favorites") return { ...state, favorites: action.ids };
  if (action.type === "notice") return { ...state, notice: action.message };
  if (action.type === "view") return { ...state, view: action.view };
  if (action.type === "query") return { ...state, query: action.query };
  if (action.type === "category") return { ...state, category: action.category };
  if (action.type === "favoriteOnly") return { ...state, favoriteOnly: action.value };
  if (action.type === "selection") return { ...state, selectedId: action.id };
  return { ...state, scrollTop: Math.max(0, action.top) };
}

export function pluginJobNeedsPolling(job: PluginInstallJob): boolean {
  return job.state === "queued"
    || job.state === "resolving"
    || job.state === "verifying"
    || job.state === "installing";
}

function browserFavorites(): PluginFavoriteStorage {
  if (typeof window === "undefined") {
    return { getItem: () => null, setItem: () => undefined };
  }
  return window.localStorage;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

export interface PluginsMarketplaceState extends PluginsMarketplaceSnapshot {
  readonly rows: readonly PluginRowView[];
  readonly updates: readonly PluginUpdateRow[];
  readonly visibleRows: readonly PluginRowView[];
  refresh(): void;
  installPlugin(entryId: string, scope: PluginInstallScope): Promise<void>;
  importPlugin(request: PluginImportRequest, scope: PluginInstallScope): Promise<void>;
  checkPluginUpdate(row: PluginRowView): Promise<void>;
  updatePlugin(row: PluginRowView): Promise<void>;
  setPluginEnabled(row: PluginRowView, enabled: boolean): Promise<void>;
  uninstallPlugin(row: PluginRowView): Promise<void>;
  configurePlugin(row: PluginRowView, values: Record<string, string>): Promise<void>;
  toggleFavorite(id: string): void;
  commitReview(): Promise<void>;
  closeReview(): void;
  reopenReview(): void;
  cancelReview(): Promise<void>;
  dismissNotice(): void;
  setView(view: PluginView): void;
  setQuery(query: string): void;
  setCategory(category: PluginCapabilityCategory | "all"): void;
  setFavoriteOnly(value: boolean): void;
  select(id: string | null): void;
  setScrollTop(top: number): void;
}

export function usePluginsMarketplace(input: {
  workspace: string | null;
  onError(message: string): void;
}): PluginsMarketplaceState {
  const storage = useRef<PluginFavoriteStorage | null>(null);
  if (storage.current === null) storage.current = browserFavorites();
  const initialFavorites = useRef<ReadonlySet<string> | null>(null);
  if (initialFavorites.current === null) {
    initialFavorites.current = loadPluginFavorites(storage.current);
  }
  const [state, dispatch] = useReducer(
    pluginsMarketplaceReducer,
    undefined,
    () => createPluginsMarketplaceSnapshot({
      workspace: input.workspace,
      favorites: initialFavorites.current as ReadonlySet<string>,
    }),
  );
  const stateRef = useRef(state);
  stateRef.current = state;
  const errorHandler = useRef(input.onError);
  errorHandler.current = input.onError;
  const workspaceRef = useRef(input.workspace);
  const generations = useRef({ catalog: 0, installed: 0, runtime: 0 });
  const jobPoll = useRef(0);

  const report = useCallback((message: string): void => {
    dispatch({ type: "notice", message });
    errorHandler.current(message);
  }, []);

  const loadCatalog = useCallback((): void => {
    const generation = ++generations.current.catalog;
    dispatch({ type: "start", surface: "catalog", generation });
    void window.agent.marketplaceCatalog("auto").then((value) => {
      dispatch({ type: "catalog", generation, value });
    }).catch((error: unknown) => {
      dispatch({ type: "reject", surface: "catalog", generation, message: errorText(error) });
    });
  }, []);

  const loadInstalled = useCallback((): void => {
    const generation = ++generations.current.installed;
    dispatch({ type: "start", surface: "installed", generation });
    void window.agent.pluginsInstalled().then((value) => {
      dispatch({ type: "installed", generation, value });
    }).catch((error: unknown) => {
      dispatch({ type: "reject", surface: "installed", generation, message: errorText(error) });
    });
  }, []);

  const loadRuntime = useCallback((): void => {
    const generation = ++generations.current.runtime;
    dispatch({ type: "start", surface: "runtime", generation });
    void window.agent.getState().then((snapshot) => {
      dispatch({ type: "runtime", generation, value: snapshot.plugins ?? null });
    }).catch((error: unknown) => {
      dispatch({ type: "reject", surface: "runtime", generation, message: errorText(error) });
    });
  }, []);

  const refresh = useCallback((): void => {
    loadCatalog();
    loadInstalled();
    loadRuntime();
  }, [loadCatalog, loadInstalled, loadRuntime]);

  const pollJob = useCallback(async (
    jobId: string,
    run: number,
    kind: PluginJobKind,
    workspace: string | null,
  ): Promise<void> => {
    while (run === jobPoll.current) {
      const current = await window.agent.marketplacePluginInstallStatus(jobId).catch((error: unknown) => {
        if (run === jobPoll.current) report(`插件任务状态读取失败：${errorText(error)}`);
        return null;
      });
      if (run !== jobPoll.current) return;
      if (current === null) {
        report("插件任务已不存在");
        return;
      }
      dispatch({ type: "job", job: current });
      if (current.state === "review" && current.review !== undefined) {
        dispatch({
          type: "review",
          review: current.review,
          jobId: current.id,
          workspace,
          kind,
          instanceId: `${current.id}:${String(run)}`,
        });
        return;
      }
      if (!pluginJobNeedsPolling(current)) return;
      await wait(300);
    }
  }, [report]);

  const beginJob = useCallback(async (
    pending: Promise<PluginInstallJob>,
    kind: PluginJobKind,
  ): Promise<void> => {
    const workspace = stateRef.current.workspace;
    try {
      const job = await pending;
      const run = ++jobPoll.current;
      dispatch({ type: "jobStart", job, kind });
      await pollJob(job.id, run, kind, workspace);
    } catch (error) {
      report(`插件任务启动失败：${errorText(error)}`);
    }
  }, [pollJob, report]);

  useEffect(() => {
    const previous = workspaceRef.current;
    const previousState = stateRef.current;
    const scopedReview = previousState.review;
    const activeJob = previousState.activeJob;
    if (previous !== input.workspace) {
      jobPoll.current += 1;
      dispatch({ type: "workspace", workspace: input.workspace });
      const cancelId = scopedReview?.jobId
        ?? (activeJob?.scope === "project" && activeJob.workspace !== input.workspace ? activeJob.id : null);
      if (cancelId !== null) {
        void window.agent.marketplacePluginInstallCancel(cancelId).catch((error: unknown) => {
          report(`旧工作区插件任务取消失败：${errorText(error)}`);
        });
      }
      workspaceRef.current = input.workspace;
    }
    refresh();
  }, [input.workspace, refresh, report]);

  const rows = useMemo(
    () => mergePluginRows(state.catalog, state.installed, state.runtime, state.favorites),
    [state.catalog, state.favorites, state.installed, state.runtime],
  );
  const updates = useMemo(
    () => pluginUpdateRows(rows, state.updateChecks),
    [rows, state.updateChecks],
  );
  const visibleRows = useMemo(() => {
    const filtered = filterPluginRows(rows, state.query, state.category);
    return state.favoriteOnly ? filtered.filter((row) => row.favorite) : filtered;
  }, [rows, state.category, state.favoriteOnly, state.query]);

  const toggleFavorite = useCallback((id: string): void => {
    const next = new Set(stateRef.current.favorites);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    dispatch({ type: "favorites", ids: next });
    savePluginFavorites(storage.current as PluginFavoriteStorage, next);
  }, []);

  const installPlugin = useCallback(async (
    entryId: string,
    scope: PluginInstallScope,
  ): Promise<void> => {
    const workspace = scope === "project" ? stateRef.current.workspace ?? undefined : undefined;
    await beginJob(window.agent.marketplacePluginInstall(entryId, scope, workspace), "install");
  }, [beginJob]);

  const importPlugin = useCallback(async (
    request: PluginImportRequest,
    scope: PluginInstallScope,
  ): Promise<void> => {
    const workspace = scope === "project" ? stateRef.current.workspace ?? undefined : undefined;
    await beginJob(window.agent.marketplacePluginImport(request, scope, workspace), "import");
  }, [beginJob]);

  const checkPluginUpdate = useCallback(async (row: PluginRowView): Promise<void> => {
    const installed = row.installed;
    if (installed === null) return;
    const key = pluginUpdateCheckKey(installed.source);
    dispatch({
      type: "updateCheck",
      key,
      check: {
        status: "checking",
        currentVersion: installed.version,
        nextVersion: null,
        sourceKind: installed.source.kind,
      },
    });
    try {
      const check = await window.agent.marketplacePluginCheckUpdate(
        installed.entryId,
        installed.scope,
        installed.scope === "project" ? installed.workspace ?? stateRef.current.workspace ?? undefined : undefined,
      );
      dispatch({ type: "updateCheck", key, check });
    } catch (error) {
      dispatch({
        type: "updateCheck",
        key,
        check: {
          status: "failed",
          currentVersion: installed.version,
          nextVersion: null,
          sourceKind: installed.source.kind,
          detail: errorText(error),
        },
      });
    }
  }, []);

  const updatePlugin = useCallback(async (row: PluginRowView): Promise<void> => {
    const installed = row.installed;
    if (installed === null) return;
    await beginJob(
      window.agent.marketplacePluginUpdate(
        installed.entryId,
        installed.scope,
        installed.scope === "project" ? installed.workspace ?? stateRef.current.workspace ?? undefined : undefined,
      ),
      "update",
    );
  }, [beginJob]);

  const setPluginEnabled = useCallback(async (
    row: PluginRowView,
    enabled: boolean,
  ): Promise<void> => {
    const installed = row.installed;
    if (installed === null) return;
    try {
      const result = await window.agent.pluginSetEnabled(
        installed.entryId,
        installed.scope,
        enabled,
        installed.scope === "project" ? installed.workspace ?? stateRef.current.workspace ?? undefined : undefined,
      );
      if (!result.ok) {
        report(result.error ?? "插件状态切换失败");
        return;
      }
      dispatch({ type: "notice", message: enabled ? "插件已启用，将在下一轮生效" : "插件已停用，将在下一轮生效" });
      loadInstalled();
    } catch (error) {
      report(`插件状态切换失败：${errorText(error)}`);
    }
  }, [loadInstalled, report]);

  const uninstallPlugin = useCallback(async (row: PluginRowView): Promise<void> => {
    const installed = row.installed;
    if (installed === null) return;
    try {
      const result = await window.agent.pluginUninstall(
        installed.entryId,
        installed.scope,
        installed.scope === "project" ? installed.workspace ?? stateRef.current.workspace ?? undefined : undefined,
      );
      if (!result.ok) {
        report(result.error ?? "插件卸载失败");
        return;
      }
      dispatch({ type: "notice", message: "插件已卸载" });
      dispatch({ type: "selection", id: null });
      loadInstalled();
      loadRuntime();
    } catch (error) {
      report(`插件卸载失败：${errorText(error)}`);
    }
  }, [loadInstalled, loadRuntime, report]);

  const configurePlugin = useCallback(async (
    row: PluginRowView,
    values: Record<string, string>,
  ): Promise<void> => {
    const installed = row.installed;
    if (installed === null) return;
    try {
      const result = await window.agent.pluginConfigureInstalled({
        entryId: installed.entryId,
        scope: installed.scope,
        ...(installed.scope === "project"
          ? { workspace: installed.workspace ?? stateRef.current.workspace ?? undefined }
          : {}),
        values,
      });
      if (!result.ok) {
        report(result.error ?? "插件配置保存失败");
        return;
      }
      dispatch({ type: "notice", message: "插件配置已保存" });
    } catch (error) {
      report(`插件配置保存失败：${errorText(error)}`);
    }
  }, [report]);

  const commitReview = useCallback(async (): Promise<void> => {
    const scoped = stateRef.current.review;
    if (scoped === null) return;
    try {
      const result = await window.agent.marketplacePluginInstallCommit(scoped.jobId);
      if (!result.ok) {
        report(result.error ?? "插件提交失败");
        return;
      }
      const current = await window.agent.marketplacePluginInstallStatus(scoped.jobId);
      if (current !== null) dispatch({ type: "job", job: current });
      dispatch({ type: "reviewClose", notice: scoped.kind === "update" ? "插件已更新，请确认后启用" : "插件已安装，请确认后启用" });
      loadInstalled();
      loadRuntime();
    } catch (error) {
      report(`插件提交失败：${errorText(error)}`);
    }
  }, [loadInstalled, loadRuntime, report]);

  const cancelReview = useCallback(async (): Promise<void> => {
    const scoped = stateRef.current.review;
    if (scoped === null) return;
    try {
      const result = await window.agent.marketplacePluginInstallCancel(scoped.jobId);
      if (!result.ok) {
        report(result.error ?? "插件审查取消失败");
        return;
      }
      dispatch({ type: "jobClear" });
      dispatch({ type: "notice", message: "插件审查已取消" });
    } catch (error) {
      report(`插件审查取消失败：${errorText(error)}`);
    }
  }, [report]);

  const closeReview = useCallback((): void => {
    if (stateRef.current.review === null) return;
    dispatch({ type: "reviewClose", notice: "插件审查已收起，可继续审查" });
  }, []);

  const reopenReview = useCallback((): void => {
    const { activeJob, activeJobKind, workspace } = stateRef.current;
    if (activeJob?.state !== "review" || activeJob.review === undefined || activeJobKind === null) return;
    dispatch({
      type: "review",
      review: activeJob.review,
      jobId: activeJob.id,
      workspace,
      kind: activeJobKind,
      instanceId: `${activeJob.id}:${String(jobPoll.current)}`,
    });
  }, []);

  return {
    ...state,
    rows,
    updates,
    visibleRows,
    refresh,
    installPlugin,
    importPlugin,
    checkPluginUpdate,
    updatePlugin,
    setPluginEnabled,
    uninstallPlugin,
    configurePlugin,
    toggleFavorite,
    commitReview,
    closeReview,
    reopenReview,
    cancelReview,
    dismissNotice: () => { dispatch({ type: "notice", message: null }); },
    setView: (view) => { dispatch({ type: "view", view }); },
    setQuery: (query) => { dispatch({ type: "query", query }); },
    setCategory: (category) => { dispatch({ type: "category", category }); },
    setFavoriteOnly: (value) => { dispatch({ type: "favoriteOnly", value }); },
    select: (id) => { dispatch({ type: "selection", id }); },
    setScrollTop: (top) => { dispatch({ type: "scroll", top }); },
  };
}
