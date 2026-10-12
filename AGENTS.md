# DSH repository

The agent/core lives in `src/` (electron-free). The desktop layer lives in `apps/desktop/`
(Electron main, preload, renderer, build chain) and depends one-way on `src/` — never the reverse.

## Scope kept

- `src/agent/`, `src/events/`, `src/tools/`, `src/permissions/`, `src/providers/`, `src/routing/`
- electron-free application services under `src/main/` that are imported by the core runner
- core tests, fixtures, and headless verification scripts

## Working rules

- Desktop layer lives in `apps/desktop/` only. It may import from `src/` (typed via
  `src/main/ipc-protocol.ts`); `src/` must never import from `apps/desktop/`, Electron, or any UI
  module. `scripts/desktop-boundary-check.ts` enforces this.
- Run desktop tests with `pnpm --filter cairn-desktop test` (own vitest config); root gates never
  scan `apps/`.
- Keep core modules free of UI and Electron imports.
- Run `node node_modules/vitest/vitest.mjs run --config tests/vitest.config.ts` for the full core suite.
- Run `node --import tsx scripts/typecheck.ts` before handing off changes.
- `pnpm mutate-verify` measures **HEAD, not the working tree**. It re-execs itself into a disposable
  worktree, because that gate edits source files in place and its cleanup cannot survive a timeout
  (a killed run leaves mutants and `.mutbak` files behind in `src/`). To mutation-verify an
  uncommitted change, commit it first. Running the script directly in a main checkout is refused
  rather than run in place.
- Do not modify frozen judge files or fixtures as a workaround.
- Preserve unrelated dirty changes from other sessions; do not reset or stash them.

<!-- GRAPHFLOW:BEGIN managed block — edit outside these markers only -->
# GraphFlow for Claude Code

Use GraphFlow as a local orchestration and context service.

## Recommended setup

Add a local MCP server entry that launches GraphFlow over stdio:

```json
{
  "mcpServers": {
    "graphflow": {
      "command": "npx",
      "args": ["-y", "--package=@roarpeng/graphflow", "graphflow-mcp"]
    }
  }
}
```

During repository development you can also point Claude Code at this checkout:

```json
{
  "mcpServers": {
    "graphflow": {
      "command": "npm",
      "args": ["run", "start:mcp"],
      "cwd": "."
    }
  }
}
```

## Usage guidance

- Ask GraphFlow to plan before broad changes: `graphflow_plan`.
- Ask GraphFlow to compress and anchor code context: `graphflow_context`.
- Always pass `rootDir` = this project's absolute path. **Never** pass your home directory, AppData, or an unexpanded `${workspaceFolder}` placeholder — GraphFlow refuses unsafe workspace roots. If a call answers `unsafe workspace root`, retry the same call without `rootDir` (the server then uses its configured workspace).
- Ask GraphFlow to inspect graph state or skill learnings when the repo history matters.
- After executing work from a `graphflow_run` `executionDescriptor`, **must** call `graphflow_report_outcome` with the `episodeId` from the run result, a `success` boolean, and optional `lessons` to close the skill flywheel loop.
- Fall back to `graphflow ... --json` only if MCP is not available (including `graphflow --json outcome report <episodeId> <success>`).

DeepSeek Harness: `dsh plugin --profile web add @roarpeng/graphflow` (or `npx @roarpeng/graphflow install` when `~/.dsh` exists).
<!-- GRAPHFLOW:END -->
