# Context And Memory Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add bounded raw-history recall, predictive compaction, hybrid memory, and a reproducible paired quality report.

**Architecture:** Keep the event log as the only history authority. Add pure bounded search and prediction-validation functions, wrap them in runtime services, and inject those services at existing assembly/tool seams.

**Tech Stack:** TypeScript, Node.js, Vitest, existing event log, provider, memory, and tool-runtime abstractions.

**Spec:** `docs/superpowers/specs/2026-10-27-context-memory-quality-design.md`

## Global Constraints

- Do not add an event kind.
- New event fields must be optional and old JSONL must remain valid.
- `STATE.md` is rewritten wholesale; `PROGRESS.md` is append-only.
- Core code must not import desktop code.
- No test may make a real embedding, model, or network request.
- Keep the current uncommitted desktop changes out of this work.
- Use `pnpm test:capped`, not only a focused test file, before claiming the suite is green.

## Review Focus

- An empty history result must be distinguishable from an unreadable or truncated scan.
- A prediction must not be adopted after a history rewrite, expiry, or model change.
- A discarded successful prediction must remain visible in usage accounting.
- A broken embedder must not erase otherwise valid lexical recall.
- Tool output bounds must apply by Unicode code point and must not split surrogates.

---

### Task 1: Bounded Current-Session History Search

**Files:**
- Create: `src/agent/history-search.ts`
- Create: `tests/history-search.test.ts`

**Interfaces:**
- Consumes: `AgentEvent`, `EventRef`, `tokensOf`.
- Produces: `searchHistory(input: HistorySearchInput): HistorySearchResult`.

- [ ] **Step 1: Write the failing pure-search tests**

```ts
const entries = [
  { event: { type: "user_message", content: "remember ALPHA-417" }, ref: ref(2) },
  { event: { type: "assistant_message", content: "unrelated" }, ref: ref(3) },
];
expect(searchHistory({ entries, query: "ALPHA-417" })).toMatchObject({
  kind: "ok",
  hits: [{ ref: ref(2), matched: expect.arrayContaining(["alpha-417"]) }],
});
expect(searchHistory({ entries, query: "" })).toEqual({
  kind: "unavailable", reason: "empty-query",
});
```

Add assertions for `partial` when `scannedEvents < totalEvents`, deterministic ties
by `eventId`, CJK text, tool-result text, and surrogate-safe excerpts.

- [ ] **Step 2: Run the test and verify RED**

Run: `pnpm vitest run --config tests/vitest.config.ts tests/history-search.test.ts`

Expected: FAIL because `src/agent/history-search.ts` does not exist.

- [ ] **Step 3: Implement the pure bounded search**

Signature:

```ts
export function searchHistory(input: {
  entries: readonly HistorySearchEntry[];
  query: string;
  maxResults?: number;
  maxEvents?: number;
  maxExcerptChars?: number;
}): HistorySearchResult;
```

Exclude `thinking_delta`; render supported raw fields into bounded searchable text;
rank by token overlap with deterministic tie-breaking.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `pnpm vitest run --config tests/vitest.config.ts tests/history-search.test.ts`

Expected: all tests pass.

### Task 2: Bind Search To The Current Session

**Files:**
- Create: `src/tools/search-history.ts`
- Create: `tests/search-history-tool.test.ts`
- Modify: `src/agent/tool-surface.ts`
- Modify: `src/main/agent-runner.ts`
- Modify: `tests/tool-surface-parity.test.ts`

**Interfaces:**
- Consumes: `searchHistory`.
- Produces: `createSearchHistoryTool(opts): Tool` and `searchHistorySpec`.

- [ ] **Step 1: Write the failing tool tests**

```ts
const tool = createSearchHistoryTool({ readEntries: async () => entries, sessionId: "s1" });
expect(await tool.run({ query: "ALPHA-417" }, ctx)).toMatchObject({ ok: true });
expect(await tool.run({ query: "x", sessionId: "other" }, ctx)).toMatchObject({ ok: false });
```

Add a production-facing assertion that `sessionToolFace` includes
`search_history` in a main read-only run.

- [ ] **Step 2: Run and verify RED**

Run: `pnpm vitest run --config tests/vitest.config.ts tests/search-history-tool.test.ts tests/tool-surface-parity.test.ts`

Expected: FAIL because the tool and surface entry are absent.

- [ ] **Step 3: Implement and inject the tool**

Closure binds `workspace`, `sessionId`, and root. `readEntries` uses
`readSessionView`. Add `search_history` to `INJECTED_TOOLS` as runtime, main-only,
read-only, and non-side-effecting. Inject instance and spec in `agent-runner` on
all main sessions.

- [ ] **Step 4: Run and verify GREEN**

Run: `pnpm vitest run --config tests/vitest.config.ts tests/search-history-tool.test.ts tests/tool-surface-parity.test.ts`

Expected: all tests pass.

### Task 3: Hybrid Memory Adapter

**Files:**
- Create: `src/agent/memory/semantic.ts`
- Create: `tests/memory-hybrid.test.ts`
- Modify: `src/agent/memory/retrieval.ts`
- Modify: `src/agent/memory/inject.ts`

**Interfaces:**
- Produces: `EmbeddingProvider`,
  `selectRecallHybrid(query, candidates, opts): Promise<HybridRecallOutcome>`.
- Extends: `MemoryInjectionOptions.embedding` and `MemoryInjection.retrieval`.

- [ ] **Step 1: Write the failing hybrid tests**

```ts
const provider = fakeEmbedder({ "deploy outage": [1, 0], "production failure": [0.98, 0.2] });
const out = await selectRecallHybrid("deploy outage", candidates, {
  embedding: { provider }, nowISO: NOW,
});
expect(out.mode).toBe("hybrid");
expect(out.picks.map(p => p.topic)).toContain("prod-runbook");
```

Add an embedder that throws and assert lexical picks survive with
`mode: "hybrid-fallback"` and a non-empty reason.

- [ ] **Step 2: Run and verify RED**

Run: `pnpm vitest run --config tests/vitest.config.ts tests/memory-hybrid.test.ts`

Expected: FAIL because the hybrid API does not exist.

- [ ] **Step 3: Implement provider validation and fusion**

Validate dimensions, finite values, vector count, and non-zero norm. Use cosine
similarity. Preserve lexical selection when `embedding` is absent. Surface
`retrieval` in `MemoryInjection` and a visible fallback line when configured
semantics fail.

- [ ] **Step 4: Run focused and existing memory tests**

Run: `pnpm vitest run --config tests/vitest.config.ts tests/memory-hybrid.test.ts tests/memory-recall.test.ts tests/memory-inject-token-budget.test.ts`

Expected: all tests pass.

### Task 4: Predictive Compaction Candidate

**Files:**
- Create: `src/agent/compaction-prediction.ts`
- Create: `tests/compaction-prediction.test.ts`
- Modify: `src/agent/compaction.ts`
- Modify: `src/agent/session-provider.ts`
- Modify: `src/events/types.ts`
- Modify: `tests/compaction.test.ts`

**Interfaces:**
- Produces: `shouldStartCompactionPrediction`,
  `compactionPrefixDigest`, `validatePrediction`.
- Extends: `SessionCompaction.prediction` and `UsageEvent.source`.

- [ ] **Step 1: Write failing pure validation tests**

```ts
expect(validatePrediction(candidate, { events: [...same, later], modelKey: "m", now: 2, maxAgeMs: 10 }))
  .toEqual({ ok: true });
expect(validatePrediction(candidate, { events: changed, modelKey: "m", now: 2, maxAgeMs: 10 }))
  .toEqual({ ok: false, reason: "history-changed" });
expect(validatePrediction(candidate, { events: same, modelKey: "other", now: 2, maxAgeMs: 10 }))
  .toEqual({ ok: false, reason: "model-changed" });
```

Add expiry and no-start-above-threshold cases.

- [ ] **Step 2: Run and verify RED**

Run: `pnpm vitest run --config tests/vitest.config.ts tests/compaction-prediction.test.ts`

Expected: FAIL because the prediction API does not exist.

- [ ] **Step 3: Implement pure prediction logic**

Use SHA-256 over the canonical event JSON. `shouldStartCompactionPrediction`
requires a finite estimate between the warm threshold and normal ratio threshold.

- [ ] **Step 4: Write failing provider integration tests**

Use a counting mock summarizer. Extend the log between two requests without
rewriting the prefix. Assert one summary call, one adopted compaction event, and
no synchronous second call. Add a stale-candidate test that asserts a
`source: "compaction_prediction"` usage event.

- [ ] **Step 5: Run and verify RED**

Run: `pnpm vitest run --config tests/vitest.config.ts tests/compaction-prediction.test.ts`

Expected: FAIL because `session-provider` does not start or adopt predictions.

- [ ] **Step 6: Implement provider integration**

Start at most one prediction per provider. Keep the promise handled. Adopt only
after `validatePrediction`. Fall back synchronously on invalidation. Record stale
successful usage once. Skip `PreCompact` for prediction and ignore prediction usage
in `calibrateFactor`.

- [ ] **Step 7: Run focused and compaction regression tests**

Run: `pnpm vitest run --config tests/vitest.config.ts tests/compaction-prediction.test.ts tests/compaction.test.ts tests/compact-wiring.test.ts tests/hook-precompact-producer.test.ts`

Expected: all tests pass.

### Task 5: Fixed Paired Quality Evaluation

**Files:**
- Create: `fixtures/context-quality/cases.json`
- Create: `src/agent/context-quality-eval.ts`
- Create: `scripts/context-quality-eval.ts`
- Create: `tests/context-quality-eval.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `runContextQualityEvaluation(cases, deps): Promise<ContextQualityReport>`.
- CLI: `pnpm context-quality-eval -- --out outputs/context-quality-YYYY-MM-DD`.

- [ ] **Step 1: Write the failing report tests**

Assert fixed paired cases produce separate rows for `lexical`, `hybrid`, `sync`,
`prediction`, and `history`. Assert each row reports hit, returned tokens,
latency, `failed`, and `unknown`.

- [ ] **Step 2: Run and verify RED**

Run: `pnpm vitest run --config tests/vitest.config.ts tests/context-quality-eval.test.ts`

Expected: FAIL because the evaluator does not exist.

- [ ] **Step 3: Implement deterministic evaluation**

Use the local fake embedder and summarizer. Measure elapsed time with an injected
clock only for tests; use `performance.now()` in the CLI. Write JSON and Markdown.

- [ ] **Step 4: Run and verify GREEN**

Run: `pnpm vitest run --config tests/vitest.config.ts tests/context-quality-eval.test.ts`

Expected: all tests pass.

- [ ] **Step 5: Produce evidence**

Run:

```bash
pnpm context-quality-eval -- --out outputs/context-quality-2026-10-27
```

Expected: report exists and each arm is present.

### Task 6: Documentation And Full Verification

**Files:**
- Modify: `STATE.md`
- Modify: `PROGRESS.md`
- Modify: `docs/REPOSITORY-STATUS.md`
- Modify: `docs/CODE-WIKI.md`

- [ ] **Step 1: Update the current-state documents within their existing rules**

Record implemented surfaces, evidence path, and remaining boundaries. Do not turn
synthetic paired results into a real-provider claim.

- [ ] **Step 2: Run full verification**

Run:

```bash
pnpm test:capped
node --import tsx scripts/typecheck.ts
pnpm docs-check
```

Expected: exit 0. Report exact counts and concurrency.

