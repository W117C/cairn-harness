# Unified Agent Runtime Design

Date: 2026-10-27

## Objective

Provide one lifecycle contract for local and remote agents while preserving the
existing Orchestrator and durable Flow engine as execution authorities.

The contract covers spawn, send/follow-up, wait, resume, close, list, cancel,
race, quorum, and remote execution.

## Current Gaps

- the model-facing surface exposes only `spawn_agent`, `wait_for_agents`, and
  `cancel_agents`;
- the old Orchestrator has pipeline/supervise/race behavior but no uniform identity
  and lifecycle facade;
- Flow accepts `race` and `gather any/quorum` shapes and rejects them during static
  expansion;
- remote execution and real orchestration evaluation are explicitly unfinished.

## Architecture

Introduce a core `AgentRuntime` facade:

```ts
interface AgentRuntime {
  spawn(spec: AgentSpawnSpec): Promise<AgentRecord>;
  send(id: string, message: AgentMessage): Promise<AgentReceipt>;
  wait(ids: readonly string[], opts?: AgentWaitOptions): Promise<AgentWaitResult>;
  resume(id: string, fencingToken: string): Promise<AgentRecord>;
  close(id: string): Promise<AgentReceipt>;
  list(filter?: AgentListFilter): Promise<AgentRecord[]>;
  cancel(ids: readonly string[]): Promise<AgentCancellationResult>;
}
```

`AgentRecord.id` is stable for the logical agent thread. Each execution attempt has
its own `run_id`, fence, and revision. A completion from an older fence is rejected.

Adapters:

- local lifecycle adapter backed by the existing Orchestrator;
- durable Flow adapter backed by `OrchestrationEngine`;
- remote adapter using the same contract and capability tokens.

## Follow-up Semantics

`send` appends a user-authored follow-up to a stable agent thread.

- If the agent is idle, it starts a new run with the thread summary and follow-up.
- If the agent is running, the follow-up is queued and delivered at the next turn
  boundary.
- Delivery is idempotent by `(agent_id, message_id)`.
- The child context remains isolated from the parent conversation.
- The parent receives bounded summaries and artifacts, never the full child log.

## Dynamic Control

Flow nodes named `race` and `gather` with `any` or `quorum` are runtime groups,
not statically expanded tasks.

Each group records:

- group id and plan/version;
- candidate task/run ids;
- strategy and quorum;
- predicate or success contract;
- cancellation deadline;
- winner/quorum decision;
- cancelled and late-result receipts.

The first successful completion wins a race. Losing runs are cancelled
deterministically in task-id order. Late results are rejected and recorded as
fenced-away outcomes.

`gather quorum` waits for `quorum` successful children. `gather any` is quorum 1.

## Remote Workers

Remote execution uses an outbound JSON-RPC style client; the remote side cannot
write the local workspace directly.

Every request carries:

- capability token with tool, filesystem, network, and git limits;
- deadline and heartbeat interval;
- run id, logical agent id, fence, and contract digest;
- idempotency key.

The local host accepts results only when fence, contract digest, revision, and
deadline all match. Disconnect recovery marks an unknown remote run as
`needs_you`; it never guesses success or retries destructive work automatically.

## Safety

Interop layers cannot bypass existing approval, redaction, audit, or write-lease
boundaries. Remote capabilities are bounded by both sides. No raw token is written
to event logs.

## Acceptance

- stable thread ids survive follow-up runs;
- duplicate send is idempotent;
- resume with a stale fence is rejected;
- close is idempotent and confirms executor stop;
- race cancellation order is deterministic and late results are rejected;
- quorum and any behave correctly with failure/timeout fixtures;
- remote disconnect yields `needs_you`, not success;
- all local and remote paths pass through the same permission and audit tests.

