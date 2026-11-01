# Cairn agent product completion implementation plan

> **For agentic workers:** Use superpowers:executing-plans in this session. The user authorized direct execution using the implementer's judgment.

**Goal:** Repair the configuration, request and delivery paths needed for a usable local coding agent.

**Architecture:** Reuse the existing encrypted backend, environment injector, application runner and project exporter. Keep Electron outside core and avoid new dependencies.

**Tech Stack:** TypeScript, Node.js, Electron, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-28-agent-product-completion-design.md`

## Global Constraints

- Preserve unrelated working-tree changes; no rule edits or weakened checks.
- Unknown-provider writes remain rejected; external env takes priority.
- Store failures preserve existing bytes; export cannot overwrite user files.
- Evidence distinguishes deterministic tests, real Electron and real providers.

## Review Focus

- Provider ciphertext for an unloaded workspace must survive saves elsewhere.
- Concurrent save/delete and failed reads must not lose or poison later updates.
- A refreshed key must not overwrite an externally changed environment variable.
- Explicit false in a run request must override a true default.
- Export destination aliases, broken links and a directory inside the source must fail safely.

### Task 1: Reliable provider configuration

**Files:** `src/main/provider-keys.ts`, `src/main/provider-key-inject.ts`,
`src/main/settings-handlers.ts`, `src/providers/provider-identifiers.ts`,
`src/providers/provider-config.ts`, `src/main/provider-setup.ts`,
`apps/desktop/src/main/index.ts`; new regression tests under `tests/`.

**Interfaces:** Preserve put/get/delete/status and injection signatures. Reuse the provider id grammar for persisted entries without authorizing unregistered writes.

- [x] Reproduce lost concurrent writes, corrupt-store overwrite, unloaded custom keys and stale injected keys.
- [x] Serialize encrypted-store operations, distinguish ENOENT from failure, preserve valid unloaded entries.
- [x] Track only Cairn-owned environment injections; await refresh after save/delete in shared handlers.
- [x] Run provider regression and existing provider suites with `--maxWorkers=2`.
- [x] Keep custom-provider setup's credential activation after the configuration commit; revoke old provider-owned env mappings on remap/delete.

### Task 2: Core request semantics

**Files:** `src/main/agent-runner.ts`; new production-entry regression test.

**Interfaces:** `handleAgentRun(req, over)`; plan precedence is override → request → settings.

- [x] Reproduce required-plan bypass at the shared core entry; include both true and false requests.
- [x] Apply nullish precedence at the assembly point; keep pending-plan and permission semantics.
- [x] Run new regression plus existing plan and runner tests.

### Task 3: Portable project delivery

**Files:** `src/main/project-export.ts`; new export regression tests.

**Interfaces:** Preserve `exportProject` result shape and reason categories.

- [x] Reproduce invalid names, export inside the source, source/parent aliases and nonportable symlinks.
- [x] Validate before creating the destination, preserve no-overwrite behavior, clean only this operation's partial output.
- [x] Run export and project tests; verify valid copies and exclusions still work.

### Task 4: Integration and next product slice

- [x] Review task-specific diff with OCR delegate rules; agent performs the review.
- [x] Run typecheck, capped core, desktop tests/build and real Electron smoke sequentially.
- [x] Record pre-existing failures separately and investigate any new failures.
- [x] Leave exact files, commands, results and remaining product acceptance in a handoff record.
- [ ] Continue the goal until remaining product boundaries are resolved; do not equate this repair batch with product readiness. This is a standing goal: Task 5 closes the local package; the boundaries enumerated in the report (`完整产品的后续验收`) stay open until real-provider, notarization, stable-keychain and cross-platform evidence exist.

### Task 5: A self-contained desktop package

**Files:** `apps/desktop/scripts/package.mjs`, `package.json`, `pnpm-lock.yaml`,
`README.md`; tests in `tests/desktop-package.test.ts`.

**Interfaces:** `pnpm --filter cairn-desktop package --out <new-directory> [--no-archive]`;
`makeRuntimePackage(sourceManifest)` retains the source version/module type and production dependencies.

- [x] RED: help and argument validation work without build tools; existing output is preserved; runtime identity includes version/type and excludes development tools.
- [x] Move the already-installed `tsx` loader into production dependencies without changing its locked version; whitelist runtime files for deployment.
- [x] Reuse native pnpm deployment with a dedicated lockfile and normal policy verification; preserve the source/fixture layout required by the core.
- [x] Build in a temporary directory and publish only after signing and packaged Electron smoke pass; never clear a prior release on failure.
- [x] Verify the resulting app outside the source tree, audit links and runtime tools, and record any external dependency that prevents an actual package.

### Verification notes

- The first real packaged smoke exposed an IPC trust defect: the window loaded, but every
  `window.agent` call was rejected because `app.getAppPath()` is `Resources/app` while the shell
  lives at `Resources/app/apps/desktop/dist`. `shellAppPath(mainDir)` now derives the shell root
  from the main entry; the regression test in `apps/desktop/tests/main-hardening.test.ts` fails
  when the old wiring is restored.
- Ad-hoc re-signing changes the CDHash on every build, so the first real-keychain lookup blocks
  on the ACL decision. The packaged smoke uses Chromium's `--use-mock-keychain`; it still exercises
  the safeStorage path. A stable Developer ID signature and a real first-run keychain approval
  remain unverified.
- The artifact is `apps/desktop/release/` (gitignored); evidence is
  `outputs/agent-product-completion-2026-10-28/`; the ledger record is PROGRESS page 753.

**Research:** pnpm's official deploy documentation describes an isolated, portable dependency tree.
The local 11.21.0 command supports dedicated deployment via `injectWorkspacePackages`.
An offline probe failed because registry policy metadata was absent; do not disable policy checks to force it through.
