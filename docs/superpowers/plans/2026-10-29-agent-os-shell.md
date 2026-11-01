# Agent OS Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the approved Agent OS shell as working, testable software: a persistent 48px destination rail, destination-aware context navigation, durable Plugins/Memory/Automation pages using current real snapshots, and a shared page frame without adding future marketplace or memory-edit actions.

**Architecture:** Keep conversation state mounted and make destination pages siblings inside the existing shell. A pure navigation module owns destination/section/filter facts; presentation components own the rail, context sidebar, and page frame; `useWorkbenchModel` owns destination and per-page filter state. Settings remains an overlay, while Plugins, Memory, and Automation move out of settings navigation into durable pages.

**Tech Stack:** Electron, React, TypeScript, `lucide-react`, existing Radix primitives, Vitest server-rendered HTML tests, isolated Electron smoke scripts. No new dependency.

**Spec:** `docs/superpowers/specs/2026-10-29-agent-os-desktop-design.md`

## Global Constraints

- Preserve the existing warm canvas, coral brand, dark theme, typography, and current design tokens.
- Do not reset, stash, clean, overwrite, or commit unrelated dirty-worktree changes.
- This checkout contains concurrent uncommitted work. Every task ends with a scoped diff check, not a commit.
- Do not expose marketplace install/update or memory write/edit controls in `UI-0`; those belong to later plans.
- Conversation remains the startup destination and stays mounted while utility pages are open.
- The smallest supported real Electron window remains 880px; 720px is component-container coverage only.
- Plugins, Memory, and Automation are durable destinations, not settings sections.
- Do not add a new dependency, event kind, permission path, or IPC channel for `UI-0`.
- Use Simplified Chinese UI copy and preserve technical identifiers verbatim.
- If a modified renderer file approaches its 1,200-line cap, extract behavior-free presentation code before adding lines.

## Review Focus

- Existing uncommitted changes in `WorkbenchView.tsx`, `workbench.ts`, `AppPage.tsx`, and `styles.css` must survive byte-for-byte outside this plan's scoped hunks; a test or diff review must prove unrelated behavior was not overwritten.
- Switching to Plugins, Memory, or Automation and back to Chat must preserve the current session, composer draft, stream scroll owner, and open tool panes rather than remounting chat.
- Settings, onboarding links, and `Cmd+K` must send Plugins/Memory/Automation to their durable destination while Settings/Provider/Usage still open the correct settings section and return to the prior destination.
- At 1440, 1120, and 880 real-window widths, the rail, context sidebar, page header, search, filter, and content must not overlap; the rail remains keyboard reachable when the context sidebar is collapsed.
- Snapshot loading, read failure, and real empty data remain visibly distinct on utility pages; no unavailable install/edit action or fake count appears.

---

### Task 1: Navigation Facts And Destination State

**Files:**
- Modify: `apps/desktop/src/renderer/app-controls.ts`
- Create: `apps/desktop/src/renderer/navigation.ts`
- Test: `apps/desktop/tests/navigation.test.ts`

**Interfaces:**
- Consumes: existing `PageId`, `SectionId`.
- Produces:
  - `type AppDestination = "chat" | "plugins" | "memory" | "automation"`
  - `type AppPageDestination = Exclude<AppDestination, "chat">`
  - `APP_DESTINATIONS: readonly AppDestination[]`
  - `APP_DESTINATION_LABEL: Record<AppDestination, string>`
  - `PAGE_CONTEXT_ITEMS: Record<PageId, readonly PageFilterItem[]>`
  - `interface PageFilterItem { id: string; label: string }`
  - `pageForDestination(AppDestination): PageId | null`
  - `destinationForSection(SectionId): AppDestination | null`
  - `defaultPageFilter(PageId): string`
  - `isAppPageDestination(PageId): page is "plugins" | "memory" | "automation"`

- [ ] **Step 1: Write the failing navigation test**

```ts
import { describe, expect, it } from "vitest";
import {
  APP_DESTINATIONS,
  destinationForSection,
  pageForDestination,
} from "../src/renderer/navigation";

describe("Agent OS navigation facts", () => {
  it("orders Chat, Plugins, Memory, Automation", () => {
    expect(APP_DESTINATIONS).toEqual(["chat", "plugins", "memory", "automation"]);
  });

  it("maps durable pages and unrelated settings independently", () => {
    expect(pageForDestination("plugins")).toBe("plugins");
    expect(pageForDestination("memory")).toBe("memory");
    expect(pageForDestination("automation")).toBe("automation");
    expect(pageForDestination("chat")).toBeNull();
    expect(destinationForSection("memory")).toBe("memory");
    expect(destinationForSection("skills")).toBeNull();
    expect(destinationForSection("provider")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter cairn-desktop test -- tests/navigation.test.ts`

Expected: FAIL because `navigation.ts` does not exist.

- [ ] **Step 3: Add the destination type and pure navigation module**

Add `AppDestination` and `AppPageDestination` beside `PageId` in `app-controls.ts`. In `navigation.ts`, define the constants and functions from the Interfaces block without React imports. `PAGE_CONTEXT_ITEMS` must copy current page filters exactly: plugins `all/trusted/untrusted`, memory `all/project/global`, automation `all/on/off`; skills/worktrees return an empty list.

- [ ] **Step 4: Run the focused test**

Run: `pnpm --filter cairn-desktop test -- tests/navigation.test.ts`

Expected: PASS.

- [ ] **Step 5: Check the scoped diff**

Run: `git diff --check -- apps/desktop/src/renderer/app-controls.ts apps/desktop/src/renderer/navigation.ts apps/desktop/tests/navigation.test.ts`

Expected: exit 0, no unrelated file in the path list.

### Task 2: Persistent App Rail

**Files:**
- Create: `apps/desktop/src/renderer/components/AppRail.tsx`
- Modify: `apps/desktop/src/renderer/styles.css`
- Test: `apps/desktop/tests/app-rail.test.tsx`

**Interfaces:**
- Consumes: `AppDestination`, `APP_DESTINATIONS`, `APP_DESTINATION_LABEL`.
- Produces:
  - `interface AppRailProps { destination: AppDestination; onOpen: (destination: AppDestination) => void; onSettings: () => void; badges?: Partial<Record<AppDestination, number>> }`
  - `function AppRail(props: AppRailProps): React.JSX.Element`

- [ ] **Step 1: Write the failing HTML test**

```tsx
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRail } from "../src/renderer/components/AppRail";

describe("AppRail", () => {
  it("is a labelled navigation rail with one current destination", () => {
    const html = renderToStaticMarkup(
      <AppRail destination="memory" onOpen={() => undefined} onSettings={() => undefined} badges={{ memory: 3 }} />,
    );
    expect(html).toContain('aria-label="全局功能"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain("记忆");
    expect(html).toContain("3");
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter cairn-desktop test -- tests/app-rail.test.tsx`

Expected: FAIL because `AppRail.tsx` does not exist.

- [ ] **Step 3: Implement the presentation-only rail**

Use `MessageSquare`, `Puzzle`, `Brain`, and `Clock3` from `lucide-react`; use `Settings2` at the bottom. Each destination is a button with `aria-label`, `aria-current` only when active, and a badge only when the supplied number is a positive integer. The settings button is not part of `APP_DESTINATIONS` and has no active state. Render no visible text labels at desktop width.

Add `.app-rail` styles: fixed 48px width, full shell height, bottom settings anchor, 32px targets, visible focus ring, 6px radius, coral active indicator. Do not modify existing `.sidebar-rail`; that remains the collapsed Chat sidebar.

- [ ] **Step 4: Run focused tests and static detector**

Run:

```sh
pnpm --filter cairn-desktop test -- tests/app-rail.test.tsx
node /Users/ze/.codex/skills/impeccable/scripts/detect.mjs --json apps/desktop/src/renderer/components/AppRail.tsx apps/desktop/src/renderer/styles.css
```

Expected: test PASS; detector reports no new issue caused by the rail.

- [ ] **Step 5: Check the scoped diff**

Run: `git diff --check -- apps/desktop/src/renderer/components/AppRail.tsx apps/desktop/src/renderer/styles.css apps/desktop/tests/app-rail.test.tsx`

Expected: exit 0.

### Task 3: Shared Page Frame And Destination Context

**Files:**
- Create: `apps/desktop/src/renderer/components/PageFrame.tsx`
- Create: `apps/desktop/src/renderer/components/PageContextSidebar.tsx`
- Modify: `apps/desktop/src/renderer/styles.css`
- Test: `apps/desktop/tests/page-frame.test.tsx`
- Test: `apps/desktop/tests/page-context-sidebar.test.tsx`

**Interfaces:**
- Consumes: `PageFilterItem`, `AppDestination`.
- Produces:
  - `interface PageFrameProps { title: string; search?: { label: string; value: string; onChange: (value: string) => void }; onRefresh?: () => void; filters?: readonly PageFilterItem[]; activeFilter?: string; onFilter?: (id: string) => void; children: React.ReactNode }`
  - `interface PageContextSidebarProps { destination: AppDestination; items: readonly PageFilterItem[]; activeFilter: string; onFilter: (id: string) => void }`
  - `function PageFrame(props: PageFrameProps): React.JSX.Element`
  - `function PageContextSidebar(props: PageContextSidebarProps): React.JSX.Element`

- [ ] **Step 1: Write failing HTML tests**

```tsx
it("renders one page title, search, and compact filter", () => {
  const html = renderToStaticMarkup(
    <PageFrame
      title="插件"
      search={{ label: "搜索插件", value: "", onChange: () => undefined }}
      filters={[{ id: "all", label: "全部" }]}
      activeFilter="all"
      onFilter={() => undefined}
    >
      <div>content</div>
    </PageFrame>,
  );
  expect(html).toContain("<h1");
  expect(html).toContain("搜索插件");
  expect(html).toContain("content");
});

it("marks only the active context filter", () => {
  const html = renderToStaticMarkup(
    <PageContextSidebar
      destination="memory"
      items={[{ id: "all", label: "全部" }, { id: "project", label: "项目层" }]}
      activeFilter="project"
      onFilter={() => undefined}
    />,
  );
  expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
  expect(html).toContain("项目层");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter cairn-desktop test -- tests/page-frame.test.tsx tests/page-context-sidebar.test.tsx`

Expected: FAIL because both components are missing.

- [ ] **Step 3: Implement the two presentation components**

`PageFrame` owns layout only: one `h1`, optional search input, optional refresh icon button, a compact native `<select>` for filters, and a stable content region. It must not own search/filter state.

`PageContextSidebar` owns a labelled `<nav>`, filter buttons, and destination-specific empty text. It has no project/session data and no action beyond `onFilter`.

Move the existing internal `PageHead` layout responsibility into `PageFrame` later in Task 4; do not duplicate both headings at runtime. Style the frame at the existing 960px content width and keep 24px gaps. Below 1120px, hide `.page-context-sidebar` from layout and show `.page-frame-filter`; above 1120px reverse that visibility.

- [ ] **Step 4: Run focused tests and detector**

Run:

```sh
pnpm --filter cairn-desktop test -- tests/page-frame.test.tsx tests/page-context-sidebar.test.tsx
node /Users/ze/.codex/skills/impeccable/scripts/detect.mjs --json apps/desktop/src/renderer/components/PageFrame.tsx apps/desktop/src/renderer/components/PageContextSidebar.tsx apps/desktop/src/renderer/styles.css
```

Expected: tests PASS; no new detector finding.

- [ ] **Step 5: Check the scoped diff**

Run: `git diff --check -- apps/desktop/src/renderer/components/PageFrame.tsx apps/desktop/src/renderer/components/PageContextSidebar.tsx apps/desktop/src/renderer/styles.css apps/desktop/tests/page-frame.test.tsx apps/desktop/tests/page-context-sidebar.test.tsx`

Expected: exit 0.

### Task 4: Controlled Utility-Page Filters And Shared Frames

**Files:**
- Modify: `apps/desktop/src/renderer/components/AppPage.tsx:64-150`
- Modify: `apps/desktop/src/renderer/components/AppPage.tsx:180-390`
- Modify: `apps/desktop/src/renderer/components/AppPage.tsx:520-760`
- Modify: `apps/desktop/src/renderer/components/AppPage.tsx:792-905`
- Modify: `apps/desktop/src/renderer/components/AppPage.tsx:942-990`
- Modify: `apps/desktop/tests/app-page.test.tsx`

**Interfaces:**
- Consumes: `PageFrame`, `PAGE_CONTEXT_ITEMS`, `defaultPageFilter`.
- Produces:
  - `interface AppPageBodyProps { page: PageId; filter?: string; onFilter?: (filter: string) => void; onError: (message: string) => void }`
  - Each page pane consumes `{ filter: string; onFilter: (filter: string) => void }`.
  - Existing Settings callers may omit `filter`/`onFilter`; `AppPageBody` then owns a local fallback initialized with `defaultPageFilter(page)`.

- [ ] **Step 1: Write failing controlled-filter tests**

```tsx
it("AppPageBody forwards the selected plugin filter without inventing another state owner", () => {
  const source = readAppSurface();
  expect(source).toContain("filter={activeFilter}");
  expect(source).toContain("onFilter={setActiveFilter}");
});

it("page frames do not render duplicate pane pills", () => {
  const source = readAppSurface();
  expect(source).not.toContain("<PanePills");
});
```

Use `apps/desktop/tests/helpers/app-surface.ts` so the source assertion reads the whole renderer, not one file.

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `pnpm --filter cairn-desktop test -- tests/app-page.test.tsx`

Expected: FAIL on the controlled-filter and duplicate-pill assertions.

- [ ] **Step 3: Refactor page panes to receive filter props**

Replace each pane's local `filter` with required props. Use `PageFrame` for Plugins, Memory, Automation, Skills, and Worktrees; move title and search into that frame. Delete `PageHead`, `PanePills`, and the old `Toolbar` filter controls once no caller uses them. Keep each pane's query/sort/detail state local.

`AppPageBody` computes:

```ts
const [fallbackFilter, setFallbackFilter] = useState(() => defaultPageFilter(props.page));
const activeFilter = props.filter ?? fallbackFilter;
const setActiveFilter = props.onFilter ?? setFallbackFilter;
```

Pass `activeFilter` and `setActiveFilter` to the selected pane. Do not reset a user's filter when a refresh snapshot returns.

- [ ] **Step 4: Run focused page tests**

Run: `pnpm --filter cairn-desktop test -- tests/app-page.test.tsx tests/settings-sections.test.tsx tests/settings-ui.test.tsx`

Expected: PASS; no pane mounts with an undefined filter.

- [ ] **Step 5: Check renderer line caps and scoped diff**

Run:

```sh
pnpm renderer-layer-check
git diff --check -- apps/desktop/src/renderer/components/AppPage.tsx apps/desktop/tests/app-page.test.tsx
```

Expected: layer check passes; `AppPage.tsx` remains under 1,200 lines; scoped diff has no whitespace error.

### Task 5: Integrate The Shell Without Remounting Chat

**Files:**
- Create: `apps/desktop/src/renderer/panes/WorkbenchSidebar.tsx`
- Modify: `apps/desktop/src/renderer/app-controls.ts`
- Modify: `apps/desktop/src/renderer/state/workbench.ts:285-320`
- Modify: `apps/desktop/src/renderer/state/workbench.ts:960-1010`
- Modify: `apps/desktop/src/renderer/state/workbench.ts:1160-1187`
- Modify: `apps/desktop/src/renderer/panes/WorkbenchView.tsx:310-520`
- Modify: `apps/desktop/src/renderer/panes/WorkbenchView.tsx:1090-1160`
- Modify: `apps/desktop/src/renderer/styles.css`
- Test: `apps/desktop/tests/workbench-sidebar.test.tsx`
- Test: `apps/desktop/tests/render-structure.test.tsx`

**Interfaces:**
- Consumes: `AppRail`, `PageContextSidebar`, `AppPageBody`, existing `Sidebar`.
- Produces:
  - `interface WorkbenchSidebarProps { destination; sidebarCollapsed; focusMode; sidebarWidth; chatSidebar: ComponentProps<typeof Sidebar>; pageItems; activeFilter; onFilter; onOpenDestination; onSettings; onExpand; onNewTask; onSearch; onFiles; onTerminal; onStartResize; onPersistWidth; onKeyResize }`
  - `WorkbenchViewDeps` adds:
    - `destination: AppDestination`
    - `pageFilter: string`
    - `openDestination: (destination: AppDestination) => void`
    - `setPageFilter: (filter: string) => void`
  - `useWorkbenchModel` returns a per-page filter map so switching destinations preserves each page's filter.

- [ ] **Step 1: Write the failing shell-presentation test**

```tsx
it("switches the context column but keeps the global rail", () => {
  const html = renderToStaticMarkup(
    <WorkbenchSidebar
      destination="plugins"
      sidebarCollapsed={false}
      focusMode={false}
      sidebarWidth={200}
      chatSidebar={SIDEBAR_FIXTURE}
      pageItems={[{ id: "all", label: "全部" }]}
      activeFilter="all"
      onFilter={() => undefined}
      onOpenDestination={() => undefined}
      onSettings={() => undefined}
      onExpand={() => undefined}
      onNewTask={() => undefined}
      onSearch={() => undefined}
      onFiles={() => undefined}
      onTerminal={() => undefined}
      onStartResize={() => undefined}
      onPersistWidth={() => undefined}
      onKeyResize={() => undefined}
    />,
  );
  expect(html).toContain('aria-label="全局功能"');
  expect(html).toContain('aria-label="插件上下文"');
  expect(html).not.toContain('aria-label="demo-ws"');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter cairn-desktop test -- tests/workbench-sidebar.test.tsx`

Expected: FAIL because `WorkbenchSidebar.tsx` does not exist.

- [ ] **Step 3: Add destination state and extract the sidebar column**

In `useWorkbenchModel`, add:

```ts
const [destination, setDestination] = useState<AppDestination>("chat");
const [pageFilters, setPageFilters] = useState<Record<AppPageDestination, string>>({
  plugins: defaultPageFilter("plugins"),
  memory: defaultPageFilter("memory"),
  automation: defaultPageFilter("automation"),
});
const openDestination = useCallback((next: AppDestination): void => {
  setSettingsOpen(false);
  setDestination(next);
}, []);
```

Derive `pageFilter` from the active page destination. `setPageFilter` updates only that page's key. Return all four values.

Extract the current collapsed `SidebarRail`, expanded `Sidebar`, resize handle, and shell divider into `WorkbenchSidebar`. It always renders `AppRail`; for Chat it renders the existing sidebar/rail, and for utility destinations it renders `PageContextSidebar`.

- [ ] **Step 4: Render utility pages without unmounting Chat**

In `WorkbenchView`, keep the existing `Group` tree mounted. Wrap it in a surface that receives `data-hidden` when `destination !== "chat"`; use `inert` while hidden and CSS `visibility:hidden; pointer-events:none; position:absolute` rather than unmounting it.

Render the utility page in the same center grid area:

```tsx
{destination !== "chat" && page !== null && (
  <section className="destination-page" aria-label={APP_DESTINATION_LABEL[destination]}>
    <AppPageBody
      page={page}
      filter={pageFilter}
      onFilter={setPageFilter}
      onError={setLastError}
    />
  </section>
)}
```

For utility destinations, pass the existing toolbar a hidden state, hide the inspector/plugin sidebar, and keep `AppRail` plus `PageContextSidebar`. `openDestination("chat")` reveals the still-mounted Chat tree.

- [ ] **Step 5: Run shell tests, line caps, and scoped diff**

Run:

```sh
pnpm --filter cairn-desktop test -- tests/workbench-sidebar.test.tsx tests/render-structure.test.tsx tests/focus-mode.test.ts
pnpm renderer-layer-check
git diff --check -- apps/desktop/src/renderer/panes/WorkbenchSidebar.tsx apps/desktop/src/renderer/panes/WorkbenchView.tsx apps/desktop/src/renderer/state/workbench.ts apps/desktop/src/renderer/app-controls.ts apps/desktop/src/renderer/styles.css apps/desktop/tests/workbench-sidebar.test.tsx
```

Expected: tests PASS; `WorkbenchView.tsx` and `workbench.ts` stay below 1,200 lines; scoped diff clean.

### Task 6: Route Settings, Onboarding, And Command Palette To Their Real Homes

**Files:**
- Modify: `apps/desktop/src/renderer/components/settings-nav.tsx`
- Modify: `apps/desktop/src/renderer/components/SettingsPanel.tsx`
- Modify: `apps/desktop/src/renderer/components/OnboardingChecklist.tsx`
- Modify: `apps/desktop/src/renderer/components/CommandPalette.tsx`
- Modify: `apps/desktop/src/renderer/panes/WorkbenchView.tsx:920-1140`
- Modify: `apps/desktop/tests/settings-section-search.test.ts`
- Modify: `apps/desktop/tests/onboarding-checklist.test.tsx`
- Modify: `apps/desktop/tests/command-palette.test.tsx`

**Interfaces:**
- Consumes: `destinationForSection`, `APP_DESTINATIONS`, `APP_DESTINATION_LABEL`, `openDestination`.
- Produces:
  - `SETTINGS_PAGE_ORDER: readonly PageId[] = ["skills", "worktrees"]`
  - `CommandPalette` adds `onOpenDestination: (destination: AppDestination) => void`.
  - Plugins, Memory, and Automation no longer appear in `SECTIONS` or settings search.

- [ ] **Step 1: Write failing routing tests**

```ts
it("does not advertise durable pages as settings sections", () => {
  expect(filterSections("插件")).not.toContain("plugins");
  expect(filterSections("记忆")).not.toContain("memory");
  expect(filterSections("自动化")).not.toContain("automation");
});

it("routes onboarding groups to durable destinations when appropriate", () => {
  expect(onboardingTarget("memory")).toBe("memory");
  expect(destinationForSection("memory")).toBe("memory");
  expect(destinationForSection("telemetry")).toBeNull();
});
```

Add a `CommandPalette` HTML assertion for a labelled “页面” group and all four destinations.

- [ ] **Step 2: Run the focused tests to verify they fail**

Run: `pnpm --filter cairn-desktop test -- tests/settings-section-search.test.ts tests/onboarding-checklist.test.tsx tests/command-palette.test.tsx`

Expected: FAIL because durable pages are still settings sections and the palette has no destination group.

- [ ] **Step 3: Split settings pages from app destinations**

Change `settings-nav.tsx` to build `PAGE_SECTIONS` from `SETTINGS_PAGE_ORDER`, not all `PAGE_ORDER`. `SettingsPanel` may still render `AppPageBody` for Skills and Worktrees; reject or fall back from Plugins/Memory/Automation as `initialSection`.

In `OnboardingChecklist`, keep the existing `SectionId` output. At its call site, first call `destinationForSection(section)`; if non-null, use `openDestination`, otherwise open Settings. `Cmd+K` adds a “页面” group from `APP_DESTINATIONS` and calls `onOpenDestination`; settings actions keep their existing handler.

- [ ] **Step 4: Run routing and existing settings tests**

Run:

```sh
pnpm --filter cairn-desktop test -- tests/settings-section-search.test.ts tests/onboarding-checklist.test.tsx tests/command-palette.test.tsx tests/settings-sections.test.tsx tests/settings-advanced-section.test.tsx
```

Expected: PASS. Settings search no longer returns durable pages; all settings destinations still do.

- [ ] **Step 5: Check the scoped diff**

Run: `git diff --check -- apps/desktop/src/renderer/components/settings-nav.tsx apps/desktop/src/renderer/components/SettingsPanel.tsx apps/desktop/src/renderer/components/OnboardingChecklist.tsx apps/desktop/src/renderer/components/CommandPalette.tsx apps/desktop/src/renderer/panes/WorkbenchView.tsx apps/desktop/tests/settings-section-search.test.ts apps/desktop/tests/onboarding-checklist.test.tsx apps/desktop/tests/command-palette.test.tsx`

Expected: exit 0.

### Task 7: Real Electron Shell Verification

**Files:**
- Create: `apps/desktop/scripts/app-shell-smoke.cjs`
- Modify: `apps/desktop/scripts/ui-gallery-preload.cjs` only if the fixture lacks destination-neutral snapshots
- Create: `outputs/agent-os-ui-0-2026-10-29/checks.json`
- Create: `outputs/agent-os-ui-0-2026-10-29/REPORT.md`

**Interfaces:**
- Consumes: built renderer, existing synthetic `AgentApi`, `AppRail` labels, page `aria-label`s.
- Produces: screenshots and machine-readable assertions for desktop/narrow/dark and keyboard navigation.

- [ ] **Step 1: Write the smoke assertions before wiring the fixture**

The script must assert:

```js
assert(await page.locator('[aria-label="全局功能"]').isVisible());
assert.equal(await page.locator('[aria-current="page"]').count(), 1);
assert(await page.getByLabel("插件").isVisible());
assert(await page.getByLabel("记忆").isVisible());
assert(await page.getByLabel("自动化任务").isVisible());
assert.equal(await page.locator(".chat-workspace").evaluate(el => getComputedStyle(el).visibility), "hidden");
```

Capture 1440×900 Light, 880×640, 1440×900 Dark, keyboard focus, empty snapshot, and read-error states.

- [ ] **Step 2: Run the smoke to verify it fails**

Run: `pnpm --filter cairn-desktop build && ELECTRON_RUN_AS_NODE= pnpm --filter cairn-desktop exec electron scripts/app-shell-smoke.cjs /tmp/cairn-agent-os-ui-0`

Expected: FAIL because the rail and durable pages are not yet in the built renderer.

- [ ] **Step 3: Complete fixture wiring and capture evidence**

Reuse the existing synthetic API and isolated profile. Do not add real provider calls, credentials, or user sessions. Save only non-TypeScript evidence under `outputs/agent-os-ui-0-2026-10-29/`.

- [ ] **Step 4: Run the full verification stack**

Run:

```sh
pnpm --filter cairn-desktop test
node --import tsx scripts/typecheck.ts
pnpm renderer-layer-check
pnpm desktop-boundary-check
pnpm --filter cairn-desktop build
ELECTRON_RUN_AS_NODE= pnpm --filter cairn-desktop exec electron scripts/app-shell-smoke.cjs /tmp/cairn-agent-os-ui-0
pnpm docs-check
node /Users/ze/.codex/skills/impeccable/scripts/detect.mjs --json apps/desktop/src/renderer/components/AppRail.tsx apps/desktop/src/renderer/components/PageFrame.tsx apps/desktop/src/renderer/components/PageContextSidebar.tsx apps/desktop/src/renderer/panes/WorkbenchSidebar.tsx apps/desktop/src/renderer/panes/WorkbenchView.tsx apps/desktop/src/renderer/styles.css
```

Expected: all commands exit 0; smoke writes 6 screenshots and `checks.json` with zero failed checks. If the shared dirty document layer makes a command red, report the exact unrelated failure and keep it separate from this plan's evidence.

- [ ] **Step 5: Perform focused diff review instead of commit**

Because the checkout is shared and dirty, do not commit. Run:

```sh
git diff --check -- apps/desktop/src/renderer apps/desktop/tests apps/desktop/scripts/app-shell-smoke.cjs outputs/agent-os-ui-0-2026-10-29
git status --short -- apps/desktop/src/renderer apps/desktop/tests apps/desktop/scripts/app-shell-smoke.cjs outputs/agent-os-ui-0-2026-10-29
```

Expected: whitespace clean; status lists only this plan's touched files plus pre-existing edits that must be called out in the report.

## Self-Review

- Spec coverage: destination rail, adaptive context navigation, durable Plugins/Memory/Automation pages, settings separation, page skeleton, command palette, onboarding routing, 880px behavior, and honest loading/error states are all assigned.
- Deferred correctly: marketplace catalog/install and memory write/edit are not implemented by this plan.
- Type consistency: `AppDestination`, `PageId`, `PageFilterItem`, `AppPageBodyProps`, and `WorkbenchSidebarProps` are defined before use and reused unchanged.
- Review focus: every uncovered user-facing failure mode has a focused HTML/source test or a named Electron assertion in Task 7.
- Proportion: the plan specifies interfaces, tests, and ownership without transcribing component bodies.
