# DSH core-only repository

This checkout intentionally contains the agent/core only. The desktop layer has been removed:
there is no Electron entry, preload, renderer, or desktop build configuration in this tree.

## Scope kept

- `src/agent/`, `src/events/`, `src/tools/`, `src/permissions/`, `src/providers/`, `src/routing/`
- electron-free application services under `src/main/` that are imported by the core runner
- core tests, fixtures, and headless verification scripts

## Working rules

- Do not reintroduce Electron, `src/renderer/`, `src/preload/`, or desktop-only gates without a new explicit request.
- Keep core modules free of UI and Electron imports.
- Run `node node_modules/vitest/vitest.mjs run --config tests/vitest.config.ts` for the full core suite.
- Run `node --import tsx scripts/typecheck.ts` before handing off changes.
- Do not modify frozen judge files or fixtures as a workaround.
- Preserve unrelated dirty changes from other sessions; do not reset or stash them.
