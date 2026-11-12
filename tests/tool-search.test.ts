import { describe, expect, it } from "vitest";
import {
  searchToolCatalog,
  TOOL_SEARCH_MAX_QUERY_CHARS,
  TOOL_SEARCH_MAX_RESULTS,
  type ToolCatalogEntry,
} from "../src/agent/tool-search";

function entry(over: Partial<ToolCatalogEntry> & Pick<ToolCatalogEntry, "name">): ToolCatalogEntry {
  return {
    description: "",
    inputSchema: { type: "object", properties: {} },
    source: "mcp",
    active: false,
    ...over,
  };
}

const CATALOG: ToolCatalogEntry[] = [
  entry({
    name: "mcp__plugin_docs_docs__search_pages",
    description: "Search documentation pages by full text query and return matching sections.",
    server: "docs/docs",
    inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  }),
  entry({
    name: "mcp__plugin_ops_ops__delete_workspace",
    description: "Destructive workspace deletion. Requires an administrator token.",
    server: "ops/ops",
  }),
  entry({
    name: "mcp__plugin_mail_mail__send_message",
    description: "发送邮件并回显投递回执。",
    server: "mail/mail",
  }),
  entry({
    name: "read_file",
    description: "Read a workspace file by relative path.",
    source: "static",
    active: true,
    inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  }),
];

describe("tool catalog search", () => {
  it("ranks an exact identifier above semantic prose", () => {
    const result = searchToolCatalog(CATALOG, "delete_workspace");
    expect(result.ok).toBe(true);
    expect(result.hits[0]?.name).toBe("mcp__plugin_ops_ops__delete_workspace");
    expect(result.hits[0]?.matched).toContain("delete");
  });

  it("returns the exact executable schema object and activation hint without activating", () => {
    const result = searchToolCatalog(CATALOG, "search pages");
    const hit = result.hits.find((h) => h.name === "mcp__plugin_docs_docs__search_pages");
    expect(hit).toBeDefined();
    expect(hit!.inputSchema).toBe(CATALOG[0]!.inputSchema);
    expect(hit!.active).toBe(false);
    expect(hit!.activation).toEqual({
      tool: "mcp_activate",
      server: "docs/docs",
      tool_name: "mcp__plugin_docs_docs__search_pages",
    });
  });

  it("recovers a Chinese paraphrase by CJK bigrams", () => {
    const result = searchToolCatalog(CATALOG, "投递回执");
    expect(result.hits[0]?.name).toBe("mcp__plugin_mail_mail__send_message");
  });

  it("is deterministic by score then name", () => {
    const first = searchToolCatalog(CATALOG, "workspace");
    const second = searchToolCatalog(CATALOG, "workspace");
    expect(second).toEqual(first);
    const scores = first.hits.map((h) => h.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it("bounds result count even when the caller asks for more", () => {
    const result = searchToolCatalog(CATALOG, "workspace mail pages", { maxResults: 99 });
    expect(result.hits.length).toBeLessThanOrEqual(TOOL_SEARCH_MAX_RESULTS);
  });

  it("rejects empty and overlong queries instead of returning a partial catalog", () => {
    expect(searchToolCatalog(CATALOG, "   ")).toMatchObject({ ok: false, hits: [] });
    const long = searchToolCatalog(CATALOG, "x".repeat(TOOL_SEARCH_MAX_QUERY_CHARS + 1));
    expect(long.ok).toBe(false);
    expect(long.error).toContain(String(TOOL_SEARCH_MAX_QUERY_CHARS));
  });

  it("marks a directory that exceeds the scan cap instead of silently truncating", () => {
    const many = Array.from({ length: 6 }, (_, i) => entry({ name: "hidden_tool_" + String(i), description: "hidden capability" }));
    const result = searchToolCatalog(many, "hidden", { scanLimit: 4, maxResults: 8 });
    expect(result.scanned).toBe(4);
    expect(result.truncated).toBe(true);
    expect(result.hits.every((h) => h.name.match(/^hidden_tool_[0-3]$/))).toBe(true);
  });

  it("resolves a fully qualified tool name beyond the semantic scan limit", () => {
    const target = entry({ name: "mcp__plugin_docs_docs__read_section", server: "docs/docs" });
    const result = searchToolCatalog([...CATALOG, target], target.name.toUpperCase(), { scanLimit: 2, maxResults: 1 });
    expect(result.scanned).toBe(2);
    expect(result.truncated).toBe(true);
    expect(result.hits[0]?.name).toBe(target.name);
  });
});
