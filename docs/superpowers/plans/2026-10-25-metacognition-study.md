# Cairn Metacognition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Correct native reasoning state handling, establish an independently judged task pilot, and evaluate minimal evidence-triggered interventions before enabling any production strategy.

**Architecture:** Preserve provider-native state with endpoint/model provenance through existing event fields and context projection. Reuse the existing runLoop/createSessionProvider/loop-eval assembly. Experimental intervention policies and randomized comparisons remain opt-in and isolated from production defaults.

**Tech Stack:** TypeScript, existing Node/Vitest, Python standard library for corpus curation and credential-in-memory process launch; no new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-25-metacognition-study-design.md` (research route approved by the user with “按照你建议的顺序开始全部推进”).

## Global Constraints

- Real task completion and reliability take priority over cost and speed.
- Do not modify permissions, acceptance/judge rules, agent rules, global settings, or existing frozen fixtures.
- No new event kind; native reasoning metadata uses an existing event's optional field.
- Production defaults do not acquire experimental reflection behavior.
- Preserve unrelated edits. Isolated worktree contains a recorded foreign baseline; only this plan's delta may be integrated, never commit the foreign baseline.
- Credentials stay in the evaluation process memory; never write them to code, config, events, or reports.
- Endpoint/model: user supplied local endpoint and `cn:deepseek-v4.1-flash`. User authorized an unbounded monetary ceiling with a bounded pilot; record token/call/time use and never infer prices from missing data.

## Review Focus

- Native reasoning state must survive tool results, multiple calls, projection and replay, while remaining absent from normal assistant text and unrelated model/endpoint requests.
- Explicit off versus upstream default must be distinguishable in native probes and experiment receipts; do not claim a gateway executed a requested field merely because HTTP succeeded.
- Retry/truncation/cancellation must not splice partial reasoning from another attempt into a tool call.
- Interventions must be bounded, deduplicated, evidence-based, and incapable of bypassing approval or changing judges.
- Pilot outcomes must retain all task denominators, hidden/regression outcomes and failed attempts; small or saturated samples cannot establish equivalence or general improvement.

## Task 1: Native reasoning contracts

**Files:** `src/providers/openai.ts`, `src/providers/index.ts`, `src/providers/glm.ts`, `src/providers/registry.ts`, `src/events/types.ts`, `src/agent/context.ts`, `src/agent/session-provider.ts`; new `tests/reasoning-continuity.test.ts`; targeted existing tests unchanged unless adding assertions.

**Interfaces:** Existing ToolCallEvent and ProviderMessage gain optional `reasoning` state `{ source: string; content: string }`, where source binds protocol endpoint and model. `streamOpenAI` records returned native reasoning for tool replies and only replays matching provenance. Explicit off reaches native transport; recognized native DeepSeek uses its documented switch, unknown endpoints retain legacy behavior and remain unverified in receipts.

- [x] Write failing stream/non-stream continuation, cross-model/endpoint, plain-text isolation, worker isolation and explicit-off tests; observe the intended failures.
- [x] Implement the minimal state and transport changes, including reported reasoning token counts as optional data where provided.
- [x] Verify red→green against production functions, then run provider/context/loop regression scope.
- [x] Authenticated native pilot probe: default/low/high/off behavior and actual tool continuation. Record unsupported/ignored controls explicitly.

## Task 2: Representative, independently judged baseline

**Files:** New `scripts/metacognition-study.ts`, supporting pure evaluation helpers under `src/agent/eval/` only as needed; add opt-in hooks/flags to `scripts/loop-eval.ts`; new task snapshots under a new non-frozen corpus directory; new behavioral tests.

**Interfaces:** Existing TaskSpec shape and runLoop assembly remain authoritative. Experiment manifest records requested strategy, model, code/input hashes, order, resource limits, actual attempts and judge outcomes; credential and hidden judge material never enter the model context.

- [x] Test parser/manifest and independent positive/negative judge controls before implementation.
- [x] Reuse existing real-task capabilities first, add new independent pilot tasks for gaps rather than renaming identical chain assertions as tasks.
- [x] Verify each task's seeded failure, reference repair and negative controls; hash and freeze before model trials.
- [x] Run an initial bounded task pilot and inspect task difficulty, failures and costs before expanding coverage.

## Task 3: Minimal intervention experiment and decision

**Files:** Pure experimental policy under `src/agent/eval/`, opt-in evaluation wiring, randomized study driver and result analyzer; tests for observable decisions and end-to-end execution.

**Interfaces:** Evidence→decision uses existing tool/verify/user events. Baseline does not get new instructions. Triggered/fixed/reminder/random controls share tool surface, permissions, starting snapshot and resource ceiling. Every extra call is counted.

- [x] Write failing tests for actual failure-triggered replanning, no trigger during healthy execution, environment-failure handling, steering reset, deduplication and budget exhaustion.
- [x] Implement a minimal opt-in policy and wire it into the real evaluation assembly with no production-default change.
- [x] Run controlled real-model pilot with randomized order; include high-budget and matched-frequency controls as feasible. Log any missing comparison as a limitation.
- [x] Analyze per-task completion, protected regressions, false completion, recovery, calls/tokens/time and paired differences; do not claim general gain from a saturated or tiny sample.
- [x] Whole-delta fresh review using OCR delegate routing; fix actionable issues, verify appropriate core tests/typecheck/boundaries/docs, and integrate only our reviewed delta under baseline hash guards.
- [x] Deliver code, experiment artifacts, exact verification boundaries and deployment decision. Retain resumable instructions for any external blocker.

## Completion boundary

Completed the authorized bounded pilot: 6 historical tasks, 30 frozen-v1 trajectories, separate 1-trajectory v2 acceptance. The larger >=24-task confirmatory study remains a future adoption condition, not a completed capability claim. No experimental strategy was enabled by default. See [final results](../../research/metacognition-pilot-2026-10-25.md).
