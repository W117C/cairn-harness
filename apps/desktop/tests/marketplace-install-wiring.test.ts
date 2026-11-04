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

const INSTALL_CHANNELS = {
  marketplacePluginInstall: "agent:marketplace-plugin-install",
  marketplacePluginInstallStatus: "agent:marketplace-plugin-install-status",
  marketplacePluginInstallCommit: "agent:marketplace-plugin-install-commit",
  marketplacePluginInstallCancel: "agent:marketplace-plugin-install-cancel",
  pluginSetEnabled: "agent:plugin-set-enabled",
  pluginUninstall: "agent:plugin-uninstall",
  pluginsInstalled: "agent:plugins-installed",
} as const;

describe("plugin install IPC wiring", () => {
  it("exposes the backend install surface at protocol v51", () => {
    expect(IPC_PROTOCOL_VERSION).toBe(52);
    const channels = INVOKE_CHANNELS as Record<string, string>;
    for (const [key, channel] of Object.entries(INSTALL_CHANNELS)) {
      expect(channels[key]).toBe(channel);
    }
  });

  it("keeps package URL, digest, size, and publish path out of renderer inputs", () => {
    const protocol = repo("../../../src/main/ipc-protocol.ts");
    expect(protocol).toContain(
      "marketplacePluginInstall(entryId: string, scope: PluginInstallScope, workspace?: string): Promise<PluginInstallJob>",
    );
    expect(protocol).toContain(
      "marketplacePluginInstallStatus(jobId: string): Promise<PluginInstallJob | null>",
    );
    expect(protocol).toContain(
      "marketplacePluginInstallCommit(jobId: string): Promise<{ ok: boolean; error?: string }>",
    );
    expect(protocol).toContain(
      "marketplacePluginInstallCancel(jobId: string): Promise<{ ok: boolean; error?: string }>",
    );
    expect(protocol).toContain(
      "pluginSetEnabled(entryId: string, scope: PluginInstallScope, enabled: boolean, workspace?: string): Promise<{ ok: boolean; error?: string }>",
    );
    expect(protocol).toContain(
      "pluginUninstall(entryId: string, scope: PluginInstallScope, workspace?: string): Promise<{ ok: boolean; error?: string }>",
    );
    expect(protocol).toContain("pluginsInstalled(): Promise<InstalledPluginRecord[]>");

    const installApi = between(protocol, "marketplacePluginInstall(", "marketplacePluginInstallStatus(");
    expect(installApi).not.toMatch(/packageUrl|sha256|sizeBytes|targetRoot|manifestName/u);
  });

  it("looks up only a verified catalog entry and canonicalizes project workspaces", () => {
    const main = repo("../src/main/index.ts");
    const install = between(main, "marketplacePluginInstall: async", "marketplacePluginInstallStatus:");
    expect(install).toContain('await loadDesktopMarketplaceCatalog("auto")');
    expect(install).toContain('catalogReadout.status !== "ready"');
    expect(install).toContain("catalogReadout.stale");
    expect(install).toContain("catalogReadout.catalog.entries.find");
    expect(install).toMatch(/candidate\.id === String\(entryId(?:\s*\?\?\s*"")?\)/u);
    expect(install).toContain("pluginInstallJobs.start(entry, normalizedScope, workspaceTarget)");
    expect(install).not.toMatch(/packageUrl|sha256|sizeBytes|targetRoot|manifestName/u);

    expect(main).toContain("resolveProvidedWorkspace(workspace, await knownProjectRoots(), workspaceContext())");
    expect(main).toContain("stat(gate.workspace)");
    expect(main).toContain("return canonicalWorkspacePath(gate.workspace)");
  });

  it("uses one registry and one install-job manager for every operation", () => {
    const main = repo("../src/main/index.ts");
    expect(main.match(/new InstalledPluginRegistry\(/gu)).toHaveLength(1);
    expect(main.match(/new PluginInstallJobManager\(/gu)).toHaveLength(1);
    expect(main).toContain('const pluginDataRoot = pluginDataRootOf(process.env, homedir());');
    expect(main).toContain('new InstalledPluginRegistry(join(pluginDataRoot, "installed.json"))');
    expect(main).toContain("registry: pluginInstallRegistry");
    expect(main).toMatch(/pluginInstallJobs\.status\(String\(jobId(?:\s*\?\?\s*"")?\)\)/u);
    expect(main).toMatch(/pluginInstallJobs\.commit\(String\(jobId(?:\s*\?\?\s*"")?\)\)/u);
    expect(main).toMatch(/pluginInstallJobs\.cancel\(String\(jobId(?:\s*\?\?\s*"")?\)\)/u);
    expect(main).toContain("void Promise.all([host.orchestrationClose(), pluginInstallJobs.shutdown()])");
  });

  it("shares effective roots and blocks mutation while a run is active", () => {
    const main = repo("../src/main/index.ts");
    expect(main).toContain('process.env.M2E_USER_PLUGINS || userPluginsDirOf(pluginDataRoot)');
    expect(main).toContain('process.env.M2E_TRUST_FILE || trustFilePathOf({ pluginDataRoot })');
    expect(main).toContain("beforeCommit: assertPluginMutationIdle");
    expect(main).toContain("currentAppVersion: app.getVersion()");
    expect(main).toContain("assertIdle: assertPluginMutationIdle");
  });

  it("keeps every install-surface channel reachable from the plugin marketplace renderer", () => {
    const renderer = repo("../src/renderer/state/plugins-marketplace.ts");
    for (const key of Object.keys(INSTALL_CHANNELS)) {
      expect(renderer).toMatch(new RegExp(`\\b${key}\\s*\\(`, "u"));
    }
  });
});
