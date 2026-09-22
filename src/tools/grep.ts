import { resolveInWorkspace, truncationNotice, type Tool, type ToolResult } from "./base.js";
import { rgNegativeNote, runRgJson, type RawMatch } from "./ripgrep.js";

// 命中上限与单行截断：输出准确 > 省 token > 功能多。
const MAX_MATCHES = 100;
const MAX_LINE_CHARS = 2000;
/** 上下文档位帽。再宽不给：`context=5` 已经是 6 倍行数，而改点现场不需要 5 行以上——
 *  宽档位只会让 8KB 预算被第一条命中吃光，反而看不见后面的调用点。 */
const CONTEXT_MAX = 5;
/** 带上下文时的输出字符预算。context=0（缺省）不走这条 ⇒ 既有输出字节一字不变。 */
const CONTEXT_BUDGET_CHARS = 8 * 1024;

function clipLine(text: string): string {
  return text.length > MAX_LINE_CHARS ? text.slice(0, MAX_LINE_CHARS) + " …[行截断]" : text;
}

/** 命中行 `Line N: text`（旧口径逐字不变）；邻行 `  N | text`。
 *  两种前缀不是美化：模型要拿这段文本拼 edit_file 的 old_string，
 *  分不清「哪条是命中的那行」就会把邻行抄进定位串——然后按 not-found 失败白跑一轮。 */
function renderLine(m: RawMatch): string {
  return m.ctx
    ? "  " + String(m.line) + " | " + clipLine(m.text)
    : "Line " + String(m.line) + ": " + clipLine(m.text);
}

interface Rendered { text: string; omittedHits: number; byBudget: boolean }

/** 按 rg 的原生顺序渲染（每个文件的 match/context 连续，故顺序分组与旧实现的 Map 分组同结果）。
 *  帽按「命中」计，邻行不占额——按行计帽等于在 context=5 时把可检索命中数砍到 1/6。 */
function renderMatches(entries: RawMatch[], budget: number | null): Rendered {
  const parts: string[] = [];
  let current = "";
  let hits = 0;
  let omittedHits = 0;
  let chars = 0;
  let stopped = false;
  let byBudget = false;
  for (const m of entries) {
    if (stopped) {
      if (!m.ctx) omittedHits++;
      continue;
    }
    if (!m.ctx) {
      hits++;
      if (hits > MAX_MATCHES) {
        omittedHits++;
        stopped = true;
        continue;
      }
    }
    const line = renderLine(m);
    if (budget !== null && chars + line.length > budget) {
      stopped = true;
      byBudget = true;
      if (m.ctx) continue;
      hits--;
      omittedHits++;
      continue;
    }
    if (m.path !== current) {
      current = m.path;
      parts.push(current + ":");
      chars += current.length + 1;
    }
    parts.push(line);
    chars += line.length + 1;
  }
  return { text: parts.join("\n"), omittedHits, byBudget };
}

/** 两种截断说两种话：命中帽到了要照旧口径（agent-plan §工具规格钉了这句），
 *  预算到了必须报出**未列出的条数**——只说"被截断了"的模型会以为已经看全，或原样重跑同一条宽查询。 */
function truncateNote(r: Rendered): string {
  return r.byBudget
    ? `[truncated: 上下文输出超 ${String(CONTEXT_BUDGET_CHARS / 1024)}KB 预算，还有 ${String(r.omittedHits)} 条命中未列出——把 context 调小或收窄 pattern/path]`
    : truncationNotice(MAX_MATCHES) + " more matches available, use more specific path/pattern";
}

export const grep: Tool = {
  name: "grep",
  async run(args, ctx): Promise<ToolResult> {
    const pattern = typeof args.pattern === "string" ? args.pattern : "";
    if (!pattern) throw new Error("grep: pattern 参数必须是非空字符串");
    const rel = typeof args.path === "string" && args.path.trim() ? args.path : ".";
    // path 入参走统一信任边界校验（越界拒绝），"." 表示整个 workspace。
    const abs = rel === "." ? ctx.workspace : resolveInWorkspace(ctx.workspace, rel, "grep");
    // context：一次调用拿到「命中 + 现场」。缺它时定位完还得 read_file 同一段重读一遍，
    // 每一处待改点都多花一轮往返（查/改代码的主路径上，这是按次计的钱）。
    const contextRaw = args.context;
    const context = typeof contextRaw === "number" && Number.isInteger(contextRaw) && contextRaw > 0
      ? Math.min(CONTEXT_MAX, contextRaw)
      : 0;
    // fixed_strings：按字面串匹配。缺它时搜 `foo(` / `a.b` / `$.val` 这类含元字符的串
    // 要么被正则语义曲解（`.` 命中任意字符 = 假阳性成堆），要么 rg 直接退出码 2 报错。
    const fixed = args.fixed_strings === true;
    const entries = await runRgJson(ctx.workspace, [
      "--json",
      ...(fixed ? ["-F"] : []),
      ...(context > 0 ? ["-C", String(context)] : []),
      "-e", pattern, abs,
    ]);
    // 零命中不许只回三个字：那句会被读成「仓库里没有」，而这条查询面根本没扫 .gitignore 里的东西。
    if (entries.length === 0) {
      return { ok: true, output: `无命中（搜索面 ${rel.slice(0, 120)}）\n` + rgNegativeNote("跳过了 .gitignore 里的条目与隐藏文件") };
    }
    const r = renderMatches(entries, context > 0 ? CONTEXT_BUDGET_CHARS : null);
    return { ok: true, output: r.text + (r.omittedHits > 0 ? "\n" + truncateNote(r) : "") };
  },
};
