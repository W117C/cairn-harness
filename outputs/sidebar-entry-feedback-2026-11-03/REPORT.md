# Sidebar feedback — 2026-11-03

Local, uncommitted working-tree change in `/Users/ze/Downloads/Cairn/cairn`, branch `fix/spec-summary-double-count`, starting HEAD `7e23cdd6d579b6cad86ae99b284cea96862f5465`. Unrelated existing changes are preserved.

- Removed the inner input's inherited global focus glow; the sidebar search container now owns one visible neutral focus border.
- Removed the footer service badge in all provider states, along with its unused CSS. Demo mode remains clearly labelled in the title bar.
- Changed the tiny right-hand avatar into one left-aligned full-width user-menu trigger, with an avatar, “设置与偏好” label, and upward chevron. Existing settings, theme, motion, usage, about, and update actions remain wired through the same menu.
- Updated tests and the continuity smoke assertion to match the requested removal and new entry shape. New SSR checks failed before the fix, then passed.

Verification (working tree):

- Desktop suite, one worker: 317 files / 2182 tests passed.
- Targeted sidebar/render/demo/contrast tests, one worker: 6 files / 107 tests passed.
- Production desktop build and root typecheck passed. Build still reports the pre-existing missing Inter/JetBrains Mono assets that were already deleted at task start.
- Renderer layering and core/desktop dependency boundary checks passed.
- Isolated production Electron renderer with synthetic AgentApi: 41/41 checks passed across light/dark themes and 1440/900 widths. Verified computed input shadow/outline, real filtering, two-stage Escape handling, wide entry geometry, keyboard menu activation/focus return, popup containment, and opening settings. Zero renderer console errors.
- Update notice/menu smoke: 8/8 passed, including update indicator and opening About from the updated user entry.
- Session continuity smoke passed with real local main/preload/renderer and JSONL storage, using an offline scripted demo provider. See `continuity/checks.json`; no real provider calls or user data involved.
- Visual screenshots inspected for light/wide and dark/narrow search and user-menu states.
- Design detector ran once; only two pre-existing width-transition warnings outside this change (styles.css lines 159 and 174).
- OCR delegate preview/rules were used; current agent reviewed the scoped diff. No model-backed OCR review/scan was invoked. No actionable finding remains in this scope.

Evidence is adjacent (`validation.json`, `source-hashes.json`, screenshots, and update/continuity subdirectories); reproduction helper and logs are in `.tmp/sidebar-entry-feedback-20261103/`. This is local UI evidence, not a commit, package, release, or real-provider certification.
