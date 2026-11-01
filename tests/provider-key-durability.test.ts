import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installCustomEnvKeys } from "../src/providers/env-keys";
import {
  deleteProviderKey, getProviderKey, installProviderKeyBackend, providerKeyStatus,
  putProviderKey, setProviderKeyBackend, type SafeStorageIo,
} from "../src/main/provider-keys";

function encryptedBackend(): SafeStorageIo {
  const key = randomBytes(32);
  return {
    isEncryptionAvailable: () => true,
    encryptString(value) {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
    },
    decryptString(value) {
      const cipher = createDecipheriv("aes-256-gcm", key, value.subarray(0, 12));
      cipher.setAuthTag(value.subarray(12, 28));
      return Buffer.concat([cipher.update(value.subarray(28)), cipher.final()]).toString("utf8");
    },
  };
}

let dir: string;
let path: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "cairn-key-durability-"));
  path = join(dir, "keys.json");
  installProviderKeyBackend(encryptedBackend(), path);
});
afterEach(async () => {
  setProviderKeyBackend(null);
  installCustomEnvKeys({});
  await rm(dir, { recursive: true, force: true });
});

describe("provider key persistence", () => {
  it("parallel saves retain every encrypted key", async () => {
    const providers = ["glm", "openai", "anthropic", "gemini", "deepseek"];
    const results = await Promise.all(providers.map(provider => putProviderKey(provider, `fixture-${provider}`)));
    expect(results).toEqual(providers.map(() => ({ ok: true })));
    expect((await providerKeyStatus()).stored).toEqual(["anthropic", "deepseek", "gemini", "glm", "openai"]);
    for (const provider of providers) expect(await getProviderKey(provider)).toBe(`fixture-${provider}`);
    expect(await readFile(path, "utf8")).not.toContain("fixture-");
    if (process.platform !== "win32") expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it("a concurrent delete and save cannot resurrect the deleted key", async () => {
    await putProviderKey("glm", "fixture-original");
    expect(await Promise.all([deleteProviderKey("glm"), putProviderKey("openai", "fixture-new")]))
      .toEqual([{ ok: true }, { ok: true }]);
    expect((await providerKeyStatus()).stored).toEqual(["openai"]);
  });

  it.each(["{broken-private-value", '{"version":2,"keys":{}}', '{"version":1,"keys":[]}'])(
    "a damaged store is reported without overwriting its bytes: %s", async raw => {
      await writeFile(path, raw);
      const result = await putProviderKey("glm", "fixture-new");
      expect(result.ok).toBe(false);
      expect(JSON.stringify(result)).not.toContain("broken-private-value");
      expect(await readFile(path, "utf8")).toBe(raw);
      await expect(providerKeyStatus()).rejects.toThrow(/存储/);
      await expect(getProviderKey("glm")).rejects.toThrow(/存储/);
    },
  );

  it("a failed operation does not poison subsequent operations after the file is repaired", async () => {
    await writeFile(path, "{broken");
    expect((await putProviderKey("glm", "fixture-rejected")).ok).toBe(false);
    await writeFile(path, '{"version":1,"keys":{}}');
    expect(await putProviderKey("glm", "fixture-repaired")).toEqual({ ok: true });
    expect(await getProviderKey("glm")).toBe("fixture-repaired");
  });

  it("saving in another workspace preserves an unloaded custom provider's ciphertext", async () => {
    installCustomEnvKeys({ "fixture-gateway": "FIXTURE_GATEWAY_KEY" });
    await putProviderKey("fixture-gateway", "fixture-custom");
    const before = JSON.parse(await readFile(path, "utf8")) as { keys: Record<string, unknown> };
    installCustomEnvKeys({});
    expect(await putProviderKey("openai", "fixture-builtin")).toEqual({ ok: true });
    expect((await putProviderKey("unregistered", "fixture-rejected")).ok).toBe(false);
    const after = JSON.parse(await readFile(path, "utf8")) as { keys: Record<string, unknown> };
    expect(after.keys["fixture-gateway"]).toEqual(before.keys["fixture-gateway"]);
    expect(await getProviderKey("openai")).toBe("fixture-builtin");
    installCustomEnvKeys({ "fixture-gateway": "FIXTURE_GATEWAY_KEY" });
    expect(await getProviderKey("fixture-gateway")).toBe("fixture-custom");
  });

  it("an unavailable replacement backend cannot leave the previous backend active", async () => {
    const unavailable = { ...encryptedBackend(), isEncryptionAvailable: () => false };
    expect(installProviderKeyBackend(unavailable, path)).toBe(false);
    expect((await putProviderKey("glm", "fixture-rejected")).ok).toBe(false);
    expect(await providerKeyStatus()).toEqual({ available: false, stored: [] });
  });
});
