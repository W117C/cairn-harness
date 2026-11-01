# Context And Memory Quality Design

Date: 2026-10-27

## Objective

Make Cairn's context management measurable and competitive with Codex and Claude
without weakening the event log, replay, permission, or budget contracts.

The first release covers four independent gaps:

1. the model can retrieve raw current-session history after compaction;
2. compaction can prepare a candidate before the synchronous threshold;
3. memory recall can use an injected semantic embedder while retaining lexical
   fallback;
4. a fixed paired evaluation reports quality, token cost, and latency rather
   than a single anecdotal score.

## Evidence

Current repository:

- lexical-only memory recall: `src/agent/memory/retrieval.ts`;
- one safe memory injection exit: `buildMemoryInjectionSafe` in
  `src/agent/memory/inject.ts`;
- synchronous compaction inside request assembly:
  `src/agent/session-provider.ts`;
- UI/session-wide search exists in `src/main/session-search.ts`, but the model has
  no current-session history tool;
- the event log already supports source references through `EventRef` and
  `readSessionView`.

External patterns worth copying:

- Codex predicts compacted history and validates candidate history/model state
  before use: <https://github.com/openai/codex>;
- Claude subagents use isolated contexts and summary-only returns:
  <https://code.claude.com/docs/en/sub-agents>;
- Claude memory uses a small eager index and progressive disclosure:
  <https://code.claude.com/docs/en/memory>;
- Pydantic AI composes durable capabilities such as memory, compaction, and tool
  search: <https://github.com/pydantic/pydantic-ai>;
- Mem0 and Graphiti combine lexical, semantic, entity, temporal, and provenance
  signals: <https://github.com/mem0ai/mem0>,
  <https://github.com/getzep/graphiti>.

This design borrows interfaces and failure handling, not graph-database
dependencies or opaque hosted services.

## Non-goals

- No new event kind. New behavior is represented by optional fields on existing
  event types.
- No raw history outside the current session lineage.
- No model-supplied session id, workspace, event id range, or file path for the
  history tool.
- No hidden network call from tests when no embedder is configured.
- No claim that semantic recall improves task success until a paired evaluation
  has run.

## History Recall

### Model-facing tool

Add `search_history`, a read-only runtime tool bound to one session:

```ts
interface SearchHistoryArgs {
  query: string;
  max_results?: number;
}
```

The tool searches the complete `SessionView` for the bound session, including
parent entries inherited by a pointer fork. It does not accept a session id.

Each hit returns:

```ts
{
  ref: { workspace: string; sessionId: string; eventId: number };
  type: string;
  excerpt: string;
  matched: string[];
  score: number;
}
```

The result envelope is tri-state:

- `ok`: complete scan, including a legitimate empty result;
- `partial`: bounded scan stopped or some entries were unreadable;
- `unavailable`: the query or source could not be evaluated.

`partial` and `unavailable` must never render as "no match".

The scan covers raw user, assistant, thinking-free tool, and compaction-adjacent
events. Reasoning deltas are excluded. Tool calls and results are included because
they often contain the facts lost from the model context. Output is bounded by
result count, source event count, and excerpt characters.

### Safety

- Closures bind workspace, session id, and root; model arguments cannot override
  them.
- The tool is not reachable from workers or write-only execution lanes.
- Secret-bearing bytes have already passed the host redaction path before they
  enter the event log.
- Event refs are metadata, not extra file-reading authority.

## Predictive Compaction

Compaction remains synchronous when a threshold is crossed and no valid candidate
exists. Prediction starts only after the context reaches a configurable warm
threshold below the normal trigger.

A candidate contains:

```ts
interface PredictiveCompactionCandidate {
  event: CompactionEvent;
  baseEventCount: number;
  prefixDigest: string;
  modelKey: string;
  createdAt: number;
}
```

Adoption requires:

- the current event count is at least `baseEventCount`;
- a digest of the first `baseEventCount` events still matches;
- `modelKey` still matches the active provider/model;
- the candidate has not exceeded `maxAgeMs`;
- the normal compaction decision is `auto/threshold`.

A candidate can therefore survive append-only growth after its snapshot. It cannot
survive a rewritten prefix, changed model, or expiry.

If a successful prediction is discarded, its measured `CompactionUsage` is
recorded as an existing `usage` event with:

```ts
source: "compaction_prediction"
```

Calibration ignores prediction usage. General usage accounting still includes it,
so a discarded request is never silently free.

Prediction must not fire `PreCompact`; no context replacement happened. A
synchronous fallback fires the existing hook normally.

## Hybrid Memory

Add an injectable adapter:

```ts
interface EmbeddingProvider {
  id: string;
  embed(texts: readonly string[], options?: { signal?: AbortSignal }):
    Promise<readonly (readonly number[])[]>;
}
```

Memory injection accepts `embedding?: { provider: EmbeddingProvider; signal?: AbortSignal }`.
When absent, behavior remains lexical.

Hybrid ranking combines normalized lexical relevance and cosine similarity.
Lexical evidence remains mandatory for entity names and exact identifiers.
Semantic similarity can recover paraphrases and cross-language wording.

The output records:

```ts
retrieval: {
  mode: "lexical" | "hybrid" | "hybrid-fallback";
  reason?: string;
}
```

If a configured embedder fails, returns the wrong vector count, or returns an
invalid vector, Cairn uses lexical ranking and writes a visible
`hybrid-fallback` note in the recall block. A failed enhancement is not represented
as no memory or successful semantics.

## Fixed Paired Evaluation

Add a deterministic evaluation harness with fixed cases and paired arms:

- lexical versus hybrid memory;
- synchronous versus predictive compaction;
- history recall hit rate and returned bytes;
- wall-clock latency and estimated tokens.

No evaluator may replace failures or unknown usage with zeros. The report keeps
the arms separate and includes:

```ts
{
  caseId: string;
  arm: string;
  hit: boolean;
  returnedTokens: number;
  latencyMs: number;
  failed: boolean;
  unknown: string[];
}
```

The first release uses an injected deterministic embedder and summarizer so it can
run offline. Real-provider evaluation remains a separate, clearly labeled mode.

## Acceptance

- history search finds a fact absent from projected context and returns the exact
  source `EventRef`;
- history search cannot be pointed at another session;
- lexical-only tests and output remain compatible;
- hybrid recall selects a paraphrase-only fixture that lexical recall misses;
- embedder failure produces lexical results plus a visible fallback reason;
- a valid prediction is adopted without a second summarizer call;
- stale or expired predictions are rejected and their usage is recorded;
- the paired report exposes quality, tokens, latency, failure, and unknown fields;
- focused tests pass, then `pnpm test:capped`;
- `node --import tsx scripts/typecheck.ts` and `pnpm docs-check` pass.

## Implementation Status (2026-10-27)

| Gap | Implementation | Evidence |
|---|---|---|
| Current-session history recall | `src/agent/history-search.ts` + `src/tools/search-history.ts`, bound to one session; tri-state envelope | `tests/history-search.test.ts` (7), `tests/search-history-tool.test.ts` (5) |
| Predictive compaction | `src/agent/compaction-prediction.ts` + provider integration; prefix digest, model key, age, discarded usage | `tests/compaction-prediction.test.ts` (8) |
| Hybrid memory | `src/agent/memory/semantic.ts` + injectable adapter in `inject.ts`; lexical fallback with visible reason | `tests/memory-hybrid.test.ts` (6), `tests/memory-recall.test.ts` (13) |
| Fixed paired evaluation | `src/agent/context-quality-eval.ts`; separate arms, failure/unknown fields, no zero substitution | `tests/context-quality-eval.test.ts` (3) |

Boundaries:

- The paired evaluation runs on deterministic injected embedders/summarizers. Real-provider quality,
  cost, and latency gains remain unmeasured; fixture readings must not be reported as provider gains.
- History recall is current-session only; workers and write-only lanes cannot reach the tool.
- Hybrid recall never turns an embedder failure into "no memory": lexical results remain and the
  fallback reason is visible.
