# Signed Plugin Installer And Registry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn a verified marketplace catalog entry into a reviewed, safely extracted, atomically installed plugin with durable enabled/disabled state and rollback-safe replacement, without executing package scripts or exposing the PLUGIN-2 marketplace UI yet.

**Architecture:** A pure archive module validates and extracts a single-root gzip tarball. A main-process package downloader resolves only public addresses, streams the exact catalog artifact to disk, and verifies size plus SHA-256. An install job manager keeps staged trees outside plugin scan roots until the user commits the reviewed package, then publishes through the installed registry; enable/disable/uninstall move package directories transactionally.

**Tech Stack:** Node `https`, `dns`, `net`, `crypto`, `stream`, TypeScript, `tar` 7.5.x, Vitest, Electron IPC.

**Spec:** `docs/superpowers/specs/2026-10-29-agent-os-desktop-design.md`

## Global Constraints

- Preserve the shared dirty checkout: no reset, stash, clean, commit, push, or unrelated-file rewrite.
- Accept only entries from the already verified signed marketplace catalog. The renderer never supplies a package URL, digest, size, target path, or manifest name.
- First version accepts only `.tgz` marketplace artifacts. Git-directory and local-directory import remain a separate later plan.
- Never execute package scripts, install npm dependencies, evaluate JavaScript, or load third-party code inside the main process.
- Archive extraction rejects absolute paths, `..`, links, devices, FIFOs, duplicate normalized paths, case-folded collisions, multiple roots, oversized entries, too many files, and excessive total uncompressed bytes.
- Downloads use HTTPS only, reject credentials and redirects, resolve only public addresses, have a hard timeout, stream to disk, and must match catalog `sizeBytes` and `sha256` exactly.
- Staging and disabled packages live outside discovery roots. A failed review, commit, replacement, enable, disable, or uninstall must leave the previous package and registry readable.
- Installation starts disabled. Enabling is a separate operation; project plugins still pass the existing content-fingerprint trust gate before activation.
- A running agent continues with its start-of-run plugin snapshot. Install/update/disable/uninstall affects the next run.
- Keep renderer code free of runtime imports from `src/`; renderer-visible IPC uses type imports only.
- Do not expose install/update/uninstall controls in the renderer during this plan. PLUGIN-2 owns the marketplace UI.

## Review Focus

- A malicious tarball attempts traversal, links, case collisions, duplicate entries, multiple roots, or a decompression bomb; nothing may escape the fresh staging directory.
- A hostname changes resolution, returns a private/link-local address, redirects, omits length, lies about length, or sends more bytes than the catalog promises; no unverified bytes may publish.
- A replacement fails after the old package moved but before the new package and registry are committed; the old installed version must remain usable.
- A disabled or partially staged package attempts to appear in runtime discovery; only registry-confirmed active directories may be scanned.
- Cancellation, process restart, or a stale review leaves temporary files but must never turn them into an installed package.

---

### Task 1: Safe Single-Root Tarball Inspection And Extraction

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Create: `src/agent/plugins/package-archive.ts`
- Test: `tests/plugin-package-archive.test.ts`

**Interfaces:**
- Consumes: the `tar` package.
- Produces:
  - `MAX_PLUGIN_ARCHIVE_BYTES = 64 * 1024 * 1024`
  - `MAX_PLUGIN_EXTRACTED_BYTES = 128 * 1024 * 1024`
  - `MAX_PLUGIN_ARCHIVE_FILES = 5_000`
  - `MAX_PLUGIN_ARCHIVE_FILE_BYTES = 8 * 1024 * 1024`
  - `interface PluginArchiveListing { rootName: string; files: readonly string[]; totalBytes: number }`
  - `inspectPluginArchive(archivePath: string, archiveBytes: number): Promise<PluginArchiveListing>`
  - `extractPluginArchive(archivePath: string, destination: string, listing: PluginArchiveListing): Promise<void>`

- [ ] **Step 1: Add the maintained tar implementation**

Add `"tar": "7.5.22"` to runtime dependencies and update the lockfile. Do not add a hand-written tar parser.

- [ ] **Step 2: Write failing archive-boundary tests**

Create temporary `.tgz` fixtures with `tar.create` and assert:

```ts
it("accepts one root and strips it during extraction", async () => {
  const listing = await inspectPluginArchive(archive, statSync(archive).size);
  expect(listing.rootName).toBe("demo-plugin");
  await extractPluginArchive(archive, destination, listing);
  expect(readFileSync(join(destination, ".claude-plugin", "plugin.json"), "utf8")).toContain("demo-plugin");
});

it("rejects traversal, links, multiple roots, duplicate paths, and bomb limits", async () => {
  await expect(inspectPluginArchive(traversalArchive)).rejects.toThrow(/path|outside/i);
  await expect(inspectPluginArchive(symlinkArchive)).rejects.toThrow(/link/i);
  await expect(inspectPluginArchive(multipleRootsArchive)).rejects.toThrow(/single root/i);
  await expect(inspectPluginArchive(caseCollisionArchive)).rejects.toThrow(/collision/i);
  await expect(inspectPluginArchive(oversizedFileArchive)).rejects.toThrow(/file.*limit/i);
});
```

- [ ] **Step 3: Run the focused test to verify it fails**

Run: `pnpm exec vitest run --config tests/vitest.config.ts tests/plugin-package-archive.test.ts`

Expected: FAIL because `package-archive.ts` does not exist.

- [ ] **Step 4: Implement two-pass inspection and extraction**

Use `tar.t` once with `onReadEntry` to collect normalized POSIX paths, entry types, sizes, and the single root. Then use `tar.x` with `strict: true`, `preservePaths: false`, `strip: 1`, `jobs: 1`, and a filter that accepts only the exact listings collected by the first pass. Set every extracted file mode to `0o600` or `0o700` for directories.

- [ ] **Step 5: Run the focused test to verify it passes**

Run: `pnpm exec vitest run --config tests/vitest.config.ts tests/plugin-package-archive.test.ts`

Expected: PASS.

- [ ] **Step 6: Check the scoped diff**

Run: `git diff --check -- package.json pnpm-lock.yaml src/agent/plugins/package-archive.ts tests/plugin-package-archive.test.ts`

Expected: exit 0.

---

### Task 2: Public-Address Streaming Package Download

**Files:**
- Create: `src/main/plugin-package-download.ts`
- Test: `tests/plugin-package-download.test.ts`

**Interfaces:**
- Consumes: `MarketplaceEntry`; `inspectPluginArchive`.
- Produces:
  - `interface DownloadedPluginPackage { path: string; bytes: number; sha256: string }`
  - `interface PluginPackageDownloadOptions { fetchImpl?: PluginPackageTransport; lookup?: PluginAddressLookup; timeoutMs?: number }`
  - `isPublicPluginAddress(address: string): boolean`
  - `downloadPluginPackage(entry: MarketplaceEntry, destination: string, opts?: PluginPackageDownloadOptions): Promise<DownloadedPluginPackage>`

- [ ] **Step 1: Write failing download tests**

Use an injected transport that returns a `Readable` plus status/header metadata. Assert:

```ts
it("streams exact catalog bytes and verifies SHA-256", async () => {
  const result = await downloadPluginPackage(entry, destination, { fetchImpl: transport(body), lookup: publicLookup });
  expect(result).toEqual({ path: destination, bytes: body.length, sha256: entry.sha256 });
});

it("rejects redirects, private addresses, oversized streams, and digest mismatch", async () => {
  await expect(downloadPluginPackage(entry, destination, { fetchImpl: redirect(), lookup: publicLookup })).rejects.toThrow(/redirect/i);
  await expect(downloadPluginPackage(entry, destination, { fetchImpl: transport(body), lookup: privateLookup })).rejects.toThrow(/public address/i);
  await expect(downloadPluginPackage(entry, destination, { fetchImpl: transport(oversized), lookup: publicLookup })).rejects.toThrow(/size|limit/i);
  await expect(downloadPluginPackage({ ...entry, sha256: "0".repeat(64) }, destination, { fetchImpl: transport(body), lookup: publicLookup })).rejects.toThrow(/sha-256/i);
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `pnpm exec vitest run --config tests/vitest.config.ts tests/plugin-package-download.test.ts`

Expected: FAIL because `plugin-package-download.ts` does not exist.

- [ ] **Step 3: Implement hardened HTTPS streaming**

The default transport uses `https.request` with `redirect: never`, `AbortSignal.timeout(120_000)`, and a custom DNS `lookup` that rejects if any returned address is not public. Reject credentials and non-default ports. Stream chunks to a fresh file while hashing and counting, stop immediately above `min(entry.sizeBytes, MAX_PLUGIN_ARCHIVE_BYTES)`, delete the partial file on every failure, and require exact byte count plus digest before returning.

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `pnpm exec vitest run --config tests/vitest.config.ts tests/plugin-package-download.test.ts`

Expected: PASS.

- [ ] **Step 5: Check the scoped diff**

Run: `git diff --check -- src/main/plugin-package-download.ts tests/plugin-package-download.test.ts`

Expected: exit 0.

---

### Task 3: Durable Installed Registry And Install Jobs

**Files:**
- Create: `src/main/plugin-install-registry.ts`
- Create: `src/main/plugin-install-jobs.ts`
- Test: `tests/plugin-install-registry.test.ts`
- Test: `tests/plugin-install-jobs.test.ts`

**Interfaces:**
- Consumes: `MarketplaceEntry`, `downloadPluginPackage`, `inspectPluginArchive`, `extractPluginArchive`, `parsePluginManifest`, `detectJsEntry`, `pluginFingerprintEx`.
- Produces:
  - `type PluginInstallScope = "user" | "project"`
  - `interface InstalledPluginRecord { entryId; manifestName; version; sha256; fingerprint; scope; workspace; enabled; installedAt; updatedAt }`
  - `interface PluginInstallReview { jobId; entryId; manifestName; version; scope; workspace; targetRoot; capabilities; permissions; userConfigFields; warnings }`
  - `type PluginInstallJobState = "queued" | "downloading" | "verifying" | "extracting" | "review" | "installing" | "succeeded" | "failed" | "cancelled"`
  - `interface PluginInstallJob { id; state; entryId; scope; workspace; review?; error?; createdAt; updatedAt }`
  - `class InstalledPluginRegistry`
  - `class PluginInstallJobManager`

- [ ] **Step 1: Write failing registry persistence tests**

Assert atomic round-trip, mode `0600`, duplicate `(entryId, scope, workspace)` replacement, malformed registry visibility, and no record publication before package publication succeeds.

- [ ] **Step 2: Write failing staged-job tests**

Assert state transitions from queued through review, manifest name/version equality with the signed entry, rejection of JS entries, cancellation cleanup, status truthfulness, and commit publishing a disabled package only after the registry write is recoverable.

- [ ] **Step 3: Run the focused tests to verify they fail**

Run: `pnpm exec vitest run --config tests/vitest.config.ts tests/plugin-install-registry.test.ts tests/plugin-install-jobs.test.ts`

Expected: FAIL because both modules do not exist.

- [ ] **Step 4: Implement staging, review, and commit**

Create private job directories under `<pluginDataRoot>/marketplace/staging/<jobId>`. Keep downloaded artifacts separate from extracted roots. Review must parse `.claude-plugin/plugin.json`, require manifest `name === entry.id` and manifest `version === entry.version`, reject JS entry files, compute an unbounded fingerprint, and return counts/configuration metadata without publishing.

Commit starts from the reviewed extraction, moves the previous installed directory to a same-filesystem rollback path when replacing, publishes the new tree to the disabled root, writes the registry atomically, and deletes the rollback only after the registry read-back matches the new digest. Restore the previous tree on every failure.

- [ ] **Step 5: Run the focused tests to verify they pass**

Run: `pnpm exec vitest run --config tests/vitest.config.ts tests/plugin-install-registry.test.ts tests/plugin-install-jobs.test.ts`

Expected: PASS.

- [ ] **Step 6: Check the scoped diff**

Run: `git diff --check -- src/main/plugin-install-registry.ts src/main/plugin-install-jobs.ts tests/plugin-install-registry.test.ts tests/plugin-install-jobs.test.ts`

Expected: exit 0.

---

### Task 4: Enable, Disable, Uninstall, And Runtime Discovery

**Files:**
- Modify: `src/agent/plugins/index.ts`
- Modify: `src/main/state-handlers.ts`
- Modify: `src/agent/plugins/trust.ts`
- Modify: `src/main/plugin-install-registry.ts`
- Test: `tests/plugin-install-operations.test.ts`
- Test: `tests/plugin-data-root-durable.test.ts`

**Interfaces:**
- Consumes: `InstalledPluginRegistry`, existing `TrustStore`.
- Produces:
  - `defaultUserPluginsDir(home: string): string`
  - `TrustStore.forget(absRoot: string): Promise<void>`
  - `setPluginEnabled(input): Promise<InstalledPluginRecord>`
  - `uninstallPlugin(input): Promise<{ ok: true }>`

- [ ] **Step 1: Write failing operation tests**

Assert:

```ts
it("moves a disabled plugin into the active root before reporting enabled", async () => {
  const record = await setPluginEnabled({ entryId: "demo-plugin", scope: "user", enabled: true, workspace });
  expect(record.enabled).toBe(true);
  expect(existsSync(join(userPluginsDir, "demo-plugin", ".claude-plugin", "plugin.json"))).toBe(true);
});

it("does not scan disabled or staging packages", async () => {
  const manifest = await discoverPlugins({ userPluginsDir: defaultUserPluginsDir(home), projectPluginsDir });
  expect(manifest.plugins.map((plugin) => plugin.name)).toEqual(["active-plugin"]);
});
```

- [ ] **Step 2: Run the focused tests to verify they fail**

Run: `pnpm exec vitest run --config tests/vitest.config.ts tests/plugin-install-operations.test.ts tests/plugin-data-root-durable.test.ts`

Expected: FAIL because operations and default user root are missing.

- [ ] **Step 3: Implement transactional file moves**

`setPluginEnabled` renames between registry-derived active and disabled roots, updates the registry, and restores the original path if the registry write fails. Disabling never deletes files. Uninstall removes only the registry-owned package directory, removes all matching trust entries with `TrustStore.forget`, and leaves external or manually copied plugin directories untouched.

Set `pluginRuntimeOpts` user root to `M2E_USER_PLUGINS` when provided, otherwise `defaultUserPluginsDir(homedir())`.

- [ ] **Step 4: Run the focused tests to verify they pass**

Run: `pnpm exec vitest run --config tests/vitest.config.ts tests/plugin-install-operations.test.ts tests/plugin-data-root-durable.test.ts`

Expected: PASS.

- [ ] **Step 5: Check the scoped diff**

Run: `git diff --check -- src/agent/plugins/index.ts src/main/state-handlers.ts src/agent/plugins/trust.ts src/main/plugin-install-registry.ts tests/plugin-install-operations.test.ts tests/plugin-data-root-durable.test.ts`

Expected: exit 0.

---

### Task 5: Desktop Install IPC At Protocol v28

**Files:**
- Modify: `src/main/ipc-protocol.ts`
- Modify: `apps/desktop/src/main/channels.ts`
- Modify: `apps/desktop/src/main/index.ts`
- Modify: `apps/desktop/tests/channels.test.ts`
- Modify: `apps/desktop/tests/protocol-version.test.ts`
- Modify: `apps/desktop/tests/notification-open-wiring.test.ts`
- Modify: `apps/desktop/tests/plan-mode-wiring.test.ts`
- Modify: `apps/desktop/tests/invoke-consumer-census.test.ts`
- Modify: `tests/ipc-protocol-version.test.ts`
- Modify: `tests/readme-invoke-channel-count.test.ts`
- Modify: `README.md`
- Test: `apps/desktop/tests/marketplace-install-wiring.test.ts`

**Interfaces:**
- Consumes: `PluginInstallJobManager`, `InstalledPluginRegistry`, verified `marketplaceCatalog`.
- Produces:
  - `AgentApi.marketplacePluginInstall(entryId, scope, workspace?): Promise<PluginInstallJob>`
  - `AgentApi.marketplacePluginInstallStatus(jobId): Promise<PluginInstallJob | null>`
  - `AgentApi.marketplacePluginInstallCommit(jobId): Promise<{ ok: boolean; error?: string }>`
  - `AgentApi.marketplacePluginInstallCancel(jobId): Promise<{ ok: boolean; error?: string }>`
  - `AgentApi.pluginSetEnabled(entryId, scope, enabled, workspace?): Promise<{ ok: boolean; error?: string }>`
  - `AgentApi.pluginUninstall(entryId, scope, workspace?): Promise<{ ok: boolean; error?: string }>`
  - `AgentApi.pluginsInstalled(): Promise<InstalledPluginRecord[]>`
  - `IPC_PROTOCOL_VERSION = 28`

- [ ] **Step 1: Write failing IPC wiring tests**

Assert channel names, protocol v28, no renderer-supplied URL/hash/path parameters, verified catalog lookup by `entryId`, workspace canonicalization for project scope, singleton job manager wiring, and renderer-consumer allowlist entries marked for PLUGIN-2.

- [ ] **Step 2: Run the focused tests to verify they fail**

Run: `pnpm --filter cairn-desktop exec vitest run --config vitest.config.ts tests/marketplace-install-wiring.test.ts tests/channels.test.ts tests/protocol-version.test.ts tests/notification-open-wiring.test.ts tests/plan-mode-wiring.test.ts tests/invoke-consumer-census.test.ts`

Expected: FAIL on protocol version, missing channels, missing API, and missing main wiring.

- [ ] **Step 3: Add protocol, channels, and main-process handlers**

The install handler refreshes the verified catalog with `"auto"`, returns unavailable/expired errors without starting a job, finds the entry by id, and passes only the verified entry plus canonical target scope to the manager. Project scope requires an existing workspace directory. App quit cancels active jobs and removes staging.

- [ ] **Step 4: Run the focused tests to verify they pass**

Run: `pnpm --filter cairn-desktop exec vitest run --config vitest.config.ts tests/marketplace-install-wiring.test.ts tests/channels.test.ts tests/protocol-version.test.ts tests/notification-open-wiring.test.ts tests/plan-mode-wiring.test.ts tests/invoke-consumer-census.test.ts`

Expected: PASS.

- [ ] **Step 5: Run root protocol and README tests**

Run: `pnpm exec vitest run --config tests/vitest.config.ts tests/ipc-protocol-version.test.ts tests/readme-invoke-channel-count.test.ts tests/plugin-package-archive.test.ts tests/plugin-package-download.test.ts tests/plugin-install-registry.test.ts tests/plugin-install-jobs.test.ts tests/plugin-install-operations.test.ts`

Expected: PASS.

- [ ] **Step 6: Check the scoped diff**

Run: `git diff --check -- src/main/ipc-protocol.ts apps/desktop/src/main/channels.ts apps/desktop/src/main/index.ts apps/desktop/tests/channels.test.ts apps/desktop/tests/protocol-version.test.ts apps/desktop/tests/notification-open-wiring.test.ts apps/desktop/tests/plan-mode-wiring.test.ts apps/desktop/tests/invoke-consumer-census.test.ts apps/desktop/tests/marketplace-install-wiring.test.ts tests/ipc-protocol-version.test.ts tests/readme-invoke-channel-count.test.ts README.md`

Expected: exit 0.

---

## Self-Review

- Spec coverage: signed catalog entry consumption, HTTPS package download, digest verification, safe extraction, manifest review, staged install, rollback-safe replacement, enabled/disabled state, uninstall and next-run lifecycle are covered.
- Deliberately deferred: marketplace discovery/installed/update UI, install review drawer, trust UI, local-directory and Git imports, signing-key operations, and release publishing.
- Type consistency: scope, record, review, job, and IPC names are defined before consumers; the renderer receives terminal records rather than mutable filesystem paths.
- Review focus: each archive, transport, rollback, disabled-runtime, and cancellation failure mode has a dedicated task and test.
- Proportion: four focused backend modules plus one IPC task; no marketplace UI is included.
