# Cairn / DSH repository

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
