# Session lock stability implementation plan

> Execute inline; OCR delegate resolves scope and rules, and the current agent reviews the patch.

**Goal:** prevent concurrent recovery of a stale session run lock from admitting multiple writers.

**Design:** move the existing root mutation mutex into `session-mutation-lock.ts`, preserving the exports from `session-repository.ts`. Acquire/reclaim run locks under that same short critical section. Keep the run lock held throughout the run, without holding the root mutex throughout the run. Decode lock records defensively and make release idempotent.

Cross-process contention on the short root critical section receives bounded retries. A real four-process regression must allow four distinct sessions to start, while allowing only one writer to the same session. Stale root locks remain fail-closed and are never removed automatically.

**Constraints:** preserve unrelated dirty work; add no dependencies; preserve event and IPC contracts; do not auto-delete stale root mutation locks; do not claim network-filesystem, Windows, real-provider or release certification.

**Alternatives:** a new lock dependency adds a different stale-timeout/heartbeat policy; a second custom recovery lock duplicates the existing root mutex. Reusing the existing mutex also coordinates run startup with rename/delete.

## Tasks

- [x] Add regression tests for malformed records, simultaneous stale-lock recovery, and refusal while the root mutation lock is held; observe failures before implementation.
- [x] Extract the root mutex without changing its existing public exports; route run-lock acquisition through it, validate positive PID records, and prevent duplicate release calls from deleting a later generation.
- [x] Reproduce non-default workspace preference saves and ignored `{ ok: false }` replies before fixing both paths; reuse the session root resolver and one response-checking helper for model/thinking saves.
- [x] Run session/compact/CLI regressions, capped core and desktop suites, typecheck and boundary checks; inspect all failures.
- [x] Review the scoped patch under OCR delegate rules and record current evidence and remaining gaps.

## Review focus

- Root mutex must cover stale-lock inspection, cleanup, creation and owner-record write.
- Releasing a run must not require holding a root mutex for the run's lifetime.
- Invalid JSON values must not throw or accidentally target a process group via PID zero.
- Existing root-lock crash policy and module initialization must remain intact.
- Public imports from `session-repository.ts` must keep working without a new module cycle.
