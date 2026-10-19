import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema, type Tool as McpDefinition } from "@modelcontextprotocol/sdk/types.js";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PluginRuntime } from "../src/agent/plugins";
import { McpManager } from "../src/agent/plugins/mcp";
import { AskGate } from "../src/main/ask-gate";
import { installPluginTools, setToolGateDeps } from "../src/main/tool-gates";
import { newAutonomySession, type PermissionMode, type ToolResultWithAudit } from "../src/permissions";
import { TOOLS } from "../src/tools";
import type { Tool } from "../src/tools/base";

const name = "mcp__plugin_changing_stub__work";
const dirs: string[] = [];
const runtimes: PluginRuntime[] = [];
const injected: string[] = [];
const cleanup: (() => Promise<void>)[] = [];
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function definition(readOnly: boolean, destructive = false): McpDefinition {
  return { name: "work", inputSchema: { type: "object" }, annotations: { readOnlyHint: readOnly, destructiveHint: destructive } };
}
async function setup(mode: PermissionMode, initial = definition(true), gate: AskGate | null = null) {
  const dir = await mkdtemp(join(tmpdir(), "mcp-current-permissions-"));
  dirs.push(dir);
  for (const plugin of ["changing", "other"]) {
    const root = join(dir, "plugins", plugin, ".claude-plugin");
    await mkdir(root, { recursive: true });
    await writeFile(join(root, "plugin.json"), JSON.stringify({ name: plugin, version: "1.0.0", mcpServers: { stub: { command: "unused" } } }));
  }
  const runtime = await PluginRuntime.load({ workspace: dir, home: dir, projectPluginsDir: join(dir, "plugins"), userPluginsDir: join(dir, "none"), projectSkillsDir: join(dir, "skills"), looseRoots: [], pluginDataRoot: join(dir, "data"), trustFile: join(dir, "trust.json") });
  runtimes.push(runtime);
  let definitions = [initial];
  const calls: { plugin: string; tool: string }[] = [];
  runtime.mcp = new McpManager(async (_config, plugin) => {
    const client = new Client({ name: "permission-test", version: "1" });
    const server = new Server({ name: "local-fixture", version: "1" }, { capabilities: { tools: {} } });
    server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: plugin === "changing" ? definitions : [definition(true)] }));
    server.setRequestHandler(CallToolRequestSchema, (request) => {
      calls.push({ plugin, tool: request.params.name });
      return { content: [{ type: "text", text: "executed current tool" }] };
    });
    const [transport, other] = InMemoryTransport.createLinkedPair();
    await server.connect(other);
    cleanup.push(async () => { await client.close(); await server.close(); });
    return { client, transport };
  }, 1000, 1000);
  expect(await runtime.trustDecide("changing", true)).toBe(true);
  await runtime.connectMcp();
  injected.push(...installPluginTools(runtime));
  const autonomy = newAutonomySession(mode, { planBlocked: () => false });
  setToolGateDeps({ currentSession: () => ({ autonomy, askGate: gate, sandbox: null }) });
  const tool = (TOOLS as unknown as Record<string, Tool>)[name]!;
  expect(tool).toBeDefined();
  const reconnect = async (next: McpDefinition[]) => {
    expect(await runtime.trustDecide("changing", false)).toBe(true);
    definitions = next;
    expect(await runtime.trustDecide("changing", true)).toBe(true);
    await runtime.connectMcp();
  };
  return { runtime, calls, tool, reconnect, ctx: { workspace: dir } };
}
afterEach(async () => {
  for (const name of injected.splice(0)) delete (TOOLS as unknown as Record<string, Tool>)[name];
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.shutdown()));
  await Promise.all(cleanup.splice(0).map((close) => close()));
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("MCP 权限使用当前工具清单", () => {
  it("旧入口不能把重连后的写工具继续按只读工具放行", async () => {
    const s = await setup("read-only");
    expect((await s.tool.run({}, s.ctx)).ok).toBe(true);
    await s.reconnect([definition(false)]);
    const result = await s.tool.run({}, s.ctx);
    expect(result.ok).toBe(false);
    expect(result.output).toContain("permission denied");
    expect(s.calls).toHaveLength(1);
  });

  it("重连后变成 destructive 工具，在 auto 档也使用当前风险发起审批", async () => {
    let asked = 0;
    const gate = new AskGate({ timeoutMs: 1000, notify: (request) => { asked++; gate.decide(request.askId, false, "user"); } });
    const s = await setup("auto", definition(true), gate);
    await s.reconnect([definition(false, true)]);
    expect((await s.tool.run({}, s.ctx)).ok).toBe(false);
    expect(asked).toBe(1);
    expect(s.calls).toEqual([]);
  });

  it("重连后工具已移出清单，缓存的旧入口不能继续调用同名服务器方法", async () => {
    const s = await setup("read-only");
    await s.reconnect([]);
    expect(s.runtime.mcpTools.has(name)).toBe(false);
    const result = await s.tool.run({}, s.ctx);
    expect(result.ok).toBe(false);
    expect(result.output).toMatch(/停用|未激活|未注册/u);
    expect(s.calls).toEqual([]);
  });

  it("写工具重连后已变成只读，旧入口按当前清单正常放行", async () => {
    const s = await setup("read-only", definition(false));
    await s.reconnect([definition(true)]);
    expect((await s.tool.run({}, s.ctx)).ok).toBe(true);
    expect(s.calls).toHaveLength(1);
  });

  it("审批等待期间工具被重新连接，旧审批不能执行新一代工具", async () => {
    const entered = deferred<string>();
    const gate = new AskGate({ timeoutMs: 3000, notify: (request) => entered.resolve(request.askId) });
    const s = await setup("default", definition(false), gate);
    const pending = s.tool.run({}, s.ctx);
    const askId = await entered.promise;
    await s.reconnect([definition(false)]);
    gate.decide(askId, true, "user", "once");
    const result = await pending as ToolResultWithAudit;
    expect(result.ok).toBe(false);
    expect(result.output).toMatch(/停用|更新/u);
    expect(result.gate?.verdict).toBe("approved");
    expect(s.calls).toEqual([]);
  });

  it("其他插件批准导致清单包装对象变化，不误伤原工具正在等待的审批", async () => {
    const entered = deferred<string>();
    const gate = new AskGate({ timeoutMs: 3000, notify: (request) => entered.resolve(request.askId) });
    const s = await setup("default", definition(false), gate);
    const original = s.runtime.mcpTools.get(name);
    const pending = s.tool.run({}, s.ctx);
    const askId = await entered.promise;
    expect(await s.runtime.trustDecide("other", true)).toBe(true);
    await s.runtime.connectMcp();
    expect(s.runtime.mcpTools.get(name)).not.toBe(original);
    gate.decide(askId, true, "user", "once");
    const result = await pending as ToolResultWithAudit;
    expect(result.ok).toBe(true);
    expect(result.gate?.verdict).toBe("approved");
    expect(s.calls).toEqual([{ plugin: "changing", tool: "work" }]);
  });

  it("正常审批仍可执行当前写工具", async () => {
    const gate = new AskGate({ timeoutMs: 1000, notify: (request) => gate.decide(request.askId, true, "user", "once") });
    const s = await setup("default", definition(false), gate);
    const result = await s.tool.run({}, s.ctx) as ToolResultWithAudit;
    expect(result.ok).toBe(true);
    expect(result.gate?.verdict).toBe("approved");
    expect(s.calls).toHaveLength(1);
  });

  it("工具已撤回时直接拒绝旧入口，不再弹出无效审批", async () => {
    let asked = 0;
    const gate = new AskGate({ timeoutMs: 1000, notify: (request) => { asked++; gate.decide(request.askId, false, "user"); } });
    const s = await setup("default", definition(false), gate);
    expect(await s.runtime.trustDecide("changing", false)).toBe(true);
    expect((await s.tool.run({}, s.ctx)).ok).toBe(false);
    expect(asked).toBe(0);
    expect(s.calls).toEqual([]);
  });
});
