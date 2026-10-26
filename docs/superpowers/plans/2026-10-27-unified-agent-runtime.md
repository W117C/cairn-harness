# Unified Agent Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement one tested lifecycle facade for local and remote agents, plus runtime race/quorum control.

**Architecture:** Keep existing executors, add a stable thread registry and fence-aware control layer, then adapt Flow runtime groups and remote RPC to that layer.

**Tech Stack:** TypeScript, Vitest, existing event log and orchestration engine, Node HTTP/JSON-RPC for the remote adapter.

**Spec:** `docs/superpowers/specs/2026-10-27-unified-agent-runtime-design.md`

## Global Constraints

- No completion report is acceptance; independent verification stays mandatory.
- A stale fence can never complete, resume, or mutate a live agent.
- Follow-up messages are idempotent.
- Remote workers cannot write the local checkout directly.
- Existing Orchestrator behavior must remain reachable until the adapter is proven.

## Review Focus

- follow-up queued exactly once across retry and restart;
- cancellation while spawn approval is pending;
- late race result after a winner;
- quorum success mixed with child failure;
- remote heartbeat loss after side effects began;
- list/wait identity collision across workspaces.

---

### Task 1: Stable Agent Thread Types And Projection

**Files:**
- Create: `src/agent/runtime-types.ts`
- Create: `src/agent/agent-thread-projector.ts`
- Create: `tests/agent-thread-projector.test.ts`

**Interfaces:**
- Produces: `AgentRecord`, `AgentMessage`, `AgentReceipt`, `AgentWaitResult`,
  `projectAgentThreads(events, workspace, sessionId): AgentThreadSnapshot`.

- [ ] **Step 1: Write failing projection tests**

Assert one logical agent accumulates multiple run ids without losing its stable id.
Assert out-of-order events and duplicate messages are idempotent.

- [ ] **Step 2: Run and verify RED**

Run: `pnpm vitest run --config tests/vitest.config.ts tests/agent-thread-projector.test.ts`

Expected: FAIL because the types and projector are absent.

- [ ] **Step 3: Implement additive projection**

Use existing `agent_*` event optional fields; add fields only where no current field
can express logical thread, fence, or message id.

- [ ] **Step 4: Run and verify GREEN**

Run: `pnpm vitest run --config tests/vitest.config.ts tests/agent-thread-projector.test.ts`

Expected: all tests pass.

### Task 2: Local Lifecycle Adapter

**Files:**
- Create: `src/agent/local-agent-runtime.ts`
- Create: `tests/local-agent-runtime.test.ts`
- Modify: `src/agent/orchestrator.ts`

**Interfaces:**
- Produces: `createLocalAgentRuntime(orchestrator): AgentRuntime`.

- [ ] **Step 1: Write failing send/resume/close tests**

Use a controlled provider. Assert one active agent accepts two follow-ups in one
thread, duplicate send returns the original receipt, stale resume is rejected, and
close waits for confirmed stop.

- [ ] **Step 2: Run and verify RED**

Run: `pnpm vitest run --config tests/vitest.config.ts tests/local-agent-runtime.test.ts`

Expected: FAIL because the adapter API is absent.

- [ ] **Step 3: Implement the adapter**

Preserve current spawn/cancel semantics. Add an in-memory idempotency map and
thread registry backed by emitted events.

- [ ] **Step 4: Run and verify GREEN**

Run: `pnpm vitest run --config tests/vitest.config.ts tests/local-agent-runtime.test.ts tests/orchestrator-wait.test.ts tests/cancel-agents-tool.test.ts`

Expected: all tests pass.

### Task 3: Model Lifecycle Tools

**Files:**
- Modify: `src/agent/session-provider.ts`
- Modify: `src/agent/tool-surface.ts`
- Modify: `src/main/agent-runner.ts`
- Create: `tests/agent-lifecycle-tools.test.ts`

**Interfaces:**
- Produces: `send_agent`, `list_agents`, `resume_agent`, `close_agent`.

- [ ] **Step 1: Write failing surface and execution tests**

Assert all four tools are visible in the main face, absent in read-only or worker
faces where applicable, and cannot target another session.

- [ ] **Step 2: Run and verify RED**

Run: `pnpm vitest run --config tests/vitest.config.ts tests/agent-lifecycle-tools.test.ts tests/tool-surface-parity.test.ts`

Expected: FAIL because the tools are absent.

- [ ] **Step 3: Implement tool specs and runtime handlers**

Route every tool through `AgentRuntime`; no second lifecycle implementation.

- [ ] **Step 4: Run and verify GREEN**

Run: `pnpm vitest run --config tests/vitest.config.ts tests/agent-lifecycle-tools.test.ts tests/tool-surface-parity.test.ts`

Expected: all tests pass.

### Task 4: Runtime Race And Quorum

**Files:**
- Create: `src/orchestration/control-node.ts`
- Create: `tests/orchestration-dynamic-control.test.ts`
- Modify: `src/orchestration/types.ts`
- Modify: `src/orchestration/flow.ts`
- Modify: `src/orchestration/engine.ts`

**Interfaces:**
- Produces: `expandRuntimeFlow(flow, bindings): RuntimeNode`.
- Engine records: `race_won`, `quorum_reached`, `late_result_rejected`.

- [ ] **Step 1: Write failing schedule/control tests**

Use deferred promises. Assert race winner selection, deterministic loser
cancellation, quorum N, any, child failure, timeout, and late-result rejection.

- [ ] **Step 2: Run and verify RED**

Run: `pnpm vitest run --config tests/vitest.config.ts tests/orchestration-dynamic-control.test.ts`

Expected: FAIL because runtime control groups are unsupported.

- [ ] **Step 3: Implement runtime group expansion and control**

Static branches still expand statically. Race/any/quorum remain explicit runtime
groups with bounded children and fenced results.

- [ ] **Step 4: Run and verify GREEN**

Run: `pnpm vitest run --config tests/vitest.config.ts tests/orchestration-dynamic-control.test.ts tests/orchestration-engine.test.ts tests/orchestration-plan.test.ts`

Expected: all tests pass.

### Task 5: Remote Execution Adapter

**Files:**
- Create: `src/orchestration/remote-backend.ts`
- Create: `src/orchestration/remote-protocol.ts`
- Create: `tests/remote-backend.test.ts`
- Create: `tests/helpers/remote-worker-server.ts`

**Interfaces:**
- Produces: `createRemoteExecutionBackend(options): ExecutionBackend`.

- [ ] **Step 1: Write failing protocol tests**

Assert capability enforcement, contract digest, deadline, heartbeat, idempotent
execute, stale fence rejection, and disconnect-to-`needs_you`.

- [ ] **Step 2: Run and verify RED**

Run: `pnpm vitest run --config tests/vitest.config.ts tests/remote-backend.test.ts`

Expected: FAIL because the remote adapter is absent.

- [ ] **Step 3: Implement the client against a local fake server**

Use Node's HTTP server in tests. Do not add a dependency. Keep secrets out of URLs
and event logs.

- [ ] **Step 4: Run and verify GREEN**

Run: `pnpm vitest run --config tests/vitest.config.ts tests/remote-backend.test.ts`

Expected: all tests pass.

### Task 6: Recovery, Documentation, And Verification

**Files:**
- Modify: `src/orchestration/engine.ts`
- Modify: `STATE.md`
- Modify: `PROGRESS.md`
- Modify: `docs/REPOSITORY-STATUS.md`
- Modify: `docs/superpowers/specs/2026-10-25-multi-agent-orchestration-platform-design.md`

- [ ] **Step 1: Add crash-recovery tests**

Assert every disconnected run becomes `needs_you`; duplicate control and late
results do not mutate state.

- [ ] **Step 2: Run focused recovery tests**

Run:

```bash
pnpm vitest run --config tests/vitest.config.ts tests/remote-backend.test.ts tests/orchestration-dynamic-control.test.ts tests/local-agent-runtime.test.ts
```

Expected: all tests pass.

- [ ] **Step 3: Update current-state docs**

Record local lifecycle, dynamic groups, and remote adapter status separately.

- [ ] **Step 4: Run full verification**

Run:

```bash
pnpm test:capped
node --import tsx scripts/typecheck.ts
pnpm docs-check
```

Expected: exit 0 with exact counts reported.

