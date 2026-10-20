import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema, type Tool as McpDefinition } from "@modelcontextprotocol/sdk/types.js";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PluginRuntime } from "../src/agent/plugins";
import { McpManager } from "../src/agent/plugins/mcp";
import { AskGate } from "../src/main/ask-gate";
import { installPluginTools, resolveLivePluginTool, setToolGateDeps } from "../src/main/tool-gates";
import { newAutonomySession, type PermissionMode, type ToolResultWithAudit } from "../src/permissions";
import { TOOLS } from "../src/tools";
import type { Tool } from "../src/tools/base";

const name = "mcp__plugin_changing_stub__work";
/** 下面那个 describe 用的是另一个插件名（late）——它的 scoped 名要另立，
 *  抄上面这个常量会让断言打到不存在的键上（假红）。 */
const lateName = "mcp__plugin_late_stub__work";
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

describe("run 中途批准的插件：模型看得见，执行面也必须动得了（2026-10-19）", () => {
  /** 起点时插件**还没批**（pending）⇒ installPluginTools 不会注入它的工具，模型面也没有它。
   *  随后用户批准 + connectMcp ⇒ rt.mcpTools 立刻多出 scoped 名，provider 的 requestFace
   *  （读的是 rt.mcpTools 活引用）下一轮就把它列进模型清单。可执行表还是起点快照。 */
  async function setupPending() {
    const dir = await mkdtemp(join(tmpdir(), "mcp-midrun-approve-"));
    dirs.push(dir);
    for (const plugin of ["late"]) {
      const root = join(dir, "plugins", plugin, ".claude-plugin");
      await mkdir(root, { recursive: true });
      await writeFile(join(root, "plugin.json"), JSON.stringify({ name: plugin, version: "1.0.0", mcpServers: { stub: { command: "unused" } } }));
    }
    const runtime = await PluginRuntime.load({ workspace: dir, home: dir, projectPluginsDir: join(dir, "plugins"), userPluginsDir: join(dir, "none"), projectSkillsDir: join(dir, "skills"), looseRoots: [], pluginDataRoot: join(dir, "data"), trustFile: join(dir, "trust.json") });
    runtimes.push(runtime);
    const calls: { plugin: string; tool: string }[] = [];
    runtime.mcp = new McpManager(async (_config, plugin) => {
      const client = new Client({ name: "midrun-test", version: "1" });
      const server = new Server({ name: "local-fixture", version: "1" }, { capabilities: { tools: {} } });
      server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: [definition(true)] }));
      server.setRequestHandler(CallToolRequestSchema, (request) => {
        calls.push({ plugin, tool: request.params.name });
        return { content: [{ type: "text", text: "executed late tool" }] };
      });
      const [transport, other] = InMemoryTransport.createLinkedPair();
      await server.connect(other);
      cleanup.push(async () => { await client.close(); await server.close(); });
      return { client, transport };
    }, 1000, 1000);
    // 起点：未批准 ⇒ 不连接、不注入（§9.8 信任门）。TOOLS 里没有这把工具。
    await runtime.connectMcp();
    const injectedAtStart = installPluginTools(runtime);
    injected.push(...injectedAtStart);
    const autonomy = newAutonomySession("read-only", { planBlocked: () => false });
    setToolGateDeps({ currentSession: () => ({ autonomy, askGate: null, sandbox: null }) });
    return { runtime, calls, ctx: { workspace: dir } };
  }

  it("批准前：执行表里没有它，解析器也拿不到（fail-closed 不放行未注册工具）", async () => {
    const s = await setupPending();
    expect(s.runtime.mcpTools.has(lateName)).toBe(false);
    expect((TOOLS as unknown as Record<string, Tool>)[lateName]).toBeUndefined();
    expect(resolveLivePluginTool(lateName, s.runtime)).toBeUndefined();
  });

  it("批准后：模型面已列出它（mcpTools 有它），解析器补上执行入口 ⇒ 真能跑，不是 unknown tool", async () => {
    const s = await setupPending();
    // 用户在这时候点了「信任」：handlePluginDecide 走的就是这两步
    expect(await s.runtime.trustDecide("late", true)).toBe(true);
    await s.runtime.connectMcp();
    // 模型面这一侧：requestFace 逐请求重算，此刻起下一轮就看得见这把工具
    expect(s.runtime.mcpTools.has(lateName)).toBe(true);
    // 执行面那一侧：起点快照里没有它，靠 resolveTool 补表才动得了
    expect((TOOLS as unknown as Record<string, Tool>)[lateName]).toBeUndefined();
    const resolved = resolveLivePluginTool(lateName, s.runtime);
    expect(resolved, "批准后必须补得上执行入口，否则模型看到的是把跑不起来的工具").toBeDefined();
    const result = await resolved!.run({}, s.ctx);
    expect(result.ok).toBe(true);
    expect(s.calls).toEqual([{ plugin: "late", tool: "work" }]);
  });

  it("接线：agent-runner 把 resolveTool 交给 loop（模型面逐请求重算，执行面也得跟着动）", () => {
    const src = readFileSync(fileURLToPath(new URL("../src/main/agent-runner.ts", import.meta.url)), "utf8");
    // 不接这一手，模型看得见（requestFace 读 rt.mcpTools 活引用）却落一句 unknown tool
    expect(src).toContain("resolveTool: (name: string) => resolveLivePluginTool(name, rt)");
    expect(src).toContain("resolveLivePluginTool");
  });

  it("未证：真会话里「运行中批准 ⇒ 下一轮模型就调它」这一条**没有端到端判据**", () => {
    // 如实记着：这一格要串起「run 起跑 → 中途批准 → 模型下一轮调它」，
    // 需要脚本化模型 + 真 MCP server + 并发（批准走的是桌面 IPC 通道，不在 runAgent 内部）。
    // 本文件覆盖的是两端各自的判据（loop 会问 resolveTool；解析器能给得出入口），
    // 串起来的并发那一跳**未证**——不把两端当一端。
    expect(true).toBe(true);
  });

  it("反向：撤销后 mcpTools 里没有它 ⇒ 解析器不给入口（补表不放行已撤回的工具）", async () => {
    const s = await setupPending();
    expect(await s.runtime.trustDecide("late", true)).toBe(true);
    await s.runtime.connectMcp();
    expect(s.runtime.mcpTools.has(lateName)).toBe(true);
    expect(await s.runtime.trustDecide("late", false)).toBe(true);
    expect(s.runtime.mcpTools.has(lateName)).toBe(false);
    expect(resolveLivePluginTool(lateName, s.runtime)).toBeUndefined();
  });
});
