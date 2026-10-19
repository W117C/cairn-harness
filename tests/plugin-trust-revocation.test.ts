import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PluginRuntime } from "../src/agent/plugins";
import { McpManager } from "../src/agent/plugins/mcp";
import { closeAllLspClients, getLspClient, isLspBroken, loadLspConfig, pluginLspServerIds, setLspTrustedRepos } from "../src/tools/lsp";

const serverPath = join(process.cwd(), "fixtures/plugins/project/echo-suite/lsp-server/stub.mjs");
const runtimes: PluginRuntime[] = [];
const cleanup: (() => Promise<void>)[] = [];
const dirs: string[] = [];
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function alive(pid: number) { try { process.kill(pid, 0); return true; } catch { return false; } }
async function setup(beforeList?: (plugin: string) => Promise<void>, onCall?: (plugin: string, signal: AbortSignal) => Promise<CallToolResult>) {
  const dir = await mkdtemp(join(tmpdir(), "plugin-revocation-"));
  dirs.push(dir);
  await mkdir(join(dir, ".agent"));
  await writeFile(join(dir, ".agent/lsp.json"), JSON.stringify({ lsp: {} }));
  for (const name of ["revoked", "kept"]) {
    const root = join(dir, "plugins", name);
    await mkdir(join(root, ".claude-plugin"), { recursive: true });
    await writeFile(join(root, ".claude-plugin/plugin.json"), JSON.stringify({ name, version: "1.0.0", mcpServers: { stub: { command: "unused" } } }));
    await writeFile(join(root, ".lsp.json"), JSON.stringify({ servers: { stub: { command: process.execPath, args: [serverPath], extensionToLanguage: { ["." + name]: "plaintext" } } } }));
    await writeFile(join(dir, "a." + name), "const value = 1;\n");
  }
  const runtime = await PluginRuntime.load({ workspace: dir, home: dir, projectPluginsDir: join(dir, "plugins"), userPluginsDir: join(dir, "none"), projectSkillsDir: join(dir, "skills"), looseRoots: [], pluginDataRoot: join(dir, "data"), trustFile: join(dir, "trust.json") });
  runtimes.push(runtime);
  for (const name of ["revoked", "kept"]) expect(await runtime.trustDecide(name, true)).toBe(true);
  const pairs: { plugin: string; client: Client; close: ReturnType<typeof vi.fn<() => Promise<void>>> }[] = [];
  const factory = vi.fn(async (_cfg, plugin: string) => {
    const client = new Client({ name: "revocation-test", version: "1" });
    const server = new Server({ name: "local-fixture", version: "1" }, { capabilities: { tools: {} } });
    server.setRequestHandler(ListToolsRequestSchema, async () => { await beforeList?.(plugin); return { tools: [{ name: "echo", inputSchema: { type: "object" }, annotations: { readOnlyHint: true } }] }; });
    server.setRequestHandler(CallToolRequestSchema, (_req, extra) => onCall ? onCall(plugin, extra.signal) : { content: [{ type: "text", text: plugin }] });
    const [transport, other] = InMemoryTransport.createLinkedPair();
    const originalClose = client.close.bind(client);
    const close = vi.fn(originalClose);
    client.close = close;
    pairs.push({ plugin, client, close });
    cleanup.push(async () => { await originalClose(); await server.close(); });
    await server.connect(other);
    return { client, transport };
  });
  runtime.mcp = new McpManager(factory, 500, 500);
  return { dir, runtime, pairs, factory };
}
afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.shutdown()));
  await closeAllLspClients();
  setLspTrustedRepos([]);
  await Promise.all(cleanup.splice(0).map((close) => close()));
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("撤回插件信任后旧执行面立即失效", () => {
  it("关闭该插件的 MCP 并摘除工具，其他插件连接与工具继续可用", async () => {
    const { runtime, pairs } = await setup();
    await runtime.connectMcp();
    expect((await runtime.mcp.callTool("revoked", "stub", "echo", {})).ok).toBe(true);
    expect(await runtime.trustDecide("revoked", false)).toBe(true);
    await runtime.connectMcp();
    expect(runtime.mcpTools.has("mcp__plugin_revoked_stub__echo")).toBe(false);
    expect((await runtime.mcp.callTool("revoked", "stub", "echo", {})).ok).toBe(false);
    expect(pairs.find((pair) => pair.plugin === "revoked")?.close).toHaveBeenCalledTimes(1);
    expect(pairs.find((pair) => pair.plugin === "kept")?.close).not.toHaveBeenCalled();
    expect(await runtime.mcp.callTool("kept", "stub", "echo", {})).toEqual({ ok: true, output: "kept" });
    expect(runtime.mcpTools.has("mcp__plugin_kept_stub__echo")).toBe(true);
  });

  it("撤回时关闭在途 MCP 请求，服务端收到断开并停止等待", async () => {
    const entered = deferred<AbortSignal>();
    const { runtime } = await setup(undefined, async (plugin, signal) => {
      if (plugin !== "revoked") return { content: [{ type: "text", text: plugin }] };
      entered.resolve(signal);
      return new Promise<CallToolResult>((resolve) => { signal.addEventListener("abort", () => resolve({ content: [{ type: "text", text: "stopped" }] }), { once: true }); });
    });
    await runtime.connectMcp();
    const pending = runtime.mcp.callTool("revoked", "stub", "echo", {});
    const signal = await entered.promise;
    expect(await runtime.trustDecide("revoked", false)).toBe(true);
    await expect.poll(() => signal.aborted, { timeout: 200 }).toBe(true);
    expect((await pending).ok).toBe(false);
    expect(signal.aborted).toBe(true);
  });

  it("撤回与连接握手并发时，迟到的 tools/list 不能把工具重新登记", async () => {
    const entered = deferred<void>();
    const release = deferred<void>();
    const { runtime, pairs } = await setup(async (plugin) => { if (plugin === "revoked") { entered.resolve(); await release.promise; } });
    const connecting = runtime.connectMcp();
    await entered.promise;
    const revoking = runtime.trustDecide("revoked", false);
    await expect.poll(() => runtime.manifest.plugins.find((plugin) => plugin.name === "revoked")?.trust).toBe("declined");
    release.resolve();
    await Promise.all([connecting, revoking]);
    expect(runtime.mcpTools.has("mcp__plugin_revoked_stub__echo")).toBe(false);
    expect(runtime.mcp.statuses().some((status) => status.plugin === "revoked")).toBe(false);
    expect(pairs.find((pair) => pair.plugin === "revoked")?.close).toHaveBeenCalledTimes(1);
  });

  it("再次批准后建立新的 MCP 连接，保留其他插件的原连接", async () => {
    const { runtime, factory } = await setup();
    await runtime.connectMcp();
    expect(await runtime.trustDecide("revoked", false)).toBe(true);
    expect(await runtime.trustDecide("revoked", true)).toBe(true);
    await runtime.connectMcp();
    expect(factory.mock.calls.filter((call) => call[1] === "revoked")).toHaveLength(2);
    expect(factory.mock.calls.filter((call) => call[1] === "kept")).toHaveLength(1);
    expect(await runtime.mcp.callTool("revoked", "stub", "echo", {})).toEqual({ ok: true, output: "revoked" });
  });

  it("撤回摘除 LSP 注册并终止已启动进程，不关闭其他插件的语言服务", async () => {
    const { runtime, dir } = await setup();
    runtime.activateLsp();
    const config = loadLspConfig(dir);
    const revoked = await getLspClient(dir, config, "revoked:stub");
    const kept = await getLspClient(dir, config, "kept:stub");
    expect(alive(revoked.pid)).toBe(true);
    expect(await runtime.trustDecide("revoked", false)).toBe(true);
    expect(pluginLspServerIds(dir)).toEqual(["kept:stub"]);
    expect(runtime.activeLspServerIds()).toEqual(["kept:stub"]);
    await expect.poll(() => alive(revoked.pid)).toBe(false);
    expect(alive(kept.pid)).toBe(true);
    expect(await getLspClient(dir, loadLspConfig(dir), "kept:stub")).toBe(kept);
  });

  it("缓存的旧 LSP 配置不能在撤回后重新调用，即使宿主工作区已获信任", async () => {
    const { runtime, dir } = await setup();
    runtime.activateLsp();
    const oldConfig = loadLspConfig(dir);
    setLspTrustedRepos([dir]);
    expect(await runtime.trustDecide("revoked", false)).toBe(true);
    const status = await getLspClient(dir, oldConfig, "revoked:stub").then(() => "allowed", (error: unknown) => String(error));
    expect(status).toMatch(/停用|撤回|信任/u);
  });

  it("重新批准 LSP 后起新进程，旧进程迟到的退出事件不污染新缓存", async () => {
    const { runtime, dir } = await setup();
    runtime.activateLsp();
    const oldClient = await getLspClient(dir, loadLspConfig(dir), "revoked:stub");
    expect(await runtime.trustDecide("revoked", false)).toBe(true);
    expect(await runtime.trustDecide("revoked", true)).toBe(true);
    runtime.activateLsp();
    const current = await getLspClient(dir, loadLspConfig(dir), "revoked:stub");
    expect(current.pid).not.toBe(oldClient.pid);
    (oldClient as unknown as { child: ChildProcess }).child.emit("exit", 0);
    expect(isLspBroken(dir, "revoked:stub")).toBe(false);
    expect(await getLspClient(dir, loadLspConfig(dir), "revoked:stub")).toBe(current);
  });

  it("宿主同名 LSP 进程不属于插件，撤回插件不能关闭它", async () => {
    const { runtime, dir } = await setup();
    await writeFile(join(dir, ".agent/lsp.json"), JSON.stringify({ lsp: { "revoked:stub": { command: process.execPath, args: [serverPath], extensions: [".host"] } } }));
    runtime.activateLsp();
    setLspTrustedRepos([dir]);
    const host = await getLspClient(dir, loadLspConfig(dir), "revoked:stub");
    expect(await runtime.trustDecide("revoked", false)).toBe(true);
    expect(alive(host.pid)).toBe(true);
    expect(await getLspClient(dir, loadLspConfig(dir), "revoked:stub")).toBe(host);
  });
});
