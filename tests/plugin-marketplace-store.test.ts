import { generateKeyPairSync } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  loadPluginMarketplaceCatalog,
  marketplaceSourceConfigFromEnv,
  type MarketplaceCacheOptions,
  type MarketplaceSourceConfig,
} from "../src/main/plugin-marketplace-store";
import {
  parseMarketplaceCatalog,
  signedMarketplaceEnvelope,
  type MarketplaceCatalog,
  type MarketplaceCatalogEnvelope,
} from "../src/agent/plugins/marketplace";

const NOW = Date.parse("2026-10-29T12:00:00.000Z");
const pair = generateKeyPairSync("ed25519");
const PUBLIC_KEY = pair.publicKey.export({ type: "spki", format: "pem" }).toString();
const PRIVATE_KEY = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "cairn-marketplace-"));
  dirs.push(dir);
  return dir;
}

function catalog(overrides: Record<string, unknown> = {}): MarketplaceCatalog {
  return parseMarketplaceCatalog({
    schemaVersion: 1,
    revision: "2026-10-29.1",
    generatedAt: "2026-10-29T00:00:00.000Z",
    expiresAt: "2026-11-05T00:00:00.000Z",
    packageHosts: ["plugins.example.com"],
    entries: [{
      id: "demo-plugin",
      name: "Demo Plugin",
      summary: "Fixture plugin.",
      author: "Cairn",
      sourceUrl: "https://github.com/example/demo-plugin",
      license: "MIT",
      version: "1.2.3",
      publishedAt: "2026-10-29T00:00:00.000Z",
      packageUrl: "https://plugins.example.com/demo-plugin-1.2.3.tgz",
      sha256: "a".repeat(64),
      sizeBytes: 1024,
      capabilities: { skills: 1, commands: 0, agents: 0, hooks: 0, mcp: 0, lsp: 0 },
      permissions: [],
      minAppVersion: "0.1.0",
    }],
    shelves: [{ id: "featured", title: "精选", entryIds: ["demo-plugin"] }],
    ...overrides,
  });
}

function envelope(value: MarketplaceCatalog = catalog()): MarketplaceCatalogEnvelope {
  return signedMarketplaceEnvelope(value, PRIVATE_KEY, "current");
}

function source(overrides: Partial<MarketplaceSourceConfig> = {}): MarketplaceSourceConfig {
  return {
    catalogUrl: "https://catalog.example.com/marketplace.json",
    publicKeys: [{ id: "current", pem: PUBLIC_KEY }],
    ...overrides,
  };
}

function store(dir: string, fetchImpl: typeof fetch, now = NOW): MarketplaceCacheOptions {
  return { dir, fetchImpl, now: () => now };
}

function noFetch(): typeof fetch {
  return vi.fn(async () => {
    throw new Error("fetch should not be called");
  }) as unknown as typeof fetch;
}

function cachePath(dir: string): string {
  return join(dir, "catalog.json");
}

function seedCache(
  dir: string,
  value: MarketplaceCatalog,
  fetchedAt = "2026-10-29T11:00:00.000Z",
): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(cachePath(dir), JSON.stringify({
    schemaVersion: 1,
    fetchedAt,
    envelope: envelope(value),
  }), "utf8");
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("marketplace source config", () => {
  it("reads the URL and Ed25519 key ring from environment JSON", () => {
    const parsed = marketplaceSourceConfigFromEnv({
      CAIRN_PLUGIN_MARKETPLACE_URL: "https://catalog.example.com/marketplace.json",
      CAIRN_PLUGIN_MARKETPLACE_KEYS_JSON: JSON.stringify([{ id: "current", pem: PUBLIC_KEY }]),
    });
    expect(parsed.catalogUrl).toBe("https://catalog.example.com/marketplace.json");
    expect(parsed.publicKeys).toEqual([{ id: "current", pem: PUBLIC_KEY }]);
    expect(parsed.configProblem).toBeUndefined();
  });

  it("reports malformed keys instead of silently disabling signature checks", () => {
    const parsed = marketplaceSourceConfigFromEnv({
      CAIRN_PLUGIN_MARKETPLACE_URL: "https://catalog.example.com/marketplace.json",
      CAIRN_PLUGIN_MARKETPLACE_KEYS_JSON: "{not json",
    });
    expect(parsed.publicKeys).toEqual([]);
    expect(parsed.configProblem).toContain("KEY");
  });
});

describe("plugin marketplace verified cache", () => {
  it("writes and re-verifies a live signed catalog", async () => {
    const dir = scratch();
    const rawEnvelope = envelope();
    const readout = await loadPluginMarketplaceCatalog(
      { refresh: "force" },
      source(),
      store(dir, async () => response(rawEnvelope)),
    );

    expect(readout).toMatchObject({
      status: "ready",
      origin: "live",
      stale: false,
      fetchedAt: new Date(NOW).toISOString(),
      expiresAt: "2026-11-05T00:00:00.000Z",
    });
    expect(readout.catalog?.revision).toBe("2026-10-29.1");
    expect(statSync(cachePath(dir)).mode & 0o777).toBe(0o600);

    const cached = await loadPluginMarketplaceCatalog(
      { refresh: "never" },
      source(),
      store(dir, noFetch()),
    );
    expect(cached).toMatchObject({ status: "ready", origin: "cache", stale: false });
    expect(cached.catalog?.entries[0]?.id).toBe("demo-plugin");
  });

  it("accepts a bounded decoded payload when base64 makes the response envelope exceed 512 KiB", async () => {
    const entries = Array.from({ length: 220 }, (_, index) => ({
      id: `plugin-${String(index)}`,
      name: `Plugin ${String(index)}`,
      summary: "x".repeat(400),
      author: "Cairn",
      sourceUrl: `https://github.com/example/plugin-${String(index)}`,
      license: "MIT",
      version: "1.2.3",
      publishedAt: "2026-10-29T00:00:00.000Z",
      packageUrl: `https://plugins.example.com/plugin-${String(index)}.tgz`,
      sha256: "a".repeat(64),
      sizeBytes: 1024,
      capabilities: { skills: 1, commands: 1, agents: 0, hooks: 0, mcp: 1, lsp: 0 },
      permissions: Array.from(
        { length: 16 },
        (_, permissionIndex) => `permission-${String(index)}-${String(permissionIndex)}`.padEnd(64, "x"),
      ),
      minAppVersion: "0.1.0",
    }));
    const largeCatalog = catalog({ entries, shelves: [] });
    const rawEnvelope = envelope(largeCatalog);
    expect(Buffer.byteLength(JSON.stringify(rawEnvelope))).toBeGreaterThan(512 * 1024);

    const readout = await loadPluginMarketplaceCatalog(
      { refresh: "force" },
      source(),
      store(scratch(), async () => response(rawEnvelope)),
    );

    expect(readout).toMatchObject({ status: "ready", origin: "live", stale: false });
    expect(readout.catalog?.entries).toHaveLength(220);
  });

  it("marks a network catalog that expires during the request as stale", async () => {
    const dir = scratch();
    let clock = Date.parse("2026-10-29T11:59:59.000Z");
    const rawEnvelope = envelope(catalog({ expiresAt: "2026-10-29T12:00:00.000Z" }));

    const readout = await loadPluginMarketplaceCatalog(
      { refresh: "force" },
      source(),
      {
        dir,
        now: () => clock,
        fetchImpl: async () => {
          clock = Date.parse("2026-10-29T12:00:01.000Z");
          return response(rawEnvelope);
        },
      },
    );

    expect(readout).toMatchObject({
      status: "ready",
      origin: "live",
      stale: true,
      fetchedAt: "2026-10-29T12:00:01.000Z",
    });
    expect(readout.note).toContain("过期");
  });

  it("does not replace a fresher verified cache with an expired network catalog", async () => {
    const dir = scratch();
    seedCache(dir, catalog({ revision: "fresh-cache" }));
    const expired = catalog({
      revision: "expired-live",
      expiresAt: "2026-10-29T10:00:00.000Z",
    });

    const readout = await loadPluginMarketplaceCatalog(
      { refresh: "force" },
      source(),
      store(dir, async () => response(envelope(expired))),
    );

    expect(readout).toMatchObject({
      status: "ready",
      origin: "cache",
      stale: false,
    });
    expect(readout.catalog?.revision).toBe("fresh-cache");
    expect(readout.note).toContain("过期");
  });

  it("uses a fresh cache for auto refresh without touching the network", async () => {
    const dir = scratch();
    seedCache(dir, catalog());
    const fetchImpl = noFetch();
    const readout = await loadPluginMarketplaceCatalog(
      { refresh: "auto" },
      source(),
      store(dir, fetchImpl),
    );
    expect(readout).toMatchObject({ status: "ready", origin: "cache", stale: false });
    expect(readout.note).toContain("未刷新");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns stale verified cache when refresh fails and unavailable when none exists", async () => {
    const dir = scratch();
    seedCache(dir, catalog({ expiresAt: "2026-10-29T10:00:00.000Z" }), "2026-10-20T00:00:00.000Z");
    const stale = await loadPluginMarketplaceCatalog(
      { refresh: "force" },
      source(),
      store(dir, async () => new Response("", { status: 503 })),
    );
    expect(stale).toMatchObject({ status: "ready", origin: "cache", stale: true });
    expect(stale.note).toContain("503");
    expect(stale.catalog?.revision).toBe("2026-10-29.1");

    const missing = await loadPluginMarketplaceCatalog(
      { refresh: "auto" },
      source(),
      store(scratch(), async () => new Response("", { status: 503 })),
    );
    expect(missing).toMatchObject({ status: "unavailable", origin: "none", catalog: null });
    expect(missing.note).toContain("503");
  });

  it("returns expired verified cache as stale even without refresh", async () => {
    const dir = scratch();
    seedCache(dir, catalog({ expiresAt: "2026-10-29T10:00:00.000Z" }));
    const stale = await loadPluginMarketplaceCatalog(
      { refresh: "never" },
      source(),
      store(dir, noFetch()),
    );
    expect(stale).toMatchObject({ status: "ready", origin: "cache", stale: true });
    expect(stale.note).toContain("过期");
  });

  it("does not replace a verified cache with a redirect or tampered response", async () => {
    const dir = scratch();
    seedCache(dir, catalog({ revision: "cached.revision" }));
    const redirected = await loadPluginMarketplaceCatalog(
      { refresh: "force" },
      source(),
      store(dir, async () => new Response("", {
        status: 302,
        headers: { location: "https://evil.example.com/catalog.json" },
      })),
    );
    expect(redirected.origin).toBe("cache");
    expect(redirected.note).toContain("重定向");

    const tamperedEnvelope = { ...envelope(), signature: Buffer.alloc(64, 7).toString("base64") };
    const tampered = await loadPluginMarketplaceCatalog(
      { refresh: "force" },
      source(),
      store(dir, async () => response(tamperedEnvelope)),
    );
    expect(tampered.origin).toBe("cache");
    expect(tampered.note).toMatch(/签名|signature/i);

    const cached = await loadPluginMarketplaceCatalog(
      { refresh: "never" },
      source(),
      store(dir, noFetch()),
    );
    expect(cached.catalog?.revision).toBe("cached.revision");
  });

  it("reports cache corruption and lets a later verified refresh recover", async () => {
    const dir = scratch();
    mkdirSync(dir, { recursive: true });
    writeFileSync(cachePath(dir), "{broken", "utf8");
    const corrupt = await loadPluginMarketplaceCatalog(
      { refresh: "never" },
      source(),
      store(dir, noFetch()),
    );
    expect(corrupt.status).toBe("unavailable");
    expect(corrupt.note).toContain("缓存");

    const recovered = await loadPluginMarketplaceCatalog(
      { refresh: "force" },
      source(),
      store(dir, async () => response(envelope())),
    );
    expect(recovered).toMatchObject({ status: "ready", origin: "live" });
  });

  it("re-verifies every cache read and never trusts a changed envelope", async () => {
    const dir = scratch();
    seedCache(dir, catalog());
    const persisted = JSON.parse(readFileSync(cachePath(dir), "utf8")) as {
      schemaVersion: 1;
      fetchedAt: string;
      envelope: MarketplaceCatalogEnvelope;
    };
    persisted.envelope = {
      ...persisted.envelope,
      payload: Buffer.from(JSON.stringify({ ...catalog(), revision: "tampered.cache" }), "utf8").toString("base64"),
    };
    writeFileSync(cachePath(dir), JSON.stringify(persisted), "utf8");
    chmodSync(cachePath(dir), 0o600);

    const readout = await loadPluginMarketplaceCatalog(
      { refresh: "never" },
      source(),
      store(dir, noFetch()),
    );
    expect(readout.status).toBe("unavailable");
    expect(readout.note).toMatch(/签名|signature/i);
  });

  it("rejects oversized responses and missing configuration", async () => {
    const oversized = await loadPluginMarketplaceCatalog(
      { refresh: "force" },
      source(),
      store(scratch(), async () => new Response("x".repeat(768 * 1024 + 1))),
    );
    expect(oversized.status).toBe("unavailable");
    expect(oversized.note).toContain("上限");

    const missing = await loadPluginMarketplaceCatalog(
      { refresh: "auto" },
      { catalogUrl: null, publicKeys: [] },
      store(scratch(), noFetch()),
    );
    expect(missing.status).toBe("unavailable");
    expect(missing.note).toContain("未配置");
  });

  it("cancels an undeclared oversized response stream before buffering the full body", async () => {
    const chunk = new Uint8Array(256 * 1024).fill(0x78);
    let pulls = 0;
    let cancels = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        if (pulls > 5) {
          controller.close();
          return;
        }
        controller.enqueue(chunk);
      },
      cancel() {
        cancels += 1;
      },
    });

    const readout = await loadPluginMarketplaceCatalog(
      { refresh: "force" },
      source(),
      store(scratch(), async () => new Response(body)),
    );

    expect(readout.status).toBe("unavailable");
    expect(readout.note).toContain("上限");
    expect(pulls).toBeLessThan(5);
    expect(cancels).toBe(1);
  });
});
