// 外部 MCP 文本的有界性（agent-plan §工具规格「输出上限 + 截断提示」在 MCP 面的补齐）。
// 两条面：tools/call 的结果（一次性）与 tools/list 的描述（每轮重送，×工具数×轮数）。
import { describe, expect, it } from "vitest";
import {
  MCP_DESCRIPTION_CHAR_LIMIT,
  MCP_RESULT_CHAR_LIMIT,
  McpManager,
  capMcpDescription,
  capMcpResult,
} from "../src/agent/plugins/mcp";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

const filler = (n: number, tag: string): string => tag + ".".repeat(Math.max(0, n - tag.length * 2)) + tag;

describe("capMcpResult（头尾都留，省略数如实）", () => {
  it("未超限逐字不变（含空串）", () => {
    expect(capMcpResult("")).toBe("");
    expect(capMcpResult(filler(1000, "ab"))).toBe(filler(1000, "ab"));
  });

  it("超限时长度不越界，且报出的省略数与实现的分段严格相等", () => {
    const text = filler(60_000, "HEADPART");
    const out = capMcpResult(text);
    expect(out.length).toBeLessThan(MCP_RESULT_CHAR_LIMIT);
    expect(out.startsWith("HEADPART")).toBe(true);
    expect(out.endsWith("HEADPART")).toBe(true); // 尾部同样是原文末段
    const keep = MCP_RESULT_CHAR_LIMIT - 220;   // 220 = 提示行预留
    const expectedOmitted = text.length - keep;
    expect(out).toContain("省略中间 " + String(expectedOmitted) + " 字符");
    const m = /省略中间 (\d+) 字符/u.exec(out);
    expect(m).not.toBeNull();
    expect(Number(m![1]) + keep).toBe(text.length);
  });
});

describe("capMcpDescription（只留头部，截在完整行尾）", () => {
  it("短描述逐字不变；长描述收窄并说明上限", () => {
    expect(capMcpDescription("read a file")).toBe("read a file");
    const long = "line one\nline two\n" + "x".repeat(MCP_DESCRIPTION_CHAR_LIMIT * 2);
    const out = capMcpDescription(long);
    expect(out).toContain("line one\nline two");
    expect(out).toContain("…[truncated: 描述 ");
    expect(out.length).toBeLessThanOrEqual(MCP_DESCRIPTION_CHAR_LIMIT + 80);
  });
});

describe("McpManager 接线（描述与结果都过界）", () => {
  function stubClient(resultText: string, description: string) {
    const transport = { onclose: undefined as (() => void) | undefined, close: async () => {} } as unknown as Transport;
    const client = {
      connect: async () => {},
      listTools: async () => ({ tools: [{ name: "big", description, inputSchema: {} }] }),
      callTool: async () => ({ content: [{ type: "text", text: resultText }] }),
      close: async () => {},
    } as unknown as Client;
    return { transport, client };
  }

  it("tools/call 的 200KB 结果被收到 32KB 内，尾部结论留住", async () => {
    const body = "z".repeat(200 * 1024) + "\nFINAL-CONCLUSION-LINE";
    const { client } = stubClient(body, "desc");
    const mgr = new McpManager(async () => ({ client, transport: {} as Transport }), 500, 500);
    await mgr.connect("p", "s", { command: "x" });
    const res = await mgr.callTool("p", "s", "big", {});
    expect(res.ok).toBe(true);
    expect(res.output.length).toBeLessThan(MCP_RESULT_CHAR_LIMIT);
    expect(res.output).toContain("FINAL-CONCLUSION-LINE");
    expect(res.output).toContain("省略中间");
  });

  it("tools/list 的 5000 字符描述进注册表时已被收窄（每轮重送的那一份）", async () => {
    const { client } = stubClient("ok", "d1\n" + "y".repeat(MCP_DESCRIPTION_CHAR_LIMIT * 3));
    const mgr = new McpManager(async () => ({ client, transport: {} as Transport }), 500, 500);
    const listed = await mgr.connect("p", "s", { command: "x" });
    const desc = listed.tools[0]?.description ?? "";
    expect(desc.length).toBeLessThanOrEqual(MCP_DESCRIPTION_CHAR_LIMIT + 80);
    expect(desc).toContain("…[truncated: 描述 ");
  });

  it("未超限的描述与结果逐字不变（零回归）", async () => {
    const { client } = stubClient("plain result", "short desc");
    const mgr = new McpManager(async () => ({ client, transport: {} as Transport }), 500, 500);
    const listed = await mgr.connect("p", "s", { command: "x" });
    expect(listed.tools[0]?.description).toBe("short desc");
    expect((await mgr.callTool("p", "s", "big", {})).output).toBe("plain result");
  });
});
