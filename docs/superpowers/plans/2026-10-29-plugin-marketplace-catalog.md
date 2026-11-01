# Plugin Marketplace Catalog Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fail-closed, signed plugin marketplace catalog foundation with strict schema validation, durable verified caching, and a read-only desktop IPC readout, without exposing install actions yet.

**Architecture:** `src/agent/plugins/marketplace.ts` owns pure catalog/schema/signature logic. `src/main/plugin-marketplace-store.ts` owns network, verified cache, atomic writes, and live/cache/stale readouts. The desktop main process exposes one read-only IPC method, so PLUGIN-2 can later render real data without inventing a second catalog path.

**Tech Stack:** Node `crypto`, built-in `fetch`, Zod-free manual validation, TypeScript, Vitest, Electron IPC.

**Spec:** `docs/superpowers/specs/2026-10-29-agent-os-desktop-design.md`

## Global Constraints

- Preserve the shared dirty checkout: no reset, stash, clean, commit, push, or unrelated-file rewrite.
- No marketplace install/update/uninstall action appears in UI-0 or this foundation.
- The client accepts only signed catalog envelopes; malformed, unknown-key, oversized, expired-but-valid, and unsigned payloads remain distinct states.
- A catalog response never follows redirects, never accepts a non-HTTPS source/package URL, and has a hard response-size ceiling.
- Package URLs must use a host explicitly signed in the catalog's `packageHosts`.
- A verified cache remains usable when expired, but the readout must identify it as stale; no verified cache means `unavailable`, never an empty market.
- Do not execute package scripts, install code, or download packages in this plan.
- Keep renderer code free of runtime imports from `src/`; add only type imports where needed.

## File Structure

| File | Responsibility |
| --- | --- |
| `src/agent/plugins/marketplace.ts` | Catalog/envelope types, strict payload parsing, signed-envelope verification, URL and entry invariants |
| `src/main/plugin-marketplace-store.ts` | Source config, HTTPS fetch, verified cache, stale fallback, readout shaping |
| `src/main/ipc-protocol.ts` | Shared readout types and one `marketplaceCatalog` API method |
| `apps/desktop/src/main/channels.ts` | `agent:marketplace-catalog` channel mapping |
| `apps/desktop/src/main/index.ts` | One wired read-only handler using desktop user-data cache |
| `tests/plugin-marketplace.test.ts` | Pure catalog/signature edge cases |
| `tests/plugin-marketplace-store.test.ts` | Cache/network/freshness/failure behavior |
| `apps/desktop/tests/marketplace-wiring.test.ts` | Protocol, channel, API, and main wiring |

## Review Focus

- A signed but expired envelope must remain inspectable as stale cache, while an unsigned or tampered envelope must never be surfaced.
- Package host allowlisting must not be bypassable through credentials, ports, case tricks, IP literals, or redirects.
- Refresh failures must preserve the last verified cache and name the failure instead of replacing it with an empty catalog.
- Cache corruption must be reported and must not poison the next successful refresh.
- Catalog payload limits must bound entries, shelves, strings, and package size before rendering.

---

### Task 1: Strict Catalog Payload

**Files:**
- Create: `src/agent/plugins/marketplace.ts`
- Test: `tests/plugin-marketplace.test.ts`

**Interfaces:**
- Consumes: none.
- Produces:
  - `type MarketplaceCatalog = { schemaVersion: 1; revision: string; generatedAt: string; expiresAt: string; packageHosts: readonly string[]; entries: readonly MarketplaceEntry[]; shelves: readonly MarketplaceShelf[] }`
  - `interface MarketplaceEntry { id; name; summary; author; sourceUrl; license; version; publishedAt; packageUrl; sha256; sizeBytes; capabilities; permissions; minAppVersion }`
  - `interface MarketplaceShelf { id: string; title: string; entryIds: readonly string[] }`
  - `function parseMarketplaceCatalog(raw: unknown): MarketplaceCatalog`
  - `MAX_MARKETPLACE_ENTRIES = 250`
  - `MAX_MARKETPLACE_PACKAGE_BYTES = 64 * 1024 * 1024`

- [ ] **Step 1: Write the failing payload tests**

```ts
it("accepts a bounded signed-catalog payload shape", () => {
  const catalog = parseMarketplaceCatalog(validPayload());
  expect(catalog.entries[0]?.id).toBe("demo-plugin");
  expect(catalog.packageHosts).toEqual(["plugins.example.com"]);
});

it("rejects duplicate ids, unknown shelf entries, foreign package hosts, and oversized packages", () => {
  expect(() => parseMarketplaceCatalog(validPayload({ entries: [entry(), entry()] }))).toThrow(/duplicate/i);
  expect(() => parseMarketplaceCatalog(validPayload({ shelves: [{ id: "new", title: "新上架", entryIds: ["missing"] }] }))).toThrow(/unknown/i);
  expect(() => parseMarketplaceCatalog(validPayload({ entries: [entry({ packageUrl: "https://evil.example.com/p.tgz" })] }))).toThrow(/host/i);
  expect(() => parseMarketplaceCatalog(validPayload({ entries: [entry({ sizeBytes: MAX_MARKETPLACE_PACKAGE_BYTES + 1 })] }))).toThrow(/size/i);
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `pnpm exec vitest run --config tests/vitest.config.ts tests/plugin-marketplace.test.ts`
Expected: FAIL because `marketplace.ts` does not exist.

- [ ] **Step 3: Implement strict payload parsing**

Reject non-object input, unsupported schema versions, invalid dates, non-HTTPS source/package URLs, duplicate entry/shelf ids, unknown shelf entry ids, SHA-256 values outside 64 lowercase hex characters, negative capability counts, package sizes over the cap, credentials in URLs, and package hosts not explicitly listed. Cap entries at 250, shelves at 32, shelf entry references at 100, and all display/source strings at practical bounded lengths. Return fresh readonly arrays/objects; never retain input references.

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `pnpm exec vitest run --config tests/vitest.config.ts tests/plugin-marketplace.test.ts`
Expected: PASS.

- [ ] **Step 5: Check the scoped diff**

Run: `git diff --check -- src/agent/plugins/marketplace.ts tests/plugin-marketplace.test.ts`
Expected: exit 0.

---

### Task 2: Signed Envelope And Key Ring

**Files:**
- Modify: `src/agent/plugins/marketplace.ts`
- Test: `tests/plugin-marketplace.test.ts`

**Interfaces:**
- Consumes: `parseMarketplaceCatalog`.
- Produces:
  - `interface MarketplacePublicKey { id: string; pem: string }`
  - `interface MarketplaceCatalogEnvelope { schemaVersion: 1; keyId: string; payload: string; signature: string }`
  - `function verifyMarketplaceCatalogEnvelope(raw: unknown, keys: readonly MarketplacePublicKey[]): MarketplaceCatalog`
  - `function signedMarketplaceEnvelope(catalog: MarketplaceCatalog, privateKeyPem: string, keyId: string): MarketplaceCatalogEnvelope` (test/CLI signing helper)

- [ ] **Step 1: Write failing signature tests using real Ed25519 keys**

```ts
it("verifies an Ed25519 envelope and rejects payload tampering", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const envelope = signedMarketplaceEnvelope(validCatalog(), privateKey.export({ type: "pkcs8", format: "pem" }).toString(), "current");
  expect(verifyMarketplaceCatalogEnvelope(envelope, [{ id: "current", pem: publicKey.export({ type: "spki", format: "pem" }).toString() }]).revision).toBe("2026-10-29.1");
  expect(() => verifyMarketplaceCatalogEnvelope({ ...envelope, payload: base64Of({ ...validPayload(), revision: "tampered" }) }, keys)).toThrow(/signature|签名/i);
});

it("rejects unknown keys and malformed base64", () => {
  expect(() => verifyMarketplaceCatalogEnvelope(envelope, [])).toThrow(/key/i);
  expect(() => verifyMarketplaceCatalogEnvelope({ ...envelope, signature: "***" }, keys)).toThrow(/base64/i);
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `pnpm exec vitest run --config tests/vitest.config.ts tests/plugin-marketplace.test.ts`
Expected: FAIL because `verifyMarketplaceCatalogEnvelope`/`signedMarketplaceEnvelope` are missing.

- [ ] **Step 3: Implement envelope verification and signing helper**

The signature covers the decoded payload bytes exactly. Accept only Ed25519 keys in SPKI PEM form for verification and PKCS#8 PEM for the signing helper. Parse the verified payload only after signature success. Enforce a 512 KiB decoded-payload cap before parsing.

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `pnpm exec vitest run --config tests/vitest.config.ts tests/plugin-marketplace.test.ts`
Expected: PASS.

- [ ] **Step 5: Check the scoped diff**

Run: `git diff --check -- src/agent/plugins/marketplace.ts tests/plugin-marketplace.test.ts`
Expected: exit 0.

---

### Task 3: Verified Cache And Offline Readout

**Files:**
- Create: `src/main/plugin-marketplace-store.ts`
- Test: `tests/plugin-marketplace-store.test.ts`

**Interfaces:**
- Consumes: `verifyMarketplaceCatalogEnvelope`, `MarketplaceCatalog`, `MarketplacePublicKey`.
- Produces:
  - `interface MarketplaceSourceConfig { catalogUrl: string | null; publicKeys: readonly MarketplacePublicKey[]; configProblem?: string }`
  - `interface MarketplaceCacheOptions { dir: string; fetchImpl?: typeof fetch; now?: () => number }`
  - `interface MarketplaceCatalogReadout { status: "ready" | "unavailable"; origin: "live" | "cache" | "none"; catalog: MarketplaceCatalog | null; fetchedAt: string | null; expiresAt: string | null; stale: boolean; note?: string }`
  - `function marketplaceSourceConfigFromEnv(env: NodeJS.ProcessEnv): MarketplaceSourceConfig`
  - `function loadPluginMarketplaceCatalog(input: { refresh?: "never" | "auto" | "force"; maxAgeMs?: number }, config: MarketplaceSourceConfig, opts: MarketplaceCacheOptions): Promise<MarketplaceCatalogReadout>`

- [ ] **Step 1: Write failing store tests**

```ts
it("writes and re-verifies a live signed catalog", async () => {
  const readout = await loadPluginMarketplaceCatalog({ refresh: "force" }, source, storeWith(response(envelope)));
  expect(readout).toMatchObject({ status: "ready", origin: "live", stale: false });
  const cached = await loadPluginMarketplaceCatalog({ refresh: "never" }, source, storeWithNoFetch());
  expect(cached).toMatchObject({ status: "ready", origin: "cache" });
});

it("returns stale verified cache when refresh fails and unavailable when none exists", async () => {
  seedExpiredVerifiedCache();
  const stale = await loadPluginMarketplaceCatalog({ refresh: "force" }, source, storeWith(new Response("", { status: 503 })));
  expect(stale).toMatchObject({ status: "ready", origin: "cache", stale: true });
  expect(stale.note).toContain("503");
  const missing = await loadPluginMarketplaceCatalog({ refresh: "auto" }, source, emptyStore());
  expect(missing).toMatchObject({ status: "unavailable", origin: "none", catalog: null });
});

it("does not replace a verified cache with a redirect or tampered response", async () => {
  seedVerifiedCache();
  await loadPluginMarketplaceCatalog({ refresh: "force" }, source, storeWith(new Response("", { status: 302 })));
  const cached = await loadPluginMarketplaceCatalog({ refresh: "never" }, source, storeWithNoFetch());
  expect(cached.catalog?.revision).toBe("cached.revision");
  expect(cached.note).toContain("重定向");
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `pnpm exec vitest run --config tests/vitest.config.ts tests/plugin-marketplace-store.test.ts`
Expected: FAIL because the store module does not exist.

- [ ] **Step 3: Implement fetch, cache, and readout**

Fetch with `redirect: "manual"`, a 5-second timeout, `accept: application/json`, and a 512 KiB response cap. Verify before writing. Write `{ schemaVersion: 1, fetchedAt, envelope }` atomically with mode `0o600`. Re-verify every cache read. Never throw for ordinary unavailable/network/cache errors; return `unavailable` with a note. When a valid cache is expired, return it as stale even if no refresh was requested. Missing URL/keys or malformed env config returns unavailable with a configuration note.

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `pnpm exec vitest run --config tests/vitest.config.ts tests/plugin-marketplace-store.test.ts`
Expected: PASS.

- [ ] **Step 5: Check the scoped diff**

Run: `git diff --check -- src/main/plugin-marketplace-store.ts tests/plugin-marketplace-store.test.ts`
Expected: exit 0.

---

### Task 4: Read-Only Desktop IPC

**Files:**
- Modify: `src/main/ipc-protocol.ts`
- Modify: `apps/desktop/src/main/channels.ts`
- Modify: `apps/desktop/src/main/index.ts`
- Modify: `apps/desktop/tests/channels.test.ts`
- Modify: `apps/desktop/tests/protocol-version.test.ts`
- Modify: `apps/desktop/tests/notification-open-wiring.test.ts`
- Modify: `tests/ipc-protocol-version.test.ts`
- Test: `apps/desktop/tests/marketplace-wiring.test.ts`

**Interfaces:**
- Consumes: `MarketplaceCatalogReadout`, `loadPluginMarketplaceCatalog`, `marketplaceSourceConfigFromEnv`.
- Produces:
  - `AgentApi.marketplaceCatalog(refresh?: "never" | "auto" | "force"): Promise<MarketplaceCatalogReadout>`
  - `INVOKE_CHANNELS.marketplaceCatalog = "agent:marketplace-catalog"`
  - `IPC_PROTOCOL_VERSION = 27`

- [ ] **Step 1: Write failing wiring tests**

```ts
it("exposes only a read-only marketplace catalog channel at protocol v27", () => {
  expect(IPC_PROTOCOL_VERSION).toBe(27);
  expect(INVOKE_CHANNELS.marketplaceCatalog).toBe("agent:marketplace-catalog");
  expect(readFileSync(protocolPath, "utf8")).toContain(
    'marketplaceCatalog(refresh?: "never" | "auto" | "force"): Promise<MarketplaceCatalogReadout>',
  );
});

it("wires the desktop user-data cache without install methods", () => {
  const main = readFileSync(mainPath, "utf8");
  expect(main).toContain("marketplaceCatalog: async (refresh)");
  expect(main).toContain('join(userData, "plugin-marketplace")');
  expect(main).not.toContain("marketplaceInstall");
});
```

- [ ] **Step 2: Run focused tests to verify they fail**

Run: `pnpm --filter cairn-desktop exec vitest run --config vitest.config.ts tests/marketplace-wiring.test.ts tests/channels.test.ts tests/protocol-version.test.ts tests/notification-open-wiring.test.ts`
Expected: FAIL on protocol version, missing channel, missing API, and missing main wiring.

- [ ] **Step 3: Add the protocol, channel, and main handler**

Import only types into the renderer-visible protocol. Register one handler that validates the refresh argument, reads config from `CAIRN_PLUGIN_MARKETPLACE_URL` and `CAIRN_PLUGIN_MARKETPLACE_KEYS_JSON`, and uses `<userData>/plugin-marketplace`. Do not add install/update/uninstall methods.

- [ ] **Step 4: Run focused tests to verify they pass**

Run: `pnpm --filter cairn-desktop exec vitest run --config vitest.config.ts tests/marketplace-wiring.test.ts tests/channels.test.ts tests/protocol-version.test.ts tests/notification-open-wiring.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the root protocol tests**

Run: `pnpm exec vitest run --config tests/vitest.config.ts tests/ipc-protocol-version.test.ts tests/plugin-marketplace.test.ts tests/plugin-marketplace-store.test.ts`
Expected: PASS.

- [ ] **Step 6: Check the scoped diff**

Run: `git diff --check -- src/main/ipc-protocol.ts apps/desktop/src/main/channels.ts apps/desktop/src/main/index.ts apps/desktop/tests/channels.test.ts apps/desktop/tests/protocol-version.test.ts apps/desktop/tests/notification-open-wiring.test.ts apps/desktop/tests/marketplace-wiring.test.ts tests/ipc-protocol-version.test.ts`
Expected: exit 0.

---

## Self-Review

- Spec coverage: signed catalog validation, cache/offline truthfulness, HTTPS/redirect/size boundaries, and a read-only data surface are covered. Download, extraction, install jobs, trust review, enable/disable, update, uninstall, and marketplace UI remain explicitly deferred to PLUGIN-1B/PLUGIN-2.
- Type consistency: `MarketplaceCatalog`, `MarketplacePublicKey`, `MarketplaceSourceConfig`, and `MarketplaceCatalogReadout` are produced before their consumers.
- Review focus: each security/failure line has a focused test in the owning task.
- Proportion: one pure module, one IO module, one IPC channel, and three focused test files.
