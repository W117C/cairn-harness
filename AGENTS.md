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
- Desktop suite: `pnpm --filter cairn-desktop test` uses its own config and checks the boundary.
- Before handing off changes: `node --import tsx scripts/typecheck.ts`.
- Core/desktop dependency changes: `pnpm desktop-boundary-check`.
- Rule or documentation changes: `pnpm docs-check`.
- Full gates: `pnpm gates`. The current manifest is `scripts/gate-manifest.ts`; it includes
  desktop tests and HEAD checks. A core-only test run does not prove the desktop passes.

## HEAD verification

- `pnpm mutate-verify` measures **HEAD, not the working tree**, in a disposable worktree.
  The change must be committed before this command can verify it. Never run mutation
  tests in the main checkout or bypass the script's isolation guard.
- `pnpm head-cert-check` also checks a commit. Record the measured commit and confirm it
  contains the change before citing either command as evidence for this task.
- Report the checks actually run, real assertion/test counts, failures, skipped or
  unverified items, and whether the evidence covers the working tree or a commit.
