import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { IPC_PROTOCOL_VERSION } from "../../../src/main/ipc-protocol";
import { INVOKE_CHANNELS } from "../src/main/channels";

function repo(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
}

function between(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  if (from < 0 || to < 0) return "";
  return source.slice(from, to);
}

const IMPORT_CHANNELS = {
  marketplacePluginImport: "agent:marketplace-plugin-import",
  marketplacePluginUpdate: "agent:marketplace-plugin-update",
  marketplacePluginCheckUpdate: "agent:marketplace-plugin-check-update",
  pluginPickLocalSource: "agent:plugin-pick-local-source",
  pluginConfigureInstalled: "agent:plugin-configure-installed",
} as const;

describe("plugin marketplace import and update IPC wiring", () => {
  it("exposes the unified import, update, check, picker, and config surface at protocol v51", () => {
    expect(IPC_PROTOCOL_VERSION).toBe(52);
    const channels = INVOKE_CHANNELS as Record<string, string>;
    for (const [key, channel] of Object.entries(IMPORT_CHANNELS)) {
      expect(channels[key]).toBe(channel);
    }
  });

  it("keeps package URLs, digests, sizes, and install targets out of renderer request signatures", () => {
    const protocol = repo("../../../src/main/ipc-protocol.ts");
    expect(protocol).toContain(
      "marketplacePluginImport(request: PluginImportRequest, scope: PluginInstallScope, workspace?: string): Promise<PluginInstallJob>",
    );
    expect(protocol).toContain(
      "marketplacePluginUpdate(entryId: string, scope: PluginInstallScope, workspace?: string): Promise<PluginInstallJob>",
    );
    expect(protocol).toContain(
      "marketplacePluginCheckUpdate(entryId: string, scope: PluginInstallScope, workspace?: string): Promise<PluginUpdateCheck>",
    );
    expect(protocol).toContain("pluginPickLocalSource(): Promise<string | null>");
    expect(protocol).toContain(
      "pluginConfigureInstalled(request: { entryId: string; scope: PluginInstallScope; workspace?: string; values: Record<string, string> }): Promise<{ ok: boolean; error?: string }>",
    );
    const publicRequests = between(protocol, "marketplacePluginImport(", "pluginsInstalled()");
    expect(publicRequests).not.toMatch(/packageUrl|sha256|sizeBytes|targetRoot|disabledRoot/u);
  });

  it("resolves catalog imports only from verified non-stale data and sends Git/local imports through the shared job", () => {
    const main = repo("../src/main/index.ts");
    const helper = between(main, "async function requireVerifiedMarketplaceEntry", "function pluginConfigureRequest");
    expect(helper).toContain('await loadDesktopMarketplaceCatalog("auto")');
    expect(helper).toContain('catalogReadout.status !== "ready"');
    expect(helper).toContain("catalogReadout.stale");
    expect(helper).toContain("catalogReadout.catalog.entries.find");

    const imported = between(main, "marketplacePluginImport: async", "marketplacePluginUpdate: async");
    expect(imported).toContain("parsePluginImportRequest(request)");
    expect(imported).toContain("requireVerifiedMarketplaceEntry(parsedRequest.entryId)");
    expect(imported).toContain("pluginInstallJobs.start(entry, normalizedScope, workspaceTarget)");
    expect(imported).toContain("pluginInstallJobs.startImport(parsedRequest, normalizedScope, workspaceTarget)");
  });

  it("binds updates to the persisted registry source and re-authorizes local paths after restart", () => {
    const main = repo("../src/main/index.ts");
    const recordHelper = between(main, "async function requireInstalledPluginOperation", "function updateRequestFromInstalledSource");
    expect(recordHelper).toContain("pluginInstallRegistry.get");
    expect(recordHelper).toContain("pluginInstallScope(scopeValue)");
    expect(recordHelper).toContain("resolvePluginOperationWorkspace");

    const requestHelper = between(main, "function updateRequestFromInstalledSource", "async function requireVerifiedMarketplaceEntry");
    expect(requestHelper).toContain('source.kind === "catalog"');
    expect(requestHelper).toContain('source.kind === "git"');
    expect(requestHelper).toContain("sourcePath: source.sourcePath");

    const update = between(main, "marketplacePluginUpdate: async", "marketplacePluginCheckUpdate: async");
    expect(update).toContain("requireInstalledPluginOperation(entryId, scope, workspace)");
    expect(update).toContain("updateRequestFromInstalledSource(operation.record.source)");
    expect(update).toContain("authorizeLocalPluginSource(operation.record.source.sourcePath)");
    expect(update).toContain("pluginInstallJobs.startImport(updateRequest");
  });

  it("checks updates from the stored source and passes only verified non-stale catalog data", () => {
    const main = repo("../src/main/index.ts");
    const check = between(main, "marketplacePluginCheckUpdate: async", "pluginConfigureInstalled: async");
    expect(check).toContain("requireInstalledPluginOperation(entryId, scope, workspace)");
    expect(check).toContain('record.source.kind === "catalog"');
    expect(check).toContain('await loadDesktopMarketplaceCatalog("auto")');
    expect(check).toContain("catalogReadout.stale");
    expect(check).toContain("checkPluginUpdate(record");
    expect(check).toContain("requestKind: record.source.kind");
  });

  it("uses a native directory picker and delegates installed config to the server-side parser", () => {
    const main = repo("../src/main/index.ts");
    const picker = between(main, "pluginPickLocalSource: async", "marketplacePluginInstallStatus:");
    expect(picker).toContain('dialog.showOpenDialog({ properties: ["openDirectory"]');
    expect(picker).toContain("picked.filePaths[0]");
    expect(picker).toContain("realpath(dir)");
    expect(picker).toContain("authorizeLocalPluginSource(canonical)");
    expect(picker).toContain("return canonical");

    const configure = between(main, "pluginConfigureInstalled: async", "pluginsInstalled:");
    expect(configure).toContain("requireInstalledPluginOperation(");
    expect(configure).toContain("request.entryId,");
    expect(configure).toContain("request.scope,");
    expect(configure).toContain("request.workspace,");
    expect(configure).toContain("configureInstalledPlugin({");
    expect(configure).toContain("values: request.values");
    expect(configure).toContain("registry: pluginInstallRegistry");
  });

  it("keeps every import-surface channel reachable from the plugin marketplace renderer", () => {
    const renderer = [
      repo("../src/renderer/state/plugins-marketplace.ts"),
      repo("../src/renderer/components/plugins/PluginImportMenu.tsx"),
    ].join("\n");
    for (const key of Object.keys(IMPORT_CHANNELS)) {
      expect(renderer).toMatch(new RegExp(`\\b${key}\\s*\\(`, "u"));
    }
  });
});
