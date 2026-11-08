// MCP 断线重连（第 999 页）。
// 旧行为（`src/agent/plugins/mcp.ts` 的 E5 那段）：transport onclose 一到就标 failed 并摘工具，
// 注释自己写着"重连入口留位，本轮不自动重连"——于是 server 崩一次，它那批工具**整个会话**消失。
// 这六条钉的是：能自己回来、回来时权限面重过一遍、连不上就停手并说清、关闭中不许复活、三档话术互不相同。
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { McpManager } from "../src/agent/plugins/mcp";
import type { McpServerConfig } from "../src/agent/plugins/types";

const managers: McpManager[] = [];
const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(managers.splice(0).map((m) => m.disconnectAll()));
  await Promise.all(cleanups.splice(0).map((c) => c()));
  vi.restoreAllMocks();
});

const config: McpServerConfig = { type: "http", url: "http://unused.invalid" };

interface Pair { client: Client; transport: InMemoryTransport }

/** 造一台可反复接入的假 server。`onList(attempt)` 决定第几次握手回哪些工具（可以异步 ⇒ 演"握手卡住"）。 */
function harness(opts: { onList?: (attempt: number) => { name: string }[] | Promise<{ name: string }[]> } = {}) {
  let attempts = 0;
  const pairs: Pair[] = [];
  const factory = vi.fn(async () => {
    attempts += 1;
    const attempt = attempts;
    const client = new Client({ name: "reconnect-test", version: "1" });
    const server = new Server({ name: "svc", version: "1" }, { capabilities: { tools: {} } });
    server.setRequestHandler(ListToolsRequestSchema, async () => {
      const listed = await (opts.onList?.(attempt) ?? Promise.resolve([{ name: "echo" }, { name: "dropme" }]));
      return { tools: listed.map((t) => ({ name: t.name, inputSchema: { type: "object" } })) };
    });
    server.setRequestHandler(CallToolRequestSchema, () => ({ content: [{ type: "text", text: "called" }] }));
    const [transport, serverTransport] = InMemoryTransport.createLinkedPair();
    cleanups.push(async () => { await client.close().catch(() => undefined); await server.close().catch(() => undefined); });
    await server.connect(serverTransport);
    pairs.push({ client, transport });
    return { client, transport };
  });
  const manager = new McpManager(factory, 300, 300);
  managers.push(manager);
  return { manager, factory, pairs };
}

const settle = async (ms = 500): Promise<void> => { await new Promise((r) => setTimeout(r, ms)); };

describe("MCP 断线自动重连", () => {
  it("崩一次 ⇒ 自己回来，工具与调用都恢复（不等下一次手工 connect）", async () => {
    const { manager, factory, pairs } = harness();
    expect((await manager.connect("p", "s", config)).ok).toBe(true);
    expect(factory).toHaveBeenCalledTimes(1);

    await pairs[0]?.transport.close(); // 演 server 进程没了
    await settle();

    expect(factory).toHaveBeenCalledTimes(2);
    const st = manager.statuses().find((s) => s.server === "s");
    expect(st?.state).toBe("connected");
    expect(st?.tools.length).toBeGreaterThan(0);
    expect(await manager.callTool("p", "s", "echo", {})).toEqual({ ok: true, output: "called" });
  });

  it("重连成功要通知运行时把工具放回去（否则连接在跑、模型看不见）", async () => {
    const { manager, pairs } = harness();
    const up = vi.fn();
    manager.onServerUp = up;
    await manager.connect("p", "s", config);
    await pairs[0]?.transport.close();
    await settle();
    expect(up).toHaveBeenCalledTimes(1);
    expect(up.mock.calls[0]?.[0]).toBe("p");
    expect((up.mock.calls[0]?.[2] ?? []).map((t: { name: string }) => t.name)).toContain("echo");
  });

  it("重连必须重过工具裁剪面：第二次 listTools 多出来的排除名不许回来", async () => {
    const excluded: McpServerConfig = { ...config, excludeTools: ["dropme"] };
    const { manager, pairs } = harness({ onList: (attempt) => (attempt === 1 ? [{ name: "echo" }] : [{ name: "echo" }, { name: "dropme" }]) });
    await manager.connect("p", "s", excluded);
    await pairs[0]?.transport.close();
    await settle();
    const tools = manager.statuses().find((s) => s.server === "s")?.tools ?? [];
    expect(tools.some((t) => t.endsWith("dropme"))).toBe(false);
    expect(tools.some((t) => t.endsWith("echo"))).toBe(true);
  });

  it("重连失败最多两次就停手，并把原因留在状态里", async () => {
    const { manager, factory, pairs } = harness();
    await manager.connect("p", "s", config);
    factory.mockImplementation(async () => { throw new Error("模拟：server 再也起不来"); });
    await pairs[0]?.transport.close();
    await settle(1600);
    const st = manager.statuses().find((s) => s.server === "s");
    expect(st?.state).toBe("failed");
    expect(st?.error ?? "").toMatch(/重连 [12] 次仍失败/);
    expect(st?.error ?? "").toContain("server 再也起不来");
  });

  it("正在关闭时迟到的 onclose 不许把服务复活", async () => {
    const { manager, factory, pairs } = harness();
    await manager.connect("p", "s", config);
    const first = pairs[0];
    await manager.disconnectAll();
    const before = factory.mock.calls.length;
    first?.transport.onclose?.(); // 手工敲一次迟到的关闭回调
    await settle();
    expect(factory.mock.calls.length).toBe(before);
    expect(manager.statuses()).toEqual([]);
  });

  it("三档话术互不相同：在跑 / 重连中 / 已失败（「重连中」不许被读成绿灯）", async () => {
    let release!: () => void;
    const blocked = new Promise<void>((r) => { release = r; });
    const { manager, pairs } = harness({
      onList: async (attempt) => {
        if (attempt >= 2) await blocked;
        return [{ name: "echo" }];
      },
    });
    await manager.connect("p", "s", config);
    expect(manager.statuses().find((s) => s.server === "s")?.state).toBe("connected");

    await pairs[0]?.transport.close();
    await settle(200);
    const mid = manager.statuses().find((s) => s.server === "s");
    expect(mid?.state).toBe("reconnecting"); // 卡住的这一轮：既不是绿灯也不是失败
    expect(mid?.error).toBeUndefined();

    release();
    await settle();
    expect(manager.statuses().find((s) => s.server === "s")?.state).toBe("connected");
  });
});
