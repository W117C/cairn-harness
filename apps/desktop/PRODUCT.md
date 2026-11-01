# Product

<!-- impeccable:product-schema 1 -->

## Platform

macOS desktop（Electron + React；开发态 Vite + Chromium）

## Users

Cairn Desktop is for developers and technical operators who run long-lived coding agents on local projects. They switch repeatedly between conversation, plugins, memory, automation, and settings while retaining project context and work in progress.

## Product Purpose

Cairn is a local desktop coding agent and a durable Agent OS. Conversation is the default, highest-frequency workspace. Plugins, memory, automation, and settings are stable destinations that let users extend, govern, and reuse the agent without burying those capabilities in transient dialogs.

Success means users can discover real capabilities, understand their source and risk, install and operate them safely, and return to the same working state without losing drafts, filters, scroll position, or focus.

## Positioning

Cairn keeps the agent's execution, extensions, and long-term knowledge local-first and reviewable. It treats installed capabilities as governed software with provenance, content fingerprints, scoped enablement, and next-run activation rather than as opaque one-click prompts.

## Operating Context

- Users work in one active project at a time while retaining access to user-scoped capabilities.
- Agent sessions can run for a long time and may depend on the plugin set captured when the run starts.
- Plugins can contribute skills, commands, subagents, hooks, MCP servers, and LSP servers.
- Plugin packages are declarative; third-party JavaScript is not loaded into the app process.
- The official marketplace is a signed catalog. Git repositories and local directories are separate, explicitly reviewed sources.
- The desktop shell includes a 48px global destination rail, context sidebar, chat workspace, durable pages, right-side inspector, and settings.
- Current supported real-window widths are 1440, 1120, and 880 pixels.

## Capabilities and Constraints

- The desktop must support plugin discovery, source inspection, review, installation, update, enable/disable, and uninstall.
- Catalog, Git, and local installs must converge on one content inspection, capability scan, fingerprint, review, staging, publication, and rollback path.
- Updating a plugin is source-bound. A catalog entry must not replace a Git or local installation merely because the display name matches.
- Plugin trust is bound to content, not to a movable display name.
- Install, update, disable, enable, and uninstall affect the next agent run. The backend fails closed while a run is active.
- Disabled plugins retain their files and configuration; uninstall removes registry-owned files and requires explicit confirmation.
- The catalog must distinguish live, verified cache, stale cache, corrupt cache, and unavailable states. Missing data must not be rendered as an empty marketplace.
- The interface must not fabricate ratings, download counts, popularity, testimonials, or compatibility claims.
- The renderer never receives package URLs, digests, sizes, or target roots as install commands.

## Brand Commitments

- Preserve Cairn's established warm cream surfaces, terracotta brand accent, and restrained dark theme.
- Preserve the quiet, operational density of the existing workbench. Do not turn product pages into marketing landing pages.
- Avoid unnecessary secondary labels and descriptions; let hierarchy and layout explain the task.
- Use familiar native desktop affordances, lucide icons, visible focus states, and cards with an 8px or smaller radius.
- Do not introduce purple-blue gradients, card-inside-card composition, decorative orb backgrounds, or display typography in operational controls.

## Evidence on Hand

- Real plugin runtime snapshots provide loaded plugin scope, trust, capabilities, MCP state, warnings, and errors.
- The backend provides a signed catalog reader, catalog cache states, install jobs, content inspection, fingerprint checks, registry state, enable/disable, and uninstall.
- Existing Electron smoke and screenshot scripts exercise the actual renderer.
- There is no production marketplace analytics, rating, review, or download data. The interface must omit those claims.
- The official catalog URL and production signing keys remain environment-configured until release infrastructure is completed.

## Product Principles

1. Keep the conversation primary and management destinations durable.
2. Show provenance and risk before action.
3. Prefer one governed lifecycle over multiple convenient but inconsistent install paths.
4. Represent uncertainty as its own state; never collapse failure into emptiness.
5. Preserve the user's working context while navigating and while background operations update.

## Accessibility & Inclusion

- All destinations and core page actions must be keyboard reachable with visible focus.
- Dense desktop controls have a minimum 28px target; primary touch-capable controls target at least 32px.
- State cannot rely on color alone.
- The application must honor the system and in-app reduced-motion preferences.
- Text must wrap or truncate without overlapping adjacent controls at every supported window width.
