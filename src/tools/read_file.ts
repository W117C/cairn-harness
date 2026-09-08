import { readFile } from "node:fs/promises";
import { resolveInWorkspace, truncationNotice, type Tool, type ToolResult } from "./base.js";

// 输出上限 50KB；超出截断并附一行提示。
const READ_LIMIT_BYTES = 50 * 1024;

export const read_file: Tool = {
  name: "read_file",
  async run(args, ctx): Promise<ToolResult> {
    const rel = typeof args.path === "string" ? args.path : "";
    const abs = resolveInWorkspace(ctx.workspace, rel, "read_file");
    let content: string;
    try {
      content = await readFile(abs, "utf8");
    } catch {
      throw new Error(`read_file: 文件不存在或不可读: ${rel}`);
    }
    if (Buffer.byteLength(content, "utf8") > READ_LIMIT_BYTES) {
      // 按字节截断再解码，避免切出坏字符
      const cut = Buffer.from(content, "utf8").subarray(0, READ_LIMIT_BYTES).toString("utf8");
      return { ok: true, output: cut + "\n" + truncationNotice(50) };
    }
    return { ok: true, output: content };
  },
};
