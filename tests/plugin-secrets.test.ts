import { afterEach, describe, expect, it } from "vitest";
import {
  deletePluginSecrets,
  getPluginSecret,
  putPluginSecret,
  setPluginSecretBackend,
  type PluginSecretBackend,
} from "../src/agent/plugins/secrets";

afterEach(() => {
  setPluginSecretBackend(null);
});

function backend(options: { atomic?: boolean } = {}): {
  adapter: PluginSecretBackend;
  store: Map<string, string>;
} {
  const store = new Map<string, string>();
  const adapter: PluginSecretBackend = {
    name: "memory",
    isAvailable: () => true,
    set: async (key, value) => { store.set(key, value); },
    get: async (key) => store.get(key) ?? null,
    delete: async (key) => { store.delete(key); },
    ...(options.atomic === false
      ? {}
      : { deleteMany: async (keys: readonly string[]) => { for (const key of keys) store.delete(key); } }),
  };
  return { adapter, store };
}

describe("plugin secret deletion", () => {
  it("deletes only the requested plugin fields", async () => {
    const secrets = backend();
    setPluginSecretBackend(secrets.adapter);
    await putPluginSecret("demo-plugin", "A", "one");
    await putPluginSecret("demo-plugin", "B", "two");
    await putPluginSecret("other-plugin", "A", "three");

    await deletePluginSecrets("demo-plugin", ["A"]);

    expect(await getPluginSecret("demo-plugin", "A")).toBeNull();
    expect(await getPluginSecret("demo-plugin", "B")).toBe("two");
    expect(await getPluginSecret("other-plugin", "A")).toBe("three");
  });

  it("fails closed when the backend cannot delete or no secure backend exists", async () => {
    setPluginSecretBackend(backend({ atomic: false }).adapter);
    await expect(deletePluginSecrets("demo-plugin", ["A"])).rejects.toThrow(/delete|删除/i);
    setPluginSecretBackend(null);
    await expect(deletePluginSecrets("demo-plugin", ["A"])).rejects.toThrow(/backend|后端|safeStorage/i);
  });
});
