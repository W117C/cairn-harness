# Documentation map

This checkout is core-first. The desktop shell lives in `apps/desktop/` (reintroduced 2026-10-02; see `adr/0001-core-only-vs-desktop.md`); root gates do not scan `apps/`.

| Area | Location |
|---|---|
| Agent loop | `src/agent/` |
| Events | `src/events/` |
| Tools | `src/tools/` |
| Permissions | `src/permissions/` |
| Providers | `src/providers/` |
| Routing | `src/routing/` |
| Headless application services | `src/main/` |
| Tests | `tests/` |
| Core checks | `scripts/` |
