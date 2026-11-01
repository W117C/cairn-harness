# Interop And Ecosystem Design

Date: 2026-10-27

## Objective

Expose Cairn capabilities through stable, permission-preserving interfaces:
deferred tool search, ACP/SDK, A2A, and external benchmark adapters.

The interoperability layer is a boundary around the runtime, not a second agent
implementation.

## Tool Search

Add `tool_search`, a deferred-tool catalog using deterministic BM25-style ranking.

The catalog contains descriptions and schemas, not active permissions. Searching
only reveals candidates. Activation still goes through the existing MCP/tool gate.

Rules:

- bounded query and result count;
- exact name and identifier matches outrank semantic prose;
- returned schema is the exact executable schema;
- no tool call is executed by search;
- read-only callers can search but still cannot activate a denied tool;
- results are stable by score then name.

## ACP And SDK

Provide a versioned `AgentClientV1`:

```ts
interface AgentClientV1 {
  createSession(input: CreateSessionInput): Promise<SessionHandle>;
  send(session: SessionRef, input: UserInput): Promise<RunHandle>;
  stream(run: RunRef, signal?: AbortSignal): AsyncIterable<ClientEvent>;
  cancel(run: RunRef): Promise<void>;
  close(session: SessionRef): Promise<void>;
}
```

Events use a public discriminated union and stable schema version. Internal event
fields may be exposed only if documented and redacted. Capability negotiation is
explicit.

The transport-neutral SDK core is tested first; an ACP adapter maps it to the ACP
wire protocol.

## A2A

A2A tasks map to stable agent threads:

- task id maps to logical agent id;
- message id maps to idempotency key;
- artifact ids are content-addressed;
- task state maps to the public lifecycle state, never raw projections;
- cancel and resume carry fence and protocol version.

Remote A2A callers cannot select local files or bypass approvals. Untrusted
message content remains data.

## Benchmarks

Add adapters for Harbor/Terminal-Bench style external tasks.

An external run records:

- benchmark and dataset version;
- task id and seed;
- model/provider;
- tool policy;
- timeout, token, and dollar budget;
- result, failure, interruption, and usage availability.

Missing usage and interrupted runs remain `unknown`, not zero and not a retry
that erases the first result.

## Acceptance

- tool search finds a hidden tool without activating it;
- activation remains permission-gated;
- SDK and ACP produce the same public events for one scripted run;
- A2A duplicate messages are idempotent;
- A2A cancel/resume rejects stale fences;
- external benchmark runs preserve failures and unknowns;
- no interface exposes raw secrets or unredacted internal events.

## Implementation Status (2026-10-27)

| Surface | Implementation | Evidence |
|---|---|---|
| Tool search | `src/agent/tool-search.ts` (BM25-style, deterministic, bounded), wired through `src/main/tool-gates.ts` as a read-only runtime tool; hidden MCP tools remain inactive until `mcp_activate` | `tests/tool-search.test.ts` (7), `tests/tool-search-tool.test.ts` (2) |
| SDK v1 | `src/interop/sdk.ts`: versioned `AgentClientV1`, explicit capability negotiation, public event union, redacted projection, real `runLoop` host. Tool execution is **host-injected**; the default is an empty table, so the SDK cannot silently fall back to the raw static `TOOLS` and bypass permission gates | `tests/interop-sdk.test.ts` (12) |
| ACP | `src/interop/acp.ts`: `initialize` / `session/new` / `session/prompt` / `session/cancel`, JSON-RPC dispatch, `session/update` notifications from the same SDK events; `src/interop/acp-stdio.ts`: bounded newline-delimited stdio transport that dispatches requests concurrently so cancel can arrive during a prompt | `tests/interop-sdk.test.ts`, `tests/interop-acp-stdio.test.ts` (3) |
| A2A | `src/interop/a2a.ts`: task id = logical agent id, message id = idempotency key, content-addressed artifacts, public lifecycle mapping, fenced cancel/resume with protocol version; `src/interop/a2a-http.ts`: loopback JSON-RPC HTTP + agent-card endpoint with body caps and explicit 404/405/415/413 | `tests/interop-a2a.test.ts` (6), `tests/interop-a2a-http.test.ts` (3) |
| External benchmarks | `src/interop/benchmarks.ts` adapters + run records; `scripts/external-bench.ts` CLI; fixtures under `fixtures/bench-external/` | `tests/interop-benchmarks.test.ts` (5), `outputs/interop-c-2026-10-27/external-bench.jsonl` |
| Product host / servers | `src/main/interop-host.ts` maps SDK runs onto `handleAgentRun`; `src/main/interop-a2a-runtime.ts` maps A2A tasks onto the same product sessions (read-only). `scripts/acp-server.ts` serves stdio; `scripts/a2a-server.ts` serves loopback HTTP | `tests/interop-host.test.ts` (1), `tests/acp-server-cli.test.ts` (1), `tests/interop-a2a-product.test.ts` (1), `tests/a2a-server-cli.test.ts` (1) |

Acceptance mapping:

- hidden-tool discovery without activation and the subsequent permission denial:
  `tests/tool-search-tool.test.ts`;
- SDK/ACP event equivalence: the ACP test derives the expected updates from the SDK stream with the
  same pure mapping used by the adapter;
- A2A duplicate-message idempotency and stale-fence rejection: `tests/interop-a2a.test.ts`;
- external failure/interruption/unknown preservation: adapter tests plus the CLI fixture run, where a
  failed task keeps its failure, a task without evidence stays `unknown`, and missing usage is `null`
  with named `unknown` fields;
- secret redaction: `toClientEvents` passes tool arguments, outputs, and errors through the existing
  redaction path; the SDK test asserts a planted key never appears in the public projection.

Explicit boundaries:

- ACP ships a stdio server (`pnpm acp-server`) backed by `handleAgentRun`; the workspace is fixed and
  the default is `unattended:true`, so write tools fail closed. `--mode auto`/`full-access` is an
  explicit trusted-client choice. There is still no `session/request_permission` bridge and no packaged
  editor-client certification.
- A2A ships a loopback HTTP server (`pnpm a2a-server`) backed by the same product sessions, but the
  product runtime accepts **read-only** tasks only. There is no authentication, TLS, SSE streaming,
  push notifications, or durable task store beyond the session log. `tasks/resume` is not resumable
  for completed product runs.
- External benchmark adapters normalize tasks and record runs; they do not execute Harbor or
  Terminal-Bench infrastructure, clone repositories, or call a model. A real external run requires an
  executor outside this repository.
- None of these adapters replaces the existing approval, write-lease, or audit paths. The SDK host
  receives its tool table from the caller; the default is empty, so it cannot fall back to the raw
  static tools. The product ACP/A2A servers go through `handleAgentRun`, not a second execution path.
