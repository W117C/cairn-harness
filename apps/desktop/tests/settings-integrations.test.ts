import { describe, expect, it } from "vitest";
import { MCP_EMPTY_DRAFT, mcpDraftFrom, mcpDraftPayload, replaceMcpServer } from "../src/renderer/components/settings/McpSection";
import { hookDraftEntry, makeHookDraft, replaceHook } from "../src/renderer/components/settings/HooksSection";

describe("MCP configuration drafts", () => {
  it("preserves exact argv boundaries and environment values on edit", () => {
    const config = {
      command: "/path with spaces/tool",
      args: ["--flag", "path with spaces", "", " a ", "a\nb"],
      env: { EXTRA: "  a\nb  " },
      includeTools: ["one,two"],
      disabled: false,
      futureOption: { retry: 5 },
    };
    expect(mcpDraftPayload(mcpDraftFrom("local", config))).toEqual({ ok: true, config });
  });
});

describe("MCP server editing", () => {
  const servers = [
    { name: "local", config: { command: "local" } },
    { name: "remote", config: { url: "https://example.com/mcp" } },
  ];

  it("renames the source in place and leaves unrelated servers intact", () => {
    expect(replaceMcpServer(servers, "local", { name: "renamed", config: { command: "changed" } })).toEqual([
      { name: "renamed", config: { command: "changed" } },
      { name: "remote", config: { url: "https://example.com/mcp" } },
    ]);
  });

  it("rejects a rename or add that collides with an existing server", () => {
    const duplicate = { name: "remote", config: { command: "must-not-overwrite" } };
    expect(replaceMcpServer(servers, "local", duplicate)).toBeNull();
    expect(replaceMcpServer(servers, null, duplicate)).toBeNull();
  });

  it("rejects a typed argument that would change the argv schema", () => {
    expect(mcpDraftPayload({ ...MCP_EMPTY_DRAFT, name: "local", command: "local", args: '["valid", 3]' }).ok).toBe(false);
  });
});

describe("hook editing", () => {
  it("updates one command and preserves ordered handlers, exact argv and advanced matcher fields", () => {
    const handlers = [
      { type: "command", command: " first ", timeout: 9 },
      { type: "http", url: "https://example.com/hook", timeout: 17, headers: { Authorization: "${user_config.key}" } },
      { type: "command", command: ["bin with spaces", "", "path with spaces"], timeout: 31 },
    ];
    const source = { event: "PreToolUse", index: 0, entry: { matcher: "run_shell", if: "Shell(prefix)", hooks: handlers }, handlers };
    const draft = makeHookDraft(source);
    const updated = hookDraftEntry({ ...draft, commands: { ...draft.commands, 0: { format: "shell", text: " new\ncommand " } } });
    expect(updated).toEqual({
      ok: true,
      entry: {
        matcher: "run_shell",
        if: "Shell(prefix)",
        hooks: [
          { type: "command", command: " new\ncommand ", timeout: 9 },
          { type: "http", url: "https://example.com/hook", timeout: 17, headers: { Authorization: "${user_config.key}" } },
          { type: "command", command: ["bin with spaces", "", "path with spaces"], timeout: 31 },
        ],
      },
    });
  });

  it("moves an entry without overwriting siblings at either event", () => {
    const kept = { hooks: [{ type: "command", command: "kept" }] };
    const moved = { hooks: [{ type: "command", command: ["program", ""] }] };
    const other = { hooks: [{ type: "http", url: "https://example.com/hook" }] };
    expect(replaceHook({ PreToolUse: [kept, moved], Stop: [other] }, { event: "PreToolUse", index: 1 }, "Stop", moved))
      .toEqual({ PreToolUse: [kept], Stop: [other, moved] });
  });
});
