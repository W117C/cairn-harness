import { describe, expect, it } from "vitest";
import type { MarketplaceEntry } from "../src/agent/plugins/marketplace";
import type { InstalledPluginRecord } from "../src/main/plugin-install-registry";
import { checkPluginUpdate } from "../src/main/plugin-update-check";

const NOW = "2026-10-29T12:00:00.000Z";

function record(
  source: InstalledPluginRecord["source"],
  version: string | null,
  sha256 = "a".repeat(64),
): InstalledPluginRecord {
  return {
    entryId: "demo-plugin",
    manifestName: "demo-plugin",
    version,
    sha256,
    fingerprint: "f".repeat(32),
    source,
    scope: "user",
    workspace: null,
    enabled: true,
    installedAt: NOW,
    updatedAt: NOW,
  };
}

function catalogRecord(version: string | null): InstalledPluginRecord {
  return record({
    kind: "catalog",
    catalogId: "cairn",
    entryId: "demo-plugin",
    sourceUrl: "https://github.com/example/demo-plugin",
    revision: "2026-10-29.1",
  }, version);
}

function gitRecord(commit: string): InstalledPluginRecord {
  return record({
    kind: "git",
    repositoryUrl: "https://github.com/example/demo-plugin.git",
    ref: "main",
    commit,
  }, null);
}

function localRecord(digest: string): InstalledPluginRecord {
  return record({ kind: "local", sourcePath: "/tmp/demo-plugin" }, null, digest);
}

function catalogEntry(version: string): MarketplaceEntry {
  return {
    id: "demo-plugin",
    name: "Demo Plugin",
    summary: "Fixture",
    author: "Cairn",
    sourceUrl: "https://github.com/example/demo-plugin",
    license: "MIT",
    version,
    publishedAt: NOW,
    packageUrl: "https://plugins.example.com/demo-plugin.tgz",
    sha256: "b".repeat(64),
    sizeBytes: 100,
    capabilities: { skills: 1, commands: 0, agents: 0, hooks: 0, mcp: 0, lsp: 0 },
    permissions: ["network"],
    minAppVersion: "0.1.0",
  };
}

describe("plugin update checks", () => {
  it("compares catalog semver and reports a real available version", async () => {
    const result = await checkPluginUpdate(catalogRecord("1.2.3"), {
      catalogEntry: catalogEntry("1.3.0"),
    });
    expect(result).toEqual({
      status: "available",
      currentVersion: "1.2.3",
      nextVersion: "1.3.0",
      sourceKind: "catalog",
    });
  });

  it("compares Git commits and local content digests", async () => {
    const git = await checkPluginUpdate(gitRecord("a".repeat(40)), {
      gitHead: "b".repeat(40),
    });
    expect(git).toMatchObject({ status: "available", currentVersion: null, nextVersion: null, sourceKind: "git" });

    const local = await checkPluginUpdate(localRecord("local-digest"), {
      localDigest: "local-digest",
    });
    expect(local).toMatchObject({ status: "current", sourceKind: "local" });
  });

  it("rejects source mismatch and unversioned catalog records", async () => {
    await expect(checkPluginUpdate(gitRecord("a".repeat(40)), {
      gitHead: "b".repeat(40),
      requestKind: "catalog",
    })).resolves.toMatchObject({ status: "unavailable" });
    await expect(checkPluginUpdate(catalogRecord(null), {
      catalogEntry: catalogEntry("1.3.0"),
    })).resolves.toMatchObject({ status: "unavailable" });
  });

  it("keeps offline failure separate from current", async () => {
    await expect(checkPluginUpdate(gitRecord("a".repeat(40)), {
      gitError: "offline",
    })).resolves.toMatchObject({ status: "failed", detail: "offline" });
    await expect(checkPluginUpdate(localRecord("digest"), {
      localError: "ENOENT",
    })).resolves.toMatchObject({ status: "failed", detail: "ENOENT" });
  });
});
