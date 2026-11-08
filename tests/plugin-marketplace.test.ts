import { describe, expect, it } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import {
  MAX_MARKETPLACE_ENTRIES,
  MAX_MARKETPLACE_PACKAGE_BYTES,
  parseMarketplaceCatalog,
  signedMarketplaceEnvelope,
  verifyMarketplaceCatalogEnvelope,
} from "../src/agent/plugins/marketplace";

type EntryOverrides = Partial<Record<string, unknown>>;

function entry(overrides: EntryOverrides = {}): Record<string, unknown> {
  return {
    id: "demo-plugin",
    name: "Demo Plugin",
    summary: "Fixture plugin for marketplace validation.",
    author: "Cairn",
    sourceUrl: "https://github.com/example/demo-plugin",
    license: "MIT",
    version: "1.2.3",
    publishedAt: "2026-10-29T00:00:00.000Z",
    packageUrl: "https://plugins.example.com/demo-plugin-1.2.3.tgz",
    sha256: "a".repeat(64),
    sizeBytes: 1024,
    capabilities: { skills: 1, commands: 1, agents: 0, hooks: 0, mcp: 1, lsp: 0 },
    permissions: ["network"],
    minAppVersion: "0.1.0",
    ...overrides,
  };
}

function validPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    revision: "2026-10-29.1",
    generatedAt: "2026-10-29T00:00:00.000Z",
    expiresAt: "2026-11-05T00:00:00.000Z",
    packageHosts: ["plugins.example.com"],
    entries: [entry()],
    shelves: [{ id: "featured", title: "精选", entryIds: ["demo-plugin"] }],
    ...overrides,
  };
}

describe("marketplace catalog payload", () => {
  it("accepts a bounded signed-catalog payload shape", () => {
    const catalog = parseMarketplaceCatalog(validPayload());
    expect(catalog.entries[0]?.id).toBe("demo-plugin");
    expect(catalog.entries[0]?.capabilities.mcp).toBe(1);
    expect(catalog.packageHosts).toEqual(["plugins.example.com"]);
    expect(catalog.shelves[0]?.entryIds).toEqual(["demo-plugin"]);
  });

  it("rejects duplicate ids, unknown shelf entries, foreign package hosts, and oversized packages", () => {
    expect(() => parseMarketplaceCatalog(validPayload({ entries: [entry(), entry()] }))).toThrow(/duplicate/i);
    expect(() => parseMarketplaceCatalog(validPayload({
      shelves: [{ id: "new", title: "新上架", entryIds: ["missing"] }],
    }))).toThrow(/unknown/i);
    expect(() => parseMarketplaceCatalog(validPayload({
      entries: [entry({ packageUrl: "https://evil.example.com/p.tgz" })],
    }))).toThrow(/host/i);
    expect(() => parseMarketplaceCatalog(validPayload({
      entries: [entry({ sizeBytes: MAX_MARKETPLACE_PACKAGE_BYTES + 1 })],
    }))).toThrow(/size/i);
  });

  it("rejects unsafe URLs, invalid hashes, invalid dates, and negative capability counts", () => {
    expect(() => parseMarketplaceCatalog(validPayload({ packageHosts: ["localhost"] }))).toThrow(/host/i);
    expect(() => parseMarketplaceCatalog(validPayload({
      entries: [entry({ packageUrl: "http://plugins.example.com/p.tgz" })],
    }))).toThrow(/https/i);
    expect(() => parseMarketplaceCatalog(validPayload({
      entries: [entry({ packageUrl: "https://user:secret@plugins.example.com/p.tgz" })],
    }))).toThrow(/credentials/i);
    expect(() => parseMarketplaceCatalog(validPayload({
      entries: [entry({ sha256: "A".repeat(64) })],
    }))).toThrow(/sha-256/i);
    expect(() => parseMarketplaceCatalog(validPayload({ expiresAt: "tomorrow" }))).toThrow(/date/i);
    expect(() => parseMarketplaceCatalog(validPayload({
      entries: [entry({ capabilities: { skills: -1, commands: 0, agents: 0, hooks: 0, mcp: 0, lsp: 0 } })],
    }))).toThrow(/capabilit/i);
  });

  it.each(["plugins.localhost", "plugins.home.arpa", "service.internal"])(
    "rejects reserved special-use package host %s",
    (host) => {
      expect(() => parseMarketplaceCatalog(validPayload({
        packageHosts: [host],
        entries: [entry({ packageUrl: `https://${host}/plugin.tgz` })],
      }))).toThrow(/public DNS hostname/i);
    },
  );

  it("caps entry count and copies the accepted input into fresh arrays", () => {
    const tooMany = Array.from({ length: MAX_MARKETPLACE_ENTRIES + 1 }, (_, index) => entry({
      id: `plugin-${String(index)}`,
      packageUrl: `https://plugins.example.com/plugin-${String(index)}.tgz`,
    }));
    expect(() => parseMarketplaceCatalog(validPayload({ entries: tooMany }))).toThrow(/entries/i);

    const raw = validPayload();
    const parsed = parseMarketplaceCatalog(raw);
    (raw.entries as unknown[]).length = 0;
    expect(parsed.entries).toHaveLength(1);
  });
});

function keyPair(): {
  publicKey: string;
  privateKey: string;
} {
  const pair = generateKeyPairSync("ed25519");
  return {
    publicKey: pair.publicKey.export({ type: "spki", format: "pem" }).toString(),
    privateKey: pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
}

describe("marketplace signed envelope", () => {
  it("verifies an Ed25519 envelope and rejects payload tampering", () => {
    const { publicKey, privateKey } = keyPair();
    const catalog = parseMarketplaceCatalog(validPayload());
    const envelope = signedMarketplaceEnvelope(catalog, privateKey, "current");
    const keys = [{ id: "current", pem: publicKey }];

    expect(verifyMarketplaceCatalogEnvelope(envelope, keys).revision).toBe("2026-10-29.1");

    const tampered = Buffer.from(JSON.stringify({ ...validPayload(), revision: "tampered" }), "utf8").toString("base64");
    expect(() => verifyMarketplaceCatalogEnvelope({ ...envelope, payload: tampered }, keys))
      .toThrow(/signature/i);
  });

  it("rejects unknown keys and malformed base64", () => {
    const { publicKey, privateKey } = keyPair();
    const envelope = signedMarketplaceEnvelope(parseMarketplaceCatalog(validPayload()), privateKey, "current");
    const keys = [{ id: "current", pem: publicKey }];

    expect(() => verifyMarketplaceCatalogEnvelope(envelope, [])).toThrow(/key/i);
    expect(() => verifyMarketplaceCatalogEnvelope({ ...envelope, signature: "***" }, keys)).toThrow(/base64/i);
    expect(() => verifyMarketplaceCatalogEnvelope({ ...envelope, payload: "***" }, keys)).toThrow(/base64/i);
  });

  it("rejects private key material in the public key slot", () => {
    const { privateKey } = keyPair();
    const envelope = signedMarketplaceEnvelope(parseMarketplaceCatalog(validPayload()), privateKey, "current");

    expect(() => verifyMarketplaceCatalogEnvelope(envelope, [{ id: "current", pem: privateKey }]))
      .toThrow(/PUBLIC KEY|SPKI/i);
  });

  it("rejects oversized decoded payloads before parsing", () => {
    const { publicKey, privateKey } = keyPair();
    const enveloped = signedMarketplaceEnvelope(parseMarketplaceCatalog(validPayload()), privateKey, "current");
    const oversized = Buffer.alloc(512 * 1024 + 1, 0x20).toString("base64");
    expect(() => verifyMarketplaceCatalogEnvelope({ ...enveloped, payload: oversized }, [{ id: "current", pem: publicKey }]))
      .toThrow(/524288/i);
  });
});
