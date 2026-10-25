# DSH core

This repository contains the agent/core (`src/`, electron-free) plus a desktop shell under `apps/desktop/`. The desktop layer was removed by explicit request on 2026-09-27 and reintroduced as new M1 slices on 2026-10-02; its disposition is decided in [`adr/0001-core-only-vs-desktop.md`](adr/0001-core-only-vs-desktop.md).

## Documentation layers

| Layer | File | Holds |
|---|---|---|
| Rules | [`../AGENTS.md`](../AGENTS.md) | what you would get wrong this turn without them |
| Current state | [`../STATE.md`](../STATE.md) | where the work stands, what is in flight, what is undecided — **rewritten wholesale** |
| Ledger | [`../PROGRESS.md`](../PROGRESS.md) | one page per batch, appended only; page numbers are the citation unit |
| Archive | [`../archive/`](../archive/) | conclusions that are no longer current |

`docs-check` enforces the layer rules mechanically (D-1 budget, D-2 no hand-copied measurements,
D-4 no append-to-refute, D-5 `STATE.md` names a real commit).

Useful entry points:

- [`ROADMAP.md`](ROADMAP.md) — branch roles, unfinished work, queued work, and optimization priorities
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
