# Cairn repository rules

Rules only: what you would get wrong this turn without them.

## Architecture

- The agent/core lives in `src/` and stays free of Electron and UI imports, including
  application services under `src/main/` used by the core runner.
- The desktop layer lives in `apps/desktop/` (main, preload, renderer, build chain).
  It may import from `src/`; the reverse dependency is forbidden. Shared IPC types live
  in `src/main/ipc-protocol.ts`. `scripts/desktop-boundary-check.ts` enforces the boundary.

## Working tree

- Inspect the relevant diff before editing. Preserve unrelated dirty changes from other
  sessions; do not reset or stash them, or include them in a commit for this task.
- Do not modify frozen fixtures, weaken assertions, or lower verification requirements
  to make a failing check pass.

## Verification

Run commands from the repository root. Start with checks covering the changed behavior.

- Fast full check for a PR: `pnpm verify` (typecheck + core tests + desktop tests + the
  public product-contract gates declared by `PUBLIC_GATES`).
- Core suite alone: `pnpm test` uses `tests/vitest.config.ts` and does not collect desktop tests.
  On an 8 GB machine the default worker count oversubscribes the box: the run then reports
  timeouts that are **load artifacts, not logic regressions**. For a reproducible full-suite
  reading on such a host use `pnpm test:capped` (`--maxWorkers=2`) and quote that command.
- Desktop suite alone: `pnpm --filter cairn-desktop test` uses its own config and checks the boundary.
- Typecheck alone: `pnpm typecheck`.
- A core-only test run does not prove the desktop passes.

## Renderer layering

- The desktop renderer is layered: `apps/desktop/src/renderer/state/` (state-cluster hooks) →
  `apps/desktop/src/renderer/derived/` (pure projections) → `apps/desktop/src/renderer/components/` +
  `apps/desktop/src/renderer/panes/` (props in, events out) → `App.tsx` (composition root).
  `pnpm renderer-layer-check` pins the rules:
  - `apps/desktop/src/renderer/components` and `apps/desktop/src/renderer/panes` must not import `App.tsx`;
    `apps/desktop/src/renderer/state` must not import `apps/desktop/src/renderer/components`.
  - `apps/desktop/src/renderer/derived` is pure: no IO, no clock, no randomness, no module-level mutable state.
  - Line caps: every renderer source file ≤ 1,200 lines, and `App.tsx` ≤ 900 lines. A cap only
    ratchets down. When a file must grow past its cap, split it first.
- A test that asserts on renderer **source text** must read the whole app surface
  (`apps/desktop/tests/helpers/app-surface.ts`), not one file. Pointing such a test at a single file
  makes a `not.toContain` assertion pass vacuously the moment the code moves — a vacuous pass is a
  weakened assertion, not a passing one.

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

## Design-system parity

- `apps/desktop/src/renderer/vendor/cds-official/tokens.css` is Claude's own @ant/cds token
  sheet, vendored **byte-for-byte** (source + sha256 in `UPSTREAM.json` beside it). Never hand-edit
  it — re-extract instead; `apps/desktop/tests/cds-parity.test.ts` fails on any digest or name-count drift.
- `cds-adapter.css` **maps, never copies**: every right side is `var(--official)` or
  `from var(--official) h s l`. A literal there silently decouples us from upstream.
- Never write `--x: var(--x)` — a CSS self-reference is a cycle: the declaration is dropped and the
  consumer gets an empty value. When both sides define the same name, let the official one win.
- Cairn colours are HSL triplets (`hsl(var(--bg-100))`); CDS emits whole colours. Bridge with
  relative colour rather than rewriting the ~900 call sites.
- CDS dark mode is scoped by `[data-mode="dark"]`, Cairn's theme writes `data-theme`. Write both
  (`themeKeysOf`) or dark silently falls back to light.
- Acceptance is a **measured** `getComputedStyle` read from the real renderer
  (`apps/desktop/scripts/cds-values-probe.cjs`), not CSS text that looks right.

## Release verification (maintainers)

- `pnpm mutate-verify` measures **HEAD, not the working tree**, in a disposable worktree.
  The change must be committed before this command can verify it.
- `pnpm head-cert-check` also checks a commit. Record the measured commit and confirm it
  contains the change before citing either command as evidence.
- Report the checks actually run, real assertion/test counts, failures, skipped or
  unverified items, and whether the evidence covers the working tree or a commit.
