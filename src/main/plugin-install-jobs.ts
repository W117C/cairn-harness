import { randomUUID } from "node:crypto";
import {
  cp,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { MarketplaceCapabilities, MarketplaceEntry } from "../agent/plugins/marketplace";
import { inspectPluginDirectory } from "../agent/plugins/discover";
import { detectJsEntry, parsePluginManifest, type UserConfigField } from "../agent/plugins/manifest";
import {
  extractPluginArchive,
  inspectPluginArchive,
} from "../agent/plugins/package-archive";
import { pluginFingerprintEx } from "../agent/plugins/trust";
import { stageGitPlugin } from "./plugin-git-stage";
import { stageLocalPlugin } from "./plugin-local-stage";
import {
  downloadPluginPackage,
  type PluginPackageDownloadOptions,
} from "./plugin-package-download";
import { preparePluginRoot } from "./plugin-path-safety";
import {
  parsePluginImportRequest,
  samePluginSourceIdentity,
  type PluginImportRequest,
  type PluginSource,
  type StagedPluginSource,
} from "./plugin-source";
import { compareSemver } from "./updater";
import type {
  InstalledPluginRecord,
  PluginInstallRegistryPort,
  PluginInstallScope,
} from "./plugin-install-registry";

export type PluginInstallJobState =
  | "queued"
  | "resolving"
  | "verifying"
  | "review"
  | "installing"
  | "succeeded"
  | "failed"
  | "cancelled";

export interface PluginInstallReview {
  readonly jobId: string;
  readonly entryId: string;
  readonly manifestName: string;
  readonly version: string | null;
  readonly source: PluginSource;
  readonly scope: PluginInstallScope;
  readonly workspace: string | null;
  readonly targetRoot: string;
  readonly fingerprint: string;
  readonly packageSha256: string;
  readonly capabilities: MarketplaceCapabilities;
  readonly permissions: readonly string[] | null;
  readonly userConfigFields: readonly UserConfigField[];
  readonly warnings: readonly string[];
}

export interface PluginInstallJob {
  readonly id: string;
  readonly state: PluginInstallJobState;
  readonly entryId: string | null;
  readonly sourceKind: PluginSource["kind"];
  readonly scope: PluginInstallScope;
  readonly workspace: string | null;
  readonly review?: PluginInstallReview;
  readonly error?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface PluginInstallJobManagerOptions {
  readonly pluginDataRoot: string;
  readonly userPluginsDir?: string;
  readonly registry: PluginInstallRegistryPort;
  readonly download?: typeof downloadPluginPackage;
  readonly now?: () => number;
  readonly onJobUpdate?: (job: PluginInstallJob) => void;
  readonly currentAppVersion?: string;
  readonly catalogRevision?: string;
  readonly beforeCommit?: () => Promise<void> | void;
  readonly sourceResolver?: PluginSourceResolver;
  readonly loadCatalogEntry?: (entryId: string) => Promise<MarketplaceEntry>;
}

export interface ResolvedPluginStage extends StagedPluginSource {
  readonly expected?: {
    readonly name: string;
    readonly version: string | null;
    readonly capabilities: MarketplaceCapabilities;
    readonly permissions: readonly string[] | null;
    readonly minAppVersion: string;
  };
}

export interface PluginSourceResolver {
  resolve(
    request: PluginImportRequest,
    context: { readonly stageDir: string; readonly signal: AbortSignal },
  ): Promise<ResolvedPluginStage>;
}

export interface PluginInstallPaths {
  readonly activeRoot: string;
  readonly disabledRoot: string;
}

interface InternalJob {
  readonly id: string;
  readonly request: PluginImportRequest;
  readonly catalogEntry?: MarketplaceEntry;
  readonly scope: PluginInstallScope;
  readonly workspace: string | null;
  readonly stageDir: string;
  readonly controller: AbortController;
  readonly settled: Promise<PluginInstallJob>;
  readonly completed: Promise<PluginInstallJob>;
  resolveSettled: (job: PluginInstallJob) => void;
  resolveCompleted: (job: PluginInstallJob) => void;
  state: PluginInstallJobState;
  stagedRoot?: string;
  review?: PluginInstallReview;
  error?: string;
  createdAt: string;
  updatedAt: string;
  cancelRequested: boolean;
}

const TERMINAL_STATES = new Set<PluginInstallJobState>(["succeeded", "failed", "cancelled"]);

function deferred(): {
  promise: Promise<PluginInstallJob>;
  resolve: (job: PluginInstallJob) => void;
} {
  let resolvePromise!: (job: PluginInstallJob) => void;
  const promise = new Promise<PluginInstallJob>((resolveValue) => {
    resolvePromise = resolveValue;
  });
  return { promise, resolve: resolvePromise };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function normalizedWorkspace(scope: PluginInstallScope, workspace: string | null): string | null {
  if (scope === "user") return null;
  if (workspace === null || workspace.trim() === "" || !isAbsolute(workspace)) {
    throw new Error("project plugin installation requires an absolute workspace");
  }
  return resolve(workspace);
}

export function pluginInstallPaths(input: {
  pluginDataRoot: string;
  userPluginsDir?: string;
  scope: PluginInstallScope;
  workspace: string | null;
}): PluginInstallPaths {
  if (input.scope === "user") {
    return {
      activeRoot: input.userPluginsDir ?? join(input.pluginDataRoot, "plugins"),
      disabledRoot: join(input.pluginDataRoot, "marketplace", "disabled", "user"),
    };
  }
  const workspace = normalizedWorkspace("project", input.workspace);
  return {
    activeRoot: join(workspace as string, ".agent", "plugins"),
    disabledRoot: join(workspace as string, ".agent", "plugin-disabled"),
  };
}

function cloneReview(review: PluginInstallReview): PluginInstallReview {
  return structuredClone(review);
}

function snapshot(job: InternalJob): PluginInstallJob {
  return {
    id: job.id,
    state: job.state,
    entryId: job.review?.entryId ?? null,
    sourceKind: job.request.kind,
    scope: job.scope,
    workspace: job.workspace,
    ...(job.review === undefined ? {} : { review: cloneReview(job.review) }),
    ...(job.error === undefined ? {} : { error: job.error }),
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

export class PluginInstallJobManager {
  private readonly registry: PluginInstallRegistryPort;
  private readonly pluginDataRoot: string;
  private readonly userPluginsDir: string | undefined;
  private readonly download: typeof downloadPluginPackage;
  private readonly now: () => number;
  private readonly onJobUpdate: ((job: PluginInstallJob) => void) | undefined;
  private readonly currentAppVersion: string | undefined;
  private readonly catalogRevision: string;
  private readonly beforeCommit: (() => Promise<void> | void) | undefined;
  private readonly sourceResolver: PluginSourceResolver | undefined;
  private readonly loadCatalogEntry: ((entryId: string) => Promise<MarketplaceEntry>) | undefined;
  private readonly jobs = new Map<string, InternalJob>();
  private readonly commitTails = new Map<string, Promise<void>>();

  constructor(opts: PluginInstallJobManagerOptions) {
    this.pluginDataRoot = resolve(opts.pluginDataRoot);
    this.userPluginsDir = opts.userPluginsDir === undefined ? undefined : resolve(opts.userPluginsDir);
    this.registry = opts.registry;
    this.download = opts.download ?? downloadPluginPackage;
    this.now = opts.now ?? Date.now;
    this.onJobUpdate = opts.onJobUpdate;
    this.currentAppVersion = opts.currentAppVersion;
    this.catalogRevision = opts.catalogRevision ?? "";
    this.beforeCommit = opts.beforeCommit;
    this.sourceResolver = opts.sourceResolver;
    this.loadCatalogEntry = opts.loadCatalogEntry;
  }

  private timestamp(): string {
    return new Date(this.now()).toISOString();
  }

  private publish(job: InternalJob): PluginInstallJob {
    job.updatedAt = this.timestamp();
    const view = snapshot(job);
    this.onJobUpdate?.(view);
    return view;
  }

  private transition(job: InternalJob, state: PluginInstallJobState): void {
    if (job.state === "cancelled" || job.cancelRequested) {
      throw new DOMException("plugin install was cancelled", "AbortError");
    }
    job.state = state;
    this.publish(job);
  }

  private paths(scope: PluginInstallScope, workspace: string | null): PluginInstallPaths {
    return pluginInstallPaths({
      pluginDataRoot: this.pluginDataRoot,
      ...(this.userPluginsDir === undefined ? {} : { userPluginsDir: this.userPluginsDir }),
      scope,
      workspace,
    });
  }

  private async prepareRoots(
    scope: PluginInstallScope,
    workspace: string | null,
    paths: PluginInstallPaths,
  ): Promise<void> {
    if (scope === "project") {
      const root = normalizedWorkspace("project", workspace) as string;
      await preparePluginRoot(root, paths.disabledRoot);
      await preparePluginRoot(root, paths.activeRoot);
      return;
    }
    await preparePluginRoot(dirname(paths.activeRoot), paths.activeRoot);
    await preparePluginRoot(this.pluginDataRoot, paths.disabledRoot);
  }

  private async prepareTransactionRoot(
    scope: PluginInstallScope,
    workspace: string | null,
    oldRoot: string,
    jobId: string,
  ): Promise<string> {
    if (scope === "project") {
      const root = normalizedWorkspace("project", workspace) as string;
      const transaction = join(root, ".agent", "plugin-transactions", jobId);
      await preparePluginRoot(root, transaction);
      return transaction;
    }
    const transaction = join(dirname(oldRoot), ".cairn-plugin-transactions", jobId);
    await preparePluginRoot(dirname(oldRoot), transaction);
    return transaction;
  }

  private async withCommitLock<T>(key: string, run: () => Promise<T>): Promise<T> {
    const previous = this.commitTails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolveGate) => { release = resolveGate; });
    const tail = previous.then(() => gate);
    this.commitTails.set(key, tail);
    await previous;
    try {
      return await run();
    } finally {
      release();
      if (this.commitTails.get(key) === tail) this.commitTails.delete(key);
    }
  }

  private async cleanupStage(job: InternalJob): Promise<void> {
    await rm(job.stageDir, { recursive: true, force: true }).catch(() => undefined);
  }

  private async fail(job: InternalJob, err: unknown): Promise<void> {
    if (TERMINAL_STATES.has(job.state)) return;
    job.state = job.cancelRequested ? "cancelled" : "failed";
    if (job.state === "failed") job.error = errorMessage(err);
    await this.cleanupStage(job);
    this.publish(job);
    job.resolveSettled(snapshot(job));
    job.resolveCompleted(snapshot(job));
  }

  private assertCompatible(entry: MarketplaceEntry): void {
    if (this.currentAppVersion === undefined) return;
    const compatible = compareSemver(this.currentAppVersion, entry.minAppVersion);
    if (compatible === null) {
      throw new Error(`plugin minimum app version cannot be compared: ${entry.minAppVersion}`);
    }
    if (compatible < 0) {
      throw new Error(
        `plugin requires Cairn ${entry.minAppVersion} or newer; current version is ${this.currentAppVersion}`,
      );
    }
  }

  private async resolveSource(job: InternalJob): Promise<ResolvedPluginStage> {
    if (this.sourceResolver !== undefined) {
      const resolved = await this.sourceResolver.resolve(job.request, {
        stageDir: job.stageDir,
        signal: job.controller.signal,
      });
      if (resolved.expected !== undefined || job.catalogEntry === undefined) return resolved;
      return {
        ...resolved,
        source: resolved.source.kind === "catalog"
          ? { ...resolved.source, revision: resolved.source.revision || this.catalogRevision }
          : resolved.source,
        expected: {
          name: job.catalogEntry.id,
          version: job.catalogEntry.version,
          capabilities: job.catalogEntry.capabilities,
          permissions: job.catalogEntry.permissions,
          minAppVersion: job.catalogEntry.minAppVersion,
        },
      };
    }
    if (job.request.kind === "catalog") {
      const entry = job.catalogEntry;
      if (entry === undefined) throw new Error("catalog resolver is not configured");
      const artifactPath = join(job.stageDir, "download", `${entry.id}.tgz`);
      const extractRoot = join(job.stageDir, "extract");
      await mkdir(join(job.stageDir, "download"), { recursive: true, mode: 0o700 });
      await mkdir(extractRoot, { recursive: false, mode: 0o700 });
      const downloadOptions: PluginPackageDownloadOptions = { signal: job.controller.signal };
      await this.download(entry, artifactPath, downloadOptions);
      const archiveBytes = (await stat(artifactPath)).size;
      const listing = await inspectPluginArchive(artifactPath, archiveBytes);
      await extractPluginArchive(artifactPath, extractRoot, listing);
      return {
        root: extractRoot,
        source: {
          kind: "catalog",
          catalogId: "cairn",
          entryId: entry.id,
          sourceUrl: entry.sourceUrl,
          revision: this.catalogRevision,
        },
        packageSha256: entry.sha256,
        expected: {
          name: entry.id,
          version: entry.version,
          capabilities: entry.capabilities,
          permissions: entry.permissions,
          minAppVersion: entry.minAppVersion,
        },
      };
    }
    const destination = join(job.stageDir, "package");
    if (job.request.kind === "git") {
      return await stageGitPlugin({
        repositoryUrl: job.request.repositoryUrl,
        ...(job.request.ref === undefined ? {} : { ref: job.request.ref }),
        destination,
        signal: job.controller.signal,
      });
    }
    return await stageLocalPlugin({
      sourcePath: job.request.sourcePath,
      destination,
    });
  }

  private async assertIdentityAvailable(
    manifestName: string,
    source: PluginSource,
    scope: PluginInstallScope,
    workspace: string | null,
  ): Promise<void> {
    const records = await this.registry.list();
    const visible = records.filter((record) => {
      if (record.manifestName !== manifestName) return false;
      if (record.scope === "user") return true;
      if (scope === "user") return true;
      return record.workspace === workspace;
    });
    for (const record of visible) {
      const sameTarget = record.entryId === manifestName
        && record.scope === scope
        && record.workspace === (scope === "user" ? null : workspace);
      if (sameTarget) {
        if (!samePluginSourceIdentity(record.source, source)) {
          throw new Error(`plugin ${manifestName} is already installed from a different source`);
        }
        continue;
      }
      throw new Error(`plugin name is already installed in the visible scope: ${manifestName}`);
    }
  }

  private async run(job: InternalJob): Promise<void> {
    try {
      await mkdir(dirname(job.stageDir), { recursive: true, mode: 0o700 });
      await mkdir(job.stageDir, { recursive: false, mode: 0o700 });
      this.transition(job, "resolving");
      const resolved = await this.resolveSource(job);
      job.stagedRoot = resolved.root;
      this.transition(job, "verifying");

      const jsEntry = await detectJsEntry(resolved.root);
      if (jsEntry !== null) {
        throw new Error(`plugin package contains a JavaScript entry (${jsEntry}); this capability is not supported`);
      }
      const manifest = await parsePluginManifest(resolved.root);
      if (resolved.expected !== undefined) {
        if (manifest.name !== resolved.expected.name) {
          throw new Error(
            `plugin manifest name must match the expected entry: ${manifest.name} !== ${resolved.expected.name}`,
          );
        }
        if (manifest.version !== resolved.expected.version) {
          throw new Error(
            `plugin manifest version must match the expected entry: ${String(manifest.version)} !== ${String(resolved.expected.version)}`,
          );
        }
        this.assertCompatible({
          ...(job.catalogEntry as MarketplaceEntry),
          minAppVersion: resolved.expected.minAppVersion,
        });
      }
      const fingerprint = await pluginFingerprintEx(resolved.root);
      if (fingerprint.bounded) {
        throw new Error("plugin package fingerprint is incomplete (links, oversized files, or read failures)");
      }
      const inspected = await inspectPluginDirectory(resolved.root);
      if (inspected.errors.length > 0) {
        throw new Error(`plugin package could not be fully inspected: ${inspected.errors.join("；")}`);
      }
      const capabilities: MarketplaceCapabilities = {
        skills: inspected.skills.length,
        commands: inspected.commands.length,
        agents: inspected.agents.length,
        hooks: inspected.hooks.length,
        mcp: inspected.mcp.length,
        lsp: Object.keys(inspected.lsp).length,
      };
      if (resolved.expected !== undefined) {
        const mismatched = (Object.keys(capabilities) as (keyof MarketplaceCapabilities)[])
          .filter((key) => capabilities[key] !== resolved.expected?.capabilities[key]);
        if (mismatched.length > 0) {
          throw new Error(
            `plugin package capabilities do not match the expected entry: ${mismatched.join(", ")}`,
          );
        }
      }

      await this.assertIdentityAvailable(manifest.name, resolved.source, job.scope, job.workspace);
      const paths = this.paths(job.scope, job.workspace);
      job.review = {
        jobId: job.id,
        entryId: manifest.name,
        manifestName: manifest.name,
        version: manifest.version,
        source: structuredClone(resolved.source),
        scope: job.scope,
        workspace: job.workspace,
        targetRoot: join(paths.activeRoot, manifest.name),
        fingerprint: fingerprint.fp,
        packageSha256: resolved.packageSha256,
        capabilities,
        permissions: resolved.expected?.permissions === null || resolved.expected?.permissions === undefined
          ? null
          : [...resolved.expected.permissions],
        userConfigFields: structuredClone(manifest.userConfigFields),
        warnings: [...new Set([...manifest.warnings, ...inspected.warnings])],
      };
      this.transition(job, "review");
      job.resolveSettled(snapshot(job));
    } catch (err) {
      await this.fail(job, err);
    }
  }

  private async createJob(
    requestValue: PluginImportRequest,
    scope: PluginInstallScope,
    workspace: string | null,
    catalogEntry?: MarketplaceEntry,
  ): Promise<PluginInstallJob> {
    const request = parsePluginImportRequest(requestValue);
    if (catalogEntry !== undefined) this.assertCompatible(catalogEntry);
    const normalized = normalizedWorkspace(scope, workspace);
    const id = randomUUID();
    const stageDir = join(this.pluginDataRoot, "marketplace", "staging", id);
    const settled = deferred();
    const completed = deferred();
    const timestamp = this.timestamp();
    const job: InternalJob = {
      id,
      request,
      ...(catalogEntry === undefined ? {} : { catalogEntry: structuredClone(catalogEntry) }),
      scope,
      workspace: normalized,
      stageDir,
      controller: new AbortController(),
      settled: settled.promise,
      completed: completed.promise,
      resolveSettled: settled.resolve,
      resolveCompleted: completed.resolve,
      state: "queued",
      createdAt: timestamp,
      updatedAt: timestamp,
      cancelRequested: false,
    };
    this.jobs.set(id, job);
    const view = this.publish(job);
    void this.run(job);
    return view;
  }

  async start(
    entry: MarketplaceEntry,
    scope: PluginInstallScope,
    workspace: string | null,
  ): Promise<PluginInstallJob> {
    return await this.createJob({ kind: "catalog", entryId: entry.id }, scope, workspace, entry);
  }

  async startImport(
    request: PluginImportRequest,
    scope: PluginInstallScope,
    workspace: string | null,
  ): Promise<PluginInstallJob> {
    if (request.kind === "catalog") {
      const entry = await this.loadCatalogEntry?.(request.entryId);
      if (entry === undefined) throw new Error(`catalog entry not found: ${request.entryId}`);
      return await this.createJob(request, scope, workspace, entry);
    }
    return await this.createJob(request, scope, workspace);
  }

  status(jobId: string): PluginInstallJob | null {
    const job = this.jobs.get(jobId);
    return job === undefined ? null : snapshot(job);
  }

  async wait(jobId: string): Promise<PluginInstallJob> {
    const job = this.jobs.get(jobId);
    if (job === undefined) throw new Error(`plugin install job not found: ${jobId}`);
    return await job.settled;
  }

  async cancel(jobId: string): Promise<PluginInstallJob> {
    const job = this.jobs.get(jobId);
    if (job === undefined) throw new Error(`plugin install job not found: ${jobId}`);
    if (TERMINAL_STATES.has(job.state)) return snapshot(job);
    if (job.state === "installing") {
      await job.completed;
      return snapshot(job);
    }
    job.cancelRequested = true;
    job.controller.abort(new DOMException("plugin install was cancelled", "AbortError"));
    if (job.state === "review") {
      job.state = "cancelled";
      await this.cleanupStage(job);
      this.publish(job);
      job.resolveSettled(snapshot(job));
      job.resolveCompleted(snapshot(job));
    } else {
      await job.settled;
      await job.completed;
    }
    return snapshot(job);
  }

  async commit(jobId: string): Promise<PluginInstallJob> {
    const job = this.jobs.get(jobId);
    if (job === undefined) throw new Error(`plugin install job not found: ${jobId}`);
    const review = job.review;
    if (review === undefined) throw new Error(`plugin install job is not ready for commit: ${job.state}`);
    const key = JSON.stringify([review.entryId, job.scope, job.workspace]);
    return await this.withCommitLock(key, async () => {
      if (job.state !== "review" || job.review === undefined) {
        throw new Error(`plugin install job is not ready for commit: ${job.state}`);
      }
      await this.beforeCommit?.();
      return await this.commitLocked(job);
    });
  }

  private async commitLocked(job: InternalJob): Promise<PluginInstallJob> {
    const review = job.review;
    if (review === undefined) throw new Error("plugin install review is missing");
    this.transition(job, "installing");
    let existing: InstalledPluginRecord | null = null;
    let oldPath: string | null = null;
    let backup: string | null = null;
    let transactionRoot: string | null = null;
    let targetPath: string | null = null;
    let publishTemp: string | null = null;
    let targetPublished = false;
    let registryWritten = false;
    try {
      const paths = this.paths(job.scope, job.workspace);
      await this.prepareRoots(job.scope, job.workspace, paths);
      await this.assertIdentityAvailable(review.manifestName, review.source, job.scope, job.workspace);
      const activePath = join(paths.activeRoot, review.entryId);
      targetPath = join(paths.disabledRoot, review.entryId);
      existing = await this.registry.get(review.entryId, job.scope, job.workspace);
      if (existing !== null) {
        oldPath = existing.enabled ? activePath : targetPath;
      }
      if (existing?.enabled === true && await stat(targetPath).then(() => true, () => false)) {
        throw new Error("installed registry is inconsistent: both active and disabled plugin copies exist");
      }

      publishTemp = `${targetPath}.install-${job.id}`;
      if (job.stagedRoot === undefined) throw new Error("plugin staged root is missing");
      await cp(job.stagedRoot, publishTemp, {
        recursive: true,
        force: false,
        errorOnExist: true,
        preserveTimestamps: false,
      });
      if (oldPath !== null) {
        const oldRoot = existing?.enabled === true ? paths.activeRoot : paths.disabledRoot;
        transactionRoot = await this.prepareTransactionRoot(
          job.scope,
          job.workspace,
          oldRoot,
          job.id,
        );
        backup = join(transactionRoot, "previous");
        await rename(oldPath, backup);
      }
      await rename(publishTemp, targetPath);
      publishTemp = null;
      targetPublished = true;

      const timestamp = this.timestamp();
      const record: InstalledPluginRecord = {
        entryId: review.entryId,
        manifestName: review.manifestName,
        version: review.version,
        sha256: review.packageSha256,
        fingerprint: review.fingerprint,
        source: structuredClone(review.source),
        scope: job.scope,
        workspace: job.workspace,
        enabled: false,
        installedAt: existing?.installedAt ?? timestamp,
        updatedAt: timestamp,
      };
      registryWritten = true;
      await this.registry.upsert(record);
      const readBack = await this.registry.get(review.entryId, job.scope, job.workspace);
      if (
        readBack === null
        || readBack.sha256 !== record.sha256
        || readBack.version !== record.version
        || readBack.fingerprint !== record.fingerprint
        || !samePluginSourceIdentity(readBack.source, record.source)
        || readBack.enabled
      ) {
        throw new Error("installed registry did not confirm the published plugin");
      }
      if (backup !== null) {
        await rm(transactionRoot as string, { recursive: true, force: true });
        backup = null;
        transactionRoot = null;
      }
      await this.cleanupStage(job);
      job.state = "succeeded";
      const result = this.publish(job);
      job.resolveCompleted(result);
      return result;
    } catch (err) {
      if (registryWritten) {
        try {
          if (existing === null) await this.registry.remove(review.entryId, job.scope, job.workspace);
          else await this.registry.upsert(existing);
        } catch {
          /* preserve the original publication error */
        }
      }
      if (targetPublished && targetPath !== null) {
        await rm(targetPath, { recursive: true, force: true }).catch(() => undefined);
      }
      if (publishTemp !== null) await rm(publishTemp, { recursive: true, force: true }).catch(() => undefined);
      if (backup !== null && oldPath !== null) {
        await rename(backup, oldPath).catch(() => undefined);
      }
      if (transactionRoot !== null) {
        await rm(transactionRoot, { recursive: true, force: true }).catch(() => undefined);
      }
      await this.cleanupStage(job);
      job.state = "failed";
      job.error = errorMessage(err);
      this.publish(job);
      const result = snapshot(job);
      job.resolveCompleted(result);
      return result;
    }
  }

  async shutdown(): Promise<void> {
    const active = [...this.jobs.values()].filter((job) => !TERMINAL_STATES.has(job.state));
    await Promise.all(active.map((job) => this.cancel(job.id)));
  }
}
