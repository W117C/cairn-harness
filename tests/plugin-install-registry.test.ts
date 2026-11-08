import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  InstalledPluginRegistry,
  type InstalledPluginRecord,
} from "../src/main/plugin-install-registry";

const dirs: string[] = [];
const NOW = Date.parse("2026-10-29T12:00:00.000Z");

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "cairn-installed-registry-"));
  dirs.push(dir);
  return dir;
}

function record(overrides: Partial<InstalledPluginRecord> = {}): InstalledPluginRecord {
  return {
    entryId: "demo-plugin",
    manifestName: "demo-plugin",
    version: "1.2.3",
    sha256: "a".repeat(64),
    fingerprint: "f".repeat(32),
    source: {
      kind: "catalog",
      catalogId: "cairn",
      entryId: "demo-plugin",
      sourceUrl: "https://github.com/example/demo-plugin",
      revision: "2026-10-29.1",
    },
    scope: "user",
    workspace: null,
    enabled: false,
    installedAt: new Date(NOW).toISOString(),
    updatedAt: new Date(NOW).toISOString(),
    ...overrides,
  };
}

describe("installed plugin registry", () => {
  it("round-trips records atomically with private file permissions", async () => {
    const file = join(scratch(), "marketplace", "installed.json");
    const registry = new InstalledPluginRegistry(file, () => NOW);
    await registry.upsert(record());

    expect(await registry.list()).toEqual([record()]);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({
      schemaVersion: 2,
      records: [record()],
    });
  });

  it("replaces the same entry/scope/workspace key without duplicating it", async () => {
    const registry = new InstalledPluginRegistry(join(scratch(), "installed.json"), () => NOW);
    await registry.upsert(record({ version: "1.2.3", sha256: "a".repeat(64) }));
    await registry.upsert(record({
      version: "1.3.0",
      sha256: "b".repeat(64),
      updatedAt: new Date(NOW + 1_000).toISOString(),
    }));

    const records = await registry.list();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ version: "1.3.0", sha256: "b".repeat(64) });
  });

  it("keeps project workspaces distinct and removes only the exact key", async () => {
    const registry = new InstalledPluginRegistry(join(scratch(), "installed.json"), () => NOW);
    await registry.upsert(record({ scope: "project", workspace: "/tmp/a" }));
    await registry.upsert(record({ scope: "project", workspace: "/tmp/b" }));

    expect(await registry.get("demo-plugin", "project", "/tmp/a")).toMatchObject({ workspace: "/tmp/a" });
    await registry.remove("demo-plugin", "project", "/tmp/a");
    expect(await registry.get("demo-plugin", "project", "/tmp/a")).toBeNull();
    expect(await registry.get("demo-plugin", "project", "/tmp/b")).toMatchObject({ workspace: "/tmp/b" });
  });

  it("surfaces malformed registry state instead of returning an empty installed list", async () => {
    const dir = scratch();
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "installed.json");
    writeFileSync(file, "{broken", "utf8");
    const registry = new InstalledPluginRegistry(file, () => NOW);

    await expect(registry.list()).rejects.toThrow(/malformed|invalid/i);
  });

  it("migrates a known v1 record to catalog provenance", async () => {
    const dir = scratch();
    const file = join(dir, "installed.json");
    const legacy = {
      schemaVersion: 1,
      records: [{
        entryId: "demo-plugin",
        manifestName: "demo-plugin",
        version: "1.2.3",
        sha256: "a".repeat(64),
        fingerprint: "f".repeat(32),
        scope: "user",
        workspace: null,
        enabled: false,
        installedAt: new Date(NOW).toISOString(),
        updatedAt: new Date(NOW).toISOString(),
      }],
    };
    writeFileSync(file, JSON.stringify(legacy), "utf8");
    const registry = new InstalledPluginRegistry(file, () => NOW);

    const [migrated] = await registry.list();

    expect(migrated?.source).toEqual({
      kind: "catalog",
      catalogId: "cairn",
      entryId: "demo-plugin",
      sourceUrl: "",
      revision: "",
    });
  });

  it("round-trips Git and local provenance with an unversioned Git install", async () => {
    const registry = new InstalledPluginRegistry(join(scratch(), "installed.json"), () => NOW);
    const git = record({
      version: null,
      source: {
        kind: "git",
        repositoryUrl: "https://github.com/example/demo-plugin.git",
        ref: "main",
        commit: "1".repeat(40),
      },
    });
    await registry.upsert(git);
    expect(await registry.list()).toEqual([git]);

    const local = record({
      source: { kind: "local", sourcePath: "/tmp/demo-plugin" },
    });
    await registry.upsert(local);
    expect(await registry.list()).toEqual([local]);
  });

  it("rejects malformed provenance before writing", async () => {
    const registry = new InstalledPluginRegistry(join(scratch(), "installed.json"), () => NOW);
    await expect(registry.upsert(record({
      source: {
        kind: "git",
        repositoryUrl: "https://user:secret@github.com/example/demo.git",
        ref: "main",
        commit: "1".repeat(40),
      },
    }))).rejects.toThrow(/source|URL|credentials/i);
    await expect(registry.upsert(record({
      source: { kind: "local", sourcePath: "relative/path" },
    }))).rejects.toThrow(/source|absolute|绝对/i);
  });
});
