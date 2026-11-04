# New conversation showing old history — 2026-11-03

Local uncommitted working tree, branch `fix/spec-summary-double-count`, starting HEAD `7e23cdd6d579b6cad86ae99b284cea96862f5465`. Existing unrelated changes were preserved.

User clarification: sidebar selection remains on the new conversation while the main content shows the previous conversation.

## Cause and fix

The real desktop `openSession` returns a `SessionView` for ordinary conversations as well as forks. `mergeViewEvents` begins with that view's saved entries. `newSession` cleared `events` and the active identity but left `sessionView` intact. The home screen hid the stale projection; sending the new conversation's first message revealed the old view again, with its previous local-event watermark also suppressing new content.

`useSessionOps.newSession` now clears the historical view together with local events. The existing request sequence guard still invalidates outstanding opens. No persistence, provider routing, IPC, or model configuration was changed.

## Regression evidence

The existing real-main reproduction script had created a conversation and immediately created another, never opening a saved conversation first. It also checked selection and log counts without asserting the visible transcript, so it missed this defect.

The updated script reopens the old conversation through the real sidebar before creating a new one, and asserts the main area's actual visible contents. It also covers startup restoration followed by a new conversation.

- Before fix: the two transcript checks failed, while selection and independent JSONL storage checks passed. Both failures exactly matched the user's clarification. Evidence: `red/checks.json` and `red/repro-result.json`.
- After fix: **12/12 checks passed**, zero renderer console errors, using real Electron main/preload/renderer and local JSONL storage with an offline scripted demo provider. Evidence: `green/checks.json`, `green/repro-result.json`, `green/01-final.png`.
- Targeted desktop tests: **5 files, 84 tests passed**, one worker.
- Full desktop suite: **317 files, 2182 tests passed**, one worker.
- Production desktop build and root typecheck passed; existing deleted Inter/JetBrains Mono asset warnings remain.
- Renderer layering, core/desktop dependency boundary, and scoped tracked-file whitespace checks passed.
- OCR delegate preview and rule resolution ran. Current agent reviewed the scoped diff against those rules; model-backed OCR review/scan did not run. No remaining actionable finding in this scope.

Reproduction: `env -u ELECTRON_RUN_AS_NODE pnpm --filter cairn-desktop exec electron scripts/repro-new-session-jump.cjs <output-directory>`. Build first with `pnpm --filter cairn-desktop build`. Logs and pre-edit comparison: `.tmp/new-chat-history-20261103/`.

This evidence covers the local working tree and offline desktop flow, not a packaged release or real-provider run. No commit or deployment was made.
