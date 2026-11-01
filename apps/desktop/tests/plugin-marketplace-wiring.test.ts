import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { IPC_PROTOCOL_VERSION } from "../../../src/main/ipc-protocol";
import { INVOKE_CHANNELS } from "../src/main/channels";

function repo(path: string): string {
  return readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
}

describe("plugin marketplace end-to-end wiring", () => {
  it("keeps protocol v51 and exposes the full marketplace API", () => {
    expect(IPC_PROTOCOL_VERSION).toBe(51);
    for (const key of [
      "marketplaceCatalog",
      "marketplacePluginImport",
      "marketplacePluginUpdate",
      "marketplacePluginCheckUpdate",
      "pluginPickLocalSource",
      "pluginConfigureInstalled",
      "marketplacePluginInstall",
      "pluginSetEnabled",
      "pluginUninstall",
      "pluginsInstalled",
    ] as const) {
      expect(INVOKE_CHANNELS[key]).toMatch(/^agent:/u);
    }
  });

  it("exposes stable states and rows for Electron assertions", () => {
    const workspace = repo("../src/renderer/components/plugins/PluginsWorkspace.tsx");
    const discover = repo("../src/renderer/components/plugins/PluginDiscover.tsx");
    const installed = repo("../src/renderer/components/plugins/PluginInstalled.tsx");
    expect(workspace).toContain("data-marketplace-view={effectiveView}");
    expect(workspace).toContain("data-plugin-job-state={state.activeJob.state}");
    expect(discover).toContain('data-catalog-state={stale ? "stale" : "live"}');
    expect(installed).toContain('data-plugin-row="installed"');
  });

  it("drives the built renderer through window.agent and captures the required viewport matrix", () => {
    const smoke = repo("../scripts/plugin-marketplace-smoke.cjs");
    expect(smoke).toContain("--cairn-plugin-marketplace-fixture");
    expect(smoke).toContain("win.webContents.executeJavaScript");
    expect(smoke).toContain("window.agent");
    for (const name of [
      "01-discover-1440-light.png",
      "02-discover-1440-dark.png",
      "03-installed-1120-light.png",
      "04-updates-1120-dark.png",
      "05-review-880-light.png",
      "06-offline-1440-light.png",
      "07-corrupt-1120-dark.png",
      "08-detail-880-dark.png",
    ]) {
      expect(smoke).toContain(name);
    }
    expect(smoke).toContain("marketplace contains no fabricated social proof");
  });
});
