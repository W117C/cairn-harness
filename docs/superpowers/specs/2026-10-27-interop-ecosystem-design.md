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

