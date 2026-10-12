# DSH core

This repository contains the agent/core (`src/`, electron-free) plus a desktop shell under `apps/desktop/`. The desktop layer was removed by explicit request on 2026-09-27 and reintroduced as new M1 slices on 2026-10-02; its disposition is decided in [`adr/0001-core-only-vs-desktop.md`](adr/0001-core-only-vs-desktop.md).

Useful entry points:

- `src/agent/loop.ts` — agent loop
- `src/tools/` — tool implementations
- `src/providers/` — provider adapters
- `src/permissions/` — permission policy
- `src/main/agent-runner.ts` — electron-free application runner
- `tests/` — core tests

Run the core test suite with:

```sh
node node_modules/vitest/vitest.mjs run --config tests/vitest.config.ts
```
