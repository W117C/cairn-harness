import { resolveInWorkspace, truncationNotice, type Tool, type ToolResult } from "./base.js";
import { runRgJson, type RawMatch } from "./ripgrep.js";

// 命中上限与单行截断：输出准确 > 省 token > 功能多。
const MAX_MATCHES = 100;
const MAX_LINE_CHARS = 2000;

function clipLine(text: string): string {
  return text.length > MAX_LINE_CHARS ? text.slice(0, MAX_LINE_CHARS) + " …[行截断]" : text;
}

function formatMatches(workspace: string, matches: RawMatch[], limited: boolean): string {
  // 按文件分组：path: 后跟 Line N: text，路径一律 workspace 相对。
  const byFile = new Map<string, RawMatch[]>();
  for (const m of matches) {
    const list = byFile.get(m.path);
    if (list) list.push(m);
    else byFile.set(m.path, [m]);
  }
  const parts: string[] = [];
  for (const [path, list] of byFile) {
    parts.push(path + ":");
    for (const m of list) parts.push(`Line ${m.line}: ${clipLine(m.text)}`);
  }
  let out = parts.join("\n");
  if (limited) out += `\n${truncationNotice(MAX_MATCHES)} more matches available, use more specific path/pattern`;
  return out;
}

export const grep: Tool = {
  name: "grep",
  async run(args, ctx): Promise<ToolResult> {
    const pattern = typeof args.pattern === "string" ? args.pattern : "";
    if (!pattern) throw new Error("grep: pattern 参数必须是非空字符串");
    const rel = typeof args.path === "string" && args.path.trim() ? args.path : ".";
    // path 入参走统一信任边界校验（越界拒绝），"." 表示整个 workspace。
    const abs = rel === "." ? ctx.workspace : resolveInWorkspace(ctx.workspace, rel, "grep");
    const matches = await runRgJson(ctx.workspace, ["--json", "-e", pattern, abs]);
    if (matches.length === 0) return { ok: true, output: "无命中" };
    const limited = matches.length > MAX_MATCHES;
    const shown = limited ? matches.slice(0, MAX_MATCHES) : matches;
    return { ok: true, output: formatMatches(ctx.workspace, shown, limited) };
  },
};
