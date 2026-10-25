import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installSafeStorageBackend, setPluginSecretBackend } from "../src/agent/plugins/secrets";
import { getSearchSettings, saveSearchSettings, testSearchSettings } from "../src/main/search-settings";
import { loadSearchConfig, makeWebSearch } from "../src/tools/web-search";
import type { SearchSettingsInput } from "../src/main/ipc-protocol";

let dir: string;
let config: string;
const input = (patch: Partial<SearchSettingsInput> = {}): SearchSettingsInput => ({
  enabled: true, provider: "searxng", endpoint: "https://search.example", allowLocalEndpoint: false, ...patch,
});
const safe = {
  isEncryptionAvailable: () => true,
  encryptString: (plain: string) => Buffer.from(plain.split("").reverse().join("")),
  decryptString: (bytes: Buffer) => bytes.toString().split("").reverse().join(""),
};
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "cairn-search-settings-"));
  config = join(dir, ".agent", "config.json");
  setPluginSecretBackend(null);
});
afterEach(async () => {
  setPluginSecretBackend(null);
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

describe("search settings form service", () => {
  it("reads without networking; saves service URL while preserving unrelated config", async () => {
    await mkdir(join(dir, ".agent"));
    await writeFile(config, JSON.stringify({ verify: { test: ["pnpm test"] }, search: { future: "keep" } }));
    expect((await getSearchSettings(dir)).enabled).toBe(false);
    expect((await saveSearchSettings(dir, input())).ok).toBe(true);
    expect(JSON.parse(await readFile(config, "utf8"))).toMatchObject({ verify: { test: ["pnpm test"] }, search: { future: "keep", provider: "searxng" } });
    expect(loadSearchConfig(dir)).toMatchObject({ provider: "searxng", endpoint: "https://search.example/" });
  });

  it("refuses corrupt JSON without overwriting it or storing the submitted key", async () => {
    await mkdir(join(dir, ".agent"));
    await writeFile(config, "{broken secret-dont-echo");
    const r = await saveSearchSettings(dir, input({ provider: "brave", endpoint: "", apiKey: "submitted-secret" }));
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toMatch(/submitted-secret|secret-dont-echo/);
    expect(await readFile(config, "utf8")).toBe("{broken secret-dont-echo");
  });

  it("fails closed without encryption and persists encrypted endpoint-scoped keys across backend reinstall", async () => {
    const draft = input({ provider: "brave", endpoint: "", apiKey: "brave-test-secret" });
    expect((await saveSearchSettings(dir, draft)).ok).toBe(false);
    const secrets = join(dir, "secrets.json");
    installSafeStorageBackend(safe, secrets);
    expect((await saveSearchSettings(dir, draft)).ok).toBe(true);
    expect(await readFile(secrets, "utf8")).not.toContain(draft.apiKey);
    expect(await readFile(config, "utf8")).not.toContain(draft.apiKey);
    setPluginSecretBackend(null);
    installSafeStorageBackend(safe, secrets);
    expect(await getSearchSettings(dir)).toMatchObject({ hasKey: true, keySource: "stored" });
    expect(JSON.stringify(await getSearchSettings(dir))).not.toContain(draft.apiKey);
    let auth = "";
    const tested = await testSearchSettings(dir, undefined, {
      resolveHost: async () => ["8.8.8.8"],
      fetchImpl: async (_url, init) => {
        auth = new Headers(init.headers).get("X-Subscription-Token") ?? "";
        return new Response('{"web":{"results":[]}}');
      },
    });
    expect(tested).toMatchObject({ ok: true, resultCount: 0 });
    expect(auth).toBe(draft.apiKey);
    expect((await saveSearchSettings(dir, { ...draft, endpoint: "https://different.example/search", apiKey: undefined })).ok).toBe(true);
    expect(await getSearchSettings(dir)).toMatchObject({ hasKey: false, keySource: "none" });
  });

  it("returns no endpoint credentials when reading pre-existing unsafe URLs", async () => {
    await mkdir(join(dir, ".agent"));
    for (const endpoint of ["https://user:existing-secret@search.example/?q={query}", "https://search.example/?q={query}&api_key=existing-secret"]) {
      await writeFile(config, JSON.stringify({ search: { endpoint } }));
      const snapshot = await getSearchSettings(dir);
      expect(snapshot.error).toBeTruthy();
      expect(JSON.stringify(snapshot)).not.toContain("existing-secret");
    }
  });

  it("keeps an unchanged key, supports explicit deletion, and uses provider environment keys", async () => {
    installSafeStorageBackend(safe, join(dir, "secrets.json"));
    expect((await saveSearchSettings(dir, input({ provider: "tavily", endpoint: "", apiKey: "secret" }))).ok).toBe(true);
    expect((await saveSearchSettings(dir, input({ provider: "tavily", endpoint: "" }))).ok).toBe(true);
    expect((await getSearchSettings(dir)).hasKey).toBe(true);
    expect((await saveSearchSettings(dir, input({ provider: "tavily", endpoint: "", clearApiKey: true }))).ok).toBe(true);
    expect((await getSearchSettings(dir)).hasKey).toBe(false);
    vi.stubEnv("TAVILY_API_KEY", "environment-secret");
    expect(await getSearchSettings(dir)).toMatchObject({ hasKey: true, keySource: "environment" });
  });

  it("makes one explicit draft query without writing", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ results: [{ title: "Test", url: "https://example.com" }] })));
    const deps = { fetchImpl, resolveHost: async () => ["8.8.8.8"] };
    const r = await testSearchSettings(dir, input(), deps);
    expect(r).toMatchObject({ ok: true, resultCount: 1 });
    expect(r.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await expect(readFile(config)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each([
    ["login HTML", "<html>Please log in</html>"],
    ["error JSON", '{"error":"denied"}'],
    ["null root", "null"],
    ["array root", "[]"],
    ["null results", '{"results":null}'],
    ["object results", '{"results":{"title":"bad","url":"https://example.com"}}'],
    ["string results", '{"results":"[]"}'],
    ["malformed entry", '{"results":[{}]}'],
    ["unsafe result URL", '{"results":[{"title":"invalid","url":"javascript:alert(1)"}]}'],
  ])("rejects %s as connection success", async (_shape, body) => {
    const failed = await testSearchSettings(dir, input(), {
      resolveHost: async () => ["8.8.8.8"],
      fetchImpl: async () => new Response(body),
    });
    expect(failed).toMatchObject({ ok: false, resultCount: 0 });
    expect(failed.error).toContain("有效的检索结果 JSON");
  });

  it("accepts an empty results array as a valid response with zero results", async () => {
    const empty = await testSearchSettings(dir, input(), {
      resolveHost: async () => ["8.8.8.8"],
      fetchImpl: async () => new Response('{"results":[]}'),
    });
    expect(empty).toMatchObject({ ok: true, resultCount: 0 });
    expect(empty.error).toBeUndefined();
  });

  it("does not send credentials in URLs, leaks no API key in error responses, and disables the tool explicitly", async () => {
    const rejected = await saveSearchSettings(dir, input({ endpoint: "https://search.example/?api_key=secret" }));
    expect(rejected.ok).toBe(false);
    const failure = await testSearchSettings(dir, input({ provider: "brave", endpoint: "", apiKey: "never-expose" }), {
      resolveHost: async () => ["8.8.8.8"],
      fetchImpl: async () => { throw new Error("failed with never-expose"); },
    });
    expect(failure.ok).toBe(false);
    expect(JSON.stringify(failure)).not.toContain("never-expose");
    expect((await saveSearchSettings(dir, input({ enabled: false }))).ok).toBe(true);
    expect(loadSearchConfig(dir)).toBeNull();
    expect((await makeWebSearch().run({ query: "test" }, { workspace: dir })).ok).toBe(false);
  });
});
