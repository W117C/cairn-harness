import { app, dialog } from "electron";
import { realpath, stat } from "node:fs/promises";
import { join } from "node:path";
import { handlePluginDecide } from "../../../../src/main/agent-runner";
import {
  currentPluginRuntime,
  TrustStore,
  trustFilePathOf,
  userPluginsDirOf,
} from "../../../../src/agent/plugins";
import {
  loadPluginMarketplaceCatalog,
  marketplaceSourceConfigFromEnv,
  type MarketplaceCatalogReadout,
} from "../../../../src/main/plugin-marketplace-store";
import { PluginInstallJobManager } from "../../../../src/main/plugin-install-jobs";
import {
  InstalledPluginRegistry,
  type InstalledPluginRecord,
  type PluginInstallScope,
} from "../../../../src/main/plugin-install-registry";
import {
  configureInstalledPlugin,
  setPluginEnabled,
  uninstallPlugin,
} from "../../../../src/main/plugin-install-operations";
import { authorizeLocalPluginSource } from "../../../../src/main/plugin-local-stage";
import {
  parsePluginImportRequest,
  type PluginImportRequest,
  type PluginSource,
} from "../../../../src/main/plugin-source";
import { checkPluginUpdate } from "../../../../src/main/plugin-update-check";
import type { InvokeChannel } from "./channels";
import { canonicalWorkspacePath } from "./kernel-host";
import { resolveProvidedWorkspace } from "./project-path-gate";

type MarketplaceRefresh = "never" | "auto" | "force";

interface InstalledPluginOperation {
  readonly record: InstalledPluginRecord;
  readonly scope: PluginInstallScope;
  readonly workspace: string | null;
}

function pluginInstallScope(value: unknown): PluginInstallScope {
  if (value === "user" || value === "project") return value;
  throw new Error(`插件安装作用域不合法：${String(value)}`);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface PluginIpcDeps {
  readonly userData: string;
  readonly pluginDataRoot: string;
  readonly isRunning: () => boolean;
  readonly knownProjectRoots: () => Promise<string[]>;
  readonly workspaceContext: () => string | null;
}

type PluginChannelKeys =
  | "pluginDecide"
  | "pluginUserConfigSet"
  | "marketplaceCatalog"
  | "marketplacePluginInstall"
  | "pluginPickLocalSource"
  | "marketplacePluginInstallStatus"
  | "marketplacePluginInstallCommit"
  | "marketplacePluginInstallCancel"
  | "pluginSetEnabled"
  | "pluginUninstall"
  | "marketplacePluginImport"
  | "marketplacePluginUpdate"
  | "marketplacePluginCheckUpdate"
  | "pluginConfigureInstalled"
  | "pluginsInstalled";

export function createPluginIpcHandlers(deps: PluginIpcDeps): Pick<
  Record<InvokeChannel, (...args: unknown[]) => unknown>,
  PluginChannelKeys
> & { readonly pluginInstallJobs: PluginInstallJobManager } {
  const { userData, pluginDataRoot, isRunning, knownProjectRoots, workspaceContext } = deps;
  const effectiveUserPluginsDir = process.env.M2E_USER_PLUGINS || userPluginsDirOf(pluginDataRoot);
  const effectivePluginTrustFile = process.env.M2E_TRUST_FILE || trustFilePathOf({ pluginDataRoot });
  const pluginInstallRegistry = new InstalledPluginRegistry(join(pluginDataRoot, "installed.json"));
  const pluginTrust = new TrustStore(effectivePluginTrustFile);

  async function assertPluginMutationIdle(): Promise<void> {
    if (isRunning()) {
      throw new Error("有会话正在运行；请结束当前会话后再更改插件");
    }
  }

  const pluginInstallJobs = new PluginInstallJobManager({
    pluginDataRoot,
    userPluginsDir: effectiveUserPluginsDir,
    registry: pluginInstallRegistry,
    currentAppVersion: app.getVersion(),
    beforeCommit: assertPluginMutationIdle,
  });

  async function loadDesktopMarketplaceCatalog(refresh: MarketplaceRefresh): Promise<MarketplaceCatalogReadout> {
    return await loadPluginMarketplaceCatalog(
      { refresh },
      marketplaceSourceConfigFromEnv(process.env),
      { dir: join(userData, "plugin-marketplace") },
    );
  }

  async function resolvePluginOperationWorkspace(
    scope: PluginInstallScope,
    workspace: unknown,
  ): Promise<string | null> {
    if (scope === "user") return null;
    const gate = resolveProvidedWorkspace(workspace, await knownProjectRoots(), workspaceContext());
    if (!gate.ok) throw new Error(gate.error);
    if (gate.workspace === null) throw new Error("项目级插件操作需要现有工作区");
    const info = await stat(gate.workspace).catch(() => null);
    if (info === null || !info.isDirectory()) throw new Error("项目级插件操作需要现有工作区目录");
    return canonicalWorkspacePath(gate.workspace);
  }

  async function requireInstalledPluginOperation(
    entryIdValue: unknown,
    scopeValue: unknown,
    workspace: unknown,
  ): Promise<InstalledPluginOperation> {
    const entryId = typeof entryIdValue === "string" ? entryIdValue.trim() : "";
    if (entryId === "") throw new Error("插件 entryId 不能为空");
    const scope = pluginInstallScope(scopeValue);
    const workspaceTarget = await resolvePluginOperationWorkspace(scope, workspace);
    const record = await pluginInstallRegistry.get(entryId, scope, workspaceTarget);
    if (record === null) throw new Error(`plugin is not installed: ${entryId}`);
    return { record, scope, workspace: workspaceTarget };
  }

  function updateRequestFromInstalledSource(source: PluginSource): PluginImportRequest {
    if (source.kind === "catalog") {
      return { kind: "catalog", entryId: source.entryId };
    }
    if (source.kind === "git") {
      return {
        kind: "git",
        repositoryUrl: source.repositoryUrl,
        ...(source.ref === "HEAD" ? {} : { ref: source.ref }),
      };
    }
    return { kind: "local", sourcePath: source.sourcePath };
  }

  async function requireVerifiedMarketplaceEntry(entryId: string) {
    const catalogReadout = await loadDesktopMarketplaceCatalog("auto");
    if (catalogReadout.status !== "ready" || catalogReadout.catalog === null) {
      throw new Error(`插件市场目录不可用：${catalogReadout.note ?? "没有已验证的目录"}`);
    }
    if (catalogReadout.stale) {
      throw new Error(`插件市场目录已过期：${catalogReadout.note ?? catalogReadout.expiresAt ?? "请刷新目录"}`);
    }
    const entry = catalogReadout.catalog.entries.find((candidate) => candidate.id === entryId);
    if (entry === undefined) throw new Error(`插件市场目录中没有该插件：${entryId}`);
    return entry;
  }

  function pluginConfigureRequest(value: unknown): {
    readonly entryId: unknown;
    readonly scope: unknown;
    readonly workspace: unknown;
    readonly values: Record<string, string>;
  } {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error("插件配置请求不合法");
    }
    const raw = value as Record<string, unknown>;
    const unknown = Object.keys(raw).filter((key) => !["entryId", "scope", "workspace", "values"].includes(key));
    if (unknown.length > 0) throw new Error(`插件配置请求包含未知字段：${unknown.join(", ")}`);
    if (typeof raw.values !== "object" || raw.values === null || Array.isArray(raw.values)) {
      throw new Error("插件配置 values 必须是对象");
    }
    const values = Object.entries(raw.values as Record<string, unknown>);
    if (values.some(([, item]) => typeof item !== "string")) {
      throw new Error("插件配置值必须是字符串");
    }
    return {
      entryId: raw.entryId,
      scope: raw.scope,
      workspace: raw.workspace,
      values: Object.fromEntries(values) as Record<string, string>,
    };
  }

  const handlers: Pick<Record<InvokeChannel, (...args: unknown[]) => unknown>, PluginChannelKeys> = {
    pluginDecide: async (plugin, trusted, workspace) => {
      const gate = resolveProvidedWorkspace(workspace, await knownProjectRoots(), workspaceContext());
      if (!gate.ok) return { ok: false };
      return await handlePluginDecide(plugin as string, trusted as boolean, gate.workspace);
    },
    pluginUserConfigSet: (plugin, values) => {
      const rt = currentPluginRuntime();
      if (rt === null) return Promise.resolve({ ok: false, error: "插件运行时未装载（先跑一场会话）" });
      return rt.setUserConfig(String(plugin), (values ?? {}) as Record<string, unknown>);
    },
    marketplaceCatalog: async (refresh) => {
      if (refresh !== undefined && refresh !== "never" && refresh !== "auto" && refresh !== "force") {
        return {
          status: "unavailable",
          origin: "none",
          catalog: null,
          fetchedAt: null,
          expiresAt: null,
          stale: false,
          note: "插件市场刷新参数不合法",
        };
      }
      return await loadDesktopMarketplaceCatalog(refresh ?? "auto");
    },
    marketplacePluginInstall: async (entryId, scope, workspace) => {
      const catalogReadout = await loadDesktopMarketplaceCatalog("auto");
      if (catalogReadout.status !== "ready" || catalogReadout.catalog === null) {
        throw new Error(`插件市场目录不可用：${catalogReadout.note ?? "没有已验证的目录"}`);
      }
      if (catalogReadout.stale) {
        throw new Error(`插件市场目录已过期：${catalogReadout.note ?? catalogReadout.expiresAt ?? "请刷新目录"}`);
      }
      const entry = catalogReadout.catalog.entries.find((candidate) => candidate.id === String(entryId ?? ""));
      if (entry === undefined) throw new Error(`插件市场目录中没有该插件：${String(entryId ?? "")}`);
      const normalizedScope = pluginInstallScope(scope);
      const workspaceTarget = await resolvePluginOperationWorkspace(normalizedScope, workspace);
      return await pluginInstallJobs.start(entry, normalizedScope, workspaceTarget);
    },
    pluginPickLocalSource: async () => {
      const picked = await dialog.showOpenDialog({ properties: ["openDirectory"] });
      const dir = picked.filePaths[0];
      if (dir === undefined) return null;
      const canonical = await realpath(dir);
      authorizeLocalPluginSource(canonical);
      return canonical;
    },
    marketplacePluginInstallStatus: (jobId) =>
      Promise.resolve(pluginInstallJobs.status(String(jobId ?? ""))),
    marketplacePluginInstallCommit: async (jobId) => {
      try {
        const job = await pluginInstallJobs.commit(String(jobId ?? ""));
        if (job.state !== "succeeded") {
          return { ok: false, error: job.error ?? `插件安装未完成：${job.state}` };
        }
        return { ok: true };
      } catch (error) {
        return { ok: false, error: errorText(error) };
      }
    },
    marketplacePluginInstallCancel: async (jobId) => {
      try {
        const job = await pluginInstallJobs.cancel(String(jobId ?? ""));
        if (job.state !== "cancelled") return { ok: false, error: `插件安装当前状态：${job.state}` };
        return { ok: true };
      } catch (error) {
        return { ok: false, error: errorText(error) };
      }
    },
    pluginSetEnabled: async (entryId, scope, enabled, workspace) => {
      try {
        if (typeof enabled !== "boolean") return { ok: false, error: "插件 enabled 必须是布尔值" };
        const normalizedScope = pluginInstallScope(scope);
        const workspaceTarget = await resolvePluginOperationWorkspace(normalizedScope, workspace);
        await setPluginEnabled({
          pluginDataRoot,
          userPluginsDir: effectiveUserPluginsDir,
          registry: pluginInstallRegistry,
          entryId: String(entryId ?? ""),
          scope: normalizedScope,
          enabled,
          workspace: workspaceTarget,
          assertIdle: assertPluginMutationIdle,
        });
        return { ok: true };
      } catch (error) {
        return { ok: false, error: errorText(error) };
      }
    },
    pluginUninstall: async (entryId, scope, workspace) => {
      try {
        const normalizedScope = pluginInstallScope(scope);
        const workspaceTarget = await resolvePluginOperationWorkspace(normalizedScope, workspace);
        await uninstallPlugin({
          pluginDataRoot,
          userPluginsDir: effectiveUserPluginsDir,
          registry: pluginInstallRegistry,
          trust: pluginTrust,
          entryId: String(entryId ?? ""),
          scope: normalizedScope,
          workspace: workspaceTarget,
          assertIdle: assertPluginMutationIdle,
        });
        return { ok: true };
      } catch (error) {
        return { ok: false, error: errorText(error) };
      }
    },
    marketplacePluginImport: async (request, scope, workspace) => {
      const parsedRequest = parsePluginImportRequest(request);
      const normalizedScope = pluginInstallScope(scope);
      const workspaceTarget = await resolvePluginOperationWorkspace(normalizedScope, workspace);
      if (parsedRequest.kind === "catalog") {
        const entry = await requireVerifiedMarketplaceEntry(parsedRequest.entryId);
        return await pluginInstallJobs.start(entry, normalizedScope, workspaceTarget);
      }
      return await pluginInstallJobs.startImport(parsedRequest, normalizedScope, workspaceTarget);
    },
    marketplacePluginUpdate: async (entryId, scope, workspace) => {
      const operation = await requireInstalledPluginOperation(entryId, scope, workspace);
      const updateRequest = updateRequestFromInstalledSource(operation.record.source);
      if (operation.record.source.kind === "local") {
        authorizeLocalPluginSource(operation.record.source.sourcePath);
      }
      if (updateRequest.kind === "catalog") {
        const entry = await requireVerifiedMarketplaceEntry(updateRequest.entryId);
        return await pluginInstallJobs.start(entry, operation.scope, operation.workspace);
      }
      return await pluginInstallJobs.startImport(updateRequest, operation.scope, operation.workspace);
    },
    marketplacePluginCheckUpdate: async (entryId, scope, workspace) => {
      const operation = await requireInstalledPluginOperation(entryId, scope, workspace);
      const record = operation.record;
      if (record.source.kind === "catalog") {
        const source = record.source;
        const catalogReadout = await loadDesktopMarketplaceCatalog("auto");
        const catalogEntry = catalogReadout.status === "ready"
          && !catalogReadout.stale
          && catalogReadout.catalog !== null
          ? catalogReadout.catalog.entries.find((candidate) => candidate.id === source.entryId)
          : undefined;
        return await checkPluginUpdate(record, {
          requestKind: source.kind,
          ...(catalogEntry === undefined ? {} : { catalogEntry }),
        });
      }
      return await checkPluginUpdate(record, { requestKind: record.source.kind });
    },
    pluginConfigureInstalled: async (requestValue) => {
      try {
        const request = pluginConfigureRequest(requestValue);
        const operation = await requireInstalledPluginOperation(
          request.entryId,
          request.scope,
          request.workspace,
        );
        await configureInstalledPlugin({
          pluginDataRoot,
          userPluginsDir: effectiveUserPluginsDir,
          registry: pluginInstallRegistry,
          entryId: operation.record.entryId,
          scope: operation.scope,
          workspace: operation.workspace,
          values: request.values,
          assertIdle: assertPluginMutationIdle,
        });
        return { ok: true };
      } catch (error) {
        return { ok: false, error: errorText(error) };
      }
    },
    pluginsInstalled: () => pluginInstallRegistry.list(),
  };

  return {
    pluginInstallJobs,
    ...handlers,
  };
}
