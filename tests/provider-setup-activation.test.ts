import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { commitProviderSetup, prepareCustomProvider } from "../src/main/provider-setup";
import { installCustomProviders, installedCustomProviders } from "../src/providers/registry";
import { setProviderKeyBackend } from "../src/main/provider-keys";
import { revokeInjectedProviderKey } from "../src/main/provider-key-inject";

let root: string;
let oldEnv: string | undefined;
const provider = "fixture-transaction";
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "cairn-provider-transaction-"));
  oldEnv = process.env.CAIRN_FIXTURE_TRANSACTION_KEY;
  delete process.env.CAIRN_FIXTURE_TRANSACTION_KEY;
  const keys = new Map<string, string>();
  setProviderKeyBackend({
    name: "transaction-fixture", isAvailable: () => true,
    async set(id, key) { keys.set(id, key); },
    async get(id) { return keys.get(id) ?? null; },
    async delete(id) { return keys.delete(id); },
    async storedProviders() { return [...keys.keys()]; },
  });
});
afterEach(async () => {
  revokeInjectedProviderKey(provider);
  installCustomProviders([]);
  setProviderKeyBackend(null);
  if (oldEnv === undefined) delete process.env.CAIRN_FIXTURE_TRANSACTION_KEY;
  else process.env.CAIRN_FIXTURE_TRANSACTION_KEY = oldEnv;
  await rm(root, { recursive: true, force: true });
});

function prepare() {
  const prepared = prepareCustomProvider(root, {
    id: provider, protocol: "openai", baseURL: "https://example.com/v1",
    apiKeyEnv: "CAIRN_FIXTURE_TRANSACTION_KEY", models: [{ id: "standard", model: "fixture-model" }],
  });
  if (!prepared.ok) throw new Error(prepared.error);
  return prepared;
}

describe("custom provider configuration activates only after commit", () => {
  it("a failed first configuration commit does not activate the new credential", async () => {
    const prepared = prepare();
    await mkdir(prepared.path, { recursive: true }); // A real filesystem failure at rename.
    const result = await commitProviderSetup(prepared, provider, "fixture-uncommitted");
    expect(result.ok).toBe(false);
    expect(installedCustomProviders()).toEqual([]);
    expect(process.env.CAIRN_FIXTURE_TRANSACTION_KEY).toBeUndefined();
  });

  it("a failed configuration replacement leaves the running credential unchanged", async () => {
    const initial = prepare();
    expect((await commitProviderSetup(initial, provider, "fixture-original")).ok).toBe(true);
    const prepared = prepare();
    await rm(prepared.path);
    await mkdir(prepared.path);
    expect((await commitProviderSetup(prepared, provider, "fixture-uncommitted-replacement")).ok).toBe(false);
    expect(process.env.CAIRN_FIXTURE_TRANSACTION_KEY).toBe("fixture-original");
    expect(installedCustomProviders().map(item => item.id)).toEqual([provider]);
  });

  it("success returns only after configuration and credential are usable", async () => {
    const prepared = prepare();
    await mkdir(dirname(prepared.path), { recursive: true });
    expect((await commitProviderSetup(prepared, provider, "fixture-committed")).ok).toBe(true);
    expect(JSON.parse(await readFile(prepared.path, "utf8")).providers[0].id).toBe(provider);
    expect(process.env.CAIRN_FIXTURE_TRANSACTION_KEY).toBe("fixture-committed");
  });
});
