# DSH core

This repository currently contains the agent/core only. Desktop UI, Electron packaging, preload, renderer, and desktop acceptance material were removed by explicit request.

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
