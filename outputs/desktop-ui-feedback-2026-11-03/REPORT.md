# Desktop UI feedback — 2026-11-03

Scope: current shared dirty working tree at `fix/spec-summary-double-count`, HEAD `7e23cdd6d579b6cad86ae99b284cea96862f5465`. Changes are uncommitted. Existing unrelated edits were preserved. No new dependencies, global settings, agent rules, or user memory were changed.

## Changes

- Composer: replace the spinning loader in the stop action with a static, high-contrast stop square; cancellation handler and keyboard shortcut remain intact.
- Automation: compact 640px form, labels above fields, prompt first, aligned schedule/permission controls, native time and numeric inputs, consistent weekday controls, separate footer actions. Existing empty/form mutual exclusion is preserved.
- Command palette: retain the existing removal of the inner input glow; increase the search-row focus underline contrast.
- Clarification: the old `.q-free` styling targeted a wrapper, leaving its input with browser defaults. Replace it with a full-width multiline textarea and a restrained focus border; answer submission remains verbatim.
- Errors: retain the existing 6500ms lifetime; fix full lifetime reset after a hovered message changes and independent hover/focus pause state. Focus movement within the strip does not resume the timer.
- Memory: readable scope groups, book icon/name/preview hierarchy, row separators, truncated long names with hover text, less duplicate metadata in details, and no empty pending-reference section. Existing search/filter/export/delete APIs are preserved.

## Verification

- Full desktop suite, `pnpm --filter cairn-desktop exec vitest run --config vitest.config.ts --maxWorkers=1`: **317 files, 2181 tests passed**. Ran before the last form alignment/empty-reference visibility adjustment; the final targeted run below covers the changed components.
- Final targeted suite (ErrorStrip, Composer running/usage, AppPage, memory list, automation edit/closed): **7 files, 71 tests passed**, one worker.
- New regression tests initially failed for the three reproduced defects (stop glyph and two timer edge cases), then passed with the fixes. The old spinner-specific source assertion was updated for the requested stop glyph; test count/assertion coverage was retained.
- Final desktop production build: passed. Existing missing InterVariable/JetBrainsMonoVariable font warnings remain from unrelated deleted assets already present at task start.
- Final `node --import tsx scripts/typecheck.ts`: passed, zero errors.
- `pnpm renderer-layer-check`: passed (184 renderer source files).
- `pnpm desktop-boundary-check`: passed.
- `git diff --check` for scoped tracked files: passed.
- Production Electron renderer, isolated synthetic AgentApi, dark/light × 1440/900 widths: **50/50 checks passed**, zero renderer console errors. Checked task creation payload, matching input/select heights, overflow, memory details, stop cancellation, multiline answer submission, command-palette focus, and actual disappearance of an error after 6.5 seconds.
- Screenshots were visually inspected in two batches; final form control alignment and weekday labels were corrected in the single intervening batch.
- Design detector ran once: two pre-existing width-transition warnings at styles.css lines 159 and 174, outside this change.
- Review used `ocr delegate preview --exclude ...` and `ocr delegate rule` for the scoped product files. The current agent reviewed the scoped changes against those rules; OCR model-backed review/scan commands were not run. No remaining actionable finding in this scope.

## Evidence and limits

`validation.json` contains runtime checks, `source-hashes.json` pins the final source contents, and the adjacent PNGs show representative synthetic content. Reproduction helper and logs: `.tmp/desktop-ui-feedback-20261103/`.

This proves local working-tree UI behavior with synthetic backend responses. It does not certify committed HEAD, packaging/release, or real-provider model routing. The unknown custom-model error in the user's screenshot was in scope for transient presentation only.
