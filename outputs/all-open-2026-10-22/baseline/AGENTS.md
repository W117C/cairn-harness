# Cairn / DSH repository

## Documentation layers

- `AGENTS.md` (this file) — rules only: what you would get wrong this turn without them. Add new
  rules here; do not append paragraphs that argue with the old ones.
- `STATE.md` — the current state: where the work stands, what is in flight, what is undecided.
  **Rewritten wholesale, never appended to.** Measured numbers do not belong here — point at
  `pnpm facts` instead.
- `PROGRESS.md` — the ledger: one page per batch, appended only, never rewritten. Page numbers are
  the citation unit.
- `archive/` — where conclusions that are no longer current go.
- `docs/README.md` / `docs/CODE-WIKI.md` — entry points and the symbol-name index (also current-layer
  pages, under the same two rules as `STATE.md`).

`docs-check` enforces these mechanically: D-1 (byte budget), D-2 (no hand-copied measurements in the
current layer), D-4 (no append-to-refute in the current layer), D-5 (`STATE.md` must name a real commit).

## Architecture

- The agent/core lives in `src/` and stays free of Electron and UI imports, including
  application services under `src/main/` used by the core runner.
- The desktop layer lives in `apps/desktop/` (main, preload, renderer, build chain).
  It may import from `src/`; the reverse dependency is forbidden. Shared IPC types live
  in `src/main/ipc-protocol.ts`. `scripts/desktop-boundary-check.ts` enforces the boundary.

## Working tree

- Inspect the relevant diff before editing. Preserve unrelated dirty changes from other
  sessions; do not reset or stash them, or include them in a commit for this task.
- Do not modify frozen judge files or fixtures, weaken assertions, or lower verification
  requirements to make a failing check pass.

## Verification

Run commands from the repository root. Start with checks covering the changed behavior.

- Core suite: `pnpm test` uses `tests/vitest.config.ts` and does not collect desktop tests.
  On an 8 GB machine the default worker count oversubscribes the box: the run then reports
  timeouts (`Test timed out`, Chrome render timeouts) that are **load artifacts, not logic
  regressions** — every one of them passes when run alone. For a reproducible full-suite
  reading on such a host, cap the workers and quote that command:
  `pnpm test:capped` (＝`vitest run --config tests/vitest.config.ts --maxWorkers=2`).
  Always state the concurrency level next to a core-suite count; a count without it is
  not a reproducible reading.
- Desktop suite: `pnpm --filter cairn-desktop test` uses its own config and checks the boundary.
- Before handing off changes: `node --import tsx scripts/typecheck.ts`.
- Core/desktop dependency changes: `pnpm desktop-boundary-check`.
- Rule or documentation changes: `pnpm docs-check`.
- Full gates: `pnpm gates`. The current manifest is `scripts/gate-manifest.ts`; it includes
  desktop tests and HEAD checks. A core-only test run does not prove the desktop passes.

## Renderer layering

- The desktop renderer is layered: `state/` (state-cluster hooks) → `derived/` (pure projections) →
  `components/` + `panes/` (props in, events out) → `App.tsx` (composition root).
  The machine face is `pnpm renderer-layer-check`; the rules it pins:
  - `components/` and `panes/` must not import `App.tsx`; `state/` must not import `components/`.
  - `derived/` is pure: no IO, no clock, no randomness, no module-level mutable state.
  - Line caps: every renderer source file ≤ 1,200 lines, and `App.tsx` ≤ 900 lines. A cap only
    ratchets down. When a file must grow past its cap, split it first.
- A judge that asserts on renderer **source text** must read the whole app surface
  (`apps/desktop/tests/helpers/app-surface.ts`), not one file. Pointing such a judge at a single file
  makes a `not.toContain` assertion pass vacuously the moment the code moves — a vacuous pass is a
  weakened assertion, not a passing one. This holds for any "assert on source" judge.

## Event log

- A new event kind is only allowed for a **log-structural control record** (a record about the log
  itself — a rewind pointer, a metadata patch). Anything that describes **what the agent did** goes
  through an existing event's optional field. See `docs/adr/0005-log-structural-records.md`.
- `replay()` stays dumb and verbatim: it returns logged events as they are, control records included.
  Interpreting control records is a projection's job, never `replay()`'s. That is what keeps "a JSONL
  replays byte-identically" and "event id = 1-based line number" true at the same time.
- A session fork is a **pointer, not a copy**: it records `{parent, boundary}`, does not copy the
  parent's events, and does not inherit the parent's in-flight state.
- Cursors are opaque and **fail closed**: an unsupported cursor kind, a malformed cursor, a cursor
  whose session does not match, and an out-of-range position are all rejected. Never substitute a
  different cursor for a bad one.
- A provider/tool submission carries a `requestId` idempotency key: resubmitting the same
  `requestId` returns the existing submission and does not execute the work a second time.

## HEAD verification

- `pnpm mutate-verify` measures **HEAD, not the working tree**, in a disposable worktree.
  The change must be committed before this command can verify it. Never run mutation
  tests in the main checkout or bypass the script's isolation guard.
- `pnpm head-cert-check` also checks a commit. Record the measured commit and confirm it
  contains the change before citing either command as evidence for this task.
- Report the checks actually run, real assertion/test counts, failures, skipped or
  unverified items, and whether the evidence covers the working tree or a commit.
