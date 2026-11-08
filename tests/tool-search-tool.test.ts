import { afterEach, describe, expect, it, vi } from "vitest";
import type { PluginRuntime } from "../src/agent/plugins";
import type { McpToolInfo } from "../src/agent/plugins/mcp";
import {
  installPluginTools,
  pluginToolSpecsFromRuntime,
  resolveLivePluginTool,
  sessionToolFace,
  setToolGateDeps,
  readOnlyGateSession,
} from "../src/main/tool-gates";
import { TOOLS } from "../src/tools";

const SERVER = "fake/stub";

function scoped(tool: string): string {
  return "mcp__plugin_fake_stub__" + tool;
}

function toolInfo(tool: string, grade: McpToolInfo["grade"], schema: Record<string, unknown>): McpToolInfo & { plugin: string; server: string } {
  return {
    name: tool,
    description: tool === "echo" ? "回显输入文本" : "写入一条备注（有副作用）",
    inputSchema: schema,
    scopedName: scoped(tool),
    grade,
    plugin: "fake",
    server: "stub",
  };
}

function fakeRuntime(): {
  rt: PluginRuntime;
  active: Set<string>;
  calls: Array<{ tool: string; args: Record<string, unknown> }>;
} {
  const active = new Set<string>();
  const calls: Array<{ tool: string; args: Record<string, unknown> }> = [];
  const schemas: Record<string, Record<string, unknown>> = {
    echo: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
    write_note: { type: "object", properties: { note: { type: "string" } }, required: ["note"] },
  };
  const tools = new Map<string, McpToolInfo & { plugin: string; server: string }>();
  tools.set(scoped("echo"), toolInfo("echo", { annotated: true, readOnly: true }, schemas.echo!));
  tools.set(scoped("write_note"), toolInfo("write_note", { annotated: false }, schemas.write_note!));
  const runtime = {
    mcpTools: tools,
    skills: () => [],
    isMcpToolActive: (name: string) => active.has(name),
    isMcpServerActive: () => false,
    activeMcpToolCount: () => active.size,
    mcpServerSummaries: () => [{ key: SERVER, plugin: "fake", server: "stub", toolCount: 2, active: false, activeMode: "none", activeToolCount: 0 }],
    mcpServerTools: (key: string) => key === SERVER
      ? [...tools.values()].map((info) => ({ name: info.name, scopedName: info.scopedName, description: info.description, active: active.has(info.scopedName) }))
      : null,
    activateMcpTools: (key: string, names: string[]) => {
      if (key !== SERVER) return { ok: false, tools: [], error: "unknown server" };
      for (const info of tools.values()) {
        if (names.includes(info.name) || names.includes(info.scopedName)) active.add(info.scopedName);
      }
      return { ok: true, tools: (runtime as { mcpServerTools(k: string): unknown[] }).mcpServerTools(key) };
    },
    activateMcpServer: () => ({ ok: true, tools: [] }),
    releaseMcpServer: () => ({ ok: true, removed: 0 }),
    releaseMcpTool: () => ({ ok: true }),
    mcp: {
      callTool: async (_plugin: string, _server: string, tool: string, args: Record<string, unknown>) => {
        calls.push({ tool, args });
        return { ok: true, output: "called " + tool };
      },
    },
  };
  return { rt: runtime as unknown as PluginRuntime, active, calls };
}

describe("tool_search runtime wiring", () => {
  const injected = new Set<string>();

  afterEach(() => {
    for (const name of injected) delete TOOLS[name];
    injected.clear();
    setToolGateDeps({ currentSession: () => null });
  });

  it("finds an inactive tool without activating or executing it, and returns the executable schema", async () => {
    const { rt, active, calls } = fakeRuntime();
    for (const name of installPluginTools(rt)) injected.add(name);
    expect(injected.has("tool_search")).toBe(true);
    expect(injected.has(scoped("echo"))).toBe(false);
    const tool = TOOLS["tool_search"]!;
    expect(tool).toBeDefined();
    const result = await tool.run({ query: "echo" }, { workspace: process.cwd() });
    expect(result.ok).toBe(true);
    const payload = JSON.parse(result.output) as {
      hits: Array<{ name: string; active: boolean; inputSchema: unknown; activation?: unknown }>;
    };
    const hit = payload.hits.find((h) => h.name === scoped("echo"));
    expect(hit).toBeDefined();
    expect(hit!.active).toBe(false);
    expect(hit!.inputSchema).toEqual(rt.mcpTools.get(scoped("echo"))!.inputSchema);
    expect(hit!.activation).toEqual({ tool: "mcp_activate", server: SERVER, tool_name: scoped("echo") });
    expect(active.size).toBe(0);
    expect(calls).toHaveLength(0);
    // The search itself is in the model face; the hidden tool is not.
    expect(pluginToolSpecsFromRuntime(rt).map((t) => t.name)).toContain("tool_search");
    expect(pluginToolSpecsFromRuntime(rt).map((t) => t.name)).not.toContain(scoped("echo"));
    // Read-only callers keep the catalog surface (it grants no execution authority).
    const readOnlyFace = sessionToolFace(null, { mode: "read-only", pluginTools: pluginToolSpecsFromRuntime(rt) });
    expect(readOnlyFace.tools.map((t) => t.function.name)).toContain("tool_search");
    expect(readOnlyFace.tools.map((t) => t.function.name)).not.toContain(scoped("write_note"));
  });

  it("still requires the normal activation and permission gate after discovery", async () => {
    const { rt, active, calls } = fakeRuntime();
    for (const name of installPluginTools(rt)) injected.add(name);
    const searched = await TOOLS["tool_search"]!.run({ query: "备注" }, { workspace: process.cwd() });
    expect(searched.ok).toBe(true);
    expect(active.size).toBe(0);
    // Discovery does not make the write tool resolvable.
    expect(resolveLivePluginTool(scoped("write_note"), rt)).toBeUndefined();

    const activated = await TOOLS["mcp_activate"]!.run({ server: SERVER, tools: ["write_note"] }, { workspace: process.cwd() });
    expect(activated.ok).toBe(true);
    expect(active.has(scoped("write_note"))).toBe(true);
    for (const name of installPluginTools(rt)) injected.add(name);

    setToolGateDeps({ currentSession: () => readOnlyGateSession(process.cwd()) });
    const denied = await TOOLS[scoped("write_note")]!.run({ note: "secret" }, { workspace: process.cwd() });
    expect(denied.ok).toBe(false);
    expect(denied.output).toContain("[permission denied]");
    expect(calls).toHaveLength(0);
  });
});
