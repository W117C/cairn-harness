import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { INVOKE_CHANNELS } from "../src/main/channels";
import { IPC_PROTOCOL_VERSION } from "../../../src/main/ipc-protocol";

const repo = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("plugin marketplace catalog wiring", () => {
  it("keeps the read-only catalog channel at protocol v51", () => {
    expect(IPC_PROTOCOL_VERSION).toBe(53);
    expect(INVOKE_CHANNELS.marketplaceCatalog).toBe("agent:marketplace-catalog");
    expect(repo("../../../src/main/ipc-protocol.ts")).toContain(
      'marketplaceCatalog(refresh?: "never" | "auto" | "force"): Promise<MarketplaceCatalogReadout>',
    );
  });

  it("wires the desktop user-data cache independently of the install backend", () => {
    const main = repo("../src/main/index.ts");
    expect(main).toContain("marketplaceCatalog: async (refresh)");
    expect(main).toContain('join(userData, "plugin-marketplace")');
    expect(main).toContain("marketplaceSourceConfigFromEnv(process.env)");
    expect(main).toContain("marketplacePluginInstall");
  });
});
