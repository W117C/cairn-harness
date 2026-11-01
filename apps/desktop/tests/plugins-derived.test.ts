import { describe, expect, it } from "vitest";
import type { PluginPanelSnapshot } from "../../../src/agent/plugins";
import type {
  InstalledPluginRecord,
  MarketplaceCatalogReadout,
  PluginSource,
  PluginUpdateCheck,
} from "../../../src/main/ipc-protocol";
import type { MarketplaceEntry } from "../../../src/agent/plugins/marketplace";
import {
  filterPluginRows,
  loadPluginFavorites,
  mergePluginRows,
  pluginCategoryOf,
  pluginUpdateCheckKey,
  pluginUpdateRows,
  savePluginFavorites,
  type PluginFavoriteStorage,
} from "../src/renderer/derived/plugins";

const ZERO_COUNTS = { skills: 0, commands: 0, agents: 0, hooks: 0, mcp: 0, lsp: 0 } as const;

function entry(
  id: string,
  summary: string,
  capabilities: MarketplaceEntry["capabilities"] = ZERO_COUNTS,
): MarketplaceEntry {
  return {
    id,
    name: id,
    summary,
    author: "Cairn",
    sourceUrl: `https://plugins.example.com/${id}`,
    license: "MIT",
    version: "2.0.0",
    publishedAt: "2026-10-29T00:00:00.000Z",
    packageUrl: `https://plugins.example.com/${id}.tgz`,
    sha256: "a".repeat(64),
    sizeBytes: 1024,
    capabilities,
    permissions: ["filesystem:read"],
    minAppVersion: "0.1.0",
  };
}

function catalog(entries: readonly MarketplaceEntry[]): MarketplaceCatalogReadout {
  return {
    status: "ready",
    origin: "live",
    catalog: {
      schemaVersion: 1,
      revision: "catalog-1",
      generatedAt: "2026-10-29T00:00:00.000Z",
      expiresAt: "2026-11-05T00:00:00.000Z",
      packageHosts: ["plugins.example.com"],
      entries,
      shelves: [],
    },
    fetchedAt: "2026-10-29T00:00:00.000Z",
    expiresAt: "2026-11-05T00:00:00.000Z",
    stale: false,
  };
}

function installed(
  manifestName: string,
  source: PluginSource,
  enabled = true,
): InstalledPluginRecord {
  return {
    entryId: manifestName,
    manifestName,
    version: source.kind === "catalog" ? "1.0.0" : null,
    sha256: "b".repeat(64),
    fingerprint: "c".repeat(32),
    source,
    scope: "user",
    workspace: null,
    enabled,
    installedAt: "2026-10-28T00:00:00.000Z",
    updatedAt: "2026-10-29T00:00:00.000Z",
  };
}

function runtimePlugin(
  name: string,
  counts: MarketplaceEntry["capabilities"] = ZERO_COUNTS,
): PluginPanelSnapshot["plugins"][number] {
  return {
    name,
    scope: "user",
    trust: "trusted",
    root: `/plugins/${name}`,
    counts: { ...counts, lspActive: 0 },
    skills: [],
    commands: [],
    userConfig: [],
    errors: [],
    warnings: [],
  };
}

function runtime(plugins: PluginPanelSnapshot["plugins"]): PluginPanelSnapshot {
  return {
    plugins,
    looseSkills: [],
    mcpServers: [],
    toolScopes: [],
    errors: [],
    warnings: [],
  };
}

const catalogSource: PluginSource = {
  kind: "catalog",
  catalogId: "cairn",
  entryId: "demo-plugin",
  sourceUrl: "https://plugins.example.com/demo-plugin",
  revision: "catalog-1",
};

describe("plugin marketplace projections", () => {
  it("merges catalog, registry, and runtime without losing unmanaged or conflict states", () => {
    const entries = [
      entry("demo-plugin", "演示插件", { ...ZERO_COUNTS, skills: 1 }),
      entry("conflict-plugin", "同名冲突"),
    ];
    const records = [installed("demo-plugin", catalogSource)];
    const snap = runtime([
      runtimePlugin("demo-plugin", { ...ZERO_COUNTS, mcp: 2 }),
      runtimePlugin("manual-plugin"),
      runtimePlugin("conflict-plugin"),
      runtimePlugin("conflict-plugin"),
    ]);

    const rows = mergePluginRows(catalog(entries), records, snap, new Set(["demo-plugin"]));

    expect(rows.find((row) => row.id === "demo-plugin")).toMatchObject({
      state: "enabled",
      sourceKind: "catalog",
      favorite: true,
      capabilities: { mcp: 2 },
    });
    expect(rows.find((row) => row.id === "manual-plugin")).toMatchObject({
      state: "unmanaged",
      sourceKind: "runtime",
      installed: null,
    });
    expect(rows.find((row) => row.id === "conflict-plugin")?.state).toBe("name-conflict");
  });

  it("only reports available updates with matching source identity", () => {
    const catalogRecord = installed("catalog-update", {
      ...catalogSource,
      entryId: "catalog-update",
    } as PluginSource);
    const gitRecord = installed("git-update", {
      kind: "git",
      repositoryUrl: "https://github.com/example/git-update",
      ref: "main",
      commit: "1".repeat(40),
    });
    const localRecord = installed("local-current", {
      kind: "local",
      sourcePath: "/plugins/local-current",
    });
    const rows = mergePluginRows(null, [catalogRecord, gitRecord, localRecord], null, new Set());
    const checks: Record<string, PluginUpdateCheck> = {
      [pluginUpdateCheckKey(catalogRecord.source)]: {
        status: "available",
        currentVersion: "1.0.0",
        nextVersion: "2.0.0",
        sourceKind: "catalog",
      },
      [pluginUpdateCheckKey(gitRecord.source)]: {
        status: "available",
        currentVersion: null,
        nextVersion: null,
        sourceKind: "git",
      },
      "catalog:wrong-entry": {
        status: "available",
        currentVersion: "1.0.0",
        nextVersion: "9.0.0",
        sourceKind: "catalog",
      },
      [pluginUpdateCheckKey(localRecord.source)]: {
        status: "current",
        currentVersion: null,
        nextVersion: null,
        sourceKind: "local",
      },
    };

    expect(pluginUpdateRows(rows, checks).map((row) => row.id)).toEqual([
      "catalog-update",
      "git-update",
    ]);
  });

  it("keeps favorites, category priority, and search deterministic", () => {
    const entries = [
      entry("mcp-plugin", "连接模型上下文", { ...ZERO_COUNTS, skills: 2, commands: 1, mcp: 3 }),
      entry("lsp-plugin", "语言服务", { ...ZERO_COUNTS, mcp: 1, lsp: 2 }),
    ];
    const rows = mergePluginRows(catalog(entries), [], null, new Set(["lsp-plugin"]));

    expect(filterPluginRows(rows, "mcp", "mcp").map((row) => row.id)).toEqual(["mcp-plugin"]);
    expect(filterPluginRows(rows, "语言", "lsp").map((row) => row.id)).toEqual(["lsp-plugin"]);
    expect(pluginCategoryOf({ skills: 9, commands: 8, agents: 7, hooks: 6, mcp: 5, lsp: 4 })).toBe("lsp");
    expect(pluginCategoryOf(ZERO_COUNTS)).toBeNull();
  });

  it("persists only a stable sorted favorite id set", () => {
    const values = new Map<string, string>();
    const storage: PluginFavoriteStorage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => { values.set(key, value); },
    };

    savePluginFavorites(storage, ["zeta", "alpha", "alpha"]);
    expect(loadPluginFavorites(storage)).toEqual(new Set(["alpha", "zeta"]));

    values.set("cairn.plugins.favorites.v1", "{broken");
    expect(loadPluginFavorites(storage)).toEqual(new Set());
  });
});
