import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { create as tarCreate } from "tar";
import { afterEach, describe, expect, it } from "vitest";
import type { MarketplaceEntry } from "../src/agent/plugins/marketplace";
import {
  InstalledPluginRegistry,
  type InstalledPluginRecord,
  type PluginInstallRegistryPort,
} from "../src/main/plugin-install-registry";
import {
  PluginInstallJobManager,
  type PluginSourceResolver,
  type PluginInstallJobState,
} from "../src/main/plugin-install-jobs";
import type { downloadPluginPackage } from "../src/main/plugin-package-download";
import { pluginDirectorySha256 } from "../src/main/plugin-local-stage";

const dirs: string[] = [];
const NOW = Date.parse("2026-10-29T12:00:00.000Z");

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "cairn-plugin-jobs-"));
  dirs.push(dir);
  return dir;
}

async function archive(options: {
  name?: string;
  version?: string;
  globalJsEntry?: boolean;
  skill?: boolean;
} = {}): Promise<{ path: string; bytes: Buffer; sha256: string }> {
  const source = scratch();
  const root = join(source, "package");
  mkdirSync(join(root, ".claude-plugin"), { recursive: true });
  writeFileSync(join(root, ".claude-plugin", "plugin.json"), JSON.stringify({
    name: options.name ?? "demo-plugin",
    version: options.version ?? "1.2.3",
    userConfig: {
      API_KEY: { type: "string", sensitive: true },
      REGION: { type: "string", default: "global" },
    },
  }));
  if (options.globalJsEntry === true) writeFileSync(join(root, "index.js"), "throw new Error('must not load')");
  if (options.skill !== false) {
    const skill = join(root, "skills", "demo");
    mkdirSync(skill, { recursive: true });
    writeFileSync(join(skill, "SKILL.md"), "---\nname: demo\ndescription: Demo skill\n---\nBody\n");
  }
  const path = join(scratch(), "plugin.tgz");
  await tarCreate({ cwd: source, file: path, gzip: true, portable: true }, ["package"]);
  const bytes = readFileSync(path);
  return {
    path,
    bytes,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

function entry(
  artifact: { bytes: Buffer; sha256: string },
  overrides: Partial<MarketplaceEntry> = {},
): MarketplaceEntry {
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
    sha256: artifact.sha256,
    sizeBytes: artifact.bytes.length,
    capabilities: { skills: 1, commands: 0, agents: 0, hooks: 0, mcp: 0, lsp: 0 },
    permissions: ["network"],
    minAppVersion: "0.1.0",
    ...overrides,
  };
}

function downloader(artifact: { bytes: Buffer; sha256: string }): typeof downloadPluginPackage {
  return async (_entry, destination) => {
    writeFileSync(destination, artifact.bytes, { mode: 0o600 });
    return { path: destination, bytes: artifact.bytes.length, sha256: artifact.sha256 };
  };
}

function manager(
  pluginDataRoot: string,
  registry: PluginInstallRegistryPort,
  download: typeof downloadPluginPackage,
  onState?: (state: PluginInstallJobState) => void,
  options: {
    currentAppVersion?: string;
    userPluginsDir?: string;
    beforeCommit?: () => Promise<void> | void;
    sourceResolver?: PluginSourceResolver;
    loadCatalogEntry?: (entryId: string) => Promise<MarketplaceEntry>;
  } = {},
): PluginInstallJobManager {
  return new PluginInstallJobManager({
    pluginDataRoot,
    registry,
    download,
    now: () => NOW,
    currentAppVersion: options.currentAppVersion ?? "0.1.0",
    ...(options.userPluginsDir === undefined ? {} : { userPluginsDir: options.userPluginsDir }),
    ...(options.beforeCommit === undefined ? {} : { beforeCommit: options.beforeCommit }),
    ...(options.sourceResolver === undefined ? {} : { sourceResolver: options.sourceResolver }),
    ...(options.loadCatalogEntry === undefined ? {} : { loadCatalogEntry: options.loadCatalogEntry }),
    ...(onState === undefined ? {} : { onJobUpdate: (job) => onState(job.state) }),
  });
}

function stagedResolver(): PluginSourceResolver {
  return {
    resolve: async (_request, context) => {
      const root = join(context.stageDir, "package");
      mkdirSync(join(root, ".claude-plugin"), { recursive: true });
      const version = _request.kind === "catalog" ? "1.2.3" : undefined;
      writeFileSync(join(root, ".claude-plugin", "plugin.json"), JSON.stringify({
        name: "demo-plugin",
        ...(version === undefined ? {} : { version }),
      }));
      mkdirSync(join(root, "skills", "demo"), { recursive: true });
      writeFileSync(join(root, "skills", "demo", "SKILL.md"), "---\nname: demo\ndescription: Demo\n---\n");
      return {
        root,
        packageSha256: await pluginDirectorySha256(root),
        source: _request.kind === "git"
          ? {
              kind: "git",
              repositoryUrl: _request.repositoryUrl,
              ref: _request.ref ?? "HEAD",
              commit: "1".repeat(40),
            }
          : _request.kind === "local"
            ? { kind: "local", sourcePath: _request.sourcePath }
            : {
                kind: "catalog",
                catalogId: "cairn",
                entryId: _request.entryId,
                sourceUrl: "https://github.com/example/demo-plugin",
                revision: "2026-10-29.1",
              },
      };
    },
  };
}

describe("plugin install jobs", () => {
  it("stages a verified package and exposes a review without publishing it", async () => {
    const pluginDataRoot = scratch();
    const artifact = await archive();
    const registry = new InstalledPluginRegistry(join(pluginDataRoot, "installed.json"), () => NOW);
    const states: PluginInstallJobState[] = [];
    const jobs = manager(pluginDataRoot, registry, downloader(artifact), (state) => states.push(state));

    const started = await jobs.start(entry(artifact), "user", null);
    const reviewed = await jobs.wait(started.id);

    expect(reviewed.state).toBe("review");
    expect(reviewed.review).toMatchObject({
      entryId: "demo-plugin",
      manifestName: "demo-plugin",
      version: "1.2.3",
      scope: "user",
      workspace: null,
      capabilities: entry(artifact).capabilities,
      permissions: ["network"],
    });
    expect(reviewed.review?.targetRoot).toBe(join(pluginDataRoot, "plugins", "demo-plugin"));
    expect(reviewed.review?.userConfigFields.map((field) => field.key)).toEqual(["API_KEY", "REGION"]);
    expect(states.slice(0, 4)).toEqual([
      "queued",
      "resolving",
      "verifying",
      "review",
    ]);
    expect(existsSync(join(pluginDataRoot, "plugins", "demo-plugin"))).toBe(false);
    expect(existsSync(join(pluginDataRoot, "marketplace", "disabled", "user", "demo-plugin"))).toBe(false);
  });

  it("rejects manifest identity mismatch and JavaScript entry files", async () => {
    const mismatchRoot = scratch();
    const mismatchArtifact = await archive({ name: "other-plugin" });
    const mismatchRegistry = new InstalledPluginRegistry(join(mismatchRoot, "installed.json"), () => NOW);
    const mismatchJobs = manager(mismatchRoot, mismatchRegistry, downloader(mismatchArtifact));
    const mismatch = await mismatchJobs.wait((await mismatchJobs.start(entry(mismatchArtifact), "user", null)).id);
    expect(mismatch.state).toBe("failed");
    expect(mismatch.error).toMatch(/manifest.*name|name.*match/i);

    const jsRoot = scratch();
    const jsArtifact = await archive({ globalJsEntry: true });
    const jsRegistry = new InstalledPluginRegistry(join(jsRoot, "installed.json"), () => NOW);
    const jsJobs = manager(jsRoot, jsRegistry, downloader(jsArtifact));
    const rejected = await jsJobs.wait((await jsJobs.start(entry(jsArtifact), "user", null)).id);
    expect(rejected.state).toBe("failed");
    expect(rejected.error).toMatch(/JavaScript|JS entry|index\.js/i);
  });

  it("cancels an active download and removes its staging directory", async () => {
    const pluginDataRoot = scratch();
    const artifact = await archive();
    const registry = new InstalledPluginRegistry(join(pluginDataRoot, "installed.json"), () => NOW);
    let markDownloadStarted: (() => void) | null = null;
    const downloadStarted = new Promise<void>((resolve) => { markDownloadStarted = resolve; });
    const blockedDownload: typeof downloadPluginPackage = async (_entry, _destination, options = {}) => {
      markDownloadStarted?.();
      await new Promise<never>((_resolve, reject) => {
        options.signal?.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
      });
      throw new Error("unreachable");
    };
    const jobs = manager(pluginDataRoot, registry, blockedDownload);
    const started = await jobs.start(entry(artifact), "user", null);
    await downloadStarted;

    const cancelled = await jobs.cancel(started.id);
    expect(cancelled.state).toBe("cancelled");
    expect(existsSync(join(pluginDataRoot, "marketplace", "staging", started.id))).toBe(false);
  });

  it("commits a reviewed package as disabled and records its digest", async () => {
    const pluginDataRoot = scratch();
    const artifact = await archive();
    const registry = new InstalledPluginRegistry(join(pluginDataRoot, "installed.json"), () => NOW);
    const jobs = manager(pluginDataRoot, registry, downloader(artifact));
    const reviewed = await jobs.wait((await jobs.start(entry(artifact), "user", null)).id);

    const committed = await jobs.commit(reviewed.id);
    const installed = await registry.get("demo-plugin", "user", null);

    expect(committed.state).toBe("succeeded");
    expect(installed).toMatchObject({
      entryId: "demo-plugin",
      manifestName: "demo-plugin",
      version: "1.2.3",
      sha256: artifact.sha256,
      scope: "user",
      workspace: null,
      enabled: false,
      installedAt: new Date(NOW).toISOString(),
    });
    expect(existsSync(join(pluginDataRoot, "plugins", "demo-plugin"))).toBe(false);
    expect(existsSync(join(pluginDataRoot, "marketplace", "disabled", "user", "demo-plugin", ".claude-plugin", "plugin.json"))).toBe(true);
    expect(existsSync(join(pluginDataRoot, "marketplace", "staging", reviewed.id))).toBe(false);
  });

  it("does not delete an unowned target when publication cannot replace it", async () => {
    const pluginDataRoot = scratch();
    const artifact = await archive();
    const target = join(pluginDataRoot, "marketplace", "disabled", "user", "demo-plugin");
    const sentinel = join(target, "sentinel.txt");
    mkdirSync(target, { recursive: true });
    writeFileSync(sentinel, "manual package");
    const registry = new InstalledPluginRegistry(join(pluginDataRoot, "installed.json"), () => NOW);
    const jobs = manager(pluginDataRoot, registry, downloader(artifact));
    const reviewed = await jobs.wait((await jobs.start(entry(artifact), "user", null)).id);

    const committed = await jobs.commit(reviewed.id);

    expect(committed.state).toBe("failed");
    expect(readFileSync(sentinel, "utf8")).toBe("manual package");
  });

  it("rejects a symlinked project publish root", async () => {
    const pluginDataRoot = scratch();
    const workspace = scratch();
    const outside = scratch();
    mkdirSync(join(workspace, ".agent"), { recursive: true });
    symlinkSync(outside, join(workspace, ".agent", "plugin-disabled"), "dir");
    const artifact = await archive();
    const registry = new InstalledPluginRegistry(join(pluginDataRoot, "installed.json"), () => NOW);
    const jobs = manager(pluginDataRoot, registry, downloader(artifact));
    const reviewed = await jobs.wait((await jobs.start(entry(artifact), "project", workspace)).id);

    const committed = await jobs.commit(reviewed.id);

    expect(committed.state).toBe("failed");
    expect(existsSync(join(outside, "demo-plugin"))).toBe(false);
  });

  it("keeps rollback backups outside the active plugin scan root", async () => {
    const pluginDataRoot = scratch();
    const artifact = await archive();
    const activeRoot = join(pluginDataRoot, "plugins");
    const activePath = join(activeRoot, "demo-plugin");
    mkdirSync(join(activePath, ".claude-plugin"), { recursive: true });
    writeFileSync(join(activePath, "old-version.txt"), "still working");
    const oldRecord: InstalledPluginRecord = {
      entryId: "demo-plugin",
      manifestName: "demo-plugin",
      version: "1.1.0",
      sha256: "b".repeat(64),
      fingerprint: "e".repeat(32),
      source: {
        kind: "catalog",
        catalogId: "cairn",
        entryId: "demo-plugin",
        sourceUrl: "https://github.com/example/demo-plugin",
        revision: "",
      },
      scope: "user",
      workspace: null,
      enabled: true,
      installedAt: new Date(NOW - 10_000).toISOString(),
      updatedAt: new Date(NOW - 10_000).toISOString(),
    };
    const base = new InstalledPluginRegistry(join(pluginDataRoot, "installed.json"), () => NOW);
    await base.upsert(oldRecord);
    let releaseUpsert!: () => void;
    const upsertRelease = new Promise<void>((resolve) => { releaseUpsert = resolve; });
    let markStarted!: () => void;
    const upsertStarted = new Promise<void>((resolve) => { markStarted = resolve; });
    const blockingRegistry: PluginInstallRegistryPort = {
      list: () => base.list(),
      get: (entryId, scope, workspace) => base.get(entryId, scope, workspace),
      upsert: async (record) => {
        markStarted();
        await upsertRelease;
        await base.upsert(record);
      },
      remove: (entryId, scope, workspace) => base.remove(entryId, scope, workspace),
    };
    const jobs = manager(pluginDataRoot, blockingRegistry, downloader(artifact));
    const reviewed = await jobs.wait((await jobs.start(entry(artifact), "user", null)).id);
    const committing = jobs.commit(reviewed.id);
    await upsertStarted;

    expect(readdirSync(activeRoot)).toEqual([]);

    releaseUpsert();
    expect((await committing).state).toBe("succeeded");
  });

  it("waits for an in-flight commit before shutdown finishes", async () => {
    const pluginDataRoot = scratch();
    const artifact = await archive();
    const base = new InstalledPluginRegistry(join(pluginDataRoot, "installed.json"), () => NOW);
    let releaseUpsert!: () => void;
    const upsertRelease = new Promise<void>((resolve) => { releaseUpsert = resolve; });
    let markStarted!: () => void;
    const upsertStarted = new Promise<void>((resolve) => { markStarted = resolve; });
    const blockingRegistry: PluginInstallRegistryPort = {
      list: () => base.list(),
      get: (entryId, scope, workspace) => base.get(entryId, scope, workspace),
      upsert: async (record) => {
        markStarted();
        await upsertRelease;
        await base.upsert(record);
      },
      remove: (entryId, scope, workspace) => base.remove(entryId, scope, workspace),
    };
    const jobs = manager(pluginDataRoot, blockingRegistry, downloader(artifact));
    const reviewed = await jobs.wait((await jobs.start(entry(artifact), "user", null)).id);
    const committing = jobs.commit(reviewed.id);
    await upsertStarted;
    let shutdownFinished = false;
    const shuttingDown = jobs.shutdown().then(() => { shutdownFinished = true; });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(shutdownFinished).toBe(false);

    releaseUpsert();
    expect((await committing).state).toBe("succeeded");
    await shuttingDown;
    expect(shutdownFinished).toBe(true);
  });

  it("rejects signed capability counts that do not match the extracted package", async () => {
    const pluginDataRoot = scratch();
    const artifact = await archive({ skill: false });
    const registry = new InstalledPluginRegistry(join(pluginDataRoot, "installed.json"), () => NOW);
    const jobs = manager(pluginDataRoot, registry, downloader(artifact));

    const reviewed = await jobs.wait((await jobs.start(entry(artifact), "user", null)).id);

    expect(reviewed.state).toBe("failed");
    expect(reviewed.error).toMatch(/capabilit|skills/i);
  });

  it("rejects entries that require a newer app version", async () => {
    const pluginDataRoot = scratch();
    const artifact = await archive();
    const registry = new InstalledPluginRegistry(join(pluginDataRoot, "installed.json"), () => NOW);
    const jobs = manager(pluginDataRoot, registry, downloader(artifact), undefined, {
      currentAppVersion: "0.1.0",
    });

    await expect(jobs.start(
      entry(artifact, { minAppVersion: "9.0.0" }),
      "user",
      null,
    )).rejects.toThrow(/version|newer|minimum/i);
  });

  it("uses the configured user plugin root for review and publication", async () => {
    const pluginDataRoot = scratch();
    const userPluginsDir = scratch();
    const artifact = await archive();
    const registry = new InstalledPluginRegistry(join(pluginDataRoot, "installed.json"), () => NOW);
    const jobs = manager(pluginDataRoot, registry, downloader(artifact), undefined, { userPluginsDir });
    const reviewed = await jobs.wait((await jobs.start(entry(artifact), "user", null)).id);

    expect(reviewed.review?.targetRoot).toBe(join(userPluginsDir, "demo-plugin"));
  });

  it("leaves a review unpublished when the mutation gate rejects commit", async () => {
    const pluginDataRoot = scratch();
    const artifact = await archive();
    const registry = new InstalledPluginRegistry(join(pluginDataRoot, "installed.json"), () => NOW);
    const jobs = manager(pluginDataRoot, registry, downloader(artifact), undefined, {
      beforeCommit: () => { throw new Error("session still running"); },
    });
    const reviewed = await jobs.wait((await jobs.start(entry(artifact), "user", null)).id);

    await expect(jobs.commit(reviewed.id)).rejects.toThrow(/session still running/i);

    expect(jobs.status(reviewed.id)?.state).toBe("review");
    expect(await registry.get("demo-plugin", "user", null)).toBeNull();
  });

  it("restores the previous active package when registry publication fails", async () => {
    const pluginDataRoot = scratch();
    const artifact = await archive();
    const activeRoot = join(pluginDataRoot, "plugins", "demo-plugin");
    mkdirSync(join(activeRoot, ".claude-plugin"), { recursive: true });
    writeFileSync(join(activeRoot, "old-version.txt"), "still working");
    const oldRecord: InstalledPluginRecord = {
      entryId: "demo-plugin",
      manifestName: "demo-plugin",
      version: "1.1.0",
      sha256: "b".repeat(64),
      fingerprint: "e".repeat(32),
      source: {
        kind: "catalog",
        catalogId: "cairn",
        entryId: "demo-plugin",
        sourceUrl: "https://github.com/example/demo-plugin",
        revision: "",
      },
      scope: "user",
      workspace: null,
      enabled: true,
      installedAt: new Date(NOW - 10_000).toISOString(),
      updatedAt: new Date(NOW - 10_000).toISOString(),
    };
    const base = new InstalledPluginRegistry(join(pluginDataRoot, "installed.json"), () => NOW);
    await base.upsert(oldRecord);
    const failingRegistry: PluginInstallRegistryPort = {
      list: () => base.list(),
      get: (entryId, scope, workspace) => base.get(entryId, scope, workspace),
      upsert: async () => { throw new Error("registry write failed"); },
      remove: (entryId, scope, workspace) => base.remove(entryId, scope, workspace),
    };
    const jobs = manager(pluginDataRoot, failingRegistry, downloader(artifact));
    const reviewed = await jobs.wait((await jobs.start(entry(artifact), "user", null)).id);

    const committed = await jobs.commit(reviewed.id);

    expect(committed.state).toBe("failed");
    expect(readFileSync(join(activeRoot, "old-version.txt"), "utf8")).toBe("still working");
    expect(existsSync(join(pluginDataRoot, "marketplace", "disabled", "user", "demo-plugin"))).toBe(false);
    expect(await base.get("demo-plugin", "user", null)).toEqual(oldRecord);
    expect(existsSync(join(pluginDataRoot, "marketplace", "staging", reviewed.id))).toBe(false);
  });

  it.each([
    { kind: "catalog" as const, request: { kind: "catalog" as const, entryId: "demo-plugin" } },
    { kind: "git" as const, request: { kind: "git" as const, repositoryUrl: "https://github.com/acme/demo.git" } },
    { kind: "local" as const, request: { kind: "local" as const, sourcePath: "/tmp/demo-plugin" } },
  ])("stages $kind through one review path", async ({ kind, request }) => {
    const pluginDataRoot = scratch();
    const artifact = await archive();
    const registry = new InstalledPluginRegistry(join(pluginDataRoot, "installed.json"), () => NOW);
    const catalogEntry = entry(artifact);
    const jobs = manager(pluginDataRoot, registry, downloader(artifact), undefined, {
      sourceResolver: stagedResolver(),
      loadCatalogEntry: async () => catalogEntry,
    });

    const started = await jobs.startImport(request, "user", null);
    const reviewed = await jobs.wait(started.id);

    expect(reviewed.state).toBe("review");
    expect(reviewed.entryId).toBe("demo-plugin");
    expect(reviewed.sourceKind).toBe(kind);
    expect(reviewed.review).toMatchObject({
      entryId: "demo-plugin",
      version: kind === "catalog" ? "1.2.3" : null,
      source: { kind },
    });
    expect(reviewed.review?.packageSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(reviewed.review?.permissions).toEqual(kind === "catalog" ? ["network"] : null);
  });

  it("rejects duplicate names and cross-source replacement before publication", async () => {
    const pluginDataRoot = scratch();
    const artifact = await archive();
    const registry = new InstalledPluginRegistry(join(pluginDataRoot, "installed.json"), () => NOW);
    await registry.upsert({
      entryId: "demo-plugin",
      manifestName: "demo-plugin",
      version: "1.0.0",
      sha256: "a".repeat(64),
      fingerprint: "f".repeat(32),
      source: { kind: "local", sourcePath: "/tmp/demo-plugin" },
      scope: "user",
      workspace: null,
      enabled: false,
      installedAt: new Date(NOW).toISOString(),
      updatedAt: new Date(NOW).toISOString(),
    });
    const jobs = manager(pluginDataRoot, registry, downloader(artifact), undefined, {
      sourceResolver: stagedResolver(),
    });

    const started = await jobs.startImport({
      kind: "git",
      repositoryUrl: "https://github.com/acme/demo.git",
    }, "user", null);
    const reviewed = await jobs.wait(started.id);

    expect(reviewed.state).toBe("failed");
    expect(reviewed.error).toMatch(/already installed|source|conflict|冲突/i);
    expect((await registry.list())[0]?.source).toEqual({ kind: "local", sourcePath: "/tmp/demo-plugin" });
  });
});
