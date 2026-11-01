import { lookup as dnsLookup } from "node:dns/promises";
import type { MarketplaceEntry } from "../agent/plugins/marketplace";
import type { InstalledPluginRecord } from "./plugin-install-registry";
import { hardenedGitEnvironment, hardenedGitRunner } from "./plugin-git-stage";
import { pluginDirectorySha256 } from "./plugin-local-stage";
import { isPublicPluginAddress, type PluginAddressLookup } from "./plugin-package-download";
import type { PluginSource } from "./plugin-source";
import { compareSemver } from "./updater";

export type PluginUpdateStatus = "current" | "available" | "checking" | "failed" | "unavailable";

export interface PluginUpdateCheck {
  readonly status: PluginUpdateStatus;
  readonly currentVersion: string | null;
  readonly nextVersion: string | null;
  readonly sourceKind: PluginSource["kind"];
  readonly detail?: string;
}

export interface PluginUpdateCheckDependencies {
  readonly requestKind?: PluginSource["kind"];
  readonly catalogEntry?: MarketplaceEntry;
  readonly gitHead?: string;
  readonly gitError?: string;
  readonly localDigest?: string;
  readonly localError?: string;
  readonly lookup?: PluginAddressLookup;
  readonly signal?: AbortSignal;
}

function unavailable(record: InstalledPluginRecord, detail: string): PluginUpdateCheck {
  return {
    status: "unavailable",
    currentVersion: record.version,
    nextVersion: null,
    sourceKind: record.source.kind,
    detail,
  };
}

async function remoteGitHead(
  source: Extract<PluginSource, { kind: "git" }>,
  deps: PluginUpdateCheckDependencies,
): Promise<string> {
  const url = new URL(source.repositoryUrl);
  const lookup = deps.lookup ?? (async (hostname: string) => {
    const rows = await dnsLookup(hostname, { all: true, verbatim: true });
    return rows.map((row) => row.address);
  });
  const addresses = await lookup(url.hostname);
  if (addresses.length === 0) throw new Error("Git repository host has no public address");
  for (const address of addresses) {
    if (!isPublicPluginAddress(address)) {
      throw new Error(`Git repository host resolved to a non-public address: ${address}`);
    }
  }
  const output = await hardenedGitRunner([
    "-c", "protocol.file.allow=never",
    "-c", "protocol.ext.allow=never",
    "-c", "core.hooksPath=/dev/null",
    "-c", "credential.helper=",
    "ls-remote",
    "--exit-code",
    "--",
    source.repositoryUrl,
    source.ref,
  ], {
    env: hardenedGitEnvironment(),
    ...(deps.signal === undefined ? {} : { signal: deps.signal }),
  });
  const hashes = output.split(/\r?\n/u)
    .map((line) => line.split(/\s+/u)[0] ?? "")
    .filter((hash) => /^[a-f0-9]{40}$/u.test(hash.toLowerCase()));
  const head = hashes[0]?.toLowerCase();
  if (head === undefined) throw new Error("Git remote did not return a valid commit");
  return head;
}

export async function checkPluginUpdate(
  record: InstalledPluginRecord,
  deps: PluginUpdateCheckDependencies = {},
): Promise<PluginUpdateCheck> {
  if (deps.requestKind !== undefined && deps.requestKind !== record.source.kind) {
    return unavailable(record, `安装来源是 ${record.source.kind}，不能用 ${deps.requestKind} 检查更新`);
  }
  if (record.source.kind === "catalog") {
    const entry = deps.catalogEntry;
    if (entry === undefined) return unavailable(record, "目录中没有该插件");
    if (entry.id !== record.source.entryId) return unavailable(record, "目录来源 identity 不匹配");
    if (record.version === null || compareSemver(record.version, entry.version) === null) {
      return unavailable(record, "已安装版本不是可比较的三段 semver");
    }
    const comparison = compareSemver(record.version, entry.version);
    return {
      status: comparison !== null && comparison < 0 ? "available" : "current",
      currentVersion: record.version,
      nextVersion: entry.version,
      sourceKind: "catalog",
    };
  }
  if (record.source.kind === "git") {
    if (deps.gitError !== undefined) {
      return {
        status: "failed",
        currentVersion: null,
        nextVersion: null,
        sourceKind: "git",
        detail: deps.gitError,
      };
    }
    try {
      const head = (deps.gitHead ?? await remoteGitHead(record.source, deps)).toLowerCase();
      if (!/^[a-f0-9]{40}$/u.test(head)) throw new Error("Git remote returned an invalid commit");
      return {
        status: head === record.source.commit ? "current" : "available",
        currentVersion: null,
        nextVersion: null,
        sourceKind: "git",
      };
    } catch (err) {
      return {
        status: "failed",
        currentVersion: null,
        nextVersion: null,
        sourceKind: "git",
        detail: err instanceof Error ? err.message : String(err),
      };
    }
  }
  if (deps.localError !== undefined) {
    return {
      status: "failed",
      currentVersion: null,
      nextVersion: null,
      sourceKind: "local",
      detail: deps.localError,
    };
  }
  try {
    const digest = deps.localDigest ?? await pluginDirectorySha256(record.source.sourcePath);
    return {
      status: digest === record.sha256 ? "current" : "available",
      currentVersion: null,
      nextVersion: null,
      sourceKind: "local",
    };
  } catch (err) {
    return {
      status: "failed",
      currentVersion: null,
      nextVersion: null,
      sourceKind: "local",
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}
