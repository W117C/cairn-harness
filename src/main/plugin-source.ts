import { isAbsolute, resolve } from "node:path";
import { isIP } from "node:net";

export type PluginInstallScope = "user" | "project";

export interface CatalogPluginSource {
  readonly kind: "catalog";
  readonly catalogId: string;
  readonly entryId: string;
  readonly sourceUrl: string;
  readonly revision: string;
}

export interface GitPluginSource {
  readonly kind: "git";
  readonly repositoryUrl: string;
  readonly ref: string;
  readonly commit: string;
}

export interface LocalPluginSource {
  readonly kind: "local";
  readonly sourcePath: string;
}

export type PluginSource = CatalogPluginSource | GitPluginSource | LocalPluginSource;

export interface StagedPluginSource {
  readonly root: string;
  readonly source: PluginSource;
  readonly packageSha256: string;
}

export type PluginImportRequest =
  | { readonly kind: "catalog"; readonly entryId: string }
  | { readonly kind: "git"; readonly repositoryUrl: string; readonly ref?: string }
  | { readonly kind: "local"; readonly sourcePath: string };

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const GIT_COMMIT = /^[a-f0-9]{40}$/u;
const GIT_REF = /^(?!-)(?!.*\.\.)(?!.*\s)[A-Za-z0-9._/-]{1,256}$/u;
const DNS_HOST = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/iu;
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

function record(value: unknown, label: string, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const raw = value as Record<string, unknown>;
  const unknown = Object.keys(raw).filter((key) => !keys.includes(key));
  if (unknown.length > 0) throw new Error(`${label} contains unsupported fields: ${unknown.join(", ")}`);
  return raw;
}

function text(value: unknown, label: string, max: number, allowEmpty = false): string {
  if (typeof value !== "string" || value.length > max || (!allowEmpty && value.trim() === "")) {
    throw new Error(`${label} must be ${allowEmpty ? "" : "a non-empty "}string of at most ${String(max)} characters`);
  }
  return value.trim();
}

function id(value: unknown, label: string): string {
  const out = text(value, label, 64);
  if (!ID.test(out)) throw new Error(`${label} must be kebab-case`);
  return out;
}

function httpsRepositoryUrl(value: unknown): string {
  const raw = text(value, "Git repository URL", 2_048);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Git repository URL must be a valid HTTPS URL");
  }
  if (url.protocol !== "https:") throw new Error("Git repository URL must use HTTPS");
  if (url.username !== "" || url.password !== "") {
    throw new Error("Git repository URL must not contain credentials");
  }
  if (url.port !== "" && url.port !== "443") {
    throw new Error("Git repository URL must use the default HTTPS port");
  }
  const hostname = url.hostname.toLowerCase();
  const ipCandidate = hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
  if (
    hostname === "localhost"
    || hostname === "home.arpa"
    || RESERVED_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
    || isIP(ipCandidate) !== 0
    || !DNS_HOST.test(hostname)
  ) {
    throw new Error("Git repository URL must use a public DNS hostname, not an IP or private host");
  }
  if (url.pathname === "" || url.pathname === "/") {
    throw new Error("Git repository URL must identify a repository path");
  }
  url.hash = "";
  return url.href;
}

function absoluteLocalPath(value: unknown): string {
  const raw = text(value, "local plugin source", 4_096);
  if (!isAbsolute(raw)) throw new Error("local plugin source must be an absolute path");
  return resolve(raw);
}

function gitRef(value: unknown): string {
  const ref = text(value, "Git ref", 256);
  if (!GIT_REF.test(ref)) throw new Error("Git ref contains unsupported characters");
  return ref;
}

export function parsePluginSource(value: unknown): PluginSource {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("plugin source must be an object");
  }
  const kind = (value as Record<string, unknown>).kind;
  if (kind === "catalog") {
    const raw = record(value, "catalog plugin source", [
      "kind", "catalogId", "entryId", "sourceUrl", "revision",
    ]);
    const sourceUrl = text(raw.sourceUrl, "catalog source URL", 2_048, true);
    if (sourceUrl !== "") {
      const url = new URL(sourceUrl);
      if (url.protocol !== "https:" || url.username !== "" || url.password !== "") {
        throw new Error("catalog source URL must be HTTPS without credentials");
      }
    }
    return {
      kind: "catalog",
      catalogId: id(raw.catalogId, "catalogId"),
      entryId: id(raw.entryId, "entryId"),
      sourceUrl,
      revision: text(raw.revision, "catalog revision", 128, true),
    };
  }
  if (kind === "git") {
    const raw = record(value, "Git plugin source", ["kind", "repositoryUrl", "ref", "commit"]);
    const commit = text(raw.commit, "Git commit", 64).toLowerCase();
    if (!GIT_COMMIT.test(commit)) throw new Error("Git commit must be a lowercase 40-character SHA-1");
    return {
      kind: "git",
      repositoryUrl: httpsRepositoryUrl(raw.repositoryUrl),
      ref: gitRef(raw.ref),
      commit,
    };
  }
  if (kind === "local") {
    const raw = record(value, "local plugin source", ["kind", "sourcePath"]);
    return { kind: "local", sourcePath: absoluteLocalPath(raw.sourcePath) };
  }
  throw new Error("plugin source kind is invalid");
}

export function parsePluginImportRequest(value: unknown): PluginImportRequest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("plugin import request must be an object");
  }
  const kind = (value as Record<string, unknown>).kind;
  if (kind === "catalog") {
    const raw = record(value, "catalog plugin import", ["kind", "entryId"]);
    return { kind: "catalog", entryId: id(raw.entryId, "entryId") };
  }
  if (kind === "git") {
    const raw = record(value, "Git plugin import", ["kind", "repositoryUrl", "ref"]);
    const ref = raw.ref === undefined ? undefined : gitRef(raw.ref);
    return {
      kind: "git",
      repositoryUrl: httpsRepositoryUrl(raw.repositoryUrl),
      ...(ref === undefined ? {} : { ref }),
    };
  }
  if (kind === "local") {
    const raw = record(value, "local plugin import", ["kind", "sourcePath"]);
    return { kind: "local", sourcePath: absoluteLocalPath(raw.sourcePath) };
  }
  throw new Error("plugin import kind is invalid");
}

export function samePluginSourceIdentity(left: PluginSource, right: PluginSource): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "catalog" && right.kind === "catalog") {
    return left.catalogId === right.catalogId && left.entryId === right.entryId;
  }
  if (left.kind === "git" && right.kind === "git") {
    return left.repositoryUrl === right.repositoryUrl && left.ref === right.ref;
  }
  if (left.kind === "local" && right.kind === "local") {
    return left.sourcePath === right.sourcePath;
  }
  return false;
}
