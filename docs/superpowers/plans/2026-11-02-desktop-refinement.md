# Desktop refinement implementation plan

> Execution: current agent, using superpowers:executing-plans. Preserve the shared working tree.

**Goal:** Refine Cairn toward the Claude interface style requested on 2026-11-02, fixing the memory list, model menu, queued messages, and sidebar affordances.

**Architecture:** Reuse the existing React components, official token adapter, navigation state, and IPC. Keep changes in the renderer and local verification scripts; add no dependency. The 2026-10-30 design remains the functional reference; the user's latest Claude preference supersedes its cooler visual direction.

**Constraints:** Do not edit vendor tokens, agent rules, provider requests, plugin trust/install rules, or unrelated dirty changes. Use an isolated renderer build and temporary Electron profiles. Verification covers the working tree, not release or committed HEAD.

## Tasks

- [x] Memory: make recent sorting real, search body text, preserve layer grouping and colon-containing topic names; provide a compact summary and consistent list/detail layout. Verify ordering/search with data tests and selection with Electron.
- [x] Composer/model/sidebar: lighten the new-task action, align the model control to the right, constrain long model labels, retain all model capabilities and reasoning options; fix keyboard opening of the sidebar filter. Verify long labels, keyboard navigation, focus return, and short windows.
- [x] Queue: separate message previews from actions, use readable action targets, and bound the message area so a long queue cannot push the composer away. Keep edit/reorder/remove/interrupt/persistence contracts. Verify real input, reorder, and long queues in Electron.
- [x] Cross-page parity: unify page headings and spacing; retain a single plugin view switcher and a single category filter. Verify memory/plugin pages at 1440/1120/880 and light/dark themes.
- [x] Review and evidence: run focused tests, desktop suite, typecheck, renderer/boundary/docs gates; OCR delegate selects files and rules, current agent reviews. Capture before/after evidence and get a fresh design review.

## Review focus

- Mixed project/global timestamps must sort within their own groups, with invalid dates last.
- Search must find remembered content and topic selection must preserve punctuation.
- Many queued messages must leave the editor and send action reachable in short windows.
- Long model names and capability metadata must fit without hiding selection state.
- Keyboard navigation and focus return must work after opening menus and switching destinations.

## Delivery

This batch is complete; the broader continuous optimization goal remains active. Evidence: `outputs/desktop-refinement-2026-11-02/REPORT.md`. Desktop suite: 311 files / 2123 tests, 2 workers. Electron: 51 shell + 11 queue assertions. Independent visual verdict: ship.

Ruling: modify the current shared checkout because its in-flight UI is the requested target; a clean HEAD worktree would omit that UI. Preserve unrelated edits, use isolated build outputs, record source hashes, and leave all changes uncommitted.
