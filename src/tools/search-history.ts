import { readSessionView } from "../events";
import { searchHistory, type HistorySearchEntry } from "../agent/history-search";
import type { Tool, ToolResult } from "./base";

const ALLOWED = new Set(["query", "max_results"]);

export const searchHistorySpec = {
  name: "search_history",
  description:
    "Search this session's complete raw history (including compacted tool results) and return bounded excerpts with event refs. " +
    "Use when an earlier detail is no longer in context; do not use for workspace files.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Literal or CJK terms to find in this session" },
      max_results: { type: "number", description: "Maximum results (1-50, default 6)" },
    },
    required: ["query"],
    additionalProperties: false,
  },
} as const;

/** Bind to one session. The model cannot choose a workspace, session, or file. */
export function createSearchHistoryTool(opts: {
  sessionId: string;
  readEntries: () => Promise<readonly HistorySearchEntry[]>;
}): Tool {
  return {
    name: "search_history",
    async run(args): Promise<ToolResult> {
      if (Object.keys(args).some((key) => !ALLOWED.has(key))) {
        return { ok: false, output: "search_history: EINVAL unknown argument" };
      }
      if (typeof args.query !== "string" || args.query.trim() === "") {
        return { ok: false, output: "search_history: EINVAL query must be a non-empty string" };
      }
      if (args.max_results !== undefined &&
          (typeof args.max_results !== "number" || !Number.isInteger(args.max_results) || args.max_results < 1 || args.max_results > 50)) {
        return { ok: false, output: "search_history: EINVAL max_results must be an integer 1..50" };
      }
      let entries: readonly HistorySearchEntry[];
      try {
        entries = await opts.readEntries();
      } catch (error) {
        const why = error instanceof Error ? error.message : String(error);
        return { ok: false, output: "search_history: EIO current session history unavailable: " + why.slice(0, 300) };
      }
      const result = searchHistory({
        entries,
        query: args.query,
        ...(args.max_results !== undefined ? { maxResults: args.max_results } : {}),
      });
      return { ok: result.kind !== "unavailable", output: JSON.stringify(result) };
    },
  };
}

export function createCurrentSessionSearchHistoryTool(opts: {
  workspace: string;
  sessionId: string;
  root: string;
}): Tool {
  return createSearchHistoryTool({
    sessionId: opts.sessionId,
    readEntries: async () => {
      const view = await readSessionView(
        { workspace: opts.workspace, sessionId: opts.sessionId },
        opts.root,
      );
      return view.entries.map((entry) => ({ event: entry.event, ref: entry.ref }));
    },
  });
}

