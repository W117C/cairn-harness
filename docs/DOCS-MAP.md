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
| Request-lifecycle diagram | `outputs/request-lifecycle-2026-10-08/request-lifecycle.html` |

The request-lifecycle diagram traces one `agent:run` from the renderer through the preload bridge,
Electron main, `KernelHost`, `runAgent`, `runLoop`, the permission gate, the tool surface, and the
session JSONL back to the renderer. Its cards cite source locations by **symbol name**, not line
number (`docs-check` D-3/`docs/CODE-WIKI.md`)。Rebuild it with:

```sh
node "$ARCHIFY/bin/archify.mjs" finalize sequence \
  outputs/request-lifecycle-2026-10-08/request-lifecycle.candidate.json \
  outputs/request-lifecycle-2026-10-08/request-lifecycle.html --quality showcase --json
```

The artifact is byte-reproducible from its candidate; regenerate rather than hand-editing the HTML,
because its `delivery.json` sidecar notarizes the artifact sha256.
