# Plugin Marketplace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a working plugin marketplace with signed catalog discovery, Git/local import, unified review and installation, enable/disable, provenance-bound updates, uninstall, and a responsive Warm Cairn desktop UI.

**Architecture:** Normalize catalog, Git, and local imports into one staged-package interface, then reuse the existing capability scan, fingerprint, review, disabled publication, registry, and rollback path. Split the renderer into a plugin state cluster, pure derived projections, and a dedicated plugin workspace instead of growing `AppPage.tsx`.

**Tech Stack:** Node 22 APIs, TypeScript, Electron IPC, React 18, lucide-react, Vitest SSR/static tests, Playwright/Electron smoke scripts.

**Spec:** `docs/superpowers/specs/2026-10-29-plugin-marketplace-design.md`

**Execution:** Native execution in the shared checkout. Preserve unrelated dirty work; do not reset, stash, clean, commit, push, or merge.

## Global Constraints

- Protocol bump is required for every `AgentApi` shape change. Current baseline is v28; this plan ends at v29.
- Renderer never supplies package URL, archive digest, target root, disabled root, or authoritative manifest name.
- Catalog remains the only signed source. Git URLs must be public HTTPS; local paths must come from the native picker.
- Git clone is non-interactive, depth 1, no submodules, no hooks, no credential helper, no LFS smudge, and no checkout execution.
- Git/local staging rejects symlinks, `.git` content, JavaScript entries, more than 5,000 files, files over 8 MiB, or more than 128 MiB total.
- All sources converge on one capability scan, one full fingerprint check, one review, one disabled-first publication, and one rollback path.
- Install/update/disable/enable/uninstall affects the next run and fails closed while any agent run is active.
- Same manifest name is unique across user scope plus the target workspace. Cross-source replacement is forbidden.
- Catalog versions are semver. Git/local versions may be `null`; no synthetic version is displayed.
- UI tabs are `发现 / 已安装 / 更新`; context filters are discover, installed, updates, favorites, and capability categories.
- UI uses existing tokens, system sans, lucide icons, 8px-or-less radii, no nested cards, no fabricated ratings/downloads, and no marketing hero.
- Real-window widths 1440, 1120, and 880 must remain usable. Detail is a drawer above the wide breakpoint and a full-height sheet at 880.
- One consolidated detector run is allowed after UI edits; do not run it repeatedly.

## File Structure

| File | Responsibility |
| --- | --- |
| `src/main/plugin-source.ts` | Shared source/provenance types, import requests, staged-package contract, source labels and validation helpers |
| `src/main/plugin-local-stage.ts` | Picker-authorized local directory copy, symlink/size limits, deterministic directory SHA-256 |
| `src/main/plugin-git-stage.ts` | Public HTTPS Git validation, hardened clone/checkout, commit resolution, metadata cleanup |
| `src/main/plugin-install-registry.ts` | Registry v2 source/version persistence and v1 migration |
| `src/main/plugin-install-jobs.ts` | Unified source resolver, review, disabled publication, replacement rollback |
| `src/main/plugin-update-check.ts` | Catalog/Git/local source-bound update checks |
| `src/main/plugin-install-operations.ts` | Enable/disable, installed config, transactional uninstall |
| `src/agent/plugins/secrets.ts` | SafeStorage secret deletion needed by uninstall |
| `src/main/ipc-protocol.ts` | v29 public types and API methods |
| `apps/desktop/src/main/index.ts` | Source staging, update, config, picker, and IPC adaptation |
| `apps/desktop/src/renderer/derived/plugins.ts` | Pure merge/search/filter/shelf/update/favorite projections |
| `apps/desktop/src/renderer/state/plugins-marketplace.ts` | Catalog, registry, runtime, jobs, review, update and favorite state |
| `apps/desktop/src/renderer/components/plugins/*` | Pure discover/installed/updates/detail/review/import UI |
| `apps/desktop/src/renderer/components/plugins/plugins.css` | Responsive plugin destination styling |
| `apps/desktop/src/renderer/components/PageFrame.tsx` | Optional real page actions without secondary descriptions |
| `apps/desktop/src/renderer/components/AppPage.tsx` | Replace `PluginsPane` body with the new workspace/container |
| `apps/desktop/src/renderer/navigation.ts` | Plugin context filters and true-count badge contract |
| `apps/desktop/src/renderer/panes/WorkbenchSidebar.tsx` | Forward real plugin counts to `AppRail` |
| `apps/desktop/src/renderer/panes/WorkbenchView.tsx` | Pass current workspace into durable pages |

## Review Focus

- A Git repository uses an SSH URL, credentials, private IP, redirect, hooks, submodules, symlink, or oversized tree; nothing executes and no staged bytes publish.
- A Git/local package attempts to install over a catalog plugin with the same name, or an update attempts a different source; the operation fails with the old installation intact.
- The user changes project or closes the page while a review is open; the review cannot silently retarget to another workspace.
- Catalog cache corruption, network failure, registry failure, and an actually empty catalog are conflated into one empty state; the UI must keep them distinct.
- Uninstall removes the package but fails to clean trust/config/secrets, or vice versa; the user-visible registry and package state must remain coherent.

---

### Task 1: Source Provenance And Registry V2

**Files:**
- Create: `src/main/plugin-source.ts`
- Modify: `src/main/plugin-install-registry.ts`
- Test: `tests/plugin-install-registry.test.ts`
- Test: `tests/plugin-source.test.ts`

**Interfaces:**
- Consumes: `MarketplaceCapabilities` from `src/agent/plugins/marketplace.ts`.
- Produces:
  - `type PluginInstallScope = "user" | "project"`
  - `type PluginSource = CatalogPluginSource | GitPluginSource | LocalPluginSource`
  - `interface CatalogPluginSource { kind: "catalog"; catalogId: string; entryId: string; sourceUrl: string; revision: string }`
  - `interface GitPluginSource { kind: "git"; repositoryUrl: string; ref: string; commit: string }`
  - `interface LocalPluginSource { kind: "local"; sourcePath: string }`
  - `type PluginImportRequest = { kind: "catalog"; entryId: string } | { kind: "git"; repositoryUrl: string; ref?: string } | { kind: "local"; sourcePath: string }`
  - `interface InstalledPluginRecord { entryId; manifestName; version: string | null; sha256; fingerprint; source: PluginSource; scope; workspace; enabled; installedAt; updatedAt }`

- [ ] **Step 1: Write failing provenance and migration tests**

Add tests that create a v1 registry file and read it through v2, then persist and re-read all three sources:

```ts
it("migrates a v1 record to catalog provenance and preserves null-capable versions", async () => {
  writeLegacyRegistry({ version: "1.2.3" });
  const [record] = await registry.list();
  expect(record?.source).toEqual({
    kind: "catalog", catalogId: "cairn", entryId: "demo-plugin",
    sourceUrl: "", revision: "",
  });
});

it("round-trips git and local source identities", async () => {
  await registry.upsert(record({ version: null, source: gitSource() }));
  expect((await registry.list())[0]?.source).toEqual(gitSource());
  await registry.upsert(record({ source: localSource() }));
  expect((await registry.list())[0]?.source).toEqual(localSource());
});
```

Also assert malformed source objects, credentials in Git URLs, relative local paths, and duplicate keys fail closed.

- [ ] **Step 2: Run focused tests to verify failure**

Run: `pnpm exec vitest run --config tests/vitest.config.ts tests/plugin-source.test.ts tests/plugin-install-registry.test.ts`

Expected: FAIL because source types and v2 registry behavior do not exist.

- [ ] **Step 3: Implement source validation and registry migration**

Write `plugin-source.ts` with runtime validators for each discriminated source. Git source URLs use `https:`, no credentials, no custom port, no IP literal. Local source paths must be absolute. Registry reads both schema `1` and `2`; v1 records map to `{ kind: "catalog", catalogId: "cairn", entryId, sourceUrl: "", revision: "" }`. New writes use schema `2`. Keep atomic `0600` persistence and visible malformed-state errors.

- [ ] **Step 4: Run focused tests to verify pass**

Run: `pnpm exec vitest run --config tests/vitest.config.ts tests/plugin-source.test.ts tests/plugin-install-registry.test.ts`

Expected: PASS.

- [ ] **Step 5: Check scoped diff**

Run: `git diff --check -- src/main/plugin-source.ts src/main/plugin-install-registry.ts tests/plugin-source.test.ts tests/plugin-install-registry.test.ts`

Expected: exit 0.

---

### Task 2: Hardened Git And Local Staging

**Files:**
- Create: `src/main/plugin-local-stage.ts`
- Create: `src/main/plugin-git-stage.ts`
- Modify: `src/main/plugin-source.ts`
- Test: `tests/plugin-local-stage.test.ts`
- Test: `tests/plugin-git-stage.test.ts`

**Interfaces:**
- Consumes: `PluginImportRequest`, `PluginSource`, existing `isPublicPluginAddress`.
- Produces:
  - `interface StagedPluginSource { root: string; source: PluginSource; packageSha256: string }`
  - `stageLocalPlugin(input: { sourcePath: string; destination: string }): Promise<StagedPluginSource>`
  - `stageGitPlugin(input: { repositoryUrl: string; ref?: string; destination: string; signal?: AbortSignal; runGit?: GitRunner }): Promise<StagedPluginSource>`
  - `pluginDirectorySha256(root: string): Promise<string>`
  - `authorizeLocalPluginSource(path: string): void`
  - `isAuthorizedLocalPluginSource(path: string): boolean`

- [ ] **Step 1: Write failing local staging tests**

Assert normal copy, no symlink follow, no `.git`, bounded files/bytes, manifest presence, source/destination overlap rejection, and deterministic digest:

```ts
it("copies a real directory without links or git metadata", async () => {
  const staged = await stageLocalPlugin({ sourcePath: source, destination });
  expect(existsSync(join(staged.root, ".claude-plugin", "plugin.json"))).toBe(true);
  expect(existsSync(join(staged.root, ".git"))).toBe(false);
  expect(staged.packageSha256).toMatch(/^[a-f0-9]{64}$/);
});

it("rejects symlinks, oversized trees, and overlapping paths", async () => {
  await expect(stageLocalPlugin({ sourcePath: symlinked, destination })).rejects.toThrow(/symbolic link/i);
  await expect(stageLocalPlugin({ sourcePath: source, destination: join(source, "nested") })).rejects.toThrow(/overlap/i);
});
```

- [ ] **Step 2: Run local staging test to verify failure**

Run: `pnpm exec vitest run --config tests/vitest.config.ts tests/plugin-local-stage.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement picker authorization and safe local copy**

Store canonical picker results in a module-level `Set` populated only by the main-process picker handler. Reject unauthorised local inputs at job start. Walk with `lstat`, reject every symlink/special file, skip `.git`, enforce 5,000 files / 8 MiB per file / 128 MiB total, require `.claude-plugin/plugin.json`, copy with `COPYFILE_EXCL`, and compute a sorted full SHA-256 over relative POSIX paths and file SHA-256 values.

- [ ] **Step 4: Write failing Git staging tests**

Inject a fake `GitRunner` and assert exact safe arguments/environment, commit capture, `.git` removal, unauthorised protocol rejection, and no shell invocation:

```ts
it("clones one commit without hooks, submodules, or prompts", async () => {
  const runGit = vi.fn(async (args: string[], env: NodeJS.ProcessEnv) => {
    expect(args).toContain("--depth=1");
    expect(env.GIT_TERMINAL_PROMPT).toBe("0");
    return "0123456789abcdef0123456789abcdef01234567";
  });
  const staged = await stageGitPlugin({ repositoryUrl: "https://github.com/acme/demo", destination, runGit });
  expect(staged.source).toMatchObject({ kind: "git", ref: "HEAD", commit: "0123456789abcdef0123456789abcdef01234567" });
});

it("rejects SSH, credentials, loopback, submodules, and symlinks", async () => {
  await expect(stageGitPlugin({ repositoryUrl: "git@github.com:acme/demo.git", destination })).rejects.toThrow(/https/i);
  await expect(stageGitPlugin({ repositoryUrl: "https://localhost/demo", destination })).rejects.toThrow(/public/i);
});
```

- [ ] **Step 5: Run Git staging test to verify failure**

Run: `pnpm exec vitest run --config tests/vitest.config.ts tests/plugin-git-stage.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 6: Implement non-interactive hardened clone**

Use `spawn` with argument arrays, never a shell. Set `GIT_CONFIG_NOSYSTEM=1`, `GIT_CONFIG_GLOBAL=/dev/null`, `GIT_TERMINAL_PROMPT=0`, `GIT_LFS_SKIP_SMUDGE=1`, and `GCM_INTERACTIVE=never`. Clone with `--depth=1 --single-branch --no-tags --recurse-submodules=no`, explicit `-c protocol.file.allow=never`, `-c core.hooksPath=/dev/null`, `-c core.symlinks=false`, and disabled credential helper. Resolve HEAD with `rev-parse HEAD`, reject `.gitmodules`, validate the tree with the same local-copy limits, remove `.git`, and return provenance `{kind:"git", repositoryUrl, ref: requestedRef ?? "HEAD", commit}`.

- [ ] **Step 7: Run both staging tests**

Run: `pnpm exec vitest run --config tests/vitest.config.ts tests/plugin-local-stage.test.ts tests/plugin-git-stage.test.ts`

Expected: PASS.

- [ ] **Step 8: Check scoped diff**

Run: `git diff --check -- src/main/plugin-source.ts src/main/plugin-local-stage.ts src/main/plugin-git-stage.ts tests/plugin-local-stage.test.ts tests/plugin-git-stage.test.ts`

Expected: exit 0.

---

### Task 3: Unified Install Jobs And Source-Bound Updates

**Files:**
- Create: `src/main/plugin-update-check.ts`
- Modify: `src/main/plugin-install-jobs.ts`
- Modify: `src/main/plugin-source.ts`
- Test: `tests/plugin-install-jobs.test.ts`
- Test: `tests/plugin-update-check.test.ts`

**Interfaces:**
- Consumes: `PluginImportRequest`, `StagedPluginSource`, `MarketplaceEntry`, `InstalledPluginRegistryPort`.
- Produces:
  - `type PluginInstallJobState = "queued" | "resolving" | "verifying" | "review" | "installing" | "succeeded" | "failed" | "cancelled"`
  - `interface PluginInstallJob { id; state; entryId: string | null; sourceKind: PluginSource["kind"]; scope; workspace; review?; error?; createdAt; updatedAt }`
  - `interface PluginInstallReview { jobId; entryId; manifestName; version: string | null; source: PluginSource; scope; workspace; targetRoot; fingerprint; packageSha256; capabilities; permissions: readonly string[] | null; userConfigFields; warnings }`
  - `interface PluginSourceResolver { resolve(request: PluginImportRequest, context: { stageDir: string; signal: AbortSignal }): Promise<StagedPluginSource & { expected?: { name; version; capabilities; permissions; minAppVersion } }> }`
  - `type PluginUpdateStatus = "current" | "available" | "checking" | "failed" | "unavailable"`
  - `interface PluginUpdateCheck { status; currentVersion: string | null; nextVersion: string | null; sourceKind; detail?: string }`
  - `checkPluginUpdate(record, deps): Promise<PluginUpdateCheck>`

- [ ] **Step 1: Write failing unified-job tests**

Adapt existing catalog tests and add Git/local fixtures:

```ts
it.each(["catalog", "git", "local"] as const)("stages %s through one review path", async (kind) => {
  const job = await jobs.start(requestFor(kind), "user", null);
  const reviewed = await jobs.wait(job.id);
  expect(reviewed.state).toBe("review");
  expect(reviewed.review).toMatchObject({ entryId: "demo-plugin", version: null, source: { kind } });
  expect(reviewed.review?.packageSha256).toMatch(/^[a-f0-9]{64}$/);
});

it("rejects duplicate visible names and cross-source replacement", async () => {
  await seedRecord({ manifestName: "demo-plugin", source: localSource() });
  await expect(jobs.start(gitRequest(), "user", null)).rejects.toThrow(/already installed|source/i);
});
```

Assert catalog capabilities still match the signed entry; Git/local permissions are `null`; cancellation removes staging; failed replacement restores the old active package.

- [ ] **Step 2: Run unified-job tests to verify failure**

Run: `pnpm exec vitest run --config tests/vitest.config.ts tests/plugin-install-jobs.test.ts`

Expected: FAIL because jobs still accept only `MarketplaceEntry` and states are archive-specific.

- [ ] **Step 3: Refactor jobs to one staged source resolver**

Create private staging under the existing job directory. Resolve first, then perform common JS-entry rejection, manifest parsing, capability scan, full fingerprint, and review. Catalog checks expected name/version/capabilities/min app version; Git/local do not trust manifest permission hints. `entryId` remains null until review. Commit rechecks registry identity/source conflicts and writes v2 provenance plus `packageSha256`. Preserve all existing atomic publication/rollback behavior.

- [ ] **Step 4: Write failing update-check tests**

```ts
it("compares catalog semver and preserves real null versions", async () => {
  expect((await checkPluginUpdate(catalogRecord("1.2.3"), { catalogEntry: entry("1.3.0") })).status).toBe("available");
  expect((await checkPluginUpdate(gitRecord("a".repeat(40)), { gitHead: "b".repeat(40) })).status).toBe("available");
  expect((await checkPluginUpdate(localRecord("local"), { localDigest: "local" })).status).toBe("current");
});

it("rejects source mismatch and reports check failure separately from no update", async () => {
  expect((await checkPluginUpdate(gitRecord("a".repeat(40)), { gitHead: "b".repeat(40), requestKind: "catalog" })).status).toBe("unavailable");
  expect((await checkPluginUpdate(gitRecord("a".repeat(40)), { gitError: "offline" })).status).toBe("failed");
});
```

- [ ] **Step 5: Run update-check tests to verify failure**

Run: `pnpm exec vitest run --config tests/vitest.config.ts tests/plugin-update-check.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 6: Implement source-bound update checks**

Catalog compares semver from the verified catalog. Git uses hardened `git ls-remote` against the stored URL/ref. Local recomputes `pluginDirectorySha256` from the stored canonical path. Different source kinds return unavailable. Missing directory, network failure, invalid remote response, and unchanged source remain distinct.

- [ ] **Step 7: Run unified jobs and update-check tests**

Run: `pnpm exec vitest run --config tests/vitest.config.ts tests/plugin-install-jobs.test.ts tests/plugin-update-check.test.ts`

Expected: PASS.

- [ ] **Step 8: Check scoped diff**

Run: `git diff --check -- src/main/plugin-install-jobs.ts src/main/plugin-source.ts src/main/plugin-update-check.ts tests/plugin-install-jobs.test.ts tests/plugin-update-check.test.ts`

Expected: exit 0.

---

### Task 4: Installed Config And Transactional Uninstall Cleanup

**Files:**
- Modify: `src/main/plugin-install-operations.ts`
- Modify: `src/agent/plugins/secrets.ts`
- Test: `tests/plugin-install-operations.test.ts`
- Create: `tests/plugin-secrets.test.ts`

**Interfaces:**
- Consumes: `parsePluginManifest`, `userConfigValuesErrors`, `writePluginUserConfig`, `pluginUserConfigDir`, `PluginSecretBackend`.
- Produces:
  - `configureInstalledPlugin(input: { pluginDataRoot; registry; entryId; scope; workspace; values: Record<string,string>; assertIdle? }): Promise<InstalledPluginRecord>`
  - `deletePluginSecrets(plugin: string, keys: readonly string[]): Promise<void>`
  - Uninstall deletes package, trust, registry, `plugin-userconfig.json`, and secret values in one rollback-safe operation.

- [ ] **Step 1: Write failing config tests**

```ts
it("configures a disabled package by reparsing its manifest", async () => {
  await configureInstalledPlugin({ ...base, values: { TOKEN: "secret", REGION: "cn" } });
  const read = await readPluginUserConfig({ dir: pluginUserConfigDir(root, "demo-plugin"), plugin: "demo-plugin", fields });
  expect(read.values).toMatchObject({ TOKEN: "secret", REGION: "cn" });
});

it("rejects unknown fields and required omissions without enabling the package", async () => {
  await expect(configureInstalledPlugin({ ...base, values: { UNKNOWN: "x" } })).rejects.toThrow(/unknown|未知/i);
  expect((await registry.get("demo-plugin", "user", null))?.enabled).toBe(false);
});
```

- [ ] **Step 2: Run config tests to verify failure**

Run: `pnpm exec vitest run --config tests/vitest.config.ts tests/plugin-install-operations.test.ts`

Expected: FAIL because `configureInstalledPlugin` is missing.

- [ ] **Step 3: Implement installed config**

Load the registry record, resolve its active/disabled package path, parse the on-disk manifest, take allowed fields from that manifest, validate values with existing helpers, then write to `pluginUserConfigDir(pluginDataRoot, manifestName)`. Do not accept renderer-provided field metadata. Use `assertIdle` before writing.

- [ ] **Step 4: Write failing uninstall cleanup tests**

Assert config and secrets are removed, package/trust/registry are restored when secret deletion fails, and disabling still preserves both:

```ts
it("removes package, trust, config, and secrets on uninstall", async () => {
  await uninstallPlugin({ ...base, trust });
  expect(existsSync(packagePath)).toBe(false);
  expect(existsSync(configDir)).toBe(false);
  expect(await getPluginSecret("demo-plugin", "TOKEN")).toBeNull();
});

it("restores every surface when secret deletion fails", async () => {
  await expect(uninstallPlugin({ ...base, trust, deleteSecrets: failingDelete })).rejects.toThrow(/secret/i);
  expect(existsSync(packagePath)).toBe(true);
  expect(await registry.get("demo-plugin", "user", null)).toEqual(originalRecord);
  expect(existsSync(configDir)).toBe(true);
});
```

- [ ] **Step 5: Implement secret deletion and rollback-safe cleanup**

Extend the secret backend with `delete(key)`. Rename the config directory into a local tombstone before mutating trust/registry. On any failure, restore config, package, trust and registry. Delete secret keys only after all other state can still be rolled back; if secret deletion fails, restore the prior surfaces. Keep disable as a package move only and preserve config/secrets.

- [ ] **Step 6: Run operations and secret tests**

Run: `pnpm exec vitest run --config tests/vitest.config.ts tests/plugin-install-operations.test.ts tests/plugin-secrets.test.ts`

Expected: PASS.

- [ ] **Step 7: Check scoped diff**

Run: `git diff --check -- src/main/plugin-install-operations.ts src/agent/plugins/secrets.ts tests/plugin-install-operations.test.ts tests/plugin-secrets.test.ts`

Expected: exit 0.

---

### Task 5: Protocol V29, Main Wiring, And Local Picker

**Files:**
- Modify: `src/main/ipc-protocol.ts`
- Modify: `apps/desktop/src/main/channels.ts`
- Modify: `apps/desktop/src/main/index.ts`
- Modify: `apps/desktop/tests/channels.test.ts`
- Modify: `apps/desktop/tests/protocol-version.test.ts`
- Modify: `apps/desktop/tests/invoke-consumer-census.test.ts`
- Modify: `tests/ipc-protocol-version.test.ts`
- Test: `apps/desktop/tests/marketplace-import-wiring.test.ts`

**Interfaces:**
- Consumes: source staging, unified jobs, update checks, installed config, current trusted workspace resolver.
- Produces:
  - `IPC_PROTOCOL_VERSION = 29`
  - `pluginPickLocalSource(): Promise<string | null>`
  - `marketplacePluginImport(request: PluginImportRequest, scope: PluginInstallScope, workspace?: string): Promise<PluginInstallJob>`
  - `marketplacePluginUpdate(entryId: string, scope: PluginInstallScope, workspace?: string): Promise<PluginInstallJob>`
  - `marketplacePluginCheckUpdate(entryId: string, scope: PluginInstallScope, workspace?: string): Promise<PluginUpdateCheck>`
  - `pluginConfigureInstalled(request: { entryId; scope; workspace?; values: Record<string,string> }): Promise<{ok:boolean;error?:string}>`
  - `INVOKE_CHANNELS` entries for all four new methods.

- [ ] **Step 1: Write failing protocol/wiring tests**

```ts
it("exposes import, update, config, and local picker at protocol v29", () => {
  expect(IPC_PROTOCOL_VERSION).toBe(29);
  expect(INVOKE_CHANNELS.marketplacePluginImport).toBe("agent:marketplace-plugin-import");
  expect(INVOKE_CHANNELS.pluginPickLocalSource).toBe("agent:plugin-pick-local-source");
});

it("keeps package URL and install target out of renderer request types", () => {
  const protocol = readProtocol();
  expect(protocol).toContain("marketplacePluginImport(request: PluginImportRequest");
  expect(protocol).not.toMatch(/packageUrl|targetRoot|disabledRoot/);
});
```

Assert every new channel has a real wired handler and the consumer census marks it `PLUGIN-2`.

- [ ] **Step 2: Run focused wiring tests to verify failure**

Run: `pnpm --filter cairn-desktop exec vitest run --config vitest.config.ts tests/marketplace-import-wiring.test.ts tests/channels.test.ts tests/protocol-version.test.ts tests/invoke-consumer-census.test.ts`

Expected: FAIL on version, new methods, channels, and handler entries.

- [ ] **Step 3: Add protocol, channels, picker, and handlers**

Resolve catalog request into a verified entry in main. Reject stale/unavailable catalog before catalog jobs. Git/local requests go directly to the source resolver. `pluginPickLocalSource` uses a native directory dialog, canonicalizes the result, authorizes it for local staging, and returns the path. Update checks and updates resolve the registry record first, then use only its stored provenance. Config resolves the scoped record and delegates to installed config.

- [ ] **Step 4: Run focused wiring tests to verify pass**

Run: `pnpm --filter cairn-desktop exec vitest run --config vitest.config.ts tests/marketplace-import-wiring.test.ts tests/channels.test.ts tests/protocol-version.test.ts tests/invoke-consumer-census.test.ts`

Expected: PASS.

- [ ] **Step 5: Run typecheck for the IPC surface**

Run: `pnpm --filter cairn-desktop typecheck`

Expected: PASS with no channel-map/API drift.

- [ ] **Step 6: Check scoped diff**

Run: `git diff --check -- src/main/ipc-protocol.ts apps/desktop/src/main/channels.ts apps/desktop/src/main/index.ts apps/desktop/tests/marketplace-import-wiring.test.ts apps/desktop/tests/channels.test.ts apps/desktop/tests/protocol-version.test.ts tests/ipc-protocol-version.test.ts`

Expected: exit 0.

---

### Task 6: Pure Plugin Projections And State Cluster

**Files:**
- Create: `apps/desktop/src/renderer/derived/plugins.ts`
- Create: `apps/desktop/src/renderer/state/plugins-marketplace.ts`
- Modify: `apps/desktop/src/renderer/navigation.ts`
- Test: `apps/desktop/tests/plugins-derived.test.ts`
- Test: `apps/desktop/tests/plugins-marketplace-state.test.ts`
- Test: `apps/desktop/tests/navigation.test.ts`

**Interfaces:**
- Consumes: `MarketplaceCatalogReadout`, `InstalledPluginRecord`, `PluginPanelSnapshot`, `PluginInstallJob`, `PluginUpdateCheck`.
- Produces:
  - `type PluginView = "discover" | "installed" | "updates"`
  - `type PluginCapabilityCategory = "skills" | "commands" | "agents" | "hooks" | "mcp" | "lsp"`
  - `interface PluginFavoriteStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }`
  - `interface PluginRowView { id; name; summary; sourceKind; version: string | null; installed: InstalledPluginRecord | null; runtime; capabilities; state: "available" | "installed" | "enabled" | "disabled" | "unmanaged" | "name-conflict"; favorite: boolean }`
  - `mergePluginRows(catalog, installed, runtime, favorites): readonly PluginRowView[]`
  - `pluginUpdateRows(rows, checks): readonly PluginUpdateRow[]`
  - `filterPluginRows(rows, query, category): readonly PluginRowView[]`
  - `pluginCategoryOf(capabilities): PluginCapabilityCategory`
  - `loadPluginFavorites(storage: PluginFavoriteStorage): ReadonlySet<string>` / `savePluginFavorites(storage: PluginFavoriteStorage, ids): void`
  - `interface PluginsMarketplaceSnapshot { catalog; installed; runtime; review; activeJob; updateChecks; favorites; notice; generation }`
  - `type PluginsMarketplaceAction = {type:"catalog";generation;value} | {type:"installed";generation;value} | {type:"runtime";generation;value} | {type:"workspace";workspace} | {type:"review";review;jobId;workspace} | {type:"job";job} | {type:"updateCheck";key;check} | {type:"favorites";ids} | {type:"notice";message}`
  - `createPluginsMarketplaceSnapshot(input): PluginsMarketplaceSnapshot`
  - `pluginsMarketplaceReducer(state, action): PluginsMarketplaceSnapshot`
  - `usePluginsMarketplace(input: { workspace: string | null; onError(message): void }): PluginsMarketplaceState`

- [ ] **Step 1: Write failing projection tests**

```ts
it("merges catalog, registry, and runtime without losing unmanaged or conflict states", () => {
  const rows = mergePluginRows(catalog, installed, runtime, new Set(["demo-plugin"]));
  expect(rows.find((row) => row.id === "demo-plugin")?.state).toBe("enabled");
  expect(rows.find((row) => row.id === "manual-plugin")?.state).toBe("unmanaged");
  expect(rows.find((row) => row.id === "conflict-plugin")?.state).toBe("name-conflict");
});

it("only reports updates with matching provenance and real versions/revisions", () => {
  expect(pluginUpdateRows(rows, checks).map((row) => row.id)).toEqual(["catalog-update"]);
});

it("keeps favorites and category filtering deterministic", () => {
  expect(filterPluginRows(rows, "mcp", "mcp").map((row) => row.id)).toEqual(["mcp-plugin"]);
});
```

- [ ] **Step 2: Run projection tests to verify failure**

Run: `pnpm --filter cairn-desktop exec vitest run --config vitest.config.ts tests/plugins-derived.test.ts tests/navigation.test.ts`

Expected: FAIL because derived/plugin filters do not exist.

- [ ] **Step 3: Implement pure projections and context navigation**

No clock, randomness, IO, or mutable module state. Prefer registry-owned state over runtime state while retaining runtime warnings and MCP summaries. Unmanaged runtime plugins are read-only. Detect duplicate runtime/registry names as name-conflict. Primary category priority is `lsp > mcp > hooks > agents > commands > skills`. Update rows require same source kind and, for catalog/Git/local, the matching source-specific identity. `PAGE_CONTEXT_ITEMS.plugins` becomes `discover`, `installed`, `updates`, `favorites`, plus category entries.

- [ ] **Step 4: Write failing state tests for generation guards and workspace changes**

```ts
it("ignores stale catalog responses and closes an uncommitted review when workspace changes", async () => {
  let state = createPluginsMarketplaceSnapshot({ workspace: "/workspace/a" });
  state = pluginsMarketplaceReducer(state, { type: "catalog", generation: 1, value: liveCatalog("old") });
  state = pluginsMarketplaceReducer(state, { type: "catalog", generation: 2, value: liveCatalog("new") });
  expect(state.catalog.catalog?.revision).toBe("new");
  state = pluginsMarketplaceReducer(state, { type: "review", review: review(), jobId: "job-1", workspace: "/workspace/a" });
  state = pluginsMarketplaceReducer(state, { type: "workspace", workspace: "/workspace/b" });
  expect(state.review).toBeNull();
  expect(state.notice).toMatch(/工作区/);
});
```

Also assert job polling stops after terminal state, failures preserve registry rows, and favorites persist through a storage stub.

- [ ] **Step 5: Implement the state cluster**

Load catalog and installed records independently so one failure does not erase the other. Merge runtime from `getState()` when available. Poll active jobs with request generations. Scope review to `{kind, workspace, instanceId}` captured at start. Cancel/close review on workspace changes. Keep search/filter/scroll selection in state. Expose typed actions for install, import, update-check, update, enable, disable, uninstall, configure, refresh, favorite, and review commit/cancel.

- [ ] **Step 6: Run derived/state/navigation tests**

Run: `pnpm --filter cairn-desktop exec vitest run --config vitest.config.ts tests/plugins-derived.test.ts tests/plugins-marketplace-state.test.ts tests/navigation.test.ts`

Expected: PASS.

- [ ] **Step 7: Run renderer layering check**

Run: `pnpm renderer-layer-check`

Expected: PASS; derived code has no IO and state code does not import components.

---

### Task 7: Plugin Workspace UI And Responsive Composition

**Files:**
- Create: `apps/desktop/src/renderer/components/plugins/PluginsWorkspace.tsx`
- Create: `apps/desktop/src/renderer/components/plugins/PluginDiscover.tsx`
- Create: `apps/desktop/src/renderer/components/plugins/PluginInstalled.tsx`
- Create: `apps/desktop/src/renderer/components/plugins/PluginUpdates.tsx`
- Create: `apps/desktop/src/renderer/components/plugins/PluginDetail.tsx`
- Create: `apps/desktop/src/renderer/components/plugins/PluginReview.tsx`
- Create: `apps/desktop/src/renderer/components/plugins/PluginImportMenu.tsx`
- Create: `apps/desktop/src/renderer/components/plugins/plugins.css`
- Modify: `apps/desktop/src/renderer/components/PageFrame.tsx`
- Modify: `apps/desktop/src/renderer/components/AppPage.tsx`
- Modify: `apps/desktop/src/renderer/panes/WorkbenchView.tsx`
- Modify: `apps/desktop/src/renderer/panes/WorkbenchSidebar.tsx`
- Test: `apps/desktop/tests/plugins-workspace.test.tsx`
- Test: `apps/desktop/tests/plugin-review.test.tsx`
- Test: `apps/desktop/tests/page-frame.test.tsx`

**Interfaces:**
- Consumes: `PluginsMarketplaceState`, pure row/update projections, active workspace.
- Produces:
  - `PluginsWorkspace(props: { state; className? }): JSX.Element` pure view.
  - `PluginsDestination(props: { workspace: string | null; onError }): JSX.Element` stateful container.
  - `PageFrameProps.actions?: React.ReactNode`.
  - `AppPageBody` plugin branch renders `PluginsDestination` and other pages remain unchanged.

- [ ] **Step 1: Write failing SSR UI tests**

```tsx
it("renders the three real marketplace views without marketing chrome", () => {
  const html = renderToStaticMarkup(<PluginsWorkspace state={readyState()} />);
  expect(html).toContain("发现");
  expect(html).toContain("已安装");
  expect(html).toContain("更新");
  expect(html).not.toMatch(/下载量|评分|热门/);
});

it("keeps cache, corrupt, empty, and registry error states distinct", () => {
  expect(renderWith(catalog("cache", true))).toContain("离线缓存");
  expect(renderWith(catalogUnavailable("缓存损坏"))).toContain("缓存损坏");
  expect(renderWith(emptyCatalog())).toContain("目录为空");
  expect(renderWith(registryError())).toContain("已安装列表读取失败");
});
```

- [ ] **Step 2: Write failing review and source UI tests**

```tsx
it("shows source, scope, digest, capabilities, permissions, config, and warnings", () => {
  const html = renderToStaticMarkup(<PluginReview state={reviewState({ sourceKind: "git" })} />);
  for (const text of ["Git", "全局", "SHA-256", "hooks", "未提供签名权限清单", "配置", "风险"]) {
    expect(html).toContain(text);
  }
});

it("offers one import command with Git and local choices", () => {
  expect(renderToStaticMarkup(<PluginImportMenu open />)).toContain("Git 仓库");
  expect(renderToStaticMarkup(<PluginImportMenu open />)).toContain("本地目录");
});
```

- [ ] **Step 3: Run SSR tests to verify failure**

Run: `pnpm --filter cairn-desktop exec vitest run --config vitest.config.ts tests/plugins-workspace.test.tsx tests/plugin-review.test.tsx tests/page-frame.test.tsx`

Expected: FAIL because the plugin components and PageFrame actions do not exist.

- [ ] **Step 4: Build the pure plugin components**

Use a compact page header, text tabs with one active underline/background, a single real import command, search/category controls, editorial shelves on Discover, operational rows on Installed and Updates, wide detail drawer, narrow full-height sheet, and explicit loading/offline/corrupt/error states. No descriptive subtitle under the page title. Use lucide icons for refresh, import, enable/disable, update, uninstall, favorite, close, and retry, with accessible names and tooltips.

- [ ] **Step 5: Build the stateful destination and wire workspace**

Pass `activeWorkspace` from `WorkbenchView` into every `AppPageBody`. The plugin container loads catalog, registry, and runtime independently, polls jobs, and forwards page-level errors. Replace the old `PluginsPane` implementation in `AppPageBody`; keep `PluginsPane` as a compatibility export only if another current import path still needs it. Forward real update counts to `AppRail`; do not show a badge for zero.

- [ ] **Step 6: Implement responsive CSS**

Use only existing tokens. At wide widths use a 200px context sidebar and drawer; hide the context sidebar at 1119px; use a full-height detail sheet at the real 880px window. Ensure the header, search, import, refresh, tabs, row actions, and long Chinese names cannot overlap. Do not nest cards. Maintain visible focus and reduced motion behavior.

- [ ] **Step 7: Run SSR and layer tests**

Run: `pnpm --filter cairn-desktop exec vitest run --config vitest.config.ts tests/plugins-workspace.test.tsx tests/plugin-review.test.tsx tests/page-frame.test.tsx tests/destination-workspace.test.tsx`

Run: `pnpm renderer-layer-check`

Expected: PASS.

---

### Task 8: End-To-End Fixtures, Electron Evidence, And Final Gates

**Files:**
- Create: `apps/desktop/scripts/plugin-marketplace-smoke.cjs`
- Create: `apps/desktop/tests/plugin-marketplace-wiring.test.ts`
- Test: existing desktop suite and root gates.

**Interfaces:**
- Consumes: all prior tasks.
- Produces: reproducible working-tree evidence for live/cache/offline/error states, three install sources, review, enable/disable, update comparison, uninstall, responsive screenshots, and keyboard focus.

- [ ] **Step 1: Add a deterministic marketplace fixture and smoke harness**

Use a temporary CAIRN user-data directory, signed fixture catalog, fixture plugin package, Git repository, and local plugin. The harness must call the real preload/API surface, not React internals. Capture 1440, 1120, and 880 screenshots in light and dark themes, plus review, offline cache, corrupt cache, installed, and updates states.

- [ ] **Step 2: Write failing integration assertions**

Assert the rendered UI:

```js
assert.equal(await text("[data-marketplace-view='discover']"), "发现");
assert.match(await text("[data-plugin-state='review']"), /Git/);
assert.match(await text("[data-catalog-state='stale']"), /离线缓存/);
assert.equal(await count("[data-plugin-row='installed']"), 3);
assert.equal(await count(".plugin-row-action-overlap"), 0);
```

Also assert favorite toggling survives a reload, Esc returns focus to the originating card/row, and all actions have accessible names.

- [ ] **Step 3: Run focused desktop suite**

Run: `pnpm --filter cairn-desktop test`

Expected: PASS with actual test counts reported.

- [ ] **Step 4: Run type, boundary, build, and docs checks**

Run: `node --import tsx scripts/typecheck.ts`

Run: `pnpm desktop-boundary-check`

Run: `pnpm --filter cairn-desktop build`

Run: `pnpm docs-check`

Expected: all exit 0 with meaningful assertions.

- [ ] **Step 5: Run Electron marketplace smoke**

Run: `pnpm --filter cairn-desktop exec electron scripts/plugin-marketplace-smoke.cjs`

Expected: smoke exits 0 and writes screenshot/evidence paths under `apps/desktop/outputs/plugin-marketplace-2026-10-29/`.

- [ ] **Step 6: Inspect screenshots in one batched pass**

Review 1440/1120/880 and light/dark screenshots together. Fix material overlap, hierarchy, state distinction, or accessibility issues in one batch, rerun the smoke once, and stop polishing.

- [ ] **Step 7: Run the Impeccable detector once on changed UI targets**

Run:

```bash
node /Users/ze/.codex/skills/impeccable/scripts/detect.mjs --json \
  apps/desktop/src/renderer/components/plugins \
  apps/desktop/src/renderer/components/AppPage.tsx \
  apps/desktop/src/renderer/components/PageFrame.tsx \
  apps/desktop/src/renderer/navigation.ts
```

Expected: no unresolved mechanical findings. Record any remaining reviewed findings.

- [ ] **Step 8: Run final scoped diff and report**

Run: `git diff --check -- <all files touched by this plan>`

Report test counts, protocol version, screenshots, state coverage, and any unverified real-network/production-key boundaries. Do not claim release readiness.

---

## Self-Review

- Spec coverage: discovery, signed/cached/offline states, Git/local import, review, install, enable/disable, update, uninstall, provenance, same-name conflict, config, details, responsive layout, accessibility, runtime next-run semantics, and verification all map to Tasks 1–8.
- Type consistency: `PluginSource`, `PluginImportRequest`, `PluginInstallJob`, `PluginUpdateCheck`, `PluginsMarketplaceState`, and source-specific staging signatures are introduced once and consumed consistently.
- Review focus coverage: unsafe Git/local input is pinned in Task 2; source mismatch/name conflicts in Tasks 1 and 3; stale review retargeting in Task 6; state conflation in Task 7; rollback coherence in Task 4; responsive overlap and focus in Task 8.
- Scope: memory, automation, skills, settings, unrelated orchestration, and other pages remain outside this plan.
