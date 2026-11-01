# Session preferences isolation

**Goal:** workspaces containing the same session id keep separate model/thinking choices in memory, saved state and actual run requests.

**Approach:** reuse the renderer's existing workspace/session key. Persist preferences next to the exact session log as `<log>.prefs.json`, with the existing atomic-write and root-mutation mechanisms. Keep old metadata untouched; inherit old preferences only when the session id has one registered owner. An explicitly empty preference file masks legacy defaults. Rename/delete move or stage the new sidecar in the existing session transaction.

**Alternatives:** extending global metadata with workspace maps makes rollback, rename and delete operate across unrelated workspaces; rewriting all metadata addressing expands this fix into a larger migration. A session-local sidecar reuses the existing queue-sidecar lifecycle without rewriting old files or adding dependencies.

**Scope:** preference persistence and projections, desktop IPC routing, renderer choice/read/run keys, sidecar lifecycle and regression tests. Event logs, other metadata organization fields, global defaults and protocol signatures retain their existing contracts.

- [x] Reproduce and test memory-key collisions and two-root saves before changing production code.
- [x] Add validated atomic session preference sidecars; route desktop saves and lists through exact registered workspaces.
- [x] Cover rename/delete and rollback before extending the existing sidecar transaction.
- [x] Use workspace/session keys for model/thinking hydration, picker reads, new-session seeding and run requests; forward workspace through IPC.
- [x] Review using OCR delegate rules; run scoped regressions, capped suites, typecheck/build/boundaries/docs and record evidence. Core: 583 files / 7428 tests with 1 worker; desktop: 276 files / 1837 tests with 2 workers. Earlier concurrent-run failures are retained in the evidence report.

Acceptance includes independent same-id saves, fresh-host reads, no copying ambiguous legacy choices, explicit clears, preservation of the other workspace, malformed sidecars failing visibly, rename/delete rollback, and actual emitted run requests using the selected workspace's preferences. Same-id runs from different workspaces remain serialized: a second workspace is rejected without steering into the first run, and opening another workspace does not change the active run's ownership.
