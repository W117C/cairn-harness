import type { PluginPanelSnapshot } from "../../../../../src/agent/plugins";
import type {
  MarketplaceCapabilities,
  MarketplaceEntry,
} from "../../../../../src/agent/plugins/marketplace";
import type {
  InstalledPluginRecord,
  MarketplaceCatalogReadout,
  PluginSource,
  PluginUpdateCheck,
} from "../../../../../src/main/ipc-protocol";

export type PluginView = "discover" | "installed" | "updates";
export type PluginCapabilityCategory = "skills" | "commands" | "agents" | "hooks" | "mcp" | "lsp";
export type PluginSourceKind = PluginSource["kind"] | "runtime";
export type PluginRowState =
  | "available"
  | "installed"
  | "enabled"
  | "disabled"
  | "unmanaged"
  | "name-conflict";

export interface PluginFavoriteStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export type PluginRuntimeView = PluginPanelSnapshot["plugins"][number];

export interface PluginRowView {
  readonly id: string;
  readonly name: string;
  readonly summary: string;
  readonly sourceKind: PluginSourceKind;
  readonly version: string | null;
  readonly installed: InstalledPluginRecord | null;
  readonly runtime: PluginRuntimeView | null;
  readonly catalogEntry: MarketplaceEntry | null;
  readonly capabilities: MarketplaceCapabilities | null;
  readonly state: PluginRowState;
  readonly favorite: boolean;
  readonly warnings: readonly string[];
  readonly errors: readonly string[];
}

export interface PluginUpdateRow {
  readonly id: string;
  readonly row: PluginRowView;
  readonly check: PluginUpdateCheck;
  readonly sourceKind: PluginSource["kind"];
  readonly currentVersion: string | null;
  readonly nextVersion: string | null;
}

export const PLUGIN_FAVORITES_KEY = "cairn.plugins.favorites.v1";

function countsOf(runtime: PluginRuntimeView | null): MarketplaceCapabilities | null {
  if (runtime === null) return null;
  return {
    skills: runtime.counts.skills,
    commands: runtime.counts.commands,
    agents: runtime.counts.agents,
    hooks: runtime.counts.hooks,
    mcp: runtime.counts.mcp,
    lsp: runtime.counts.lsp,
  };
}

function runtimeGroups(runtime: PluginPanelSnapshot | null): ReadonlyMap<string, readonly PluginRuntimeView[]> {
  const groups = new Map<string, PluginRuntimeView[]>();
  if (runtime === null) return groups;
  for (const plugin of runtime.plugins) {
    const rows = groups.get(plugin.name) ?? [];
    rows.push(plugin);
    groups.set(plugin.name, rows);
  }
  return groups;
}

function installedGroups(records: readonly InstalledPluginRecord[]): ReadonlyMap<string, readonly InstalledPluginRecord[]> {
  const groups = new Map<string, InstalledPluginRecord[]>();
  for (const record of records) {
    const rows = groups.get(record.manifestName) ?? [];
    rows.push(record);
    groups.set(record.manifestName, rows);
  }
  return groups;
}

function rowState(input: {
  conflict: boolean;
  installed: InstalledPluginRecord | null;
  runtime: PluginRuntimeView | null;
}): PluginRowState {
  if (input.conflict) return "name-conflict";
  if (input.installed !== null) return input.installed.enabled ? "enabled" : "disabled";
  if (input.runtime !== null) return "unmanaged";
  return "available";
}

function runtimeWarnings(rows: readonly PluginRuntimeView[]): readonly string[] {
  return [...new Set(rows.flatMap((row) => row.warnings))];
}

function runtimeErrors(rows: readonly PluginRuntimeView[]): readonly string[] {
  return [...new Set(rows.flatMap((row) => row.errors))];
}

/**
 * Registry-owned rows win over runtime discovery. Catalog rows retain catalog ordering;
 * installed-only and runtime-only rows follow deterministically by name.
 */
export function mergePluginRows(
  catalog: MarketplaceCatalogReadout | null,
  installed: readonly InstalledPluginRecord[],
  runtime: PluginPanelSnapshot | null,
  favorites: ReadonlySet<string>,
): readonly PluginRowView[] {
  const catalogEntries = catalog?.status === "ready" && catalog.catalog !== null
    ? catalog.catalog.entries
    : [];
  const runtimeByName = runtimeGroups(runtime);
  const installedByName = installedGroups(installed);
  const rows: PluginRowView[] = [];
  const consumedRuntime = new Set<string>();
  const consumedInstalled = new Set<string>();
  const catalogIds = new Set<string>();

  for (const entry of catalogEntries) {
    const duplicateCatalog = catalogIds.has(entry.id);
    catalogIds.add(entry.id);
    const installedMatches = installedByName.get(entry.id) ?? [];
    const runtimeMatches = runtimeByName.get(entry.id) ?? [];
    const installedMatch = installedMatches[0] ?? null;
    const runtimeMatch = runtimeMatches[0] ?? null;
    const sourceConflict = installedMatch !== null && installedMatch.source.kind !== "catalog";
    const manualConflict = installedMatches.length === 0 && runtimeMatches.length > 0;
    const conflict = duplicateCatalog
      || installedMatches.length > 1
      || runtimeMatches.length > 1
      || sourceConflict
      || manualConflict;
    if (runtimeMatches.length > 0) consumedRuntime.add(entry.id);
    if (installedMatches.length > 0) consumedInstalled.add(entry.id);
    rows.push({
      id: entry.id,
      name: entry.name,
      summary: entry.summary,
      sourceKind: installedMatch?.source.kind ?? "catalog",
      version: installedMatch?.version ?? entry.version,
      installed: installedMatch,
      runtime: runtimeMatch,
      catalogEntry: entry,
      capabilities: countsOf(runtimeMatch) ?? (installedMatch === null ? entry.capabilities : null),
      state: rowState({ conflict, installed: installedMatch, runtime: runtimeMatch }),
      favorite: favorites.has(entry.id),
      warnings: runtimeWarnings(runtimeMatches),
      errors: runtimeErrors(runtimeMatches),
    });
  }

  const remainingInstalled = [...installedByName.entries()]
    .filter(([name]) => !consumedInstalled.has(name))
    .sort(([left], [right]) => left.localeCompare(right));
  for (const [name, matches] of remainingInstalled) {
    const record = matches[0];
    if (record === undefined) continue;
    const runtimeMatches = runtimeByName.get(name) ?? [];
    const runtimeMatch = runtimeMatches[0] ?? null;
    consumedRuntime.add(name);
    rows.push({
      id: record.entryId,
      name,
      summary: "",
      sourceKind: record.source.kind,
      version: record.version,
      installed: record,
      runtime: runtimeMatch,
      catalogEntry: null,
      capabilities: countsOf(runtimeMatch),
      state: rowState({
        conflict: matches.length > 1 || runtimeMatches.length > 1,
        installed: record,
        runtime: runtimeMatch,
      }),
      favorite: favorites.has(record.entryId),
      warnings: runtimeWarnings(runtimeMatches),
      errors: runtimeErrors(runtimeMatches),
    });
  }

  const remainingRuntime = [...runtimeByName.entries()]
    .filter(([name]) => !consumedRuntime.has(name))
    .sort(([left], [right]) => left.localeCompare(right));
  for (const [name, matches] of remainingRuntime) {
    const runtimeMatch = matches[0];
    if (runtimeMatch === undefined) continue;
    rows.push({
      id: name,
      name,
      summary: "",
      sourceKind: "runtime",
      version: null,
      installed: null,
      runtime: runtimeMatch,
      catalogEntry: null,
      capabilities: countsOf(runtimeMatch),
      state: rowState({ conflict: matches.length > 1, installed: null, runtime: runtimeMatch }),
      favorite: favorites.has(name),
      warnings: runtimeWarnings(matches),
      errors: runtimeErrors(matches),
    });
  }

  return rows;
}

export function pluginUpdateCheckKey(source: PluginSource): string {
  if (source.kind === "catalog") {
    return JSON.stringify(["catalog", source.catalogId, source.entryId]);
  }
  if (source.kind === "git") {
    return JSON.stringify(["git", source.repositoryUrl, source.ref]);
  }
  return JSON.stringify(["local", source.sourcePath]);
}

export function pluginUpdateRows(
  rows: readonly PluginRowView[],
  checks: Readonly<Record<string, PluginUpdateCheck>>,
): readonly PluginUpdateRow[] {
  const updates: PluginUpdateRow[] = [];
  for (const row of rows) {
    const installed = row.installed;
    if (installed === null) continue;
    const check = checks[pluginUpdateCheckKey(installed.source)];
    if (check === undefined || check.status !== "available" || check.sourceKind !== installed.source.kind) {
      continue;
    }
    if (installed.source.kind === "catalog") {
      if (
        check.currentVersion !== installed.version
        || check.nextVersion === null
        || check.nextVersion === check.currentVersion
      ) {
        continue;
      }
    }
    updates.push({
      id: row.id,
      row,
      check,
      sourceKind: installed.source.kind,
      currentVersion: check.currentVersion,
      nextVersion: check.nextVersion,
    });
  }
  return updates;
}

export function pluginCategoryOf(
  capabilities: MarketplaceCapabilities | null | undefined,
): PluginCapabilityCategory | null {
  if (capabilities === null || capabilities === undefined) return null;
  if (capabilities.lsp > 0) return "lsp";
  if (capabilities.mcp > 0) return "mcp";
  if (capabilities.hooks > 0) return "hooks";
  if (capabilities.agents > 0) return "agents";
  if (capabilities.commands > 0) return "commands";
  if (capabilities.skills > 0) return "skills";
  return null;
}

export function filterPluginRows(
  rows: readonly PluginRowView[],
  query: string,
  category: PluginCapabilityCategory | "all" | null,
): readonly PluginRowView[] {
  const q = query.trim().toLowerCase();
  return rows.filter((row) => {
    if (category !== null && category !== "all" && pluginCategoryOf(row.capabilities) !== category) {
      return false;
    }
    if (q === "") return true;
    return `${row.name}\n${row.summary}`.toLowerCase().includes(q);
  });
}

export function loadPluginFavorites(storage: PluginFavoriteStorage): ReadonlySet<string> {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(PLUGIN_FAVORITES_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed
      .filter((value): value is string => typeof value === "string" && value.trim() !== "")
      .map((value) => value.trim())
      .sort());
  } catch {
    return new Set();
  }
}

export function savePluginFavorites(
  storage: PluginFavoriteStorage,
  ids: Iterable<string>,
): void {
  const values = [...new Set(ids)]
    .map((id) => id.trim())
    .filter((id) => id !== "")
    .sort();
  try {
    storage.setItem(PLUGIN_FAVORITES_KEY, JSON.stringify(values));
  } catch {
    /* Favorites are a preference; storage failure must not block marketplace actions. */
  }
}
