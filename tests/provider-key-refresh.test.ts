import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { injectStoredProviderKey } from "../src/main/provider-key-inject";
import { setProviderKeyBackend } from "../src/main/provider-keys";
import { handleProviderKeyDelete, handleProviderKeySet } from "../src/main/settings-handlers";
import { installCustomEnvKeys } from "../src/providers/env-keys";

let original: string | undefined;
let keys: Map<string, string>;
beforeEach(() => {
  original = process.env.CAIRN_API_KEY;
  delete process.env.CAIRN_API_KEY;
  keys = new Map();
  setProviderKeyBackend({
    name: "refresh-fixture", isAvailable: () => true,
    async set(provider, value) { keys.set(provider, value); },
    async get(provider) { return keys.get(provider) ?? null; },
    async delete(provider) { return keys.delete(provider); },
    async storedProviders() { return [...keys.keys()]; },
  });
});
afterEach(() => {
  setProviderKeyBackend(null);
  installCustomEnvKeys({});
  if (original === undefined) delete process.env.CAIRN_API_KEY;
  else process.env.CAIRN_API_KEY = original;
});

describe("provider key lifecycle in the application", () => {
  it("saving a key activates it before the handler resolves", async () => {
    expect(await handleProviderKeySet("glm", "fixture-first")).toEqual({ ok: true });
    expect(process.env.CAIRN_API_KEY).toBe("fixture-first");
  });

  it("replacing a Cairn-injected key updates the running provider", async () => {
    keys.set("glm", "fixture-old");
    await injectStoredProviderKey(["glm"]);
    expect(await handleProviderKeySet("glm", "fixture-replacement")).toEqual({ ok: true });
    expect(process.env.CAIRN_API_KEY).toBe("fixture-replacement");
  });

  it("deleting a Cairn-injected key removes it from the running environment", async () => {
    keys.set("glm", "fixture-owned");
    await injectStoredProviderKey(["glm"]);
    expect(await handleProviderKeyDelete("glm")).toEqual({ ok: true });
    expect(process.env.CAIRN_API_KEY).toBeUndefined();
  });

  it("external credentials remain authoritative across save and delete", async () => {
    process.env.CAIRN_API_KEY = "fixture-external";
    expect(await handleProviderKeySet("glm", "fixture-stored")).toEqual({ ok: true });
    expect(process.env.CAIRN_API_KEY).toBe("fixture-external");
    expect(await handleProviderKeyDelete("glm")).toEqual({ ok: true });
    expect(process.env.CAIRN_API_KEY).toBe("fixture-external");
  });

  it("an externally replaced env value is no longer owned by Cairn", async () => {
    keys.set("glm", "fixture-owned");
    await injectStoredProviderKey(["glm"]);
    process.env.CAIRN_API_KEY = "fixture-external-replacement";
    await handleProviderKeySet("glm", "fixture-new-stored");
    await handleProviderKeyDelete("glm");
    expect(process.env.CAIRN_API_KEY).toBe("fixture-external-replacement");
  });

  it("providers sharing an env name cannot replace or delete each other's active key", async () => {
    installCustomEnvKeys({ "fixture-alias": "CAIRN_API_KEY" });
    keys.set("glm", "fixture-builtin");
    keys.set("fixture-alias", "fixture-alias-value");
    await injectStoredProviderKey(["glm", "fixture-alias"]);
    expect(process.env.CAIRN_API_KEY).toBe("fixture-builtin");
    await handleProviderKeySet("fixture-alias", "fixture-alias-replaced");
    await handleProviderKeyDelete("fixture-alias");
    expect(process.env.CAIRN_API_KEY).toBe("fixture-builtin");
    await handleProviderKeySet("glm", "fixture-builtin-refreshed");
    expect(process.env.CAIRN_API_KEY).toBe("fixture-builtin-refreshed");
  });

  it("deleting an unloaded provider revokes its prior injection without consulting its current mapping", async () => {
    installCustomEnvKeys({ "fixture-unloaded": "CAIRN_API_KEY" });
    await handleProviderKeySet("fixture-unloaded", "fixture-owned-before-unload");
    installCustomEnvKeys({});
    expect(await handleProviderKeyDelete("fixture-unloaded")).toEqual({ ok: true });
    expect(process.env.CAIRN_API_KEY).toBeUndefined();
  });

  it("a remapped provider leaves no old injection behind after deletion", async () => {
    const savedOther = process.env.CAIRN_FIXTURE_REMAPPED_KEY;
    try {
      delete process.env.CAIRN_FIXTURE_REMAPPED_KEY;
      installCustomEnvKeys({ "fixture-remapped": "CAIRN_API_KEY" });
      await handleProviderKeySet("fixture-remapped", "fixture-old-mapping");
      installCustomEnvKeys({ "fixture-remapped": "CAIRN_FIXTURE_REMAPPED_KEY" });
      await handleProviderKeySet("fixture-remapped", "fixture-new-mapping");
      expect(process.env.CAIRN_API_KEY).toBeUndefined();
      expect(process.env.CAIRN_FIXTURE_REMAPPED_KEY).toBe("fixture-new-mapping");
      expect(await handleProviderKeyDelete("fixture-remapped")).toEqual({ ok: true });
      expect(process.env.CAIRN_FIXTURE_REMAPPED_KEY).toBeUndefined();
    } finally {
      if (savedOther === undefined) delete process.env.CAIRN_FIXTURE_REMAPPED_KEY;
      else process.env.CAIRN_FIXTURE_REMAPPED_KEY = savedOther;
    }
  });
});
