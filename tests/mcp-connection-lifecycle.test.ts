import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { PluginRuntime } from "../src/agent/plugins";
import { McpManager } from "../src/agent/plugins/mcp";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
const managers: McpManager[] = [];
const cleanups: (() => Promise<void>)[] = [];
const dirs: string[] = [];
const config = { type: "http" as const, url: "http://unused.invalid" };
function setup(beforeList?: (plugin: string, server: string) => Promise<void>) {
  const pairs: { client: Client; server: Server; transport: InMemoryTransport; close: MockInstance<Client["close"]>; closeClient: () => Promise<void> }[] = [];
  const factory = vi.fn(async (_config, plugin: string, name: string) => {
    const client = new Client({ name: "lifecycle-test", version: "1" });
    const server = new Server({ name: "local-service", version: "1" }, { capabilities: { tools: {} } });
    server.setRequestHandler(ListToolsRequestSchema, async () => {
      await beforeList?.(plugin, name);
      return { tools: [{ name: "echo", inputSchema: { type: "object" } }] };
    });
    server.setRequestHandler(CallToolRequestSchema, () => ({ content: [{ type: "text", text: plugin + "/" + name }] }));
    const [transport, serverTransport] = InMemoryTransport.createLinkedPair();
    const closeClient = client.close.bind(client);
    const close = vi.spyOn(client, "close");
    pairs.push({ client, server, transport, close, closeClient });
    cleanups.push(async () => { await client.close(); await server.close(); });
    await server.connect(serverTransport);
    return { client, transport };
  });
  const manager = new McpManager(factory, 300, 300);
  managers.push(manager);
  return { manager, factory, pairs };
}
afterEach(async () => {
  await Promise.all(managers.splice(0).map((manager) => manager.disconnectAll()));
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  vi.restoreAllMocks();
});

describe("MCP 连接的并发与退出收束", () => {
  it("同一服务并发接入只建一个 SDK 客户端，退出关闭该客户端", async () => {
    const { manager, factory, pairs } = setup();
    const results = await Promise.all([manager.connect("p", "s", config), manager.connect("p", "s", config)]);
    expect(results.map((result) => result.ok)).toEqual([true, true]);
    expect(results[0]?.tools).toEqual(results[1]?.tools);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(manager.statuses()).toHaveLength(1);
    await manager.disconnectAll();
    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.close).toHaveBeenCalledTimes(1);
    expect(manager.statuses()).toEqual([]);
  });

  it("连接尚在 tools/list 时重入仍共用同一轮握手", async () => {
    const entered = deferred<void>();
    const release = deferred<void>();
    const { manager, factory } = setup(async () => { entered.resolve(); await release.promise; });
    const first = manager.connect("p", "s", config);
    await entered.promise;
    const second = manager.connect("p", "s", config);
    release.resolve();
    const results = await Promise.all([first, second]);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("不同服务独立连接，一处慢握手不阻塞另一处", async () => {
    const entered = deferred<void>();
    const release = deferred<void>();
    const { manager, factory } = setup(async (_plugin, server) => {
      if (server === "slow") { entered.resolve(); await release.promise; }
    });
    const slow = manager.connect("p", "slow", config);
    await entered.promise;
    try {
      const fast = await manager.connect("p", "fast", config);
      expect(fast.ok).toBe(true);
      expect(await manager.callTool("p", "fast", "echo", {})).toEqual({ ok: true, output: "p/fast" });
    } finally {
      release.resolve();
    }
    expect((await slow).ok).toBe(true);
    expect(factory).toHaveBeenCalledTimes(2);
    expect(manager.statuses()).toHaveLength(2);
  });

  it("并发连接失败时共用一次失败与清理；之后的 connect 允许重试（不缓存死错误）", async () => {
    const { manager, factory, pairs } = setup(async () => { throw new Error("fixture list failed"); });
    const results = await Promise.all([manager.connect("p", "s", config), manager.connect("p", "s", config)]);
    expect(results.map((result) => result.ok)).toEqual([false, false]);
    expect(results[0]?.error).toContain("fixture list failed");
    expect(results[1]).toEqual(results[0]);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(pairs[0]?.close).toHaveBeenCalledTimes(1);
    // 2026-10-19：失败缓存不再永久生效——下一次 connect 重新握手（server 崩溃后可恢复）。
    expect((await manager.connect("p", "s", config)).ok).toBe(false);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it("退出接管正在建立的连接，不让迟到连接在退出后复活", async () => {
    const entered = deferred<void>();
    const release = deferred<void>();
    const { manager, pairs } = setup(async () => { entered.resolve(); await release.promise; });
    const connecting = manager.connect("p", "s", config);
    await entered.promise;
    const closing = manager.disconnectAll();
    release.resolve();
    await Promise.all([connecting, closing]);
    expect(manager.statuses()).toEqual([]);
    expect(pairs[0]?.close).toHaveBeenCalledTimes(1);
    expect((await manager.callTool("p", "s", "echo", {})).ok).toBe(false);
  });

  it("退出期间不启动新连接，关闭完成后允许重新接入", async () => {
    const entered = deferred<void>();
    const release = deferred<void>();
    const { manager, factory } = setup(async () => { entered.resolve(); await release.promise; });
    const connecting = manager.connect("p", "s", config);
    await entered.promise;
    const closing = manager.disconnectAll();
    const duringClose = manager.connect("p", "new", config);
    release.resolve();
    const [result] = await Promise.all([duringClose, connecting, closing]);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/关闭|退出/u);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(manager.statuses()).toEqual([]);
    expect((await manager.connect("p", "s", config)).ok).toBe(true);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it("客户端工厂尚未交付时退出，迟到客户端仍会关闭且不会提供可调用工具", async () => {
    const entered = deferred<void>();
    const release = deferred<void>();
    const { manager, factory, pairs } = setup();
    const create = factory.getMockImplementation()!;
    factory.mockImplementation(async (...args) => {
      entered.resolve();
      await release.promise;
      return create(...args);
    });
    const connecting = manager.connect("p", "s", config);
    await entered.promise;
    expect(pairs).toHaveLength(0);
    const closing = manager.disconnectAll();
    release.resolve();
    const [result] = await Promise.all([connecting, closing]);
    expect(result.ok).toBe(false);
    expect(result.tools).toEqual([]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.close).toHaveBeenCalledTimes(1);
    expect(manager.statuses()).toEqual([]);
  });

  it("正在建立的连接失败恰逢退出，也不能在退出后重新留下失败记录", async () => {
    const entered = deferred<void>();
    const release = deferred<void>();
    const { manager, pairs } = setup(async () => {
      entered.resolve();
      await release.promise;
      throw new Error("list failed during shutdown");
    });
    const connecting = manager.connect("p", "s", config);
    await entered.promise;
    const closing = manager.disconnectAll();
    release.resolve();
    const [result] = await Promise.all([connecting, closing]);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("list failed during shutdown");
    expect(pairs[0]?.close).toHaveBeenCalledTimes(1);
    expect(manager.statuses()).toEqual([]);
  });

  it("两个并发退出请求共用关闭过程，不重复关闭客户端", async () => {
    const { manager, pairs } = setup();
    expect((await manager.connect("p", "s", config)).ok).toBe(true);
    const entered = deferred<void>();
    const release = deferred<void>();
    const pair = pairs[0]!;
    pair.close.mockImplementation(async () => { entered.resolve(); await release.promise; await pair.closeClient(); });
    const first = manager.disconnectAll();
    await entered.promise;
    const second = manager.disconnectAll();
    release.resolve();
    await Promise.all([first, second]);
    expect(pair.close).toHaveBeenCalledTimes(1);
    expect(manager.statuses()).toEqual([]);
  });

  it("上一轮迟到的 onclose 不能把重新连接的服务标成失败", async () => {
    const { manager, pairs } = setup();
    expect((await manager.connect("p", "s", config)).ok).toBe(true);
    const oldOnClose = pairs[0]?.transport.onclose;
    expect(oldOnClose).toBeTypeOf("function");
    await manager.disconnectAll();
    expect((await manager.connect("p", "s", config)).ok).toBe(true);
    oldOnClose?.();
    expect(manager.statuses()[0]?.state).toBe("connected");
    expect(await manager.callTool("p", "s", "echo", {})).toEqual({ ok: true, output: "p/s" });
  });

  it("真实 PluginRuntime 的并发 connectMcp 不重复启动同一受信服务", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mcp-runtime-connect-"));
    dirs.push(dir);
    const runtime = await PluginRuntime.load({
      workspace: dir, home: dir, userPluginsDir: join(dir, "user-plugins"),
      projectPluginsDir: join(process.cwd(), "fixtures/plugins/project"),
      projectSkillsDir: join(dir, "project-skills"), looseRoots: [],
      pluginDataRoot: join(dir, "data"), trustFile: join(dir, "trust.json"),
    });
    const { manager, factory } = setup();
    runtime.mcp = manager;
    try {
      expect(await runtime.trustDecide("echo-suite", true)).toBe(true);
      await Promise.all([runtime.connectMcp(), runtime.connectMcp()]);
      expect(factory).toHaveBeenCalledTimes(1);
      expect(runtime.mcpTools.size).toBe(1);
      expect(runtime.snapshot().mcpServers).toHaveLength(1);
    } finally {
      await runtime.shutdown();
    }
  });
});
