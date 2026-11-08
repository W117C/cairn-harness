import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import type { MarketplaceEntry } from "../src/agent/plugins/marketplace";
import {
  downloadPluginPackage,
  isPublicPluginAddress,
  type PluginAddressLookup,
  type PluginPackageTransport,
} from "../src/main/plugin-package-download";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "cairn-plugin-download-"));
  dirs.push(dir);
  return dir;
}

function entry(body: Buffer, overrides: Partial<MarketplaceEntry> = {}): MarketplaceEntry {
  return {
    id: "demo-plugin",
    name: "Demo Plugin",
    summary: "Fixture plugin.",
    author: "Cairn",
    sourceUrl: "https://github.com/example/demo-plugin",
    license: "MIT",
    version: "1.2.3",
    publishedAt: "2026-10-29T00:00:00.000Z",
    packageUrl: "https://plugins.example.com/demo-plugin-1.2.3.tgz",
    sha256: createHash("sha256").update(body).digest("hex"),
    sizeBytes: body.length,
    capabilities: { skills: 1, commands: 0, agents: 0, hooks: 0, mcp: 0, lsp: 0 },
    permissions: [],
    minAppVersion: "0.1.0",
    ...overrides,
  };
}

const publicLookup: PluginAddressLookup = async () => ["8.8.8.8"];
const privateLookup: PluginAddressLookup = async () => ["127.0.0.1"];

function transport(
  body: Buffer,
  options: { status?: number; headers?: Readonly<Record<string, string>> } = {},
): PluginPackageTransport {
  return async () => ({
    status: options.status ?? 200,
    headers: options.headers ?? {},
    body: Readable.from(body.length === 0 ? [] : [body]),
  });
}

describe("plugin package download", () => {
  it("streams exact catalog bytes and verifies SHA-256", async () => {
    const body = Buffer.from("verified package bytes");
    const destination = join(scratch(), "plugin.tgz");

    const result = await downloadPluginPackage(entry(body), destination, {
      fetchImpl: transport(body),
      lookup: publicLookup,
    });

    expect(result).toEqual({
      path: destination,
      bytes: body.length,
      sha256: createHash("sha256").update(body).digest("hex"),
    });
  });

  it("rejects redirects, private addresses, oversized streams, and digest mismatch", async () => {
    const body = Buffer.from("verified package bytes");
    const packageEntry = entry(body);

    const redirectDestination = join(scratch(), "redirect.tgz");
    await expect(downloadPluginPackage(packageEntry, redirectDestination, {
      fetchImpl: transport(Buffer.alloc(0), { status: 302, headers: { location: "https://evil.example.com" } }),
      lookup: publicLookup,
    })).rejects.toThrow(/redirect/i);
    expect(existsSync(redirectDestination)).toBe(false);

    const privateDestination = join(scratch(), "private.tgz");
    await expect(downloadPluginPackage(packageEntry, privateDestination, {
      fetchImpl: transport(body),
      lookup: privateLookup,
    })).rejects.toThrow(/public address/i);
    expect(existsSync(privateDestination)).toBe(false);

    const oversizedDestination = join(scratch(), "oversized.tgz");
    await expect(downloadPluginPackage(packageEntry, oversizedDestination, {
      fetchImpl: transport(Buffer.concat([body, Buffer.from("x")])),
      lookup: publicLookup,
    })).rejects.toThrow(/size|limit/i);
    expect(existsSync(oversizedDestination)).toBe(false);

    const digestDestination = join(scratch(), "digest.tgz");
    await expect(downloadPluginPackage({ ...packageEntry, sha256: "0".repeat(64) }, digestDestination, {
      fetchImpl: transport(body),
      lookup: publicLookup,
    })).rejects.toThrow(/sha-256/i);
    expect(existsSync(digestDestination)).toBe(false);
  });

  it("rejects non-HTTPS package URLs, credentials, and explicit ports", async () => {
    const body = Buffer.from("verified package bytes");
    for (const packageUrl of [
      "http://plugins.example.com/plugin.tgz",
      "https://user:secret@plugins.example.com/plugin.tgz",
      "https://plugins.example.com:8443/plugin.tgz",
    ]) {
      await expect(downloadPluginPackage(entry(body, { packageUrl }), join(scratch(), "plugin.tgz"), {
        fetchImpl: transport(body),
        lookup: publicLookup,
      })).rejects.toThrow(/https|credential|port/i);
    }
  });

  it("classifies private, loopback, link-local, documentation, and multicast addresses as non-public", () => {
    for (const address of [
      "0.0.0.0",
      "10.1.2.3",
      "100.64.0.1",
      "127.0.0.1",
      "169.254.1.1",
      "172.16.0.1",
      "192.0.2.10",
      "192.168.1.1",
      "198.18.0.1",
      "203.0.113.1",
      "224.0.0.1",
      "::",
      "::1",
      "fc00::1",
      "fe80::1",
      "ff02::1",
      "2001:db8::1",
      "64:ff9b:1::a00:1",
    ]) {
      expect(isPublicPluginAddress(address), address).toBe(false);
    }
    expect(isPublicPluginAddress("8.8.8.8")).toBe(true);
    expect(isPublicPluginAddress("2606:4700:4700::1111")).toBe(true);
  });

  it("bounds the initial address lookup with the download timeout", async () => {
    const body = Buffer.from("verified package bytes");
    const destination = join(scratch(), "plugin.tgz");
    const hangingLookup: PluginAddressLookup = () => new Promise(() => undefined);

    const outcome = await Promise.race([
      downloadPluginPackage(entry(body), destination, {
        fetchImpl: transport(body),
        lookup: hangingLookup,
        timeoutMs: 25,
      }).then(() => "resolved", () => "rejected"),
      new Promise<"hung">((resolve) => setTimeout(() => resolve("hung"), 250)),
    ]);

    expect(outcome).toBe("rejected");
    expect(existsSync(destination)).toBe(false);
  });
});
