// 目录总览（2026-11-06 业主「完善工具层」第三批）：glob 只回路径不回大小/时间，
// shell ls 又隔着白名单闸——开工摸底与「哪个文件最近动过」需要一枚原生目录面。
// 单层列出（递归归 glob），带类型/大小/修改时间；只读、零子进程、路径闸与 glob 同口径。
import { readdir, stat } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { assertRealContainment, resolveInWorkspace, ToolError, type Tool, type ToolResult } from "./base.js";

/** 条目数帽：超出截断 + 出声（与 glob 的 100 上限同一族口径）。 */
const LIST_DIR_MAX_ENTRIES = 200;
/** 大小单位表（字节 → 人读）。 */
const SIZE_UNITS: readonly [number, string][] = [[1 << 20, "MB"], [1 << 10, "KB"]];

function humanSize(bytes: number): string {
  for (const [threshold, unit] of SIZE_UNITS) {
    if (bytes >= threshold) return (bytes / threshold).toFixed(1) + unit;
  }
  return String(bytes) + "B";
}

export const list_dir: Tool = {
  name: "list_dir",
  async run(args, ctx): Promise<ToolResult> {
    const rel = typeof args.path === "string" && args.path.trim() !== "" ? args.path : ".";
    const abs = rel === "." ? ctx.workspace : resolveInWorkspace(ctx.workspace, rel, "list_dir");
    // 词法闸之外判软链归属（与 glob/grep 同口径）：目录面泄漏的是「界外有什么」。
    if (rel !== ".") await assertRealContainment(ctx.workspace, abs, "list_dir");
    let entries;
    try {
      entries = await readdir(abs, { withFileTypes: true });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") throw new ToolError(`list_dir: 目录不存在: ${rel}`);
      if (code === "ENOTDIR") throw new ToolError(`list_dir: ${rel} 是文件不是目录（读它的内容用 read_file）`);
      throw err;
    }
    const shown = entries.slice(0, LIST_DIR_MAX_ENTRIES);
    const lines: string[] = [];
    for (const entry of shown) {
      const marker = entry.isDirectory() ? "/" : entry.isSymbolicLink() ? "@" : "";
      let size = "-";
      let mtime = "-";
      try {
        const s = await stat(join(abs, entry.name));
        size = entry.isDirectory() ? "-" : humanSize(s.size);
        mtime = s.mtime.toISOString().slice(0, 16).replace("T", " ");
      } catch {
        // 破损软链/权限洞：单条目标注未知，不整列失败。
        size = "?";
      }
      lines.push(`${entry.name}${marker}\t${size}\t${mtime}`);
    }
    // 输出统一 workspace 相对口径（工具层纪律：不回显绝对路径）。
    const dirRel = relative(resolve(ctx.workspace), abs).split(sep).join("/") || ".";
    const head = `${dirRel}/（${String(entries.length)} 项${entries.length > LIST_DIR_MAX_ENTRIES ? `，截断到 ${String(LIST_DIR_MAX_ENTRIES)}` : ""}）`;
    if (lines.length === 0) return { ok: true, output: `${head}\n（空目录：里面没有任何条目）` };
    let out = head + "\n" + lines.join("\n");
    if (entries.length > LIST_DIR_MAX_ENTRIES) {
      out += `\n[list_dir] 已截断：${String(entries.length - LIST_DIR_MAX_ENTRIES)} 项未列出（递归找文件用 glob，按名找用 grep）`;
    }
    return { ok: true, output: out };
  },
};
