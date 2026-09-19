// 外部 MCP 文本的有界性（agent-plan §工具规格「输出上限 + 截断提示」在 MCP 面的补齐）。
// 两条面：tools/call 的结果（一次性）与 tools/list 的描述（每轮重送，×工具数×轮数）。
import { describe, expect, it } from "vitest";
import {
  MCP_DESCRIPTION_CHAR_LIMIT,
  MCP_RESULT_CHAR_LIMIT,
  MCP_SCHEMA_DEPTH_LIMIT,
  MCP_SCHEMA_LEAF_CHAR_LIMIT,
  McpManager,
  capMcpDescription,
  capMcpResult,
  capMcpSchema,
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

describe("capMcpSchema（只收字符串叶子与超深子树，结构逐项保留）", () => {
  it("未超长时逐字不变、clamped=0（零回归）", () => {
    const schema = { type: "object", properties: { a: { type: "string", description: "短说明" } }, required: ["a"] };
    const out = capMcpSchema(schema);
    expect(out.clamped).toBe(0);
    expect(out.schema).toEqual(schema);
  });

  it("长 description 叶子被收，但键名/type/required/enum 一个不动", () => {
    const long = "第一段。\n" + "详".repeat(4000);
    const out = capMcpSchema({
      type: "object",
      properties: { mode: { type: "string", enum: ["fast", "slow"], description: long } },
      required: ["mode"],
    });
    expect(out.clamped).toBe(1);
    const props = out.schema.properties as Record<string, Record<string, unknown>>;
    expect(props.mode?.enum).toEqual(["fast", "slow"]);
    expect(props.mode?.type).toBe("string");
    expect((props.mode?.description as string).endsWith("…[参数说明截断]")).toBe(true);
    expect((props.mode?.description as string).startsWith("第一段。\n")).toBe(true);
    expect(out.schema.required).toEqual(["mode"]);
    expect(JSON.parse(JSON.stringify(out.schema)).properties.mode.type).toBe("string");
  });

  it("截在完整行尾且长度受单叶上限约束；多叶逐个计数", () => {
    const leaf = "x".repeat(1200) + "\n别丢这一行";
    const out = capMcpSchema({
      properties: { a: { description: leaf }, b: { description: leaf } },
    });
    expect(out.clamped).toBe(2);
    const props = out.schema.properties as Record<string, Record<string, string>>;
    for (const k of ["a", "b"]) {
      expect(props[k].description.length).toBeLessThanOrEqual(MCP_SCHEMA_LEAF_CHAR_LIMIT + " …[参数说明截断]".length);
    }
  });

  it("超深子树整体换成占位（仍是一个合法 object，且计入收窄数）", () => {
    let deep: Record<string, unknown> = { description: "最深一层" };
    for (let i = 0; i < MCP_SCHEMA_DEPTH_LIMIT + 3; i++) deep = { type: "object", properties: { n: deep } };
    const out = capMcpSchema({ type: "object", properties: { root: deep } });
    const text = JSON.stringify(out.schema);
    expect(out.clamped).toBeGreaterThan(0);
    expect(text).toContain("嵌套超 " + String(MCP_SCHEMA_DEPTH_LIMIT) + " 层，已省略");
    expect(text).not.toContain("最深一层");
    expect(text.length).toBeLessThan(JSON.stringify(deep).length);
  });

  it("话痨 server 的 40 参数 schema 体积按数量级下降", () => {
    const props: Record<string, unknown> = {};
    for (let i = 0; i < 40; i++) {
      props["p" + String(i)] = { type: "string", description: "参数说明。\n" + "y".repeat(8000) };
    }
    const schema = { type: "object", properties: props };
    const out = capMcpSchema(schema);
    const before = JSON.stringify(schema).length;
    const after = JSON.stringify(out.schema).length;
    expect(out.clamped).toBe(40);
    expect(after * 4).toBeLessThan(before);
    expect(Object.keys((out.schema.properties as Record<string, unknown>)).length).toBe(40);
  });
});

describe("MCP 接线：schema 收窄要在注册表这一头就发生", () => {
  function stubWithSchema(schema: Record<string, unknown>) {
    return {
      connect: async () => {},
      listTools: async () => ({ tools: [{ name: "wide", description: "d", inputSchema: schema }] }),
      callTool: async () => ({ content: [] }),
      close: async () => {},
    } as unknown as Client;
  }

  it("tools/list 的长参数说明进注册表前已被收，且描述里如实标注收窄处数", async () => {
    const client = stubWithSchema({
      type: "object",
      properties: { q: { type: "string", description: "首行说明\n" + "z".repeat(6000) } },
      required: ["q"],
    });
    const mgr = new McpManager(async () => ({ client, transport: {} as Transport }), 500, 500);
    const listed = await mgr.connect("p", "s", { command: "x" });
    const info = listed.tools[0]!;
    expect(info.description).toContain("参数说明已收窄 1 处，结构完整");
    expect(JSON.stringify(info.inputSchema).length).toBeLessThan(1200);
    const props = info.inputSchema.properties as Record<string, Record<string, unknown>>;
    expect(props.q?.type).toBe("string");
    expect(info.inputSchema.required).toEqual(["q"]);
  });

  it("未收窄的 schema 不追加任何提示（零回归）", async () => {
    const client = stubWithSchema({ type: "object", properties: { q: { type: "string" } } });
    const mgr = new McpManager(async () => ({ client, transport: {} as Transport }), 500, 500);
    const listed = await mgr.connect("p", "s", { command: "x" });
    expect(listed.tools[0]?.description).toBe("d");
    expect(listed.tools[0]?.inputSchema).toEqual({ type: "object", properties: { q: { type: "string" } } });
  });
});
