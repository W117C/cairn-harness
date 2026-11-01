import { createHash } from "node:crypto";
import { lookup as dnsLookup } from "node:dns/promises";
import { open, rm } from "node:fs/promises";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";
import type { Readable } from "node:stream";
import type { MarketplaceEntry } from "../agent/plugins/marketplace";
import { MAX_PLUGIN_ARCHIVE_BYTES } from "../agent/plugins/package-archive";

const DEFAULT_TIMEOUT_MS = 120_000;
const BLOCKED_ADDRESSES = new BlockList();

for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  BLOCKED_ADDRESSES.addSubnet(network, prefix, "ipv4");
}

for (const [network, prefix] of [
  ["::", 96],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 32],
  ["2001:2::", 48],
  ["2001:10::", 28],
  ["2001:20::", 28],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  BLOCKED_ADDRESSES.addSubnet(network, prefix, "ipv6");
}

export interface DownloadedPluginPackage {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface PluginPackageTransportResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Readable;
}

export type PluginAddressLookup = (hostname: string) => Promise<readonly string[]>;

export interface PluginPackageTransportOptions {
  readonly signal: AbortSignal;
  readonly lookup: PluginAddressLookup;
  readonly timeoutMs: number;
}

export type PluginPackageTransport = (
  url: URL,
  options: PluginPackageTransportOptions,
) => Promise<PluginPackageTransportResponse>;

export interface PluginPackageDownloadOptions {
  readonly fetchImpl?: PluginPackageTransport;
  readonly lookup?: PluginAddressLookup;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

function ipv4MappedAddress(address: string): string | null {
  const match = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/iu.exec(address);
  return match?.[1] ?? null;
}

export function isPublicPluginAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !BLOCKED_ADDRESSES.check(address, "ipv4");
  if (family !== 6) return false;
  const mapped = ipv4MappedAddress(address);
  if (mapped !== null) return isPublicPluginAddress(mapped);
  return !BLOCKED_ADDRESSES.check(address, "ipv6");
}

const systemLookup: PluginAddressLookup = async (hostname) => {
  const rows = await dnsLookup(hostname, { all: true, verbatim: true });
  return rows.map((row) => row.address);
};

function abortedError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error("plugin package download aborted");
}

async function lookupWithinSignal(
  lookup: PluginAddressLookup,
  hostname: string,
  signal: AbortSignal,
): Promise<readonly string[]> {
  signal.throwIfAborted();
  return await new Promise<readonly string[]>((resolve, reject) => {
    const onAbort = (): void => reject(abortedError(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    void lookup(hostname).then(
      (addresses) => {
        signal.removeEventListener("abort", onAbort);
        resolve(addresses);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function requestLookup(lookup: PluginAddressLookup, signal: AbortSignal): LookupFunction {
  return (hostname, options, callback) => {
    void lookupWithinSignal(lookup, hostname, signal).then((addresses) => {
      if (addresses.length === 0) {
        callback(
          Object.assign(new Error(`plugin package host has no addresses: ${hostname}`), { code: "ENOTFOUND" }),
          "",
        );
        return;
      }
      const nonPublic = addresses.find((address) => !isPublicPluginAddress(address));
      if (nonPublic !== undefined) {
        callback(new Error(`plugin package host resolved to a non-public address: ${nonPublic}`), "");
        return;
      }
      const requestedFamily = typeof options.family === "number" ? options.family : 0;
      const matches = addresses.filter((candidate) => requestedFamily === 0 || isIP(candidate) === requestedFamily);
      if (options.all === true) {
        callback(null, matches.map((address) => ({ address, family: isIP(address) })));
        return;
      }
      const address = matches[0];
      if (address === undefined) {
        callback(
          Object.assign(new Error(`plugin package host has no matching address family: ${hostname}`), { code: "ENOTFOUND" }),
          "",
        );
        return;
      }
      callback(null, address, isIP(address));
    }, (err: unknown) => {
      callback(err instanceof Error ? err as NodeJS.ErrnoException : new Error(String(err)), "");
    });
  };
}

const httpsTransport: PluginPackageTransport = async (url, options) => {
  return await new Promise<PluginPackageTransportResponse>((resolve, reject) => {
    const req = httpsRequest(url, {
      method: "GET",
      headers: {
        accept: "application/octet-stream",
        "user-agent": "Cairn plugin installer",
      },
      signal: options.signal,
      timeout: options.timeoutMs,
      lookup: requestLookup(options.lookup, options.signal),
    }, (response) => {
      const headers: Record<string, string> = {};
      for (const name of ["content-length", "location"]) {
        const value = response.headers[name];
        const first = Array.isArray(value) ? value[0] : value;
        if (first !== undefined) headers[name] = first;
      }
      resolve({
        status: response.statusCode ?? 0,
        headers,
        body: response,
      });
    });
    req.once("timeout", () => {
      req.destroy(new Error(`plugin package download timed out after ${String(options.timeoutMs)}ms`));
    });
    req.once("error", reject);
    req.end();
  });
};

function validatedPackageUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("plugin package URL is invalid");
  }
  if (url.protocol !== "https:") throw new Error("plugin package URL must use https");
  if (url.username !== "" || url.password !== "") {
    throw new Error("plugin package URL must not contain credentials");
  }
  if (url.port !== "" && url.port !== "443") {
    throw new Error("plugin package URL must use the default HTTPS port");
  }
  return url;
}

function declaredLength(headers: Readonly<Record<string, string>>): number | null {
  const raw = headers["content-length"];
  if (raw === undefined) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function pendingBody(response: PluginPackageTransportResponse): Readable {
  return response.body;
}

export async function downloadPluginPackage(
  entry: MarketplaceEntry,
  destination: string,
  opts: PluginPackageDownloadOptions = {},
): Promise<DownloadedPluginPackage> {
  const url = validatedPackageUrl(entry.packageUrl);
  const lookup = opts.lookup ?? systemLookup;
  const fetchImpl = opts.fetchImpl ?? httpsTransport;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = Math.min(entry.sizeBytes, MAX_PLUGIN_ARCHIVE_BYTES);
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new Error("plugin package size limit is invalid");
  }
  const signal = opts.signal === undefined
    ? AbortSignal.timeout(timeoutMs)
    : AbortSignal.any([opts.signal, AbortSignal.timeout(timeoutMs)]);
  signal.throwIfAborted();

  const addresses = await lookupWithinSignal(lookup, url.hostname, signal);
  signal.throwIfAborted();
  if (addresses.length === 0) throw new Error("plugin package host has no public address");
  for (const address of addresses) {
    if (!isPublicPluginAddress(address)) {
      throw new Error(`plugin package host resolved to a non-public address: ${address}`);
    }
  }

  let body: Readable | null = null;
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  let complete = false;
  try {
    const response = await fetchImpl(url, { signal, lookup, timeoutMs });
    body = pendingBody(response);
    if (response.status >= 300 && response.status < 400) {
      throw new Error(`plugin package download redirect ${String(response.status)} (not followed)`);
    }
    if (response.status !== 200) {
      throw new Error(`plugin package download HTTP ${String(response.status)}`);
    }
    const declared = declaredLength(response.headers);
    if (declared !== null && declared > maxBytes) {
      throw new Error(`plugin package exceeds ${String(maxBytes)} byte size limit`);
    }

    handle = await open(destination, "wx", 0o600);
    const hash = createHash("sha256");
    let bytes = 0;
    for await (const raw of body) {
      signal.throwIfAborted();
      const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as Uint8Array);
      bytes += chunk.length;
      if (bytes > maxBytes) {
        body.destroy();
        throw new Error(`plugin package exceeds ${String(maxBytes)} byte size limit`);
      }
      hash.update(chunk);
      let offset = 0;
      while (offset < chunk.length) {
        const written = await handle.write(chunk, offset, chunk.length - offset);
        if (written.bytesWritten <= 0) throw new Error("plugin package write made no progress");
        offset += written.bytesWritten;
      }
    }
    if (bytes !== entry.sizeBytes) {
      throw new Error(`plugin package size mismatch: expected ${String(entry.sizeBytes)}, received ${String(bytes)}`);
    }
    const sha256 = hash.digest("hex");
    if (sha256 !== entry.sha256) {
      throw new Error(`plugin package SHA-256 mismatch: expected ${entry.sha256}, received ${sha256}`);
    }
    await handle.sync();
    await handle.close();
    handle = null;
    complete = true;
    return { path: destination, bytes, sha256 };
  } finally {
    if (!complete) {
      body?.destroy();
      await handle?.close().catch(() => undefined);
      await rm(destination, { force: true }).catch(() => undefined);
    }
  }
}
