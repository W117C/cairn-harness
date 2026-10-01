# DSH core-only repository

This checkout intentionally contains the agent/core only. The desktop layer has been removed:
there is no Electron entry, preload, renderer, or desktop build configuration in this tree.

## Scope kept

- `src/agent/`, `src/events/`, `src/tools/`, `src/permissions/`, `src/providers/`, `src/routing/`
- electron-free application services under `src/main/` that are imported by the core runner
- core tests, fixtures, and headless verification scripts

## Working rules

- Desktop layer lives in `apps/desktop/` only. It may import from `src/` (typed via
  `src/main/ipc-protocol.ts`); `src/` must never import from `apps/desktop/`, Electron, or any UI
  module. `scripts/desktop-boundary-check.ts` enforces this.
- Run desktop tests with `pnpm --filter m0-desktop test` (own vitest config); root gates never
  scan `apps/`.
- Keep core modules free of UI and Electron imports.
- Run `node node_modules/vitest/vitest.mjs run --config tests/vitest.config.ts` for the full core suite.
- Run `node --import tsx scripts/typecheck.ts` before handing off changes.
- `pnpm mutate-verify` measures **HEAD, not the working tree**. It re-execs itself into a disposable
  worktree, because that gate edits source files in place and its cleanup cannot survive a timeout
  (a killed run leaves mutants and `.mutbak` files behind in `src/`). To mutation-verify an
  uncommitted change, commit it first. Running the script directly in a main checkout is refused
  rather than run in place.
- Do not modify frozen judge files or fixtures as a workaround.
- Preserve unrelated dirty changes from other sessions; do not reset or stash them.
