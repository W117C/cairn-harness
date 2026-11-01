import { describe, expect, it } from "vitest";
import type {
  InstalledPluginRecord,
  MarketplaceCatalogReadout,
  PluginInstallJob,
  PluginInstallReview,
} from "../../../src/main/ipc-protocol";
import {
  createPluginsMarketplaceSnapshot,
  pluginJobNeedsPolling,
  pluginsMarketplaceReducer,
} from "../src/renderer/state/plugins-marketplace";

function readout(revision: string): MarketplaceCatalogReadout {
  return {
    status: "ready",
    origin: "live",
    catalog: {
      schemaVersion: 1,
      revision,
      generatedAt: "2026-10-29T00:00:00.000Z",
      expiresAt: "2026-11-05T00:00:00.000Z",
      packageHosts: ["plugins.example.com"],
      entries: [],
      shelves: [],
    },
    fetchedAt: "2026-10-29T00:00:00.000Z",
    expiresAt: "2026-11-05T00:00:00.000Z",
    stale: false,
  };
}

function record(): InstalledPluginRecord {
  return {
    entryId: "demo-plugin",
    manifestName: "demo-plugin",
    version: "1.0.0",
    sha256: "a".repeat(64),
    fingerprint: "b".repeat(32),
    source: {
      kind: "catalog",
      catalogId: "cairn",
      entryId: "demo-plugin",
      sourceUrl: "https://plugins.example.com/demo-plugin",
      revision: "catalog-1",
    },
    scope: "user",
    workspace: null,
    enabled: false,
    installedAt: "2026-10-29T00:00:00.000Z",
    updatedAt: "2026-10-29T00:00:00.000Z",
  };
}

function review(): PluginInstallReview {
  return {
    jobId: "job-1",
    entryId: "demo-plugin",
    manifestName: "demo-plugin",
    version: "1.0.0",
    source: {
      kind: "catalog",
      catalogId: "cairn",
      entryId: "demo-plugin",
      sourceUrl: "https://plugins.example.com/demo-plugin",
      revision: "catalog-1",
    },
    scope: "project",
    workspace: "/workspace/a",
    targetRoot: "/workspace/a/.agent/plugins/demo-plugin",
    fingerprint: "b".repeat(32),
    packageSha256: "a".repeat(64),
    capabilities: { skills: 1, commands: 0, agents: 0, hooks: 0, mcp: 0, lsp: 0 },
    permissions: ["filesystem:read"],
    userConfigFields: [],
    warnings: [],
  };
}

function job(state: PluginInstallJob["state"]): PluginInstallJob {
  return {
    id: "job-1",
    state,
    entryId: "demo-plugin",
    sourceKind: "catalog",
    scope: "project",
    workspace: "/workspace/a",
    createdAt: "2026-10-29T00:00:00.000Z",
    updatedAt: "2026-10-29T00:00:00.000Z",
  };
}

describe("plugins marketplace state", () => {
  it("ignores stale response generations", () => {
    let state = createPluginsMarketplaceSnapshot({ workspace: "/workspace/a" });
    state = pluginsMarketplaceReducer(state, {
      type: "catalog",
      generation: 2,
      value: readout("new"),
    });
    state = pluginsMarketplaceReducer(state, {
      type: "catalog",
      generation: 1,
      value: readout("old"),
    });

    expect(state.catalog.catalog?.revision).toBe("new");
  });

  it("closes an uncommitted review and clears project rows when the workspace changes", () => {
    let state = createPluginsMarketplaceSnapshot({ workspace: "/workspace/a" });
    state = pluginsMarketplaceReducer(state, {
      type: "installed",
      generation: 1,
      value: [record()],
    });
    state = pluginsMarketplaceReducer(state, {
      type: "review",
      review: review(),
      jobId: "job-1",
      workspace: "/workspace/a",
    });
    state = pluginsMarketplaceReducer(state, { type: "workspace", workspace: "/workspace/b" });

    expect(state.review).toBeNull();
    expect(state.installed).toEqual([]);
    expect(state.notice).toMatch(/工作区/);
  });

  it("keeps registry rows when an independent refresh fails", () => {
    let state = createPluginsMarketplaceSnapshot({ workspace: null });
    state = pluginsMarketplaceReducer(state, {
      type: "installed",
      generation: 1,
      value: [record()],
    });
    state = pluginsMarketplaceReducer(state, { type: "start", surface: "installed", generation: 2 });
    state = pluginsMarketplaceReducer(state, {
      type: "reject",
      surface: "installed",
      generation: 2,
      message: "registry unavailable",
    });

    expect(state.installed).toEqual([record()]);
    expect(state.installedStatus).toBe("error");
    expect(state.installedError).toBe("registry unavailable");
  });

  it("polls a job only until review or a terminal state", () => {
    expect(pluginJobNeedsPolling(job("queued"))).toBe(true);
    expect(pluginJobNeedsPolling(job("verifying"))).toBe(true);
    expect(pluginJobNeedsPolling(job("installing"))).toBe(true);
    expect(pluginJobNeedsPolling(job("review"))).toBe(false);
    expect(pluginJobNeedsPolling(job("succeeded"))).toBe(false);
    expect(pluginJobNeedsPolling(job("failed"))).toBe(false);
  });

  it("clears update evidence when the installed registry changes", () => {
    let state = createPluginsMarketplaceSnapshot({ workspace: "/workspace/a" });
    state = pluginsMarketplaceReducer(state, {
      type: "updateCheck",
      key: JSON.stringify(["catalog", "cairn", "demo-plugin"]),
      check: {
        status: "available",
        currentVersion: "1.0.0",
        nextVersion: "1.1.0",
        sourceKind: "catalog",
      },
    });
    state = pluginsMarketplaceReducer(state, {
      type: "installed",
      generation: 1,
      value: [record()],
    });

    expect(state.updateChecks).toEqual({});
  });

  it("does not let a stale review instance replace the active review", () => {
    let state = createPluginsMarketplaceSnapshot({ workspace: "/workspace/a" });
    state = pluginsMarketplaceReducer(state, {
      type: "review",
      review: review(),
      jobId: "job-1",
      workspace: "/workspace/a",
      instanceId: "job-1:1",
    });
    state = pluginsMarketplaceReducer(state, {
      type: "review",
      review: { ...review(), manifestName: "stale-plugin" },
      jobId: "job-1",
      workspace: "/workspace/a",
      instanceId: "job-1:2",
    });

    expect(state.review?.instanceId).toBe("job-1:1");
    expect(state.review?.review.manifestName).toBe("demo-plugin");
  });
});
