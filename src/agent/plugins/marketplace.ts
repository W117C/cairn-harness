import { isIP } from "node:net";
import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";

export const MAX_MARKETPLACE_ENTRIES = 250;
export const MAX_MARKETPLACE_SHELVES = 32;
export const MAX_MARKETPLACE_SHELF_ENTRIES = 100;
export const MAX_MARKETPLACE_PACKAGE_BYTES = 64 * 1024 * 1024;
export const MAX_MARKETPLACE_PAYLOAD_BYTES = 512 * 1024;

const MAX_ID = 64;
const MAX_NAME = 80;
const MAX_SUMMARY = 400;
const MAX_AUTHOR = 120;
const MAX_URL = 2048;
const MAX_LICENSE = 64;
const MAX_VERSION = 64;
const MAX_PERMISSIONS = 32;
const MAX_PERMISSION = 64;
const MAX_PACKAGE_HOSTS = 16;

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const SHA256 = /^[a-f0-9]{64}$/;
const DNS_HOST = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const RESERVED_HOST_SUFFIXES = [
  ".localhost",
  ".local",
  ".localdomain",
  ".internal",
  ".lan",
  ".home.arpa",
  ".invalid",
  ".test",
  ".onion",
] as const;

export interface MarketplaceCapabilities {
  readonly skills: number;
  readonly commands: number;
  readonly agents: number;
  readonly hooks: number;
  readonly mcp: number;
  readonly lsp: number;
}

export interface MarketplaceEntry {
  readonly id: string;
  readonly name: string;
  readonly summary: string;
  readonly author: string;
  readonly sourceUrl: string;
  readonly license: string;
  readonly version: string;
  readonly publishedAt: string;
  readonly packageUrl: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly capabilities: MarketplaceCapabilities;
  readonly permissions: readonly string[];
  readonly minAppVersion: string;
}

export interface MarketplaceShelf {
  readonly id: string;
  readonly title: string;
  readonly entryIds: readonly string[];
}

export interface MarketplaceCatalog {
  readonly schemaVersion: 1;
  readonly revision: string;
  readonly generatedAt: string;
  readonly expiresAt: string;
  readonly packageHosts: readonly string[];
  readonly entries: readonly MarketplaceEntry[];
  readonly shelves: readonly MarketplaceShelf[];
}

export interface MarketplacePublicKey {
  readonly id: string;
  readonly pem: string;
}

export interface MarketplaceCatalogEnvelope {
  readonly schemaVersion: 1;
  readonly keyId: string;
  readonly payload: string;
  readonly signature: string;
}

const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, label: string, max: number): string {
  if (typeof value !== "string" || value.trim() === "" || value.length > max) {
    throw new Error(`${label} must be a non-empty string of at most ${String(max)} characters`);
  }
  return value;
}

function id(value: unknown, label: string): string {
  const out = string(value, label, MAX_ID);
  if (!ID.test(out)) throw new Error(`${label} must be kebab-case`);
  return out;
}

function version(value: unknown, label: string): string {
  const out = string(value, label, MAX_VERSION);
  if (!VERSION.test(out)) throw new Error(`${label} must be a semantic version`);
  return out;
}

function isoDate(value: unknown, label: string): { text: string; millis: number } {
  const text = string(value, label, 64);
  const millis = Date.parse(text);
  if (!Number.isFinite(millis)) throw new Error(`${label} must be a valid date`);
  return { text, millis };
}

function httpsUrl(value: unknown, label: string): URL {
  const text = string(value, label, MAX_URL);
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new Error(`${label} must be a valid URL`);
  }
  if (url.protocol !== "https:") throw new Error(`${label} must use https`);
  if (url.username !== "" || url.password !== "") throw new Error(`${label} must not contain credentials`);
  return url;
}

function packageHost(value: unknown): string {
  const raw = string(value, "package host", 253).toLowerCase();
  if (
    raw === "localhost"
    || raw === "home.arpa"
    || RESERVED_HOST_SUFFIXES.some((suffix) => raw.endsWith(suffix))
    || isIP(raw) !== 0
    || !DNS_HOST.test(raw)
  ) {
    throw new Error(`package host ${JSON.stringify(raw)} must be a public DNS hostname`);
  }
  return raw;
}

function integer(value: unknown, label: string, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    throw new Error(`${label} must be an integer from ${String(min)} to ${String(max)}`);
  }
  return value as number;
}

function capabilities(value: unknown, label: string): MarketplaceCapabilities {
  const raw = record(value, label);
  return {
    skills: integer(raw.skills, `${label}.skills`, 0, 10_000),
    commands: integer(raw.commands, `${label}.commands`, 0, 10_000),
    agents: integer(raw.agents, `${label}.agents`, 0, 10_000),
    hooks: integer(raw.hooks, `${label}.hooks`, 0, 10_000),
    mcp: integer(raw.mcp, `${label}.mcp`, 0, 10_000),
    lsp: integer(raw.lsp, `${label}.lsp`, 0, 10_000),
  };
}

function permissions(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || value.length > MAX_PERMISSIONS) {
    throw new Error(`${label} must be an array of at most ${String(MAX_PERMISSIONS)} entries`);
  }
  const out = value.map((item, index) => string(item, `${label}[${String(index)}]`, MAX_PERMISSION));
  if (new Set(out).size !== out.length) throw new Error(`${label} contains duplicate permissions`);
  return [...out];
}

function parseEntry(value: unknown, index: number): MarketplaceEntry {
  const label = `entries[${String(index)}]`;
  const raw = record(value, label);
  return {
    id: id(raw.id, `${label}.id`),
    name: string(raw.name, `${label}.name`, MAX_NAME),
    summary: string(raw.summary, `${label}.summary`, MAX_SUMMARY),
    author: string(raw.author, `${label}.author`, MAX_AUTHOR),
    sourceUrl: httpsUrl(raw.sourceUrl, `${label}.sourceUrl`).href,
    license: string(raw.license, `${label}.license`, MAX_LICENSE),
    version: version(raw.version, `${label}.version`),
    publishedAt: isoDate(raw.publishedAt, `${label}.publishedAt`).text,
    packageUrl: httpsUrl(raw.packageUrl, `${label}.packageUrl`).href,
    sha256: (() => {
      const hash = string(raw.sha256, `${label}.sha256`, 64);
      if (!SHA256.test(hash)) throw new Error(`${label}.sha256 must be a lowercase SHA-256 digest`);
      return hash;
    })(),
    sizeBytes: integer(raw.sizeBytes, `${label}.sizeBytes`, 1, MAX_MARKETPLACE_PACKAGE_BYTES),
    capabilities: capabilities(raw.capabilities, `${label}.capabilities`),
    permissions: permissions(raw.permissions, `${label}.permissions`),
    minAppVersion: version(raw.minAppVersion, `${label}.minAppVersion`),
  };
}

function parseShelf(value: unknown, index: number, entryIds: ReadonlySet<string>): MarketplaceShelf {
  const label = `shelves[${String(index)}]`;
  const raw = record(value, label);
  if (!Array.isArray(raw.entryIds) || raw.entryIds.length > MAX_MARKETPLACE_SHELF_ENTRIES) {
    throw new Error(`${label}.entryIds must be an array of at most ${String(MAX_MARKETPLACE_SHELF_ENTRIES)} ids`);
  }
  const shelfEntryIds = raw.entryIds.map((item, itemIndex) => id(item, `${label}.entryIds[${String(itemIndex)}]`));
  if (new Set(shelfEntryIds).size !== shelfEntryIds.length) {
    throw new Error(`${label}.entryIds contains duplicate ids`);
  }
  for (const entryId of shelfEntryIds) {
    if (!entryIds.has(entryId)) throw new Error(`${label}.entryIds references an unknown entry: ${entryId}`);
  }
  return {
    id: id(raw.id, `${label}.id`),
    title: string(raw.title, `${label}.title`, MAX_NAME),
    entryIds: [...shelfEntryIds],
  };
}

export function parseMarketplaceCatalog(rawValue: unknown): MarketplaceCatalog {
  const raw = record(rawValue, "marketplace catalog");
  if (raw.schemaVersion !== 1) throw new Error("unsupported marketplace schemaVersion");
  const generatedAt = isoDate(raw.generatedAt, "generatedAt");
  const expiresAt = isoDate(raw.expiresAt, "expiresAt");
  if (expiresAt.millis <= generatedAt.millis) throw new Error("expiresAt must be later than generatedAt");

  if (!Array.isArray(raw.packageHosts) || raw.packageHosts.length === 0 || raw.packageHosts.length > MAX_PACKAGE_HOSTS) {
    throw new Error(`packageHosts must contain 1 to ${String(MAX_PACKAGE_HOSTS)} hosts`);
  }
  const packageHosts = raw.packageHosts.map(packageHost);
  if (new Set(packageHosts).size !== packageHosts.length) throw new Error("packageHosts contains duplicate hosts");

  if (!Array.isArray(raw.entries) || raw.entries.length > MAX_MARKETPLACE_ENTRIES) {
    throw new Error(`entries must be an array of at most ${String(MAX_MARKETPLACE_ENTRIES)} items`);
  }
  const entries = raw.entries.map(parseEntry);
  const entryIds = new Set(entries.map((entry) => entry.id));
  if (entryIds.size !== entries.length) throw new Error("duplicate entry id");

  const allowedHosts = new Set(packageHosts);
  for (const entry of entries) {
    const packageUrl = new URL(entry.packageUrl);
    if (packageUrl.port !== "" || !allowedHosts.has(packageUrl.hostname.toLowerCase())) {
      throw new Error(`package host is not signed for ${entry.id}: ${packageUrl.hostname}`);
    }
    if (packageUrl.pathname === "" || packageUrl.pathname === "/") {
      throw new Error(`packageUrl must point to a package for ${entry.id}`);
    }
  }

  if (!Array.isArray(raw.shelves) || raw.shelves.length > MAX_MARKETPLACE_SHELVES) {
    throw new Error(`shelves must be an array of at most ${String(MAX_MARKETPLACE_SHELVES)} items`);
  }
  const shelves = raw.shelves.map((shelf, index) => parseShelf(shelf, index, entryIds));
  if (new Set(shelves.map((shelf) => shelf.id)).size !== shelves.length) {
    throw new Error("duplicate shelf id");
  }

  return {
    schemaVersion: 1,
    revision: string(raw.revision, "revision", 128),
    generatedAt: generatedAt.text,
    expiresAt: expiresAt.text,
    packageHosts: [...packageHosts],
    entries,
    shelves,
  };
}

function decodeBase64(value: unknown, label: string, maxBytes: number): Buffer {
  if (typeof value !== "string" || value === "" || !BASE64.test(value)) {
    throw new Error(`${label} must be valid base64`);
  }
  const out = Buffer.from(value, "base64");
  if (out.length === 0 || out.length > maxBytes) {
    throw new Error(`${label} exceeds ${String(maxBytes)} decoded bytes`);
  }
  return out;
}

function ed25519PublicKey(pem: string): ReturnType<typeof createPublicKey> {
  if (pem.length > 8_192) throw new Error("marketplace public key PEM is oversized");
  const normalized = pem.trim();
  if (!normalized.startsWith("-----BEGIN PUBLIC KEY-----") || !normalized.endsWith("-----END PUBLIC KEY-----")) {
    throw new Error("marketplace public key must be Ed25519 SPKI PUBLIC KEY PEM");
  }
  let key: ReturnType<typeof createPublicKey>;
  try {
    key = createPublicKey(normalized);
  } catch {
    throw new Error("marketplace public key is not valid PEM");
  }
  if (key.asymmetricKeyType !== "ed25519") throw new Error("marketplace public key must be Ed25519");
  return key;
}

function ed25519PrivateKey(pem: string): ReturnType<typeof createPrivateKey> {
  if (pem.length > 8_192) throw new Error("marketplace private key PEM is oversized");
  let key: ReturnType<typeof createPrivateKey>;
  try {
    key = createPrivateKey(pem);
  } catch {
    throw new Error("marketplace private key is not valid PEM");
  }
  if (key.asymmetricKeyType !== "ed25519") throw new Error("marketplace private key must be Ed25519");
  return key;
}

export function verifyMarketplaceCatalogEnvelope(
  rawValue: unknown,
  keys: readonly MarketplacePublicKey[],
): MarketplaceCatalog {
  const raw = record(rawValue, "marketplace envelope");
  if (raw.schemaVersion !== 1) throw new Error("unsupported marketplace envelope schemaVersion");
  const keyId = string(raw.keyId, "marketplace envelope keyId", MAX_ID);
  const configured = keys.find((key) => key.id === keyId);
  if (configured === undefined) throw new Error(`unknown marketplace signing key: ${keyId}`);

  const payload = decodeBase64(raw.payload, "marketplace envelope payload", MAX_MARKETPLACE_PAYLOAD_BYTES);
  const signature = decodeBase64(raw.signature, "marketplace envelope signature", 1_024);
  if (signature.length !== 64) throw new Error("marketplace envelope signature must be 64 bytes");
  if (!verify(null, payload, ed25519PublicKey(configured.pem), signature)) {
    throw new Error("marketplace envelope signature verification failed");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload.toString("utf8"));
  } catch {
    throw new Error("marketplace envelope payload is not valid JSON");
  }
  return parseMarketplaceCatalog(parsed);
}

export function signedMarketplaceEnvelope(
  catalog: MarketplaceCatalog,
  privateKeyPem: string,
  keyId: string,
): MarketplaceCatalogEnvelope {
  const normalizedKeyId = id(keyId, "marketplace signing key id");
  const payload = Buffer.from(JSON.stringify(catalog), "utf8");
  if (payload.length > MAX_MARKETPLACE_PAYLOAD_BYTES) {
    throw new Error(`marketplace payload exceeds ${String(MAX_MARKETPLACE_PAYLOAD_BYTES)} bytes`);
  }
  return {
    schemaVersion: 1,
    keyId: normalizedKeyId,
    payload: payload.toString("base64"),
    signature: sign(null, payload, ed25519PrivateKey(privateKeyPem)).toString("base64"),
  };
}
