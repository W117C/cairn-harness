import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PluginRuntime } from "../src/agent/plugins";
import { McpManager } from "../src/agent/plugins/mcp";
import { installPluginTools, setToolGateDeps } from "../src/main/tool-gates";
import { newAutonomySession, type ToolResultWithAudit } from "../src/permissions";
import { TOOLS } from "../src/tools";
import type { Tool } from "../src/tools/base";

const sessions: { manager: McpManager; server: Server }[] = [];
const injected: string[] = [];
const text = (value: string): CallToolResult => ({ content: [{ type: "text", text: value }] });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
async function setup(handler: (args: Record<string, unknown>, signal: AbortSignal) => Promise<CallToolResult> | CallToolResult, timeout = 300) {
  const client = new Client({ name: "cancel-test", version: "1" });
  const server = new Server({ name: "local-test", version: "1" }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: [{ name: "wait", inputSchema: { type: "object" }, annotations: { readOnlyHint: true } }] }));
  server.setRequestHandler(CallToolRequestSchema, (request, extra) => handler(request.params.arguments ?? {}, extra.signal));
  const [transport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const manager = new McpManager(async () => ({ client, transport }), 1000, timeout);
  sessions.push({ manager, server });
  const connected = await manager.connect("cancel", "local", { type: "http", url: "http://unused.invalid" });
  expect(connected.ok).toBe(true);
  return { manager, server, client, transport, info: connected.tools[0]! };
}
afterEach(async () => {
  for (const name of injected.splice(0)) delete (TOOLS as unknown as Record<string, Tool>)[name];
  await Promise.all(sessions.splice(0).map(async ({ manager, server }) => {
    await manager.disconnectAll();
    await server.close();
  }));
  vi.restoreAllMocks();
});

describe("MCP 调用取消沿现有 SDK 传递", () => {
  it("发起前已取消，不向服务器发送 tools/call", async () => {
    const handler = vi.fn(() => text("should not execute"));
    const { manager } = await setup(handler);
    const controller = new AbortController();
    controller.abort(new Error("already stopped"));
    const result = await manager.callTool("cancel", "local", "wait", {}, controller.signal);
    expect(result.ok).toBe(false);
    expect(result.output).toContain("cancelled");
    expect(result.output).toContain("already stopped");
    expect(handler).not.toHaveBeenCalled();
  });

  it.each([new Error("user stopped"), "plain cancellation reason"])("进行中取消通知 SDK 服务端并保留原因：%s", async (reason) => {
    const entered = deferred<AbortSignal>();
    const { manager } = await setup((_args, signal) => {
      entered.resolve(signal);
      return new Promise<CallToolResult>((resolve) => { signal.addEventListener("abort", () => resolve(text("late cancelled result")), { once: true }); });
    }, 80);
    const controller = new AbortController();
    const pending = manager.callTool("cancel", "local", "wait", {}, controller.signal);
    const remoteSignal = await entered.promise;
    controller.abort(reason);
    const result = await pending;
    expect(result.ok).toBe(false);
    expect(result.output).toContain("cancelled");
    expect(result.output).toContain(reason instanceof Error ? reason.message : reason);
    expect(remoteSignal.aborted).toBe(true);
    expect(result.output).not.toContain("late cancelled result");
    expect(manager.statuses()[0]?.state).toBe("connected");
  });

  it("超时通过 SDK 通知服务端取消，并允许同连接继续调用", async () => {
    const entered = deferred<AbortSignal>();
    const { manager } = await setup((args, signal) => {
      if (args.fast === true) return text("next call works");
      entered.resolve(signal);
      return new Promise<CallToolResult>((resolve) => { signal.addEventListener("abort", () => resolve(text("late timeout result")), { once: true }); });
    }, 40);
    const pending = manager.callTool("cancel", "local", "wait", {});
    const remoteSignal = await entered.promise;
    const result = await pending;
    expect(result.ok).toBe(false);
    expect(result.output).toContain("超时");
    expect(remoteSignal.aborted).toBe(true);
    expect(await manager.callTool("cancel", "local", "wait", { fast: true })).toEqual({ ok: true, output: "next call works" });
  });

  it("同连接并发调用只取消对应请求", async () => {
    const first = deferred<AbortSignal>();
    const finishSecond = deferred<CallToolResult>();
    const { manager } = await setup((args, signal) => {
      if (args.second === true) return finishSecond.promise;
      first.resolve(signal);
      return new Promise<CallToolResult>((resolve) => { signal.addEventListener("abort", () => resolve(text("cancelled first")), { once: true }); });
    }, 80);
    const controller = new AbortController();
    const pendingFirst = manager.callTool("cancel", "local", "wait", {}, controller.signal);
    const pendingSecond = manager.callTool("cancel", "local", "wait", { second: true });
    const remoteSignal = await first.promise;
    controller.abort(new Error("stop first"));
    const result = await pendingFirst;
    expect(result.ok).toBe(false);
    expect(result.output).toContain("cancelled");
    expect(remoteSignal.aborted).toBe(true);
    finishSecond.resolve(text("second survived"));
    expect(await pendingSecond).toEqual({ ok: true, output: "second survived" });
  });

  it("已完成请求解除会话监听，稍后停止不再发出过期取消通知", async () => {
    const { manager, transport } = await setup(() => text("done"));
    const send = vi.spyOn(transport, "send");
    const controller = new AbortController();
    expect(await manager.callTool("cancel", "local", "wait", {}, controller.signal)).toEqual({ ok: true, output: "done" });
    send.mockClear();
    controller.abort(new Error("stop next operation"));
    await Promise.resolve();
    expect(send).not.toHaveBeenCalled();
  });

  it("普通成功与服务端 isError 回执保持原样", async () => {
    const { manager } = await setup((args) => ({ ...text(args.fail === true ? "server rejected" : "normal response"), ...(args.fail === true ? { isError: true } : {}) }));
    const controller = new AbortController();
    expect(await manager.callTool("cancel", "local", "wait", {}, controller.signal)).toEqual({ ok: true, output: "normal response" });
    expect(await manager.callTool("cancel", "local", "wait", { fail: true }, controller.signal)).toEqual({ ok: false, output: "server rejected" });
  });

  it("连接断开仍作为连接失败反馈，不能误报用户取消", async () => {
    const entered = deferred<AbortSignal>();
    const { manager, server } = await setup((_args, signal) => { entered.resolve(signal); return new Promise<CallToolResult>(() => {}); });
    const controller = new AbortController();
    const pending = manager.callTool("cancel", "local", "wait", {}, controller.signal);
    await entered.promise;
    await server.close();
    const result = await pending;
    expect(result.ok).toBe(false);
    expect(result.output).not.toContain("cancelled");
    expect(result.output).toMatch(/closed|断开/iu);
    expect(manager.statuses()[0]?.state).toBe("failed");
  });

  it("真实权限入口把执行中的 ctx.signal 传到服务器，保留审批审计", async () => {
    const entered = deferred<AbortSignal>();
    const { manager, info } = await setup((_args, signal) => {
      entered.resolve(signal);
      return new Promise<CallToolResult>((resolve) => { signal.addEventListener("abort", () => resolve(text("stopped")), { once: true }); });
    }, 80);
    const runtime = {
      skills: () => [], mcp: manager,
      mcpTools: new Map([[info.scopedName, { ...info, plugin: "cancel", server: "local" }]]),
    } as unknown as PluginRuntime;
    setToolGateDeps({ currentSession: () => ({ askGate: null, autonomy: newAutonomySession("default", { planBlocked: () => false }), sandbox: null }) });
    injected.push(...installPluginTools(runtime));
    const controller = new AbortController();
    const tool = (TOOLS as unknown as Record<string, Tool>)[info.scopedName]!;
    const pending = tool.run({}, { workspace: process.cwd(), signal: controller.signal });
    const remoteSignal = await entered.promise;
    controller.abort(new Error("stop from session"));
    const result = await pending as ToolResultWithAudit;
    expect(result.ok).toBe(false);
    expect(result.output).toContain("cancelled");
    expect(result.output).toContain("stop from session");
    expect(result.gate?.verdict).toBe("auto-approved");
    expect(remoteSignal.aborted).toBe(true);
  });
});
