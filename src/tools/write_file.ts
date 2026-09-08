import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { resolveInWorkspace, type Tool, type ToolResult } from "./base.js";

// 与 read 对称的 50KB 上限：超出直接拒绝写入——截断写入会静默损坏数据，拒绝才是正确语义。
const WRITE_LIMIT_BYTES = 50 * 1024;

export const write_file: Tool = {
  name: "write_file",
  async run(args, ctx): Promise<ToolResult> {
    const rel = typeof args.path === "string" ? args.path : "";
    const content = args.content;
    if (typeof content !== "string") {
      throw new Error("write_file: content 参数必须是字符串");
    }
    const abs = resolveInWorkspace(ctx.workspace, rel, "write_file");
    const bytes = Buffer.byteLength(content, "utf8");
    if (bytes > WRITE_LIMIT_BYTES) {
      throw new Error(`write_file: 内容 ${bytes} 字节，超过 50KB 上限，已拒绝写入: ${rel}`);
    }
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, content, "utf8");
    return { ok: true, output: `已写入 ${rel}（${bytes} 字节）` };
  },
};
