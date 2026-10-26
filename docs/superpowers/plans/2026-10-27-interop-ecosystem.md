# Interop And Ecosystem Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add deferred tool search, a versioned local SDK/ACP boundary, A2A mapping, and external benchmark ingestion without bypassing security boundaries.

**Architecture:** Build a transport-neutral client contract first, then adapt tool discovery, ACP, A2A, and benchmarks onto existing runtime and permission surfaces.

**Tech Stack:** TypeScript, Vitest, existing MCP/tool gates, Node HTTP/JSON-RPC, stable public event types.

**Spec:** `docs/superpowers/specs/2026-10-27-interop-ecosystem-design.md`

## Global Constraints

- Search does not grant permission.
- Activation and execution use the existing permission and approval gates.
- Public schemas are versioned.
- Unknown usage and interrupted runs stay unknown.
- No real network call in unit tests.

## Review Focus

- a search query that exactly names a denied tool;
- schema drift between search result and executable tool;
- ACP disconnect during a write;
- A2A duplicate message after restart;
- external benchmark process timeout;
- artifact hash mismatch after transfer.

---

### Task 1: Generic BM25 Tool Search

**Files:**
- Create: `src/agent/tool-search.ts`
- Create: `src/tools/tool-search.ts`
- Create: `tests/tool-search.test.ts`
- Modify: `src/agent/plugin-runtime.ts`
- Modify: `src/main/tool-gates.ts`

**Interfaces:**
- Produces: `rankToolCatalog(query, tools, opts): ToolSearchHit[]`.

- [ ] **Step 1: Write failing ranking tests**

Assert exact names outrank descriptions, CJK tokenization works, ties are stable,
and result count is bounded. Assert search does not activate an MCP server.

- [ ] **Step 2: Run and verify RED**

Run: `pnpm vitest run --config tests/vitest.config.ts tests/tool-search.test.ts`

Expected: FAIL because the catalog does not exist.

- [ ] **Step 3: Implement pure ranking and runtime tool**

Use structured tool metadata. Return the exact input schema and activation hint.

- [ ] **Step 4: Run and verify GREEN**

Run: `pnpm vitest run --config tests/vitest.config.ts tests/tool-search.test.ts tests/mcp-bounds.test.ts`

Expected: all tests pass.

### Task 2: Public SDK Contract

**Files:**
- Create: `src/api/v1.ts`
- Create: `src/api/event-v1.ts`
- Create: `src/api/local-client.ts`
- Create: `tests/api-v1.test.ts`

**Interfaces:**
- Produces: `AgentClientV1`, `ClientEventV1`, `createLocalAgentClientV1(deps)`.

- [ ] **Step 1: Write failing contract tests**

Create a session, send two inputs, stream events, cancel, and close. Assert stable
ids, bounded payloads, and redaction.

- [ ] **Step 2: Run and verify RED**

Run: `pnpm vitest run --config tests/vitest.config.ts tests/api-v1.test.ts`

Expected: FAIL because the SDK is absent.

- [ ] **Step 3: Implement the transport-neutral adapter**

Map onto existing session handlers; do not duplicate the runner.

- [ ] **Step 4: Run and verify GREEN**

Run: `pnpm vitest run --config tests/vitest.config.ts tests/api-v1.test.ts`

Expected: all tests pass.

### Task 3: ACP Adapter

**Files:**
- Create: `src/api/acp.ts`
- Create: `tests/acp-adapter.test.ts`

**Interfaces:**
- Produces: `createAcpServer(client): AcpPeer`.

- [ ] **Step 1: Write failing protocol tests**

Assert capability negotiation, create/send/cancel/close, cancellation, protocol
version rejection, and secret redaction.

- [ ] **Step 2: Run and verify RED**

Run: `pnpm vitest run --config tests/vitest.config.ts tests/acp-adapter.test.ts`

Expected: FAIL because the adapter is absent.

- [ ] **Step 3: Implement ACP over the SDK contract**

Keep wire translation isolated from runtime behavior.

- [ ] **Step 4: Run and verify GREEN**

Run: `pnpm vitest run --config tests/vitest.config.ts tests/acp-adapter.test.ts tests/api-v1.test.ts`

Expected: all tests pass.

### Task 4: A2A Task Adapter

**Files:**
- Create: `src/api/a2a.ts`
- Create: `tests/a2a-adapter.test.ts`

**Interfaces:**
- Produces: `createA2AAdapter(runtime): A2AAdapter`.

- [ ] **Step 1: Write failing mapping tests**

Assert task/message idempotency, artifact hashes, state mapping, fence rejection,
and untrusted message handling.

- [ ] **Step 2: Run and verify RED**

Run: `pnpm vitest run --config tests/vitest.config.ts tests/a2a-adapter.test.ts`

Expected: FAIL because the adapter is absent.

- [ ] **Step 3: Implement A2A over `AgentRuntime`**

Do not add a second session or task state machine.

- [ ] **Step 4: Run and verify GREEN**

Run: `pnpm vitest run --config tests/vitest.config.ts tests/a2a-adapter.test.ts`

Expected: all tests pass.

### Task 5: External Benchmark Adapter

**Files:**
- Create: `src/agent/eval/external-benchmark.ts`
- Create: `scripts/external-benchmark.ts`
- Create: `tests/external-benchmark.test.ts`
- Create: `fixtures/external-bench/tasks.json`

**Interfaces:**
- Produces: `runExternalBenchmark(input): Promise<ExternalBenchmarkReport>`.

- [ ] **Step 1: Write failing accounting tests**

Assert success, failure, timeout, interrupted run, missing usage, and duplicate
attempt behavior. Assert no result is rewritten by a retry.

- [ ] **Step 2: Run and verify RED**

Run: `pnpm vitest run --config tests/vitest.config.ts tests/external-benchmark.test.ts`

Expected: FAIL because the adapter is absent.

- [ ] **Step 3: Implement the generic process/JSON adapter**

Keep benchmark-specific parsing in adapters. Use explicit budgets and workspace
isolation.

- [ ] **Step 4: Run and verify GREEN**

Run: `pnpm vitest run --config tests/vitest.config.ts tests/external-benchmark.test.ts`

Expected: all tests pass.

### Task 6: Documentation And Full Verification

**Files:**
- Modify: `STATE.md`
- Modify: `PROGRESS.md`
- Modify: `docs/REPOSITORY-STATUS.md`
- Modify: `docs/CODE-WIKI.md`
- Modify: `package.json`

- [ ] **Step 1: Document public schemas and support status**

Distinguish implemented, tested, and externally interoperable. A local adapter
does not imply a certified remote deployment.

- [ ] **Step 2: Run full verification**

Run:

```bash
pnpm test:capped
node --import tsx scripts/typecheck.ts
pnpm docs-check
```

Expected: exit 0 with exact counts reported.

