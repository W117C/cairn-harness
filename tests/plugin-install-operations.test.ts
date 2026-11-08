import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { pluginFingerprintEx, TrustStore } from "../src/agent/plugins/trust";
import { discoverPlugins, defaultUserPluginsDir } from "../src/agent/plugins";
import {
  getPluginSecret,
  pluginUserConfigDir,
  putPluginSecret,
  readPluginUserConfig,
  setPluginSecretBackend,
  writePluginUserConfig,
  type PluginSecretBackend,
} from "../src/agent/plugins/secrets";
import {
  InstalledPluginRegistry,
  type InstalledPluginRecord,
  type PluginInstallRegistryPort,
} from "../src/main/plugin-install-registry";
import {
  configureInstalledPlugin,
  setPluginEnabled,
  uninstallPlugin,
} from "../src/main/plugin-install-operations";

const dirs: string[] = [];
const NOW = Date.parse("2026-10-29T12:00:00.000Z");

afterEach(() => {
  setPluginSecretBackend(null);
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "cairn-plugin-operations-"));
  dirs.push(dir);
  return dir;
}

function pluginDir(
  root: string,
  name: string,
  version = "1.2.3",
  manifest: Record<string, unknown> = {},
): string {
  const target = join(root, name);
  mkdirSync(join(target, ".claude-plugin"), { recursive: true });
  writeFileSync(join(target, ".claude-plugin", "plugin.json"), JSON.stringify({ name, version, ...manifest }));
  return target;
}

function memorySecrets(): { backend: PluginSecretBackend; store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    backend: {
      name: "memory",
      isAvailable: () => true,
      set: async (key, value) => { store.set(key, value); },
      get: async (key) => store.get(key) ?? null,
      delete: async (key) => { store.delete(key); },
      deleteMany: async (keys) => { for (const key of keys) store.delete(key); },
    },
  };
}

function record(enabled: boolean, overrides: Partial<InstalledPluginRecord> = {}): InstalledPluginRecord {
  return {
    entryId: "demo-plugin",
    manifestName: "demo-plugin",
    version: "1.2.3",
    sha256: "a".repeat(64),
    fingerprint: "f".repeat(32),
    source: {
      kind: "catalog",
      catalogId: "cairn",
      entryId: "demo-plugin",
      sourceUrl: "https://github.com/example/demo-plugin",
      revision: "",
    },
    scope: "user",
    workspace: null,
    enabled,
    installedAt: new Date(NOW - 10_000).toISOString(),
    updatedAt: new Date(NOW - 10_000).toISOString(),
    ...overrides,
  };
}

describe("plugin install operations", () => {
  it("moves a disabled plugin into the active root before reporting enabled", async () => {
    const pluginDataRoot = scratch();
    const registry = new InstalledPluginRegistry(join(pluginDataRoot, "installed.json"), () => NOW);
    const disabledRoot = join(pluginDataRoot, "marketplace", "disabled", "user");
    const installed = pluginDir(disabledRoot, "demo-plugin");
    await registry.upsert(record(false, { fingerprint: (await pluginFingerprintEx(installed)).fp }));

    const updated = await setPluginEnabled({
      pluginDataRoot,
      registry,
      entryId: "demo-plugin",
      scope: "user",
      enabled: true,
      workspace: null,
      now: () => NOW,
    });

    expect(updated.enabled).toBe(true);
    expect(updated.updatedAt).toBe(new Date(NOW).toISOString());
    expect(existsSync(join(pluginDataRoot, "plugins", "demo-plugin", ".claude-plugin", "plugin.json"))).toBe(true);
    expect(existsSync(join(disabledRoot, "demo-plugin"))).toBe(false);
  });

  it("restores the package path when registry state cannot be updated", async () => {
    const pluginDataRoot = scratch();
    const activeRoot = join(pluginDataRoot, "plugins");
    pluginDir(activeRoot, "demo-plugin");
    const base = new InstalledPluginRegistry(join(pluginDataRoot, "installed.json"), () => NOW);
    await base.upsert(record(true));
    const failing: PluginInstallRegistryPort = {
      list: () => base.list(),
      get: (entryId, scope, workspace) => base.get(entryId, scope, workspace),
      upsert: async () => { throw new Error("registry write failed"); },
      remove: (entryId, scope, workspace) => base.remove(entryId, scope, workspace),
    };

    await expect(setPluginEnabled({
      pluginDataRoot,
      registry: failing,
      entryId: "demo-plugin",
      scope: "user",
      enabled: false,
      workspace: null,
      now: () => NOW,
    })).rejects.toThrow(/registry write failed/i);

    expect(existsSync(join(activeRoot, "demo-plugin", ".claude-plugin", "plugin.json"))).toBe(true);
    expect(existsSync(join(pluginDataRoot, "marketplace", "disabled", "user", "demo-plugin"))).toBe(false);
    expect(await base.get("demo-plugin", "user", null)).toEqual(record(true));
  });

  it("uninstalls only registry-owned files and forgets their trust entries", async () => {
    const pluginDataRoot = scratch();
    const activeRoot = join(pluginDataRoot, "plugins");
    const owned = pluginDir(activeRoot, "demo-plugin");
    const manual = pluginDir(activeRoot, "manual-plugin");
    const registry = new InstalledPluginRegistry(join(pluginDataRoot, "installed.json"), () => NOW);
    await registry.upsert(record(true));
    const trust = new TrustStore(join(pluginDataRoot, "plugin-trust.json"));
    await trust.decide(owned, true, "f".repeat(32));

    await uninstallPlugin({
      pluginDataRoot,
      registry,
      trust,
      entryId: "demo-plugin",
      scope: "user",
      workspace: null,
      now: () => NOW,
    });

    expect(existsSync(owned)).toBe(false);
    expect(existsSync(manual)).toBe(true);
    expect(await registry.get("demo-plugin", "user", null)).toBeNull();
    expect(await trust.status(owned, "f".repeat(32))).toBe("pending");

    await expect(uninstallPlugin({
      pluginDataRoot,
      registry,
      trust,
      entryId: "manual-plugin",
      scope: "user",
      workspace: null,
      now: () => NOW,
    })).rejects.toThrow(/not installed|registry/i);
    expect(existsSync(manual)).toBe(true);
  });

  it("forgets trust from the disabled root when uninstalling a disabled plugin", async () => {
    const pluginDataRoot = scratch();
    const disabledRoot = join(pluginDataRoot, "marketplace", "disabled", "user");
    const owned = pluginDir(disabledRoot, "demo-plugin");
    const fingerprint = (await pluginFingerprintEx(owned)).fp;
    const registry = new InstalledPluginRegistry(join(pluginDataRoot, "installed.json"), () => NOW);
    await registry.upsert(record(false, { fingerprint }));
    const trust = new TrustStore(join(pluginDataRoot, "plugin-trust.json"));
    await trust.decide(owned, true, fingerprint);

    await uninstallPlugin({
      pluginDataRoot,
      registry,
      trust,
      entryId: "demo-plugin",
      scope: "user",
      workspace: null,
      now: () => NOW,
    });

    expect(existsSync(owned)).toBe(false);
    expect(await trust.status(owned, fingerprint)).toBe("pending");
  });

  it("restores the package and registry when trust cleanup fails during uninstall", async () => {
    const pluginDataRoot = scratch();
    const activeRoot = join(pluginDataRoot, "plugins");
    const owned = pluginDir(activeRoot, "demo-plugin");
    const registry = new InstalledPluginRegistry(join(pluginDataRoot, "installed.json"), () => NOW);
    await registry.upsert(record(true));
    const failingTrust = {
      status: async () => "trusted" as const,
      forget: async () => { throw new Error("trust write failed"); },
      decide: async () => undefined,
    } as unknown as TrustStore;

    await expect(uninstallPlugin({
      pluginDataRoot,
      registry,
      trust: failingTrust,
      entryId: "demo-plugin",
      scope: "user",
      workspace: null,
    })).rejects.toThrow(/trust write failed/i);

    expect(existsSync(join(owned, ".claude-plugin", "plugin.json"))).toBe(true);
    expect(await registry.get("demo-plugin", "user", null)).toEqual(record(true));
  });

  it("restores disabled-root trust when uninstall rolls back after secret deletion fails", async () => {
    const pluginDataRoot = scratch();
    const disabledRoot = join(pluginDataRoot, "marketplace", "disabled", "user");
    const owned = pluginDir(disabledRoot, "demo-plugin");
    const fingerprint = (await pluginFingerprintEx(owned)).fp;
    const registry = new InstalledPluginRegistry(join(pluginDataRoot, "installed.json"), () => NOW);
    await registry.upsert(record(false, { fingerprint }));
    const trust = new TrustStore(join(pluginDataRoot, "plugin-trust.json"));
    await trust.decide(owned, true, fingerprint);
    const calls: string[] = [];
    const recordingTrust = {
      status: async (path: string, fp: string) => {
        calls.push(`status:${path}`);
        return trust.status(path, fp);
      },
      forget: async (path: string) => {
        calls.push(`forget:${path}`);
        return trust.forget(path);
      },
      decide: async (path: string, allowed: boolean, fp: string) => {
        calls.push(`decide:${path}`);
        return trust.decide(path, allowed, fp);
      },
    } as unknown as TrustStore;

    await expect(uninstallPlugin({
      pluginDataRoot,
      registry,
      trust: recordingTrust,
      entryId: "demo-plugin",
      scope: "user",
      workspace: null,
      deleteSecrets: async () => { throw new Error("secret store unavailable"); },
    })).rejects.toThrow(/secret store unavailable/i);

    expect(calls).toEqual([
      `status:${owned}`,
      `forget:${owned}`,
      `decide:${owned}`,
    ]);
    expect(await trust.status(owned, fingerprint)).toBe("trusted");
  });

  it("rejects enabling through a symlinked project root", async () => {
    const pluginDataRoot = scratch();
    const workspace = scratch();
    const outside = scratch();
    mkdirSync(join(workspace, ".agent"), { recursive: true });
    const installed = pluginDir(outside, "demo-plugin");
    symlinkSync(outside, join(workspace, ".agent", "plugin-disabled"), "dir");
    const registry = new InstalledPluginRegistry(join(pluginDataRoot, "installed.json"), () => NOW);
    await registry.upsert(record(false, {
      scope: "project",
      workspace,
      fingerprint: (await pluginFingerprintEx(installed)).fp,
    }));

    await expect(setPluginEnabled({
      pluginDataRoot,
      registry,
      entryId: "demo-plugin",
      scope: "project",
      workspace,
      enabled: true,
    })).rejects.toThrow(/symbolic|symlink|real directory/i);

    expect(existsSync(join(outside, "demo-plugin", ".claude-plugin", "plugin.json"))).toBe(true);
    expect(existsSync(join(workspace, ".agent", "plugins", "demo-plugin"))).toBe(false);
  });

  it("honors the actual user plugin root when enabling a package", async () => {
    const pluginDataRoot = scratch();
    const userPluginsDir = scratch();
    const registry = new InstalledPluginRegistry(join(pluginDataRoot, "installed.json"), () => NOW);
    const installed = pluginDir(join(pluginDataRoot, "marketplace", "disabled", "user"), "demo-plugin");
    await registry.upsert(record(false, { fingerprint: (await pluginFingerprintEx(installed)).fp }));

    await setPluginEnabled({
      pluginDataRoot,
      userPluginsDir,
      registry,
      entryId: "demo-plugin",
      scope: "user",
      workspace: null,
      enabled: true,
    });

    expect(existsSync(join(userPluginsDir, "demo-plugin", ".claude-plugin", "plugin.json"))).toBe(true);
  });

  it("does not move a package when the mutation gate rejects the operation", async () => {
    const pluginDataRoot = scratch();
    const registry = new InstalledPluginRegistry(join(pluginDataRoot, "installed.json"), () => NOW);
    const disabled = pluginDir(join(pluginDataRoot, "marketplace", "disabled", "user"), "demo-plugin");
    await registry.upsert(record(false));

    await expect(setPluginEnabled({
      pluginDataRoot,
      registry,
      entryId: "demo-plugin",
      scope: "user",
      workspace: null,
      enabled: true,
      assertIdle: () => { throw new Error("session still running"); },
    })).rejects.toThrow(/session still running/i);

    expect(existsSync(join(disabled, ".claude-plugin", "plugin.json"))).toBe(true);
    expect(await registry.get("demo-plugin", "user", null)).toEqual(record(false));
  });

  it("refuses to enable a package whose content no longer matches the registry", async () => {
    const pluginDataRoot = scratch();
    const registry = new InstalledPluginRegistry(join(pluginDataRoot, "installed.json"), () => NOW);
    const disabled = pluginDir(join(pluginDataRoot, "marketplace", "disabled", "user"), "demo-plugin");
    await registry.upsert(record(false));

    await expect(setPluginEnabled({
      pluginDataRoot,
      registry,
      entryId: "demo-plugin",
      scope: "user",
      workspace: null,
      enabled: true,
    })).rejects.toThrow(/fingerprint|content/i);

    expect(existsSync(join(disabled, ".claude-plugin", "plugin.json"))).toBe(true);
    expect(await registry.get("demo-plugin", "user", null)).toEqual(record(false));
  });

  it("keeps uninstall tombstones outside the active plugin scan root", async () => {
    const pluginDataRoot = scratch();
    const activeRoot = join(pluginDataRoot, "plugins");
    pluginDir(activeRoot, "demo-plugin");
    const registry = new InstalledPluginRegistry(join(pluginDataRoot, "installed.json"), () => NOW);
    await registry.upsert(record(true));
    let releaseForget!: () => void;
    const forgetRelease = new Promise<void>((resolve) => { releaseForget = resolve; });
    let markForgetStarted!: () => void;
    const forgetStarted = new Promise<void>((resolve) => { markForgetStarted = resolve; });
    const blockingTrust = {
      status: async () => "trusted" as const,
      decide: async () => undefined,
      forget: async () => {
        markForgetStarted();
        await forgetRelease;
      },
    } as unknown as TrustStore;
    const removing = uninstallPlugin({
      pluginDataRoot,
      registry,
      trust: blockingTrust,
      entryId: "demo-plugin",
      scope: "user",
      workspace: null,
    });
    await forgetStarted;

    expect(readdirSync(activeRoot)).toEqual([]);

    releaseForget();
    await expect(removing).resolves.toEqual({ ok: true });
  });

  it("does not scan disabled or staging packages", async () => {
    const home = scratch();
    const userPluginsDir = defaultUserPluginsDir(home);
    pluginDir(userPluginsDir, "active-plugin");
    pluginDir(join(home, ".config", "cairn", "plugin-data", "marketplace", "disabled", "user"), "disabled-plugin");
    pluginDir(join(home, ".config", "cairn", "plugin-data", "marketplace", "staging", "job"), "staged-plugin");

    const manifest = await discoverPlugins({
      userPluginsDir,
      projectPluginsDir: join(scratch(), ".agent", "plugins"),
    });
    expect(manifest.plugins.map((plugin) => plugin.name)).toEqual(["active-plugin"]);
  });

  it("configures a disabled package by reparsing its manifest", async () => {
    const pluginDataRoot = scratch();
    const secrets = memorySecrets();
    setPluginSecretBackend(secrets.backend);
    const registry = new InstalledPluginRegistry(join(pluginDataRoot, "installed.json"), () => NOW);
    const installed = pluginDir(
      join(pluginDataRoot, "marketplace", "disabled", "user"),
      "demo-plugin",
      "1.2.3",
      {
        userConfig: {
          TOKEN: { type: "string", sensitive: true, required: true },
          REGION: { type: "string", required: true },
        },
      },
    );
    await registry.upsert(record(false, { fingerprint: (await pluginFingerprintEx(installed)).fp }));

    await configureInstalledPlugin({
      pluginDataRoot,
      registry,
      entryId: "demo-plugin",
      scope: "user",
      workspace: null,
      values: { TOKEN: "secret", REGION: "cn" },
    });

    const read = await readPluginUserConfig({
      dir: pluginUserConfigDir(pluginDataRoot, "demo-plugin"),
      plugin: "demo-plugin",
      fields: [
        { key: "TOKEN", type: "string", required: true, sensitive: true, hasDefault: false },
        { key: "REGION", type: "string", required: true, sensitive: false, hasDefault: false },
      ],
    });
    expect(read.values).toMatchObject({ TOKEN: "secret", REGION: "cn" });
    expect((await registry.get("demo-plugin", "user", null))?.enabled).toBe(false);
  });

  it("rejects unknown or missing required config without enabling the package", async () => {
    const pluginDataRoot = scratch();
    setPluginSecretBackend(memorySecrets().backend);
    const registry = new InstalledPluginRegistry(join(pluginDataRoot, "installed.json"), () => NOW);
    const installed = pluginDir(
      join(pluginDataRoot, "marketplace", "disabled", "user"),
      "demo-plugin",
      "1.2.3",
      { userConfig: { REQUIRED: { type: "string", required: true } } },
    );
    await registry.upsert(record(false, { fingerprint: (await pluginFingerprintEx(installed)).fp }));
    const base = {
      pluginDataRoot,
      registry,
      entryId: "demo-plugin",
      scope: "user" as const,
      workspace: null,
    };

    await expect(configureInstalledPlugin({ ...base, values: { UNKNOWN: "x" } }))
      .rejects.toThrow(/unknown|未知/i);
    await expect(configureInstalledPlugin({ ...base, values: {} }))
      .rejects.toThrow(/required|必填/i);
    expect((await registry.get("demo-plugin", "user", null))?.enabled).toBe(false);
  });

  it("removes package, trust, config, and secrets on uninstall", async () => {
    const pluginDataRoot = scratch();
    const secrets = memorySecrets();
    setPluginSecretBackend(secrets.backend);
    const activeRoot = join(pluginDataRoot, "plugins");
    const owned = pluginDir(activeRoot, "demo-plugin", "1.2.3", {
      userConfig: { TOKEN: { type: "string", sensitive: true } },
    });
    const registry = new InstalledPluginRegistry(join(pluginDataRoot, "installed.json"), () => NOW);
    await registry.upsert(record(true, { fingerprint: (await pluginFingerprintEx(owned)).fp }));
    const trust = new TrustStore(join(pluginDataRoot, "plugin-trust.json"));
    await trust.decide(owned, true, "f".repeat(32));
    const configDir = pluginUserConfigDir(pluginDataRoot, "demo-plugin");
    await writePluginUserConfig({
      plugin: "demo-plugin",
      fields: [{ key: "TOKEN", type: "string", required: false, sensitive: true, hasDefault: false }],
      values: { TOKEN: "secret" },
      dir: configDir,
    });

    await uninstallPlugin({
      pluginDataRoot,
      registry,
      trust,
      entryId: "demo-plugin",
      scope: "user",
      workspace: null,
      now: () => NOW,
    });

    expect(existsSync(owned)).toBe(false);
    expect(existsSync(configDir)).toBe(false);
    expect(await getPluginSecret("demo-plugin", "TOKEN")).toBeNull();
    expect(await registry.get("demo-plugin", "user", null)).toBeNull();
  });

  it("restores every surface when secret deletion fails during uninstall", async () => {
    const pluginDataRoot = scratch();
    const activeRoot = join(pluginDataRoot, "plugins");
    const owned = pluginDir(activeRoot, "demo-plugin", "1.2.3", {
      userConfig: { TOKEN: { type: "string", sensitive: true } },
    });
    const registry = new InstalledPluginRegistry(join(pluginDataRoot, "installed.json"), () => NOW);
    const original = record(true, { fingerprint: (await pluginFingerprintEx(owned)).fp });
    await registry.upsert(original);
    const trust = new TrustStore(join(pluginDataRoot, "plugin-trust.json"));
    await trust.decide(owned, true, original.fingerprint);
    const configDir = pluginUserConfigDir(pluginDataRoot, "demo-plugin");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "plugin-userconfig.json"), JSON.stringify({
      plugin: "demo-plugin",
      config: { TOKEN: "<sensitive>" },
      secretKeys: ["TOKEN"],
    }));

    await expect(uninstallPlugin({
      pluginDataRoot,
      registry,
      trust,
      entryId: "demo-plugin",
      scope: "user",
      workspace: null,
      deleteSecrets: async () => { throw new Error("secret delete failed"); },
    })).rejects.toThrow(/secret/i);

    expect(existsSync(join(owned, ".claude-plugin", "plugin.json"))).toBe(true);
    expect(existsSync(configDir)).toBe(true);
    expect(await registry.get("demo-plugin", "user", null)).toEqual(original);
    expect(await trust.status(owned, original.fingerprint)).toBe("trusted");
  });
});
