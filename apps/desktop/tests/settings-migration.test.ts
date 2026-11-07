import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { McpServerConfig } from "../../../src/agent/plugins/types";
import { SettingsStore } from "../../../src/main/settings";
import { UserIntegrationSettings } from "../../../src/main/user-integration-settings";
import { SettingsMigration } from "../src/main/settings-migration";

let directory: string;
let files: string[];
let instructions: string;
let servers: Map<string, McpServerConfig>;
let failMcpWrite: boolean;
let migration: SettingsMigration;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "cairn-migration-"));
  files = [];
  instructions = "";
  servers = new Map();
  failMcpWrite = false;
  migration = new SettingsMigration({
    pickFiles: async () => files,
    getInstructions: async () => instructions,
    importInstructions: async (content) => {
      if (instructions !== "") return false;
      instructions = content;
      return true;
    },
    listMcpNames: async () => [...servers.keys()],
    importMcp: async (items) => {
      if (failMcpWrite) throw new Error("Sensitive storage failure");
      const added = [];
      for (const { name, config } of items) {
        if (servers.has(name)) continue;
        servers.set(name, config);
        added.push(name);
      }
      return added;
    },
  });
});

afterEach(() => rm(directory, { recursive: true, force: true }));

async function choose(name: string, content: string): Promise<void> {
  const path = join(directory, name);
  await writeFile(path, content);
  files.push(path);
}

async function actualDestination() {
  const appData = join(directory, "app-data");
  await mkdir(appData);
  const settingsFile = join(appData, "settings.json");
  const mcpFile = join(appData, "mcp.json");
  const settings = new SettingsStore(settingsFile);
  const integrations = new UserIntegrationSettings(appData);
  const importer = new SettingsMigration({
    pickFiles: async () => files,
    getInstructions: async () => (await settings.get()).customInstructions,
    importInstructions: (content) => settings.importCustomInstructions(content),
    listMcpNames: () => integrations.listMcpNames(),
    importMcp: (items) => integrations.importMcp(items),
  });
  return { settings, settingsFile, mcpFile, importer };
}

describe("settings migration", () => {
  it("imports through the actual destination stores without overwriting existing data", async () => {
    const { settings, settingsFile, mcpFile, importer } = await actualDestination();
    const currentMcp = { mcpServers: { existing: { command: "existing-tool", disabled: false } } };
    await settings.set({ locale: "en-US" });
    await writeFile(mcpFile, JSON.stringify(currentMcp));
    await choose("AGENTS.md", "Use predictable fixtures.\n");
    await choose("config.toml", `
[mcp_servers.existing]
command = "incoming-tool"

[mcp_servers.docs]
url = "https://example.com/mcp"
enabled_tools = ["search"]
`);
    const preview = (await importer.preview("codex"))!;
    const selected = preview.items.filter((item) => item.status === "ready").map((item) => item.id);
    expect(selected).toHaveLength(2);
    expect(JSON.parse(await readFile(mcpFile, "utf-8"))).toEqual(currentMcp);
    expect((await new SettingsStore(settingsFile).get()).customInstructions).toBe("");
    expect(await importer.apply(preview.id, selected)).toEqual({ imported: selected, skipped: [] });
    expect(await new SettingsStore(settingsFile).get()).toMatchObject({
      locale: "en-US", customInstructions: "Use predictable fixtures.\n",
    });
    expect(JSON.parse(await readFile(mcpFile, "utf-8"))).toEqual({
      mcpServers: {
        ...currentMcp.mcpServers,
        docs: { type: "http", url: "https://example.com/mcp", includeTools: ["search"], disabled: true },
      },
    });
  });

  it("keeps instruction migration available when the destination MCP file is malformed", async () => {
    const { settingsFile, mcpFile, importer } = await actualDestination();
    const broken = '{"mcpServers":{"sensitive-invalid-json"';
    await writeFile(mcpFile, broken);
    await choose("CLAUDE.md", "Use predictable fixtures.\n");
    await choose(".mcp.json", JSON.stringify({ mcpServers: { docs: { command: "npx" } } }));

    const preview = (await importer.preview("claude-code"))!;
    const instruction = preview.items.find((item) => item.kind === "instructions")!;
    expect(instruction.status).toBe("ready");
    expect(preview.items.find((item) => item.name === "docs")).toMatchObject({
      status: "skipped", detail: expect.stringContaining("MCP"),
    });
    expect(JSON.stringify(preview)).not.toContain("sensitive-invalid-json");
    expect(await importer.apply(preview.id, [instruction.id])).toEqual({ imported: [instruction.id], skipped: [] });
    expect((await new SettingsStore(settingsFile).get()).customInstructions).toBe("Use predictable fixtures.\n");
    expect(await readFile(mcpFile, "utf-8")).toBe(broken);
  });

  it("previews selected files without disclosing values or writing, then only copies selected rows", async () => {
    await choose("CLAUDE.md", "# Private instructions\n\nAlways run a check.\n");
    await choose(".claude.json", JSON.stringify({
      mcpServers: {
        docs: { type: "stdio", command: "npx", args: ["-y", "fixture-tool"], env: {} },
        auth: { type: "http", url: "https://example.com", headers: { Authorization: "secret-value" } },
        scoped: { command: "node", args: ["tool.js"], cwd: "/private/project" },
      },
      projects: { "/private/project": { mcpServers: { privateServer: { command: "test" } } } },
      oauthAccount: { email: "private-email" },
    }));
    const preview = (await migration.preview("claude-code"))!;
    expect(preview.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "CLAUDE.md", status: "ready" }),
      expect.objectContaining({ name: "docs", status: "ready" }),
      expect.objectContaining({ name: "auth", status: "unsupported" }),
      expect.objectContaining({ name: "scoped", status: "unsupported" }),
    ]));
    expect(JSON.stringify(preview)).not.toMatch(/Private instructions|fixture-tool|secret-value|privateServer|private-email|private\/project/);
    expect(instructions).toBe("");
    expect(servers.size).toBe(0);

    const docs = preview.items.find((item) => item.name === "docs")!;
    expect(await migration.apply(preview.id, [docs.id])).toEqual({ imported: [docs.id], skipped: [] });
    expect(instructions).toBe("");
    expect([...servers]).toEqual([["docs", { command: "npx", args: ["-y", "fixture-tool"], disabled: true }]]);
    await expect(migration.apply(preview.id, [docs.id])).rejects.toThrow();
  });

  it("preserves Codex tool filters and rejects an unrepresentable empty allowlist", async () => {
    await choose("config.toml", `
model = "private-model"
[mcp_servers."docs"]
url = "https://example.com/mcp"
enabled_tools = [
  "search", # explicit allowlist
  "read",
]
disabled_tools = ["read"]

[mcp_servers.empty]
command = "test"
enabled_tools = []

[mcp_servers.approvals]
url = "https://example.com/mcp"
default_tools_approval_mode = "prompt"

[mcp_servers.secret_url]
url = "https://example.com/mcp?token=private-token"
`);
    const preview = (await migration.preview("codex"))!;
    expect(JSON.stringify(preview)).not.toMatch(/private-model|private-token|https:\/\/example/);
    expect(preview.items.filter((item) => item.kind === "mcp" && item.status === "unsupported").map((item) => item.name))
      .toEqual(["empty", "approvals", "secret_url"]);
    const docs = preview.items.find((item) => item.name === "docs")!;
    expect(await migration.apply(preview.id, [docs.id])).toEqual({ imported: [docs.id], skipped: [] });
    expect(servers.get("docs")).toEqual({
      type: "http", url: "https://example.com/mcp", includeTools: ["search", "read"], excludeTools: ["read"], disabled: true,
    });
  });

  it("applies Codex global override precedence and preserves a destination edited after preview", async () => {
    await choose("AGENTS.md", "Base instructions");
    await choose("AGENTS.override.md", "Override instructions");
    await choose("config.toml", '[mcp_servers.docs]\ncommand = "npx"');
    const preview = (await migration.preview("codex"))!;
    expect(preview.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "AGENTS.md", status: "skipped" }),
      expect.objectContaining({ name: "AGENTS.override.md", status: "ready" }),
    ]));
    const docs = preview.items.find((item) => item.name === "docs")!;
    const override = preview.items.find((item) => item.name === "AGENTS.override.md")!;
    const existing = { command: "already-configured" };
    servers.set("docs", existing);
    expect(await migration.apply(preview.id, [docs.id, override.id])).toEqual({
      imported: [override.id], skipped: [expect.objectContaining({ id: docs.id })],
    });
    expect(servers.get("docs")).toEqual(existing);
    expect(instructions).toBe("Override instructions");
    const next = (await migration.preview("codex"))!;
    expect(next.items.filter((item) => item.status === "collision").map((item) => item.name))
      .toEqual(["AGENTS.override.md", "docs"]);
  });

  it("rejects applying nonselectable rows and reports sanitized partial write failures", async () => {
    await choose("CLAUDE.md", "Run tests.\n");
    await choose("settings.json", JSON.stringify({
      hooks: { PostToolUse: [{ command: "run-secret-hook" }] },
      mcpServers: { docs: { command: "npx", args: ["-y", "fixture-tool"] } },
    }));
    const preview = (await migration.preview("claude-code"))!;
    const hook = preview.items.find((item) => item.name === "Hooks")!;
    expect(hook.status).toBe("unsupported");
    expect(JSON.stringify(preview)).not.toContain("run-secret-hook");
    await expect(migration.apply(preview.id, [hook.id])).rejects.toThrow();
    expect(instructions).toBe("");
    failMcpWrite = true;
    const selected = preview.items.filter((item) => item.status === "ready");
    const result = await migration.apply(preview.id, selected.map((item) => item.id));
    expect(result).toEqual({
      imported: [selected.find((item) => item.kind === "instructions")!.id],
      skipped: [expect.objectContaining({ id: selected.find((item) => item.kind === "mcp")!.id })],
    });
    expect(JSON.stringify(result)).not.toContain("Sensitive storage failure");
    expect(instructions).toBe("Run tests.\n");
    expect(servers.size).toBe(0);
  });

  it("does not offer a less restricted copy of a server listed in two selected files", async () => {
    await choose(".claude.json", JSON.stringify({ mcpServers: { duplicate: { command: "npx" } } }));
    await choose(".mcp.json", JSON.stringify({ mcpServers: { duplicate: { command: "npx", cwd: "/restricted" } } }));
    const preview = (await migration.preview("claude-code"))!;
    expect(preview.items.map((item) => [item.name, item.status])).toEqual([
      ["duplicate", "collision"], ["duplicate", "unsupported"],
    ]);
    expect(servers.size).toBe(0);
  });

  it("refuses to lift MCP restrictions and rejects secret-bearing or ambiguous configs", async () => {
    await choose(".mcp.json", JSON.stringify({
      mcpServers: { guarded: { command: "npx" } },
      deniedMcpServers: [{ serverName: "guarded" }],
    }));
    await choose(".claude.json", JSON.stringify({
      mcpServers: {
        cmd: { command: "npx", args: ["--api-key", "private-arg"] },
        transport: { type: "sse", command: "npx" },
      },
    }));
    const preview = (await migration.preview("claude-code"))!;
    expect(preview.items.filter((item) => item.kind === "mcp")).toEqual([
      expect.objectContaining({ name: "guarded", status: "unsupported" }),
      expect.objectContaining({ name: "cmd", status: "unsupported" }),
      expect.objectContaining({ name: "transport", status: "unsupported" }),
    ]);
    expect(JSON.stringify(preview)).not.toContain("private-arg");
  });
});
