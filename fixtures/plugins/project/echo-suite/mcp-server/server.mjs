// M2e 明卷 stub MCP server（stdio，官方 SDK Server 低层类，零 zod 依赖）。
// 明卷用途：plugins-check 断言 tools/list 进统一注册表（scoped 名）、tools/call 回传、
// 同一权限门生效。工具面刻意极小：echo（成功）/ fail（isError）。
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const server = new Server(
  { name: "stub-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "echo",
      description: "回显输入文本（stub）",
      inputSchema: {
        type: "object",
        properties: { text: { type: "string", description: "要回显的文本" } },
        required: ["text"],
      },
    },
    {
      name: "fail",
      description: "恒定失败（stub，用于 isError 路径）",
      inputSchema: { type: "object", properties: {} },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const name = req.params.name;
  const args = req.params.arguments ?? {};
  if (name === "echo") {
    return { content: [{ type: "text", text: "echo: " + String(args.text ?? "") }] };
  }
  return { content: [{ type: "text", text: "stub failure: " + name }], isError: true };
});

await server.connect(new StdioServerTransport());
