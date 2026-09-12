import { open, readFile, readdir, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { assertRealContainment, resolveInWorkspace, truncationNotice, ToolError, type Tool, type ToolResult } from "./base.js";
import { prefetchLsp } from "./lsp.js";

// 输出上限 50KB；行截断 2000 字符；默认最多 2000 行。
const READ_LIMIT_BYTES = 50 * 1024;
const MAX_LINE_CHARS = 2000;
const DEFAULT_MAX_LINES = 2000;
// 整读上限：超过只读前缀。输出本身已限 50KB，但旧实现「先整文件读进内存再截断」，
// 一个 GB 级文件（日志/打包产物/数据库转储）会把 Electron 主进程读爆。
const LARGE_FILE_PREFIX_BYTES = 16 * 1024 * 1024;

/** 只读文件前 bytes 字节（大文件路径用；返回可能被截断的 Buffer）。 */
async function readPrefix(abs: string, bytes: number): Promise<Buffer> {
  const fh = await open(abs, "r");
  try {
    const buf = Buffer.allocUnsafe(bytes);
    const { bytesRead } = await fh.read(buf, 0, bytes, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

// 二进制嗅探：出现 NUL 即拒读；不可打印字节（除少数常见空白）占比 >30% 也拒读。
function looksBinary(buf: Buffer): boolean {
  const sample = buf.subarray(0, 8192);
  let nonPrintable = 0;
  for (const b of sample) {
    if (b === 0) return true;
    if (b < 32 && b !== 9 && b !== 10 && b !== 13) nonPrintable++;
  }
  return sample.length > 0 && nonPrintable / sample.length > 0.3;
}

// 未命中时给最多 3 个近名建议：同目录前缀匹配优先，其次同扩展名。
async function nearNameSuggestions(workspace: string, rel: string): Promise<string[]> {
  const dir = dirname(join(workspace, rel));
  const base = basename(rel);
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const lower = base.toLowerCase();
  const ext = lower.includes(".") ? lower.slice(lower.lastIndexOf(".")) : "";
  const scored = entries
    .filter((e) => e !== base)
    .map((e) => {
      const el = e.toLowerCase();
      let score = 0;
      if (lower.length >= 3 && el.startsWith(lower.slice(0, 3))) score += 2;
      if (ext && el.endsWith(ext)) score += 1;
      return { e, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.e.localeCompare(b.e))
    .slice(0, 3)
    .map((x) => x.e);
  const dirRel = dir === workspace ? "" : dir.slice(workspace.length + 1) + "/";
  return scored.map((e) => dirRel + e);
}

function clipLine(line: string): string {
  return line.length > MAX_LINE_CHARS ? line.slice(0, MAX_LINE_CHARS) : line;
}

export const read_file: Tool = {
  name: "read_file",
  async run(args, ctx): Promise<ToolResult> {
    const rel = typeof args.path === "string" ? args.path : "";
    const abs = resolveInWorkspace(ctx.workspace, rel, "read_file");
    await assertRealContainment(ctx.workspace, abs, "read_file");

    // 目录路径：列条目（目录读不了内容，但列条目是有用的输出）。
    const st = await stat(abs).catch(() => null);
    if (st?.isDirectory()) {
      const entries = await readdir(abs);
      const lines = entries.sort().map((e) => e + "/");
      return { ok: true, output: rel + "/（目录，" + entries.length + " 项）\n" + lines.join("\n") };
    }

    // 大文件只读前缀（stat 已在上面取过，零额外系统调用）。
    // 前缀边界可能切断一个多字节 UTF-8 序列，末尾会解码成替换字符——输出已显式声明截断，
    // 不影响语义；这里不做额外修补，避免误改文件本身合法的 U+FFFD。
    const oversized = (st?.size ?? 0) > LARGE_FILE_PREFIX_BYTES;
    let buf: Buffer;
    try {
      buf = oversized ? await readPrefix(abs, LARGE_FILE_PREFIX_BYTES) : await readFile(abs);
    } catch {
      const suggestions = await nearNameSuggestions(ctx.workspace, rel);
      const hint = suggestions.length ? "（近名建议: " + suggestions.join(", ") + "）" : "";
      throw new ToolError("read_file: 文件不存在或不可读: " + rel + hint);
    }
    if (looksBinary(buf)) {
      throw new ToolError("read_file: 疑似二进制文件，拒绝按文本读取: " + rel);
    }
    const content = buf.toString("utf8");
    // M2a：read 命中源码 → 后台预热 LSP（尽力而为，零阻塞、零异常冒泡）
    prefetchLsp(ctx.workspace, abs);
    const allLines = content.split("\n");
    // 若因行尾换行 split 出的最后一个空串不算一行
    const hasTrailingNewline = allLines.length > 0 && allLines[allLines.length - 1] === "";
    const lines = hasTrailingNewline ? allLines.slice(0, -1) : allLines;

    const offsetRaw = args.offset;
    const limitRaw = args.limit;
    const offset = typeof offsetRaw === "number" && Number.isInteger(offsetRaw) && offsetRaw >= 1 ? offsetRaw : 1;
    const maxLines = typeof limitRaw === "number" && Number.isInteger(limitRaw) && limitRaw >= 1 ? limitRaw : DEFAULT_MAX_LINES;
    const selected = lines.slice(offset - 1, offset - 1 + maxLines);
    const truncatedLines = offset - 1 + selected.length < lines.length;

    let out = selected.map((l) => (l.length > MAX_LINE_CHARS ? clipLine(l) + " …[行截断]" : l)).join("\n");
    const byteLen = Buffer.byteLength(out, "utf8");
    let byteTruncated = false;
    if (byteLen > READ_LIMIT_BYTES) {
      out = Buffer.from(out, "utf8").subarray(0, READ_LIMIT_BYTES).toString("utf8");
      byteTruncated = true;
    }
    const notices: string[] = [];
    if (oversized) {
      notices.push("[truncated: 文件超过 " + String(LARGE_FILE_PREFIX_BYTES / (1024 * 1024)) + " MB，仅读取前 " + String(LARGE_FILE_PREFIX_BYTES / (1024 * 1024)) + " MB 参与解析；建议用 grep 定位后再按 offset 读]");
    }
    if (byteTruncated) notices.push(truncationNotice(50));
    if (truncatedLines) notices.push("[truncated: 从第 " + offset + " 行起共 " + lines.length + " 行，仅显示 " + selected.length + " 行；可用 offset/limit 继续读]");
    if (offset > 1 && !truncatedLines) notices.push("[offset: 从第 " + offset + " 行起读，文件共 " + lines.length + " 行]");
    if (notices.length) out += "\n" + notices.join("\n");
    return { ok: true, output: out };
  },
};
